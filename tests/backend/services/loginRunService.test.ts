import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import type { ActionWithCredential, Credential, Website } from "../../../server/services/dbService.js";

/**
 * No test here launches a real browser. `playwright` is replaced by a fake
 * `chromium` whose `launch` resolves a fake browser, whose `newPage` resolves
 * a fake page; `node:fs/promises`' `mkdir` is replaced so no run folder is
 * created; the built-in login routine (`logInWithCredential`) is replaced -
 * its own spec drives a fake login form, here only its outcome matters; the
 * database and the password decryption are replaced too. The login page and
 * message helpers, the runner's constants and scrubbing, and the request
 * problem stay real.
 */
const {
  mockChromium,
  mockBrowser,
  mockPage,
  mockMkdir,
  mockLogInWithCredential,
  mockDbService,
  mockCredentialEncryption,
  MockTimeoutError,
} = vi.hoisted(() => ({
  mockChromium: { launch: vi.fn() },
  mockBrowser: { newPage: vi.fn(), close: vi.fn() },
  mockPage: {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    screenshot: vi.fn(),
    url: vi.fn(),
  },
  mockMkdir: vi.fn(),
  mockLogInWithCredential: vi.fn(),
  mockDbService: {
    createLoginRunForAction: vi.fn(),
    findCredentialWithPasswordForWebsite: vi.fn(),
  },
  mockCredentialEncryption: {
    CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE: "CREDENTIAL_ENCRYPTION_KEY is not set (test message)",
    credentialEncryptionIsConfigured: vi.fn(),
    decryptCredentialPassword: vi.fn(),
  },
  /** Stands in for Playwright's `errors.TimeoutError`, which `playwrightService` checks with instanceof. */
  MockTimeoutError: class MockTimeoutError extends Error {},
}));

vi.mock("playwright", () => ({
  chromium: mockChromium,
  errors: { TimeoutError: MockTimeoutError },
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  mkdir: mockMkdir,
}));
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/utils/credentialEncryption.js", () => mockCredentialEncryption);
vi.mock("../../../server/services/crawlerLoginService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/crawlerLoginService.js")>()),
  logInWithCredential: mockLogInWithCredential,
}));

import {
  LOGIN_RUN_CREDENTIAL_NOT_FOUND_MESSAGE,
  ONLY_A_LOGIN_ACTION_RUNS_A_LOGIN_MESSAGE,
  performLoginRun,
  runLoginAlone,
  type LoginRunRequest,
} from "../../../server/services/loginRunService.js";
import {
  PLAN_NAVIGATION_TIMEOUT_MS,
  PLAN_RUN_SLOW_MO_MS,
  PLAN_RUN_VIEWPORT,
  PLAN_STEP_TIMEOUT_MS,
} from "../../../server/services/actionPlanRunnerService.js";
import {
  ActionScriptRequestProblem,
  isActionScriptRequestProblem,
} from "../../../server/services/actionScriptExecutionService.js";

const USERNAME = "admin@example.com";
const PASSWORD = "correct horse";
const ACTION_SCRIPT_DIRECTORY = "/srv/action-scripts";
const RUN_DIRECTORY = path.join(ACTION_SCRIPT_DIRECTORY, "website-1", "run-folder");
/** The address the fake page reports once the login is done (see `beforeEach`). */
const DASHBOARD_URL = "https://example.com/dashboard";
/** The website's timing settings, handed to the login untouched. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 7000, screenshotMinimumWaitMs: 250 };

/** One login run on its own, as `performLoginRun` asks for it. */
const LOGIN_RUN_REQUEST: LoginRunRequest = {
  loginActionTitle: "Log in as Admin",
  credentialName: "Admin",
  details: {
    loginUrl: "https://auth.example.com/login",
    username: USERNAME,
    password: PASSWORD,
    usernameSelector: null,
    passwordSelector: null,
    submitSelector: null,
  },
  timingSettings: TIMING_SETTINGS,
  runDirectory: RUN_DIRECTORY,
};

