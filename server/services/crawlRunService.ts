import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  adoptWebsiteLoginUrl,
  createCrawlRunForWebsite,
  finishCrawlRun,
  markCrawlRunLoggedIn,
  markRunningCrawlRunsInterrupted,
  recordCrawledPage,
  type CrawlRunWithCredential,
  type CrawledPageInput,
  type CrawlProgress,
  type Credential,
  type FinishedCrawlRunStatus,
  type Website,
} from "./dbService.js";
import {
  CRAWL_PAGE_LIMIT,
  crawlWebsite,
  type CrawlLogin,
  type CrawlStopReason,
} from "./crawlerService.js";
import type { CrawlLoginDetails } from "./crawlerLoginService.js";
import { measureElapsedMs } from "./playwrightService.js";
import { describeError } from "../utils/describeError.js";
import { decryptCredentialPassword } from "../utils/credentialEncryption.js";
import { DEFAULT_CRAWL_BUTTON_MODE, type CrawlButtonMode } from "../utils/crawlButtonModes.js";

/**
 * The websites with a crawl running in THIS process. Checked and updated
 * synchronously - before any `await` - so two requests that arrive together
 * cannot both start a crawl: Node runs one request's synchronous code to the
 * end before the other's.
 */
const websiteIdsBeingCrawled = new Set<string>();

/** Why a run whose browser closed mid-crawl was interrupted. */
const BROWSER_CLOSED_MESSAGE =
  "The browser closed mid-crawl - most likely the server restarted.";

/**
 * A credential's login, ready for the crawler: the decrypted login details,
 * the credential's name for the failure message, and where a screenshot of a
 * failed login goes.
 */
interface CredentialLogin {
  /** The credential's name, as the run's error message names it. */
  credentialName: string;
  /** Where and as whom to log in, with the password decrypted. */
  details: CrawlLoginDetails;
  /** The failure screenshot's name relative to the screenshot directory - what the run stores. */
  failureScreenshotFileName: string;
  /** The failure screenshot's absolute path - where the crawler writes it. */
  failureScreenshotPath: string;
}

/** The status and error message a finished (not deleted) crawl is recorded with. */
interface CrawlRunEnding {
  /** The run's final status. */
  status: FinishedCrawlRunStatus;
  /** Why the crawl failed or was interrupted, or null when it ended normally. */
  errorMessage: string | null;
}

/** What `startCrawlRun` did. */
export type CrawlRunStart =
  | {
      /** False: a crawl of this website is already running, so nothing was started. */
      crawlStarted: false;
    }
  | {
      /** True: the run was created and the crawl is working in the background. */
      crawlStarted: true;
      /** The new run, as created (`status: "running"`), with its credential's id and name. */
      crawlRun: CrawlRunWithCredential;
      /** Resolves once the background crawl has ended and been recorded; never rejects. */
      crawlCompletion: Promise<void>;
    };

/**
 * Records a crawl that broke as `failed`. If even that write fails (e.g. the
 * database went away), the failure is logged instead: this runs in the
 * background, where a rejection would be unhandled and crash the server.
 * @param crawlRun - The run that broke
 * @param crawlStartedAt - The `performance.now()` reading taken when the crawl began
 * @param crawlError - Why the crawl broke
 * @returns Resolves once the failure is recorded or logged
 */
async function recordCrawlFailure(
  crawlRun: CrawlRunWithCredential,
  crawlStartedAt: number,
  crawlError: unknown,
): Promise<void> {
  try {
    await finishCrawlRun(crawlRun.websiteId, crawlRun.id, {
      status: "failed",
      waitingUrlCount: 0,
      errorMessage: describeError(crawlError),
      loginFailureScreenshotFileName: null,
      durationMs: measureElapsedMs(crawlStartedAt),
    });
  } catch (recordError: unknown) {
    console.error(
      `[crawl] crawl run ${crawlRun.id} failed (${describeError(crawlError)}) and could not be marked failed: ${describeError(recordError)}`,
    );
  }
}

