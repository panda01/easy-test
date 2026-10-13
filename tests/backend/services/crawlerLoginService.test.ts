import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "playwright";
import type { Credential, Website } from "../../../server/services/dbService.js";

/**
 * No test here launches a browser. The two page-level helpers the login uses
 * (`navigateToUrl`, `waitForPageReadiness`) are replaced, and the page is a
 * FAKE LOGIN PAGE (see `buildFakePage`): every locator is resolved to the
 * part of the form it stands for - the password field, the username field,
 * the submit button, the `<form>`, or `<body>` - and `fakeLoginPage` decides
 * how each part behaves. The real browser round trip is proven by the manual
 * verification run against a real login form.
 */
const { mockNavigateToUrl, mockWaitForPageReadiness, mockMkdir, mockDecryptCredentialPassword } =
  vi.hoisted(() => ({
    mockNavigateToUrl: vi.fn(),
    mockWaitForPageReadiness: vi.fn(),
    /** The failure screenshot's folder is "created" here instead of on disk. */
    mockMkdir: vi.fn(),
    /** Decryption is replaced: its own spec covers the cryptography. */
    mockDecryptCredentialPassword: vi.fn(),
  }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actualFsPromises = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actualFsPromises, mkdir: mockMkdir };
});

vi.mock("../../../server/utils/credentialEncryption.js", () => ({
  decryptCredentialPassword: mockDecryptCredentialPassword,
}));

vi.mock("../../../server/services/playwrightService.js", async (importOriginal) => {
  const actualPlaywrightService =
    await importOriginal<typeof import("../../../server/services/playwrightService.js")>();
  return {
    ...actualPlaywrightService,
    navigateToUrl: mockNavigateToUrl,
    waitForPageReadiness: mockWaitForPageReadiness,
  };
});

import {
  buildCrawlLoginDetails,
  captureLoginFailureScreenshot,
  DEFAULT_PASSWORD_FIELD_SELECTOR,
  DEFAULT_SUBMIT_BUTTON_SELECTOR,
  DEFAULT_USERNAME_FIELD_SELECTOR,
  LOGIN_RESULT_TIMEOUT_MS,
  LOGIN_STEP_TIMEOUT_MS,
  STILL_ON_LOGIN_FORM_MESSAGE,
  logInWithCredential,
  type CrawlLoginDetails,
} from "../../../server/services/crawlerLoginService.js";
import {
  ACTION_REQUESTS_POLL_INTERVAL_MS,
  ACTION_REQUESTS_QUIET_WINDOW_MS,
} from "../../../server/services/pageActionService.js";

/** The website's timing settings, passed through to every readiness wait. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 0 };

/** A login that lets the crawler find every part of the form itself. */
const AUTOMATIC_LOGIN: CrawlLoginDetails = {
  loginUrl: "https://example.com/login",
  username: "admin@example.com",
  password: "correct horse",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
};

/** A login that names its own selector for every part of the form. */
const SELECTOR_LOGIN: CrawlLoginDetails = {
  ...AUTOMATIC_LOGIN,
  usernameSelector: "#email",
  passwordSelector: "#pwd",
  submitSelector: "button.go",
};

/** Which part of the login page a locator stands for. */
type FormPart = "password" | "username" | "submit" | "form" | "body";

/** Every selector the login can ask for, and the part of the page it finds. */
const FORM_PART_BY_SELECTOR: Record<string, FormPart> = {
  [DEFAULT_PASSWORD_FIELD_SELECTOR]: "password",
  [DEFAULT_USERNAME_FIELD_SELECTOR]: "username",
  [DEFAULT_SUBMIT_BUTTON_SELECTOR]: "submit",
  "#pwd": "password",
  "#email": "username",
  "button.go": "submit",
  form: "form",
  body: "body",
};