/** The website the Login action belongs to: no default login page. */
const website: Website = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/**
 * The website's Login action: it logs in on its own login page, with one
 * selector of its own, as whichever credential "Run login" picks (it has no
 * credential of its own).
 */
const loginAction: ActionWithCredential = {
  id: "login-action-1",
  websiteId: "website-1",
  credentialId: null,
  loginUrl: "https://auth.example.com/login",
  usernameSelector: "#email",
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Signs in with the picked account",
  userActionKind: "login",
  userObjectTypeKey: null,
  userNameParameterKey: null,
  parametersSyncedAt: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  deletedAt: null,
  credential: null,
};

/** The credential "Run login" picks to log in as, with its encrypted password. */
const credential: Credential = {
  id: "credential-1",
  websiteId: "website-1",
  name: "Admin",
  description: null,
  username: USERNAME,
  encryptedPassword: "iv.tag.ciphertext",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/**
 * Splits a run's log into its lines.
 * @param output - The run's `output`
 * @returns One entry per logged line
 */
function readOutputLines(output: string): string[] {
  return output.split("\n");
}

/** The credential id a "Run login" request picks (the fixture credential's). */
const PICKED_CREDENTIAL_ID = "credential-1";

/**
 * Runs `performLoginRun` and returns what it threw, failing the test when it
 * did not throw.
 * @param runAction - The action to run the login of
 * @param runWebsite - Its website; the fixture website by default
 * @param credentialId - The credential to log in as; the fixture credential by default
 * @returns The thrown value
 */
async function catchLoginRunProblem(
  runAction: ActionWithCredential,
  runWebsite: Website = website,
  credentialId: string = PICKED_CREDENTIAL_ID,
): Promise<unknown> {
  try {
    await performLoginRun(ACTION_SCRIPT_DIRECTORY, runWebsite, runAction, credentialId);
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected performLoginRun to throw");
}

/**
 * Checks that a thrown value is an `ActionScriptRequestProblem` with the given
 * status and message.
 * @param thrown - What the work threw
 * @param httpStatus - The status it should carry
 * @param message - The message it should carry
 */
function expectRequestProblem(thrown: unknown, httpStatus: number, message: string): void {
  expect(thrown).toBeInstanceOf(ActionScriptRequestProblem);
  expect(isActionScriptRequestProblem(thrown)).toBe(true);
  expect(thrown).toMatchObject({ httpStatus, message });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockChromium.launch.mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  mockPage.screenshot.mockResolvedValue(Buffer.from("png"));
  mockPage.url.mockReturnValue(DASHBOARD_URL);
  mockLogInWithCredential.mockResolvedValue({ loggedIn: true, errorMessage: null });
  mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(true);
  mockCredentialEncryption.decryptCredentialPassword.mockReturnValue(PASSWORD);
  mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(credential);
  mockDbService.createLoginRunForAction.mockImplementation(
    (websiteId: string, actionId: string, data: Record<string, unknown>) =>
      Promise.resolve({ id: "login-run-1", websiteId, actionId, ...data }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runLoginAlone", () => {
  it("creates the run folder, opens a headless, slowed-down 1280x720 browser, logs in, and takes one logged-in screenshot", async () => {
    const { durationMs, ...outcome } = await runLoginAlone(LOGIN_RUN_REQUEST);

    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome).toEqual({
      succeeded: true,
      errorMessage: null,
      screenshotFileName: "logged-in.png",
      finalPageUrl: DASHBOARD_URL,
      output: ['Log in with "Log in as Admin" as "Admin" on https://auth.example.com/login', "✔ Logged in"].join("\n"),
    });
    expect(mockMkdir).toHaveBeenCalledWith(RUN_DIRECTORY, { recursive: true });
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: PLAN_RUN_SLOW_MO_MS });
    expect(mockBrowser.newPage).toHaveBeenCalledWith({ viewport: PLAN_RUN_VIEWPORT });
    expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(PLAN_STEP_TIMEOUT_MS);
    expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(PLAN_NAVIGATION_TIMEOUT_MS);
    expect(mockLogInWithCredential).toHaveBeenCalledWith(mockPage, LOGIN_RUN_REQUEST.details, TIMING_SETTINGS);
    expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      path: path.join(RUN_DIRECTORY, "logged-in.png"),
      timeout: PLAN_STEP_TIMEOUT_MS,
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("fails with the login routine's reason, the username and password scrubbed out, and takes a failure screenshot", async () => {
    mockLogInWithCredential.mockResolvedValue({
      loggedIn: false,
      errorMessage: `Still on the login form after submitting ${USERNAME} / ${PASSWORD}`,
    });

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    const expectedError = "Still on the login form after submitting •••••• / ••••••";
    expect(result).toMatchObject({
      succeeded: false,
      errorMessage: expectedError,
      screenshotFileName: "failure.png",
      finalPageUrl: DASHBOARD_URL,
    });
    expect(readOutputLines(result.output)).toEqual([
      'Log in with "Log in as Admin" as "Admin" on https://auth.example.com/login',
      `✘ Could not log in: ${expectedError}`,
    ]);
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      path: path.join(RUN_DIRECTORY, "failure.png"),
      timeout: PLAN_STEP_TIMEOUT_MS,
    });
    expect(result.output).not.toContain(PASSWORD);
    expect(result.output).not.toContain(USERNAME);
  });

  it("still reports a passed login, with no screenshot, when the screenshot could not be taken", async () => {
    mockPage.screenshot.mockRejectedValue(new Error("Target page, context or browser has been closed"));

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    expect(result).toMatchObject({ succeeded: true, errorMessage: null, screenshotFileName: null });
    expect(readOutputLines(result.output)).toEqual([
      'Log in with "Log in as Admin" as "Admin" on https://auth.example.com/login',
      "✔ Logged in",
      "⚠ The screenshot could not be taken",
    ]);
  });

  it("scrubs the username and password from the address the browser ended on", async () => {
    mockPage.url.mockReturnValue(`https://example.com/welcome?user=${USERNAME}`);

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    expect(result.finalPageUrl).toBe("https://example.com/welcome?user=••••••");
  });

  it("fails with the error's first line, scrubbed, and closes the browser when the login routine throws", async () => {
    mockLogInWithCredential.mockRejectedValue(
      new Error(`page.goto: net::ERR_CONNECTION_REFUSED for ${USERNAME}\nCall log:\n  - navigating`),
    );

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    const expectedError = "page.goto: net::ERR_CONNECTION_REFUSED for ••••••";
    expect(result).toMatchObject({
      succeeded: false,
      errorMessage: expectedError,
      screenshotFileName: null,
      finalPageUrl: null,
    });
    expect(readOutputLines(result.output)).toEqual([
      'Log in with "Log in as Admin" as "Admin" on https://auth.example.com/login',
      `✘ Could not log in: ${expectedError}`,
    ]);
    expect(mockPage.screenshot).not.toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("fails, logging only the failure, when no page can be opened", async () => {
    mockBrowser.newPage.mockRejectedValue(new Error("browser.newPage: Target closed"));

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    expect(result).toMatchObject({ succeeded: false, errorMessage: "browser.newPage: Target closed" });
    expect(readOutputLines(result.output)).toEqual(["✘ Could not log in: browser.newPage: Target closed"]);
    expect(mockLogInWithCredential).not.toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("only logs a browser that cannot be closed, keeping the login's result", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockBrowser.close.mockRejectedValue(new Error("browser already gone"));

    const result = await runLoginAlone(LOGIN_RUN_REQUEST);

    expect(result.succeeded).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith("[playwright] could not close the browser: browser already gone");
  });

  it("rejects, launching no browser, when the run folder cannot be created", async () => {
    const folderError = new Error("EACCES: permission denied, mkdir '/srv/action-scripts/website-1'");
    mockMkdir.mockRejectedValue(folderError);

    await expect(runLoginAlone(LOGIN_RUN_REQUEST)).rejects.toBe(folderError);
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("rejects when the browser cannot be launched", async () => {
    const launchError = new Error("browserType.launch: Executable doesn't exist");
    mockChromium.launch.mockRejectedValue(launchError);

    await expect(runLoginAlone(LOGIN_RUN_REQUEST)).rejects.toBe(launchError);
    expect(mockLogInWithCredential).not.toHaveBeenCalled();
  });
});

describe("performLoginRun", () => {
  it("logs in the way the Login action says, as the picked credential, and records the run with its screenshot relative to the action script directory", async () => {
    const loginRun = await performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, PICKED_CREDENTIAL_ID);

    expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith("website-1", "credential-1");
    expect(mockCredentialEncryption.decryptCredentialPassword).toHaveBeenCalledWith("iv.tag.ciphertext");
    expect(mockLogInWithCredential).toHaveBeenCalledWith(
      mockPage,
      {
        loginUrl: "https://auth.example.com/login",
        username: USERNAME,
        password: PASSWORD,
        usernameSelector: "#email",
        passwordSelector: null,
        submitSelector: null,
      },
      TIMING_SETTINGS,
    );
    const [runDirectory] = mockMkdir.mock.calls[0] as [string];
    const runFolderName = path.relative(ACTION_SCRIPT_DIRECTORY, runDirectory).split(path.sep).join("/");
    expect(runFolderName).toMatch(/^website-1\/[0-9a-f-]{36}$/);
    expect(mockDbService.createLoginRunForAction).toHaveBeenCalledWith("website-1", "login-action-1", {
      credentialName: "Admin",
      loginUrl: "https://auth.example.com/login",
      succeeded: true,
      errorMessage: null,
      screenshotFileName: `${runFolderName}/logged-in.png`,
      finalPageUrl: DASHBOARD_URL,
      output: ['Log in with "Log in" as "Admin" on https://auth.example.com/login', "✔ Logged in"].join("\n"),
      durationMs: expect.any(Number) as number,
    });
    expect(loginRun).toMatchObject({ id: "login-run-1", succeeded: true });
  });

  it("logs in as whichever of the website's credentials the request picks, naming it in the run", async () => {
    const viewerCredential: Credential = { ...credential, id: "credential-2", name: "Viewer", username: "viewer@example.com" };
    mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(viewerCredential);

    await performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, "credential-2");

    expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith("website-1", "credential-2");
    expect(mockLogInWithCredential).toHaveBeenCalledWith(
      mockPage,
      expect.objectContaining({ username: "viewer@example.com" }),
      TIMING_SETTINGS,
    );
    expect(mockDbService.createLoginRunForAction).toHaveBeenCalledWith(
      "website-1",
      "login-action-1",
      expect.objectContaining({ credentialName: "Viewer" }),
    );
  });

  it("logs in on the website's login page, and records it, when the Login action has none of its own", async () => {
    const websiteWithLoginUrl: Website = { ...website, loginUrl: "https://example.com/sign-in" };

    await performLoginRun(ACTION_SCRIPT_DIRECTORY, websiteWithLoginUrl, { ...loginAction, loginUrl: null }, PICKED_CREDENTIAL_ID);

    expect(mockLogInWithCredential).toHaveBeenCalledWith(
      mockPage,
      expect.objectContaining({ loginUrl: "https://example.com/sign-in" }),
      TIMING_SETTINGS,
    );
    expect(mockDbService.createLoginRunForAction).toHaveBeenCalledWith(
      "website-1",
      "login-action-1",
      expect.objectContaining({ loginUrl: "https://example.com/sign-in" }),
    );
  });

  it("records a login that failed as a run that did not succeed, with its reason and the failure screenshot", async () => {
    mockLogInWithCredential.mockResolvedValue({ loggedIn: false, errorMessage: "No visible password field was found" });

    const loginRun = await performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, PICKED_CREDENTIAL_ID);

    expect(mockDbService.createLoginRunForAction).toHaveBeenCalledWith(
      "website-1",
      "login-action-1",
      expect.objectContaining({
        succeeded: false,
        errorMessage: "No visible password field was found",
        screenshotFileName: expect.stringMatching(/^website-1\/[0-9a-f-]{36}\/failure\.png$/) as string,
      }),
    );
    expect(loginRun).toMatchObject({ succeeded: false });
  });

  it("records no screenshot when none could be taken", async () => {
    mockPage.screenshot.mockRejectedValue(new Error("Timeout 10000ms exceeded"));

    await performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, PICKED_CREDENTIAL_ID);

    expect(mockDbService.createLoginRunForAction).toHaveBeenCalledWith(
      "website-1",
      "login-action-1",
      expect.objectContaining({ screenshotFileName: null }),
    );
  });

  it("throws 409, looking nothing up, for an action that is not a Login action", async () => {
    const thrown = await catchLoginRunProblem({ ...loginAction, userActionKind: "create" });

    expectRequestProblem(thrown, 409, ONLY_A_LOGIN_ACTION_RUNS_A_LOGIN_MESSAGE);
    expect(mockCredentialEncryption.credentialEncryptionIsConfigured).not.toHaveBeenCalled();
    expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("throws 503, looking nothing up, when no encryption key is configured", async () => {
    mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);

    const thrown = await catchLoginRunProblem(loginAction);

    expectRequestProblem(thrown, 503, "CREDENTIAL_ENCRYPTION_KEY is not set (test message)");
    expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("throws 400 when the picked credential is not an active credential of the website", async () => {
    mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(null);

    const thrown = await catchLoginRunProblem(loginAction, website, "credential-of-another-website");

    expectRequestProblem(thrown, 400, LOGIN_RUN_CREDENTIAL_NOT_FOUND_MESSAGE);
    expect(LOGIN_RUN_CREDENTIAL_NOT_FOUND_MESSAGE).toBe(
      "That credential is not one of this website's; pick one of its credentials to log in as",
    );
    expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith(
      "website-1",
      "credential-of-another-website",
    );
    expect(mockCredentialEncryption.decryptCredentialPassword).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
    expect(mockDbService.createLoginRunForAction).not.toHaveBeenCalled();
  });

  it("throws 400 when neither the Login action nor the website has a login page", async () => {
    const thrown = await catchLoginRunProblem({ ...loginAction, loginUrl: null });

    expectRequestProblem(
      thrown,
      400,
      'The login action "Log in" has no login page URL, and neither does its website; add one to log in',
    );
    expect(mockCredentialEncryption.decryptCredentialPassword).not.toHaveBeenCalled();
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("lets a password that cannot be decrypted reject as it is, launching no browser and recording nothing", async () => {
    const decryptError = new Error("Unsupported state or unable to authenticate data");
    mockCredentialEncryption.decryptCredentialPassword.mockImplementation(() => {
      throw decryptError;
    });

    await expect(performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, PICKED_CREDENTIAL_ID)).rejects.toBe(
      decryptError,
    );
    expect(isActionScriptRequestProblem(decryptError)).toBe(false);
    expect(mockChromium.launch).not.toHaveBeenCalled();
    expect(mockDbService.createLoginRunForAction).not.toHaveBeenCalled();
  });

  it("lets a run that cannot be recorded reject as it is", async () => {
    const insertError = new Error("insert failed");
    mockDbService.createLoginRunForAction.mockRejectedValue(insertError);

    await expect(performLoginRun(ACTION_SCRIPT_DIRECTORY, website, loginAction, PICKED_CREDENTIAL_ID)).rejects.toBe(
      insertError,
    );
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});