/**
 * Decrypts a credential's password and gathers what the crawler needs to log
 * in with it, including where a screenshot of a failed login would go: like
 * the screenshot runs' PNGs, `<websiteId>/<uuid>.png` in the screenshot
 * directory. Nothing is written unless the login fails.
 * The login page is the credential's EFFECTIVE login URL: its own `loginUrl`
 * when it has one, otherwise the website's.
 * @param credential - The credential the crawl logs in as, with its encrypted password
 * @param website - The crawled website, for its login URL and the screenshot's folder
 * @param screenshotDirectory - Absolute path of the screenshot directory (`SCREENSHOT_DIR`)
 * @returns The credential's name, its login details, and the failure screenshot's name and path
 * @throws When neither the credential nor the website has a login URL; when the password cannot be decrypted (no key configured, or the key changed since it was saved)
 */
function buildCredentialLogin(
  credential: Credential,
  website: Website,
  screenshotDirectory: string,
): CredentialLogin {
  const effectiveLoginUrl = credential.loginUrl ?? website.loginUrl;
  if (effectiveLoginUrl === null) {
    throw new Error(
      `The credential "${credential.name}" has no login page URL, and neither does its website`,
    );
  }
  const failureScreenshotFileName = `${website.id}/${randomUUID()}.png`;
  return {
    credentialName: credential.name,
    failureScreenshotFileName,
    failureScreenshotPath: path.join(screenshotDirectory, failureScreenshotFileName),
    details: {
      loginUrl: effectiveLoginUrl,
      username: credential.username,
      password: decryptCredentialPassword(credential.encryptedPassword),
      usernameSelector: credential.usernameSelector,
      passwordSelector: credential.passwordSelector,
      submitSelector: credential.submitSelector,
    },
  };
}

/**
 * Teaches a website the login page URL a crawl just logged in on. The
 * database only saves it while the website still has no login URL (see
 * `adoptWebsiteLoginUrl`), so a URL already set is never overwritten.
 *
 * NEVER rejects: learning the URL is a bonus, so a failure is logged and the
 * crawl goes on logged in.
 * @param websiteId - The crawled website's cuid
 * @param loginUrl - The login page URL the successful login used
 * @returns Resolves once the URL is saved, found already set, or the failure is logged
 */
async function learnWebsiteLoginUrl(websiteId: string, loginUrl: string): Promise<void> {
  try {
    await adoptWebsiteLoginUrl(websiteId, loginUrl);
  } catch (adoptError: unknown) {
    console.error(
      `[crawl] website ${websiteId} could not learn its login page URL ${loginUrl}: ${describeError(adoptError)}`,
    );
  }
}

/**
 * Turns a credential's login into the login the crawler performs: where and
 * as whom to log in, where a failed login's screenshot goes, and what to do
 * once the login succeeded.
 * @param website - The website being crawled, as read when the crawl started
 * @param crawlRun - Its run, created `running`
 * @param credentialLogin - The credential's decrypted login details and failure screenshot location
 * @returns The login to hand to `crawlWebsite`
 */
function buildCrawlLogin(
  website: Website,
  crawlRun: CrawlRunWithCredential,
  credentialLogin: CredentialLogin,
): CrawlLogin {
  /**
   * Marks the run logged in once the crawler's login succeeded, before it
   * records the first page. When the website has no login URL of its own yet,
   * it then LEARNS the one that just worked (the credential's own URL) - a
   * failure to save it is only logged.
   * @returns True to crawl on; false when the run is no longer active
   */
  const recordLoginSucceeded = async (): Promise<boolean> => {
    const runIsStillActive = await markCrawlRunLoggedIn(website.id, crawlRun.id);
    const websiteHasNoLoginUrl = website.loginUrl === null;
    const websiteShouldLearnTheLoginUrl = runIsStillActive && websiteHasNoLoginUrl;
    if (websiteShouldLearnTheLoginUrl) {
      await learnWebsiteLoginUrl(website.id, credentialLogin.details.loginUrl);
    }
    return runIsStillActive;
  };

  return {
    details: credentialLogin.details,
    failureScreenshotPath: credentialLogin.failureScreenshotPath,
    recordLoginSucceeded,
  };
}