/** How the fake login page behaves; `beforeEach` resets it to a working login. */
let fakeLoginPage: {
  /** Whether the password field shows up. */
  passwordFieldIsShown: boolean;
  /** Whether the username field shows up. */
  usernameFieldIsShown: boolean;
  /** Whether a named submit button shows up. */
  submitButtonIsShown: boolean;
  /** How many `<form>`s hold the password field. */
  formCount: number;
  /** How many visible submit buttons the form has. */
  submitButtonCount: number;
  /** Whether waiting for the password field to go away after submitting succeeds. */
  passwordFieldGoesAwayAfterSubmit: boolean;
  /** Whether the password field is on screen when the login's result is finally checked. */
  passwordFieldIsShownAfterSubmit: boolean;
  /** How many network requests submitting the form starts. */
  signInRequestsStartedBySubmit: number;
  /** After how many 100 ms checks those requests finish (Infinity: never). */
  checksUntilSignInRequestsFinish: number;
  /** When set, filling a field rejects with this. */
  fillError: Error | null;
  /** When set, clicking the submit button rejects with this. */
  clickError: Error | null;
  /** When set, checking the password field after submitting rejects with this. */
  isVisibleError: Error | null;
  /** When set, `page.waitForTimeout` rejects with this (the page closed). */
  waitForTimeoutError: Error | null;
};

/** The fake page's request event listeners, by event name. */
let pageListeners = new Map<string, Set<() => void>>();

/** How many 100 ms checks the login has made so far. */
let timeoutWaitCount = 0;

/**
 * Fires one of the fake page's events at every listener, like Playwright
 * does when a request starts, finishes, or fails.
 * @param eventName - "request", "requestfinished", or "requestfailed"
 */
function emitPageEvent(eventName: string): void {
  for (const listener of pageListeners.get(eventName) ?? []) {
    listener();
  }
}

/**
 * Counts every listener still attached to the fake page.
 * @returns How many listeners are attached
 */
function countPageListeners(): number {
  return [...pageListeners.values()].reduce((total, listeners) => total + listeners.size, 0);
}

/** Starts the requests submitting the form starts on the fake site. */
function startSignInRequests(): void {
  for (let requestIndex = 0; requestIndex < fakeLoginPage.signInRequestsStartedBySubmit; requestIndex += 1) {
    emitPageEvent("request");
  }
}

/** What the login did to the page, in order, e.g. "fill username admin@example.com". */
let pageActions: string[] = [];

/** The scope ("page", "form", or "body") each part was looked up in. */
let lookupScopes: Partial<Record<FormPart, string>> = {};

/** A fake Playwright locator, carrying only what the login calls. */
interface FakeLocator {
  locator: (selector: string) => FakeLocator;
  filter: (options: unknown) => FakeLocator;
  first: () => FakeLocator;
  count: () => Promise<number>;
  waitFor: (options: { state: string; timeout: number }) => Promise<void>;
  fill: (value: string, options: { timeout: number }) => Promise<void>;
  click: (options: { timeout: number }) => Promise<void>;
  press: (key: string, options: { timeout: number }) => Promise<void>;
  isVisible: () => Promise<boolean>;
}

/**
 * Reads whether a part of the page is on screen before submitting.
 * @param formPart - The part
 * @returns True when the part shows up
 */
function formPartIsShown(formPart: FormPart): boolean {
  if (formPart === "password") return fakeLoginPage.passwordFieldIsShown;
  if (formPart === "username") return fakeLoginPage.usernameFieldIsShown;
  if (formPart === "submit") return fakeLoginPage.submitButtonIsShown;
  return true;
}

/**
 * Builds a fake locator for one part of the login page.
 * @param formPart - The part it stands for
 * @returns The fake locator
 */
