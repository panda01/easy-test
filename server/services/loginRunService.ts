import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  type ActionWithCredential,
  type LoginRun,
  type Website,
  createLoginRunForAction,
  findCredentialWithPasswordForWebsite,
} from "./dbService.js";
import {
  closeBrowserQuietly,
  measureElapsedMs,
  summarizeError,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import {
  buildLoginDetails,
  describeLoginActionWithoutLoginPage,
  findEffectiveLoginUrl,
  logInWithCredential,
  type CrawlLoginDetails,
} from "./crawlerLoginService.js";
import {
  FAILURE_SCREENSHOT_FILE_NAME,
  LOGGED_IN_SCREENSHOT_FILE_NAME,
  PLAN_NAVIGATION_TIMEOUT_MS,
  PLAN_RUN_SLOW_MO_MS,
  PLAN_RUN_VIEWPORT,
  PLAN_STEP_TIMEOUT_MS,
  readScrubbedPageUrl,
  scrubSecrets,
} from "./actionPlanRunnerService.js";
import { ActionScriptRequestProblem, buildRunFolderName } from "./actionScriptExecutionService.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
} from "../utils/credentialEncryption.js";
import { isLoginAction } from "../utils/scoreActionObjectRole.js";

export const ONLY_A_LOGIN_ACTION_RUNS_A_LOGIN_MESSAGE =
  "Only a login action can run a login on its own; this action's kind is not Login";

/** Why a "Run login" was refused: the credential it names is not one of the website's. */
export const LOGIN_RUN_CREDENTIAL_NOT_FOUND_MESSAGE =
  "That credential is not one of this website's; pick one of its credentials to log in as";

/** Everything one login run needs, with the credential already decrypted. */
export interface LoginRunRequest {
  /** The Login action's title, for the log. */
  loginActionTitle: string;
  /** The credential's name, for the log. */
  credentialName: string;
  /** Where and as whom to log in (see `buildLoginDetails`). */
  details: CrawlLoginDetails;
  /** The website's network idle cap and minimum wait, which the login waits by. */
  timingSettings: ScreenshotTimingSettings;
  /** Absolute path of this run's own (new) folder; its screenshot is written there. */
  runDirectory: string;
}

/** What one login run produced. */
export interface LoginRunResult {
  /** True when the login form was submitted and went away. */
  succeeded: boolean;
  /** Why it failed (the username and password scrubbed out), or null when it passed. */
  errorMessage: string | null;
  /** The screenshot's file name inside the run folder (`logged-in.png` or `failure.png`), or null when none could be taken. */
  screenshotFileName: string | null;
  /** The address the browser was on at the end (scrubbed), or null when it could not be read. */
  finalPageUrl: string | null;
  /** The run's log, one line per entry, joined with newlines. */
  output: string;
  /** Milliseconds from browser launch to browser close. */
  durationMs: number;
}

/**
 * Writes a viewport screenshot of the page into the run folder. Never
 * rejects: a screenshot that cannot be taken must not change how the login
 * went.
 * @param page - The run's page
 * @param runDirectory - The run's folder (created when missing)
 * @param fileName - The PNG's name inside it
 * @returns The file name when the PNG was written, or null
 */
async function takeLoginRunScreenshot(page: Page, runDirectory: string, fileName: string): Promise<string | null> {
  try {
    await page.screenshot({ path: path.join(runDirectory, fileName), timeout: PLAN_STEP_TIMEOUT_MS });
    return fileName;
  } catch {
    return null;
  }
}

/**
 * Logs in once, on its own, the way a Login action does - the "Run login"
 * button. Launches a browser like a plan run does (headless, slowed down,
 * 1280x720), runs the built-in login routine (`logInWithCredential`), and
 * takes ONE screenshot into the run folder: `logged-in.png` when the login
 * passed, `failure.png` when it failed. The username and password are
 * scrubbed from the log, the error, and the final address.
 * @param request - The login, the website's timing settings, and the run folder
 * @returns How it went, its log, its screenshot, and how long it took
 * @throws When the run folder cannot be created or the browser cannot be launched
 */