/**
 * Turns how the crawler stopped into the status (and error message) the run
 * is finished with. The crawler's normal stop reasons are spelled exactly
 * like the statuses; a closed browser is an `interrupted` run, and a failed
 * login is a `failed` one naming the credential.
 * @param stopReason - Why the crawler stopped (never `stoppedBecauseRunWasDeleted`, which finishes nothing)
 * @param loginErrorMessage - Why the login failed, when it did
 * @param credentialLogin - The credential the crawl logged in as, or null
 * @returns The run's final status and error message
 */
function describeCrawlRunEnding(
  stopReason: Exclude<CrawlStopReason, "stoppedBecauseRunWasDeleted">,
  loginErrorMessage: string | null,
  credentialLogin: CredentialLogin | null,
): CrawlRunEnding {
  switch (stopReason) {
    case "stoppedBecauseBrowserClosed":
      return { status: "interrupted", errorMessage: BROWSER_CLOSED_MESSAGE };
    case "loginFailed": {
      const credentialName = credentialLogin?.credentialName ?? "the credential";
      const reason = loginErrorMessage ?? "no reason was given";
      return { status: "failed", errorMessage: `Login as "${credentialName}" failed: ${reason}` };
    }
    case "finished":
    case "stoppedAtPageLimit":
    case "stoppedAtTimeLimit":
      return { status: stopReason, errorMessage: null };
  }
}

/**
 * Runs one crawl to the end in the background and records it: the login
 * (when it has a credential), each page as it is visited, then how the crawl
 * ended.
 *
 * NEVER rejects - every failure becomes a `failed` run (or a log line) -
 * because nothing awaits it in production. When the run was deleted with its
 * website mid-crawl, nothing more is written. When the browser closed
 * mid-crawl (a server restart: Playwright closes it on SIGTERM), the run is
 * finished as `interrupted` right away, before the process exits. When the
 * login fails, the run is finished as `failed` with no pages, and with the
 * failure screenshot's file name when the crawler managed to take it. When
 * the login succeeds and the website has no login URL yet, the website learns
 * the one that worked. The website's id is released from
 * `websiteIdsBeingCrawled` when it ends, whatever happened.
 * @param website - The website being crawled
 * @param crawlRun - Its run, created `running`
 * @param credentialLogin - The credential to log in as first, or null to crawl logged out
 * @param buttonMode - Which buttons the crawl clicks on each page, on top of following its links
 * @returns Resolves once the crawl has ended and been recorded
 */
async function runCrawlInBackground(
  website: Website,
  crawlRun: CrawlRunWithCredential,
  credentialLogin: CredentialLogin | null,
  buttonMode: CrawlButtonMode,
): Promise<void> {
  const crawlStartedAt = performance.now();

  /**
   * Saves one visited page on this run.
   * @param visitedPage - What visiting the page produced
   * @param progress - The run's counters after this page
   * @returns The saved page's id, or null when the run is no longer active
   */
  const recordVisitedPage = async (
    visitedPage: CrawledPageInput,
    progress: CrawlProgress,
  ): Promise<string | null> => {
    const recordedPage = await recordCrawledPage(website.id, crawlRun.id, progress, visitedPage);
    return recordedPage?.id ?? null;
  };

  const crawlLogin: CrawlLogin | null =
    credentialLogin === null ? null : buildCrawlLogin(website, crawlRun, credentialLogin);

  try {
    const crawlOutcome = await crawlWebsite(
      website.url,
      {
        networkIdleTimeoutMs: website.networkIdleTimeoutMs,
        screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
      },
      recordVisitedPage,
      crawlLogin,
      buttonMode,
    );
    const { stopReason } = crawlOutcome;
    const runWasDeleted = stopReason === "stoppedBecauseRunWasDeleted";
    if (runWasDeleted) {
      return;
    }
    const crawlRunEnding = describeCrawlRunEnding(
      stopReason,
      crawlOutcome.loginErrorMessage,
      credentialLogin,
    );
    const loginFailureScreenshotFileName = crawlOutcome.loginFailureScreenshotWasCaptured
      ? (credentialLogin?.failureScreenshotFileName ?? null)
      : null;
    await finishCrawlRun(website.id, crawlRun.id, {
      status: crawlRunEnding.status,
      waitingUrlCount: crawlOutcome.waitingUrlCount,
      errorMessage: crawlRunEnding.errorMessage,
      loginFailureScreenshotFileName,
      durationMs: measureElapsedMs(crawlStartedAt),
    });
  } catch (crawlError: unknown) {
    await recordCrawlFailure(crawlRun, crawlStartedAt, crawlError);
  } finally {
    websiteIdsBeingCrawled.delete(website.id);
  }
}