function buildFakeLocator(formPart: FormPart): FakeLocator {
  const fakeLocator: FakeLocator = {
    locator: (selector) => {
      const childPart = FORM_PART_BY_SELECTOR[selector];
      lookupScopes[childPart] = formPart;
      return buildFakeLocator(childPart);
    },
    filter: () => fakeLocator,
    first: () => fakeLocator,
    count: () => {
      if (formPart === "form") return Promise.resolve(fakeLoginPage.formCount);
      if (formPart === "submit") return Promise.resolve(fakeLoginPage.submitButtonCount);
      return Promise.resolve(1);
    },
    waitFor: ({ state, timeout }) => {
      const waitingForThePartToGo = state === "hidden";
      if (waitingForThePartToGo) {
        pageActions.push(`wait up to ${String(timeout)} ms for the ${formPart} field to go`);
      }
      const waitSucceeds = waitingForThePartToGo
        ? fakeLoginPage.passwordFieldGoesAwayAfterSubmit
        : formPartIsShown(formPart);
      return waitSucceeds
        ? Promise.resolve()
        : Promise.reject(new Error(`locator.waitFor: Timeout ${String(timeout)}ms exceeded.`));
    },
    fill: (value) => {
      if (fakeLoginPage.fillError !== null) return Promise.reject(fakeLoginPage.fillError);
      pageActions.push(`fill ${formPart} ${value}`);
      return Promise.resolve();
    },
    click: () => {
      if (fakeLoginPage.clickError !== null) return Promise.reject(fakeLoginPage.clickError);
      pageActions.push(`click ${formPart}`);
      startSignInRequests();
      return Promise.resolve();
    },
    press: (key) => {
      pageActions.push(`press ${key} in ${formPart}`);
      startSignInRequests();
      return Promise.resolve();
    },
    isVisible: () => {
      if (fakeLoginPage.isVisibleError !== null) return Promise.reject(fakeLoginPage.isVisibleError);
      pageActions.push(`check whether the ${formPart} field is still shown`);
      return Promise.resolve(fakeLoginPage.passwordFieldIsShownAfterSubmit);
    },
  };
  return fakeLocator;
}

/**
 * The fake page's `waitForTimeout`. Each 100 ms check is recorded, and the
 * sign-in's requests finish after `checksUntilSignInRequestsFinish` checks.
 * @param timeoutMs - How long the login asked to wait
 * @returns Resolves at once (no real time passes), or rejects with `waitForTimeoutError`
 */
function fakeWaitForTimeout(timeoutMs: number): Promise<void> {
  if (fakeLoginPage.waitForTimeoutError !== null) {
    return Promise.reject(fakeLoginPage.waitForTimeoutError);
  }
  pageActions.push(`wait ${String(timeoutMs)} ms`);
  timeoutWaitCount += 1;
  const signInRequestsFinishNow = timeoutWaitCount === fakeLoginPage.checksUntilSignInRequestsFinish;
  if (signInRequestsFinishNow) {
    for (let requestIndex = 0; requestIndex < fakeLoginPage.signInRequestsStartedBySubmit; requestIndex += 1) {
      emitPageEvent("requestfinished");
    }
  }
  return Promise.resolve();
}

/**
 * Builds the fake page the login runs on.
 * @returns A Page-shaped stand-in
 */
function buildFakePage(): Page {
  const fakePage = {
    locator: (selector: string) => {
      const formPart = FORM_PART_BY_SELECTOR[selector];
      lookupScopes[formPart] = "page";
      return buildFakeLocator(formPart);
    },
    on: (eventName: string, listener: () => void) => {
      const listeners = pageListeners.get(eventName) ?? new Set<() => void>();
      listeners.add(listener);
      pageListeners.set(eventName, listeners);
    },
    off: (eventName: string, listener: () => void) => {
      pageListeners.get(eventName)?.delete(listener);
    },
    waitForTimeout: fakeWaitForTimeout,
  };
  // Only the members above are ever called; the rest of Page is not needed.
  return fakePage as unknown as Page;
}