export async function runLoginAlone(request: LoginRunRequest): Promise<LoginRunResult> {
  await mkdir(request.runDirectory, { recursive: true });
  const secrets = [request.details.password, request.details.username];
  const outputLines: string[] = [];
  /**
   * Appends one line to the run log, with the credential's values scrubbed.
   * @param line - The line
   */
  const log = (line: string): void => {
    outputLines.push(scrubSecrets(line, secrets));
  };

  const startedAt = performance.now();
  const browser = await chromium.launch({ headless: true, slowMo: PLAN_RUN_SLOW_MO_MS });
  let errorMessage: string | null = null;
  let screenshotFileName: string | null = null;
  let finalPageUrl: string | null = null;
  try {
    const page = await browser.newPage({ viewport: PLAN_RUN_VIEWPORT });
    page.setDefaultTimeout(PLAN_STEP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PLAN_NAVIGATION_TIMEOUT_MS);

    log(`Log in with "${request.loginActionTitle}" as "${request.credentialName}" on ${request.details.loginUrl}`);
    const loginAttempt = await logInWithCredential(page, request.details, request.timingSettings);
    if (loginAttempt.loggedIn) {
      log("✔ Logged in");
    } else {
      errorMessage = scrubSecrets(loginAttempt.errorMessage, secrets);
      log(`✘ Could not log in: ${errorMessage}`);
    }
    const screenshotName = loginAttempt.loggedIn ? LOGGED_IN_SCREENSHOT_FILE_NAME : FAILURE_SCREENSHOT_FILE_NAME;
    screenshotFileName = await takeLoginRunScreenshot(page, request.runDirectory, screenshotName);
    if (screenshotFileName === null) {
      log("⚠ The screenshot could not be taken");
    }
    finalPageUrl = readScrubbedPageUrl(page, secrets);
  } catch (error: unknown) {
    errorMessage = scrubSecrets(summarizeError(error), secrets);
    log(`✘ Could not log in: ${errorMessage}`);
  } finally {
    await closeBrowserQuietly(browser);
  }

  return {
    succeeded: errorMessage === null,
    errorMessage,
    screenshotFileName,
    finalPageUrl,
    output: outputLines.join("\n"),
    durationMs: measureElapsedMs(startedAt),
  };
}

/**
 * Runs the Login action's login once, as the credential the user picked,
 * and records it as a `LoginRun` - the work behind the "Run login" route,
 * after the lookups and the one-run-per-action claim (`claimActionRun`,
 * shared with plan runs, so two browsers never use the Login action at once).
 *
 * Checks that it is a Login action, that the encryption key is configured,
 * that the credential is one of the website's, and that the Login action has
 * a login page (its own, or the website's); then logs in (see
 * `runLoginAlone`) into a new run folder under the action script directory
 * and records the run. A login that FAILED is still a successfully recorded
 * run (`succeeded: false`); only a run that could not be started or recorded
 * throws.
 * @param actionScriptDirectory - Absolute path of the action script directory (run folders are written there)
 * @param website - The active website
 * @param action - The active action, which must be a Login action
 * @param credentialId - The cuid of the credential to log in as
 * @returns The recorded login run
 * @throws {ActionScriptRequestProblem} 409 when the action is not a Login action; 503 when no encryption key is configured; 400 when the credential is not an active credential of the website, or neither the Login action nor the website has a login page
 * @throws Anything else the password decryption, the browser, or a query rejects with
 */
export async function performLoginRun(
  actionScriptDirectory: string,
  website: Website,
  action: ActionWithCredential,
  credentialId: string,
): Promise<LoginRun> {
  if (!isLoginAction(action)) {
    throw new ActionScriptRequestProblem(409, ONLY_A_LOGIN_ACTION_RUNS_A_LOGIN_MESSAGE);
  }
  if (!credentialEncryptionIsConfigured()) {
    throw new ActionScriptRequestProblem(503, CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE);
  }
  const credential = await findCredentialWithPasswordForWebsite(website.id, credentialId);
  if (credential === null) {
    throw new ActionScriptRequestProblem(400, LOGIN_RUN_CREDENTIAL_NOT_FOUND_MESSAGE);
  }
  const loginUrl = findEffectiveLoginUrl(action, website);
  if (loginUrl === null) {
    throw new ActionScriptRequestProblem(400, describeLoginActionWithoutLoginPage(action.title));
  }

  const runFolderName = buildRunFolderName(website.id);
  const loginRun = await runLoginAlone({
    loginActionTitle: action.title,
    credentialName: credential.name,
    details: buildLoginDetails(action, credential, website),
    timingSettings: {
      networkIdleTimeoutMs: website.networkIdleTimeoutMs,
      screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
    },
    runDirectory: path.join(actionScriptDirectory, runFolderName),
  });
  return createLoginRunForAction(website.id, action.id, {
    credentialName: credential.name,
    loginUrl,
    succeeded: loginRun.succeeded,
    errorMessage: loginRun.errorMessage,
    screenshotFileName:
      loginRun.screenshotFileName === null ? null : `${runFolderName}/${loginRun.screenshotFileName}`,
    finalPageUrl: loginRun.finalPageUrl,
    output: loginRun.output,
    durationMs: loginRun.durationMs,
  });
}