/**
 * Starts crawling a website in the background, unless a crawl of it is
 * already running in this process.
 *
 * With a credential, its password is decrypted FIRST - before the website is
 * claimed or a run is created - so a password that cannot be decrypted
 * rejects with nothing started. The crawler then logs in before it records
 * any page.
 *
 * The website's id is claimed synchronously, before anything is awaited, so
 * two simultaneous requests cannot both start one. The run is then created
 * (`status: "running"`, page limit `CRAWL_PAGE_LIMIT`, the credential's id,
 * the button mode) and the crawl starts WITHOUT being awaited: the caller
 * answers at once, and the UI polls the run for progress.
 * @param website - The active website to crawl
 * @param credential - The website's active credential to log in as (with its encrypted password), or null to crawl as a logged-out visitor
 * @param screenshotDirectory - Absolute path of the screenshot directory (`SCREENSHOT_DIR`), where a failed login's screenshot is written
 * @param buttonMode - Which buttons the crawl clicks on each page, on top of following its links; stored on the run. Defaults to `DEFAULT_CRAWL_BUTTON_MODE` (links only)
 * @returns Whether a crawl was started; when it was, the new run and a promise for the crawl's end (for tests - production ignores it)
 * @throws When neither the credential nor the website has a login URL; when the credential's password cannot be decrypted; or when the run cannot be created (the claim is released first)
 */
export async function startCrawlRun(
  website: Website,
  credential: Credential | null,
  screenshotDirectory: string,
  buttonMode: CrawlButtonMode = DEFAULT_CRAWL_BUTTON_MODE,
): Promise<CrawlRunStart> {
  const credentialLogin =
    credential === null ? null : buildCredentialLogin(credential, website, screenshotDirectory);

  const crawlIsAlreadyRunning = websiteIdsBeingCrawled.has(website.id);
  if (crawlIsAlreadyRunning) {
    return { crawlStarted: false };
  }
  websiteIdsBeingCrawled.add(website.id);

  let crawlRun: CrawlRunWithCredential;
  try {
    crawlRun = await createCrawlRunForWebsite(website.id, {
      startUrl: website.url,
      pageLimit: CRAWL_PAGE_LIMIT,
      credentialId: credential?.id ?? null,
      buttonMode,
    });
  } catch (error: unknown) {
    websiteIdsBeingCrawled.delete(website.id);
    throw error;
  }

  const crawlCompletion = runCrawlInBackground(website, crawlRun, credentialLogin, buttonMode);
  return { crawlStarted: true, crawlRun, crawlCompletion };
}

/**
 * Marks every run left `running` by a previous server process as
 * `interrupted`. A crawl only runs inside the server process, so at boot
 * every `running` run was cut off by a restart (`tsx watch` restarts on every
 * server edit).
 *
 * `server.ts` awaits this BEFORE it starts listening, so it can never flip a
 * run this process just started. Never rejects: a failure is logged, and the
 * server still starts.
 * @returns Resolves once the runs are marked or the failure is logged
 */
export async function markUnfinishedCrawlRunsInterrupted(): Promise<void> {
  try {
    const interruptedRunCount = await markRunningCrawlRunsInterrupted();
    const someRunsWereInterrupted = interruptedRunCount > 0;
    if (someRunsWereInterrupted) {
      console.log(`[crawl] marked ${interruptedRunCount} unfinished crawl run(s) interrupted`);
    }
  } catch (error: unknown) {
    console.error(`[crawl] could not mark unfinished crawl runs interrupted: ${describeError(error)}`);
  }
}