describe("logInWithCredential", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fakeLoginPage = {
      passwordFieldIsShown: true,
      usernameFieldIsShown: true,
      submitButtonIsShown: true,
      formCount: 1,
      submitButtonCount: 1,
      passwordFieldGoesAwayAfterSubmit: true,
      passwordFieldIsShownAfterSubmit: false,
      signInRequestsStartedBySubmit: 0,
      checksUntilSignInRequestsFinish: Infinity,
      fillError: null,
      clickError: null,
      isVisibleError: null,
      waitForTimeoutError: null,
    };
    pageActions = [];
    lookupScopes = {};
    pageListeners = new Map();
    timeoutWaitCount = 0;
    mockNavigateToUrl.mockImplementation(() => {
      pageActions.push("load the login page");
      return Promise.resolve({ navigationCompleted: true, httpStatus: 200, durationMs: 40 });
    });
    mockWaitForPageReadiness.mockImplementation(() => {
      pageActions.push("wait until ready (website timing settings)");
      return Promise.resolve();
    });
  });

  it("opens the login page, finds the form's fields itself, fills them in, submits, and reports success", async () => {
    const page = buildFakePage();

    const loginAttempt = await logInWithCredential(page, AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
    expect(mockNavigateToUrl).toHaveBeenCalledWith(page, "https://example.com/login");
    expect(mockWaitForPageReadiness).toHaveBeenCalledTimes(1);
    expect(mockWaitForPageReadiness).toHaveBeenCalledWith(page, TIMING_SETTINGS);
  });

  it("types nothing until the login page is ready, then gives the site time to answer before judging the login", async () => {
    await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    const quietChecks = ACTION_REQUESTS_QUIET_WINDOW_MS / ACTION_REQUESTS_POLL_INTERVAL_MS;
    expect(pageActions).toEqual([
      "load the login page",
      "wait until ready (website timing settings)",
      "fill username admin@example.com",
      "fill password correct horse",
      "click submit",
      `wait up to ${String(LOGIN_RESULT_TIMEOUT_MS)} ms for the password field to go`,
      ...Array<string>(quietChecks).fill("wait 100 ms"),
      "check whether the password field is still shown",
    ]);
  });

  it("judges the login only after the requests the submit started have finished and stayed quiet", async () => {
    fakeLoginPage.signInRequestsStartedBySubmit = 2;
    fakeLoginPage.checksUntilSignInRequestsFinish = 7;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
    const checksBeforeTheVerdict = pageActions.filter((action) => action === "wait 100 ms");
    // 7 checks while the sign-in ran (the 7th saw it finish), then 5 quiet ones.
    expect(checksBeforeTheVerdict).toHaveLength(12);
    expect(pageActions.at(-1)).toBe("check whether the password field is still shown");
  });

  it("stops waiting for the sign-in's requests at the website's network idle cap", async () => {
    fakeLoginPage.signInRequestsStartedBySubmit = 1;
    fakeLoginPage.checksUntilSignInRequestsFinish = Infinity;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, {
      networkIdleTimeoutMs: 1000,
      screenshotMinimumWaitMs: 0,
    });

    expect(loginAttempt).toEqual({ loggedIn: true });
    expect(pageActions.filter((action) => action === "wait 100 ms")).toHaveLength(10);
  });

  it("does not wait for the sign-in's requests when the website's network idle cap is 0", async () => {
    fakeLoginPage.signInRequestsStartedBySubmit = 1;

    await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, {
      networkIdleTimeoutMs: 0,
      screenshotMinimumWaitMs: 0,
    });

    expect(pageActions).not.toContain("wait 100 ms");
  });

  it("never judges the login sooner than the website's minimum wait after the submit", async () => {
    await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, {
      networkIdleTimeoutMs: 0,
      screenshotMinimumWaitMs: 3000,
    });

    const minimumWaitAction = pageActions.find((action) => /^wait \d+ ms$/.test(action));
    const minimumWaitMs = Number(minimumWaitAction?.match(/\d+/)?.[0]);
    expect(minimumWaitMs).toBeGreaterThan(2900);
    expect(minimumWaitMs).toBeLessThanOrEqual(3000);
    expect(pageActions.at(-1)).toBe("check whether the password field is still shown");
  });

  it("stops listening to the page's requests once the login's result is known", async () => {
    fakeLoginPage.signInRequestsStartedBySubmit = 1;
    fakeLoginPage.checksUntilSignInRequestsFinish = 1;

    await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(countPageListeners()).toBe(0);
  });

  it("looks for the username field and the submit button inside the form that holds the password field", async () => {
    await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(lookupScopes.username).toBe("form");
    expect(lookupScopes.submit).toBe("form");
  });

  it("looks in the whole body when the password field is in no form", async () => {
    fakeLoginPage.formCount = 0;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
    expect(lookupScopes.username).toBe("body");
    expect(lookupScopes.submit).toBe("body");
  });

  it("presses Enter in the password field when the form has no submit button", async () => {
    fakeLoginPage.submitButtonCount = 0;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
    expect(pageActions).toContain("press Enter in password");
    expect(pageActions).not.toContain("click submit");
  });

  it("uses the credential's own selectors, looked up on the whole page, instead of guessing", async () => {
    const loginAttempt = await logInWithCredential(buildFakePage(), SELECTOR_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
    expect(lookupScopes.username).toBe("page");
    expect(lookupScopes.submit).toBe("page");
    expect(pageActions).toEqual(
      expect.arrayContaining([
        "fill username admin@example.com",
        "fill password correct horse",
        "click submit",
      ]),
    );
  });

  it("fails, naming the selector, when the credential's submit button never shows up", async () => {
    fakeLoginPage.submitButtonIsShown = false;

    const loginAttempt = await logInWithCredential(buildFakePage(), SELECTOR_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: 'No visible submit button was found on the login page (selector "button.go")',
    });
  });

  it("fails without touching the form when the login page cannot be loaded", async () => {
    mockNavigateToUrl.mockResolvedValue({
      navigationCompleted: false,
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/login",
      durationMs: 5,
    });

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage:
        "The login page could not be loaded: page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/login",
    });
    expect(pageActions).toEqual([]);
    expect(mockWaitForPageReadiness).not.toHaveBeenCalled();
  });

  it("fails when the login page answers with an HTTP error", async () => {
    mockNavigateToUrl.mockResolvedValue({ navigationCompleted: true, httpStatus: 404, durationMs: 5 });

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: "The login page could not be loaded: The page responded with HTTP 404",
    });
  });

  it("goes on when the login page gave no response at all (e.g. a client-side route)", async () => {
    mockNavigateToUrl.mockResolvedValue({ navigationCompleted: true, httpStatus: null, durationMs: 5 });

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
  });

  it("fails when the login page never becomes ready", async () => {
    mockWaitForPageReadiness.mockRejectedValueOnce(new Error("page.evaluate: Target closed\nCall log: ..."));

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: "The login page did not become ready: page.evaluate: Target closed",
    });
  });

  it("fails, saying it guessed, when no password field shows up", async () => {
    fakeLoginPage.passwordFieldIsShown = false;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: "No visible password field was found on the login page (found automatically)",
    });
  });

  it("fails, naming the selector, when the credential's password field never shows up", async () => {
    fakeLoginPage.passwordFieldIsShown = false;

    const loginAttempt = await logInWithCredential(buildFakePage(), SELECTOR_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: 'No visible password field was found on the login page (selector "#pwd")',
    });
  });

  it("fails when no username field shows up", async () => {
    fakeLoginPage.usernameFieldIsShown = false;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage: "No visible username field was found on the login page (found automatically)",
    });
  });

  it("fails when the fields cannot be filled in", async () => {
    fakeLoginPage.fillError = new Error("locator.fill: Element is not an <input>\nCall log: ...");

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage:
        "The login form could not be filled in and submitted: locator.fill: Element is not an <input>",
    });
  });

  it("fails when the submit button cannot be clicked, and stops listening to the page", async () => {
    fakeLoginPage.clickError = new Error("locator.click: Element is outside of the viewport\nCall log: ...");

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage:
        "The login form could not be filled in and submitted: locator.click: Element is outside of the viewport",
    });
    expect(countPageListeners()).toBe(0);
  });

  it("fails when the page closes while waiting for the sign-in, and stops listening to it", async () => {
    fakeLoginPage.waitForTimeoutError = new Error("page.waitForTimeout: Target page has been closed");

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage:
        "Whether the login worked could not be checked: page.waitForTimeout: Target page has been closed",
    });
    expect(countPageListeners()).toBe(0);
  });

  it(`fails when the login form is still on screen ${String(LOGIN_RESULT_TIMEOUT_MS)} ms after submitting (a wrong username or password)`, async () => {
    fakeLoginPage.passwordFieldGoesAwayAfterSubmit = false;
    fakeLoginPage.passwordFieldIsShownAfterSubmit = true;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: false, errorMessage: STILL_ON_LOGIN_FORM_MESSAGE });
    expect(pageActions).toContain(
      `wait up to ${String(LOGIN_RESULT_TIMEOUT_MS)} ms for the password field to go`,
    );
  });

  it("fails when the form only vanished for a moment and is back once the sign-in finished (a page re-rendered with an error)", async () => {
    fakeLoginPage.passwordFieldGoesAwayAfterSubmit = true;
    fakeLoginPage.passwordFieldIsShownAfterSubmit = true;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: false, errorMessage: STILL_ON_LOGIN_FORM_MESSAGE });
  });

  it("succeeds when the form outlasts the wait but is gone once the sign-in's requests have finished", async () => {
    fakeLoginPage.passwordFieldGoesAwayAfterSubmit = false;
    fakeLoginPage.passwordFieldIsShownAfterSubmit = false;

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({ loggedIn: true });
  });

  it("fails when whether the login worked cannot be checked", async () => {
    fakeLoginPage.isVisibleError = new Error("locator.isVisible: Target page has been closed");

    const loginAttempt = await logInWithCredential(buildFakePage(), AUTOMATIC_LOGIN, TIMING_SETTINGS);

    expect(loginAttempt).toEqual({
      loggedIn: false,
      errorMessage:
        "Whether the login worked could not be checked: locator.isVisible: Target page has been closed",
    });
  });
});

describe("captureLoginFailureScreenshot", () => {
  /** The fake page's `screenshot`, the only member the capture calls. */
  const mockScreenshot = vi.fn();
  const fakePage = { screenshot: mockScreenshot } as unknown as Page;
  const SCREENSHOT_FILE_PATH = "/screenshots/website-1/failed-login.png";

  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockScreenshot.mockResolvedValue(Buffer.from("png"));
  });

  it("creates the screenshot's folder, then writes the viewport PNG, and reports it", async () => {
    const screenshotWasCaptured = await captureLoginFailureScreenshot(fakePage, SCREENSHOT_FILE_PATH);

    expect(screenshotWasCaptured).toBe(true);
    expect(mockMkdir).toHaveBeenCalledWith("/screenshots/website-1", { recursive: true });
    expect(mockScreenshot).toHaveBeenCalledWith({
      path: SCREENSHOT_FILE_PATH,
      timeout: LOGIN_STEP_TIMEOUT_MS,
    });
  });

  it("logs and reports false, instead of rejecting, when the screenshot cannot be taken", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockScreenshot.mockRejectedValue(new Error("page.screenshot: Target page has been closed\nCall log: ..."));

    const screenshotWasCaptured = await captureLoginFailureScreenshot(fakePage, SCREENSHOT_FILE_PATH);

    expect(screenshotWasCaptured).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] the login failure screenshot could not be saved: page.screenshot: Target page has been closed",
    );
    consoleErrorSpy.mockRestore();
  });

  it("reports false without taking a screenshot when the folder cannot be created", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockMkdir.mockRejectedValue(new Error("EACCES: permission denied"));

    const screenshotWasCaptured = await captureLoginFailureScreenshot(fakePage, SCREENSHOT_FILE_PATH);

    expect(screenshotWasCaptured).toBe(false);
    expect(mockScreenshot).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("buildCrawlLoginDetails", () => {
  /** A website without a login page of its own. */
  const website: Website = {
    id: "website-1",
    url: "https://example.com/",
    name: "Example",
    description: null,
    networkIdleTimeoutMs: 5000,
    screenshotMinimumWaitMs: 1,
    loginUrl: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    deletedAt: null,
  };

  /** The website with a login page, which credentials without one inherit. */
  const websiteWithLoginUrl: Website = { ...website, loginUrl: "https://example.com/sign-in" };

  /** A credential with its own login page and some of its own selectors. */
  const credential: Credential = {
    id: "credential-1",
    websiteId: "website-1",
    name: "Admin",
    description: null,
    username: "admin@example.com",
    encryptedPassword: "iv.tag.ciphertext",
    loginUrl: "https://auth.example.com/login",
    usernameSelector: "#email",
    passwordSelector: null,
    submitSelector: "button.sign-in",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockDecryptCredentialPassword.mockReturnValue("correct horse");
  });

  it("decrypts the password and gathers the credential's login page, username, and selectors", () => {
    const loginDetails = buildCrawlLoginDetails(credential, website);

    expect(loginDetails).toEqual({
      loginUrl: "https://auth.example.com/login",
      username: "admin@example.com",
      password: "correct horse",
      usernameSelector: "#email",
      passwordSelector: null,
      submitSelector: "button.sign-in",
    });
    expect(mockDecryptCredentialPassword).toHaveBeenCalledWith("iv.tag.ciphertext");
  });

  it("prefers the credential's own login page over the website's", () => {
    const loginDetails = buildCrawlLoginDetails(credential, websiteWithLoginUrl);

    expect(loginDetails.loginUrl).toBe("https://auth.example.com/login");
  });

  it("falls back to the website's login page when the credential has none", () => {
    const loginDetails = buildCrawlLoginDetails({ ...credential, loginUrl: null }, websiteWithLoginUrl);

    expect(loginDetails.loginUrl).toBe("https://example.com/sign-in");
  });

  it("passes every selector through, including when none are set", () => {
    const credentialWithoutSelectors: Credential = {
      ...credential,
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    };
    const credentialWithEverySelector: Credential = {
      ...credential,
      usernameSelector: "#user",
      passwordSelector: "#pass",
      submitSelector: "#go",
    };

    expect(buildCrawlLoginDetails(credentialWithoutSelectors, website)).toMatchObject({
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    });
    expect(buildCrawlLoginDetails(credentialWithEverySelector, website)).toMatchObject({
      usernameSelector: "#user",
      passwordSelector: "#pass",
      submitSelector: "#go",
    });
  });

  it("throws, naming the credential, without decrypting, when neither it nor its website has a login page", () => {
    expect(() => buildCrawlLoginDetails({ ...credential, loginUrl: null }, website)).toThrow(
      'The credential "Admin" has no login page URL, and neither does its website',
    );
    expect(mockDecryptCredentialPassword).not.toHaveBeenCalled();
  });

  it("lets a decryption failure throw unchanged", () => {
    const decryptionError = new Error("Unsupported state or unable to authenticate data");
    mockDecryptCredentialPassword.mockImplementation(() => {
      throw decryptionError;
    });

    expect(() => buildCrawlLoginDetails(credential, website)).toThrow(decryptionError);
  });
});
