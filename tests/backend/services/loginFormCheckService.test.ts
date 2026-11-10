import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Action, Website } from "../../../server/services/dbService.js";

/**
 * No test here launches a real browser. `playwright` is replaced by a fake
 * `chromium` whose `launch` resolves a fake browser, whose `newPage` resolves
 * a fake page. The page's navigation and its "wait until it settles" step
 * (`navigateToUrl`, `waitForPageReadiness`) are replaced so each test says
 * whether the page loaded; closing the browser and summarizing an error stay
 * real. The fake page answers the locators the check asks for: its visible
 * password fields, and its visible "Sign in" links and buttons. The three
 * dbService functions the check uses are replaced too.
 */
const {
  mockChromium,
  mockBrowser,
  mockPage,
  mockPasswordFields,
  mockFirstPasswordField,
  mockLoginLinks,
  mockLoginButtons,
  mockFirstLoginLink,
  mockFirstLoginButton,
  mockPlaywrightService,
  mockDbService,
  MockTimeoutError,
} = vi.hoisted(() => ({
  mockChromium: { launch: vi.fn() },
  mockBrowser: { newPage: vi.fn(), close: vi.fn() },
  mockPage: {
    url: vi.fn(),
    locator: vi.fn(),
    getByRole: vi.fn(),
    waitForLoadState: vi.fn(),
  },
  /** The page's visible password fields. */
  mockPasswordFields: { count: vi.fn(), first: vi.fn() },
  /** The first of them, which the check waits for after following a link. */
  mockFirstPasswordField: { waitFor: vi.fn() },
  /** The page's visible links named like a way to log in. */
  mockLoginLinks: { count: vi.fn(), first: vi.fn() },
  /** The page's visible buttons named like a way to log in. */
  mockLoginButtons: { count: vi.fn(), first: vi.fn() },
  /** The first such link. */
  mockFirstLoginLink: { click: vi.fn() },
  /** The first such button. */
  mockFirstLoginButton: { click: vi.fn() },
  mockPlaywrightService: { navigateToUrl: vi.fn(), waitForPageReadiness: vi.fn() },
  mockDbService: {
    findLoginActionForWebsite: vi.fn(),
    adoptWebsiteLoginUrl: vi.fn(),
    createDefaultLoginActionForWebsite: vi.fn(),
  },
  /** Stands in for Playwright's `errors.TimeoutError`, which `playwrightService` checks with instanceof. */
  MockTimeoutError: class MockTimeoutError extends Error {},
}));

vi.mock("playwright", () => ({
  chromium: mockChromium,
  errors: { TimeoutError: MockTimeoutError },
}));
vi.mock("../../../server/services/playwrightService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/playwrightService.js")>()),
  ...mockPlaywrightService,
}));
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import {
  LOGIN_FORM_CHECK_TIME_LIMIT_MS,
  LOGIN_LINK_NAME_PATTERN,
  checkWebsiteForLoginForm,
  findLoginForm,
  searchPageForLoginForm,
} from "../../../server/services/loginFormCheckService.js";
import {
  DEFAULT_PASSWORD_FIELD_SELECTOR,
  LOGIN_STEP_TIMEOUT_MS,
} from "../../../server/services/crawlerLoginService.js";

/** The website's timing settings, handed to every settle step untouched. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 4000, screenshotMinimumWaitMs: 250 };

/** Where the fake page starts. */
const HOME_URL = "https://example.com/";

/** Where the fake page is after following its "Sign in" link. */
const SIGN_IN_URL = "https://example.com/sign-in";

/** A navigation that loaded the page. */
const COMPLETED_NAVIGATION = { navigationCompleted: true, httpStatus: 200, durationMs: 120 };

/** The website being checked: no login page of its own. */
const website: Website = {
  id: "website-1",
  url: HOME_URL,
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 4000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
};

/** The website's Login action, as `findLoginActionForWebsite` and `createDefaultLoginActionForWebsite` answer it. */
const loginAction: Action = {
  id: "login-action-1",
  websiteId: "website-1",
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Logs in with the username and password of the credential each action or crawl picks.",
  userActionKind: "login",
  userObjectTypeKey: null,
  userNameParameterKey: null,
  parametersSyncedAt: null,
  createdAt: new Date("2026-03-02T00:00:00.000Z"),
  updatedAt: new Date("2026-03-02T00:00:00.000Z"),
  deletedAt: null,
};

/** The address the fake page reports; following a link or button moves it to `SIGN_IN_URL`. */
let currentPageUrl = HOME_URL;

/**
 * Sets up what the fake page shows: how many password fields are visible
 * at first, how many "Sign in" links and buttons it has, and whether a
 * password field shows up after one is followed.
 * @param pageContent - What the page shows
 * @param pageContent.passwordFieldsAtFirst - Visible password fields on the start page
 * @param pageContent.loginLinkCount - Visible links named like a way to log in
 * @param pageContent.loginButtonCount - Visible buttons named like a way to log in
 * @param pageContent.passwordFieldAppearsAfterFollowing - True when a password field shows up once a link or button is followed
 */
function showOnPage(pageContent: {
  passwordFieldsAtFirst: number;
  loginLinkCount: number;
  loginButtonCount: number;
  passwordFieldAppearsAfterFollowing: boolean;
}): void {
  mockPasswordFields.count.mockResolvedValue(pageContent.passwordFieldsAtFirst);
  mockLoginLinks.count.mockResolvedValue(pageContent.loginLinkCount);
  mockLoginButtons.count.mockResolvedValue(pageContent.loginButtonCount);
  if (pageContent.passwordFieldAppearsAfterFollowing) {
    mockFirstPasswordField.waitFor.mockResolvedValue(undefined);
  } else {
    mockFirstPasswordField.waitFor.mockRejectedValue(new MockTimeoutError("locator.waitFor: Timeout 5000ms exceeded"));
  }
}

/**
 * Builds a promise that never settles - for a page or a browser that hangs.
 * @returns The pending promise
 */
function createNeverSettlingPromise<TValue>(): Promise<TValue> {
  return new Promise<TValue>(() => undefined);
}

beforeEach(() => {
  vi.resetAllMocks();
  currentPageUrl = HOME_URL;
  mockChromium.launch.mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  mockPage.url.mockImplementation(() => currentPageUrl);
  mockPage.locator.mockReturnValue({ filter: vi.fn(() => mockPasswordFields) });
  mockPage.getByRole.mockImplementation((role: string) => ({
    filter: vi.fn(() => (role === "link" ? mockLoginLinks : mockLoginButtons)),
  }));
  mockPage.waitForLoadState.mockResolvedValue(undefined);
  mockPasswordFields.first.mockReturnValue(mockFirstPasswordField);
  mockLoginLinks.first.mockReturnValue(mockFirstLoginLink);
  mockLoginButtons.first.mockReturnValue(mockFirstLoginButton);
  mockFirstLoginLink.click.mockImplementation(() => {
    currentPageUrl = SIGN_IN_URL;
    return Promise.resolve();
  });
  mockFirstLoginButton.click.mockImplementation(() => {
    currentPageUrl = SIGN_IN_URL;
    return Promise.resolve();
  });
  mockPlaywrightService.navigateToUrl.mockResolvedValue(COMPLETED_NAVIGATION);
  mockPlaywrightService.waitForPageReadiness.mockResolvedValue(undefined);
  showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LOGIN_LINK_NAME_PATTERN", () => {
  it.each(["Log in", "Login", "LOG IN", "  Sign in  ", "Signin", "sign on", "Sign On"])("matches %j", (linkName) => {
    expect(LOGIN_LINK_NAME_PATTERN.test(linkName)).toBe(true);
  });

  it.each(["Sign up", "Log out", "Login help", "Sign in with Google", "Logging in"])("does not match %j", (linkName) => {
    expect(LOGIN_LINK_NAME_PATTERN.test(linkName)).toBe(false);
  });
});

describe("searchPageForLoginForm", () => {
  /**
   * Runs the search on the fake page from the home page.
   * @returns What the search found
   */
  async function searchTheFakePage(): Promise<Awaited<ReturnType<typeof searchPageForLoginForm>>> {
    return searchPageForLoginForm(mockPage as never, HOME_URL, TIMING_SETTINGS);
  }

  it("finds a login form on the first page, looking for a visible password field after the page settles", async () => {
    showOnPage({ passwordFieldsAtFirst: 1, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });

    const search = await searchTheFakePage();

    expect(search).toEqual({ outcome: "found", loginUrl: HOME_URL });
    expect(mockPlaywrightService.navigateToUrl).toHaveBeenCalledWith(mockPage, HOME_URL);
    expect(mockPlaywrightService.waitForPageReadiness).toHaveBeenCalledWith(mockPage, TIMING_SETTINGS);
    expect(mockPage.locator).toHaveBeenCalledWith(DEFAULT_PASSWORD_FIELD_SELECTOR);
    const [passwordFieldLocator] = mockPage.locator.mock.results.map((result) => result.value as { filter: typeof vi.fn });
    expect(passwordFieldLocator.filter).toHaveBeenCalledWith({ visible: true });
    expect(mockPage.getByRole).not.toHaveBeenCalled();
  });

  it("follows a visible \"Sign in\" link when the first page has no password field, and finds the form it leads to", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });

    const search = await searchTheFakePage();

    expect(search).toEqual({ outcome: "found", loginUrl: SIGN_IN_URL });
    expect(mockPage.getByRole).toHaveBeenCalledWith("link", { name: LOGIN_LINK_NAME_PATTERN });
    expect(mockFirstLoginLink.click).toHaveBeenCalledWith({ timeout: LOGIN_STEP_TIMEOUT_MS });
    expect(mockFirstLoginButton.click).not.toHaveBeenCalled();
    expect(mockPage.waitForLoadState).toHaveBeenCalledWith("load", { timeout: LOGIN_STEP_TIMEOUT_MS });
    expect(mockPlaywrightService.waitForPageReadiness).toHaveBeenCalledTimes(2);
    expect(mockFirstPasswordField.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 5_000 });
  });

  it("follows a visible \"Log in\" button when the page has no such link", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 0, loginButtonCount: 2, passwordFieldAppearsAfterFollowing: true });

    const search = await searchTheFakePage();

    expect(search).toEqual({ outcome: "found", loginUrl: SIGN_IN_URL });
    expect(mockPage.getByRole).toHaveBeenCalledWith("button", { name: LOGIN_LINK_NAME_PATTERN });
    expect(mockLoginButtons.first).toHaveBeenCalledTimes(1);
    expect(mockFirstLoginButton.click).toHaveBeenCalledWith({ timeout: LOGIN_STEP_TIMEOUT_MS });
    expect(mockFirstLoginLink.click).not.toHaveBeenCalled();
  });

  it("still finds a form that opens in a pop-up on the same page, where no new load ever fires", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });
    mockPage.waitForLoadState.mockRejectedValue(new MockTimeoutError("page.waitForLoadState: Timeout 10000ms exceeded"));

    expect(await searchTheFakePage()).toEqual({ outcome: "found", loginUrl: SIGN_IN_URL });
  });

  it("looks at the page as it is when it never settles", async () => {
    showOnPage({ passwordFieldsAtFirst: 1, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });
    mockPlaywrightService.waitForPageReadiness.mockRejectedValue(new Error("page.waitForFunction: Target closed"));

    expect(await searchTheFakePage()).toEqual({ outcome: "found", loginUrl: HOME_URL });
  });

  it("finds no form when the page has no password field and no \"Sign in\" link or button", async () => {
    const search = await searchTheFakePage();

    expect(search).toEqual({ outcome: "notFound" });
    expect(mockPage.getByRole).toHaveBeenCalledTimes(2);
    expect(mockFirstLoginLink.click).not.toHaveBeenCalled();
    expect(mockFirstLoginButton.click).not.toHaveBeenCalled();
  });

  it("finds no form when the \"Sign in\" link leads to a page where no password field appears", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });

    const search = await searchTheFakePage();

    expect(search).toEqual({ outcome: "notFound" });
    expect(mockFirstLoginLink.click).toHaveBeenCalledTimes(1);
  });

  it("fails with the navigation's reason when the start page cannot be opened, looking for nothing", async () => {
    mockPlaywrightService.navigateToUrl.mockResolvedValue({
      navigationCompleted: false,
      errorMessage: "page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.com/",
      durationMs: 30,
    });

    const search = await searchTheFakePage();

    expect(search).toEqual({
      outcome: "failed",
      message: "page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.com/",
    });
    expect(mockPlaywrightService.waitForPageReadiness).not.toHaveBeenCalled();
    expect(mockPage.locator).not.toHaveBeenCalled();
  });

  it("lets a click that fails reject (the browser check turns it into a failed search)", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });
    const clickError = new Error("locator.click: Element is not attached to the DOM");
    mockFirstLoginLink.click.mockRejectedValue(clickError);

    await expect(searchTheFakePage()).rejects.toBe(clickError);
  });
});

describe("findLoginForm", () => {
  it("searches in a headless browser of its own, closes it, and answers what was found", async () => {
    showOnPage({ passwordFieldsAtFirst: 1, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });

    const search = await findLoginForm(HOME_URL, TIMING_SETTINGS);

    expect(search).toEqual({ outcome: "found", loginUrl: HOME_URL });
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
    expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);
    expect(mockPlaywrightService.navigateToUrl).toHaveBeenCalledWith(mockPage, HOME_URL);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("clears its time limit once the search is done, leaving no timer behind", async () => {
    vi.useFakeTimers();

    const search = await findLoginForm(HOME_URL, TIMING_SETTINGS);

    expect(search).toEqual({ outcome: "notFound" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers a failed search with the first line of the error, instead of rejecting, when the browser cannot start", async () => {
    mockChromium.launch.mockRejectedValue(
      new Error("browserType.launch: Executable doesn't exist at /ms-playwright/chromium\nRun npx playwright install"),
    );

    const search = await findLoginForm(HOME_URL, TIMING_SETTINGS);

    expect(search).toEqual({
      outcome: "failed",
      message: "browserType.launch: Executable doesn't exist at /ms-playwright/chromium",
    });
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });

  it("answers a failed search, and still closes the browser, when the page throws", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });
    mockFirstLoginLink.click.mockRejectedValue(new Error("locator.click: Target page, context or browser has been closed"));

    const search = await findLoginForm(HOME_URL, TIMING_SETTINGS);

    expect(search).toEqual({
      outcome: "failed",
      message: "locator.click: Target page, context or browser has been closed",
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("gives up after the time limit it is given, answering a failed search and closing the browser", async () => {
    vi.useFakeTimers();
    mockPlaywrightService.navigateToUrl.mockReturnValue(createNeverSettlingPromise());

    const pendingSearch = findLoginForm(HOME_URL, TIMING_SETTINGS, 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const search = await pendingSearch;

    expect(search).toEqual({ outcome: "failed", message: "Looking for a login form took longer than 3 seconds" });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("gives up after the time limit even while the browser is still starting", async () => {
    vi.useFakeTimers();
    mockChromium.launch.mockReturnValue(createNeverSettlingPromise());

    const pendingSearch = findLoginForm(HOME_URL, TIMING_SETTINGS, 1_500);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await pendingSearch).toEqual({
      outcome: "failed",
      message: "Looking for a login form took longer than 2 seconds",
    });
  });

  it(`waits at most ${String(LOGIN_FORM_CHECK_TIME_LIMIT_MS)} ms by default`, async () => {
    vi.useFakeTimers();
    mockPlaywrightService.navigateToUrl.mockReturnValue(createNeverSettlingPromise());

    const pendingSearch = findLoginForm(HOME_URL, TIMING_SETTINGS);
    await vi.advanceTimersByTimeAsync(LOGIN_FORM_CHECK_TIME_LIMIT_MS - 1);
    let searchHasEnded = false;
    void pendingSearch.then(() => {
      searchHasEnded = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(searchHasEnded).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(LOGIN_FORM_CHECK_TIME_LIMIT_MS).toBe(20_000);
    expect(await pendingSearch).toEqual({
      outcome: "failed",
      message: "Looking for a login form took longer than 20 seconds",
    });
  });
});

describe("checkWebsiteForLoginForm", () => {
  beforeEach(() => {
    mockDbService.findLoginActionForWebsite.mockResolvedValue(null);
    mockDbService.adoptWebsiteLoginUrl.mockResolvedValue(true);
    mockDbService.createDefaultLoginActionForWebsite.mockResolvedValue(loginAction);
  });

  it("looks for nothing when the website already has its Login action, answering that action and its effective login page", async () => {
    const websiteWithLoginUrl: Website = { ...website, loginUrl: "https://example.com/login" };
    mockDbService.findLoginActionForWebsite.mockResolvedValue(loginAction);

    const loginCheck = await checkWebsiteForLoginForm(websiteWithLoginUrl);

    expect(loginCheck).toEqual({
      outcome: "alreadyHasLoginAction",
      loginUrl: "https://example.com/login",
      loginActionId: "login-action-1",
      message: null,
    });
    expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith("website-1");
    expect(mockChromium.launch).not.toHaveBeenCalled();
    expect(mockDbService.createDefaultLoginActionForWebsite).not.toHaveBeenCalled();
  });

  it("answers the Login action's own login page when it has one", async () => {
    mockDbService.findLoginActionForWebsite.mockResolvedValue({ ...loginAction, loginUrl: "https://auth.example.com/login" });

    const loginCheck = await checkWebsiteForLoginForm(website);

    expect(loginCheck).toMatchObject({ outcome: "alreadyHasLoginAction", loginUrl: "https://auth.example.com/login" });
  });

  it("makes nothing when a Login action was made while the browser looked", async () => {
    showOnPage({ passwordFieldsAtFirst: 1, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });
    mockDbService.findLoginActionForWebsite.mockResolvedValueOnce(null).mockResolvedValueOnce(loginAction);

    const loginCheck = await checkWebsiteForLoginForm(website);

    expect(loginCheck).toEqual({
      outcome: "alreadyHasLoginAction",
      loginUrl: null,
      loginActionId: "login-action-1",
      message: null,
    });
    expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledTimes(2);
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
    expect(mockDbService.createDefaultLoginActionForWebsite).not.toHaveBeenCalled();
  });

  it("answers notFound, making nothing, when the website has no login form", async () => {
    const loginCheck = await checkWebsiteForLoginForm(website);

    expect(loginCheck).toEqual({ outcome: "notFound", loginUrl: null, loginActionId: null, message: null });
    expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledTimes(1);
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
    expect(mockDbService.createDefaultLoginActionForWebsite).not.toHaveBeenCalled();
  });

  it("answers failed with the reason, making nothing, when the check could not finish", async () => {
    mockPlaywrightService.navigateToUrl.mockResolvedValue({
      navigationCompleted: false,
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED",
      durationMs: 15,
    });

    const loginCheck = await checkWebsiteForLoginForm(website);

    expect(loginCheck).toEqual({
      outcome: "failed",
      loginUrl: null,
      loginActionId: null,
      message: "page.goto: net::ERR_CONNECTION_REFUSED",
    });
    expect(mockDbService.createDefaultLoginActionForWebsite).not.toHaveBeenCalled();
  });

  it("starts at the website's URL, with its timing settings, when it has no login page", async () => {
    await checkWebsiteForLoginForm(website);

    expect(mockPlaywrightService.navigateToUrl).toHaveBeenCalledWith(mockPage, HOME_URL);
    expect(mockPlaywrightService.waitForPageReadiness).toHaveBeenCalledWith(mockPage, {
      networkIdleTimeoutMs: 4000,
      screenshotMinimumWaitMs: 250,
    });
  });

  it("makes the Login action with no page of its own, and the website learns the form's page, when the website had no login page", async () => {
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });

    const loginCheck = await checkWebsiteForLoginForm(website);

    expect(loginCheck).toEqual({
      outcome: "found",
      loginUrl: SIGN_IN_URL,
      loginActionId: "login-action-1",
      message: null,
    });
    expect(mockDbService.adoptWebsiteLoginUrl).toHaveBeenCalledWith("website-1", SIGN_IN_URL);
    expect(mockDbService.createDefaultLoginActionForWebsite).toHaveBeenCalledWith("website-1", null);
    const adoptOrder = mockDbService.adoptWebsiteLoginUrl.mock.invocationCallOrder[0];
    const createOrder = mockDbService.createDefaultLoginActionForWebsite.mock.invocationCallOrder[0];
    expect(adoptOrder).toBeLessThan(createOrder);
  });

  it("gives the Login action the form's page as its own, keeping the website's, when the form was not on the website's login page", async () => {
    const websiteWithAccountPage: Website = { ...website, loginUrl: "https://example.com/account" };
    currentPageUrl = "https://example.com/account";
    showOnPage({ passwordFieldsAtFirst: 0, loginLinkCount: 1, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: true });

    const loginCheck = await checkWebsiteForLoginForm(websiteWithAccountPage);

    expect(mockPlaywrightService.navigateToUrl).toHaveBeenCalledWith(mockPage, "https://example.com/account");
    expect(loginCheck).toEqual({
      outcome: "found",
      loginUrl: SIGN_IN_URL,
      loginActionId: "login-action-1",
      message: null,
    });
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
    expect(mockDbService.createDefaultLoginActionForWebsite).toHaveBeenCalledWith("website-1", SIGN_IN_URL);
  });

  it("makes the Login action with no page of its own when the form is on the website's login page", async () => {
    const websiteWithSignInPage: Website = { ...website, loginUrl: SIGN_IN_URL };
    currentPageUrl = SIGN_IN_URL;
    showOnPage({ passwordFieldsAtFirst: 1, loginLinkCount: 0, loginButtonCount: 0, passwordFieldAppearsAfterFollowing: false });

    const loginCheck = await checkWebsiteForLoginForm(websiteWithSignInPage);

    expect(loginCheck).toMatchObject({ outcome: "found", loginUrl: SIGN_IN_URL });
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
    expect(mockDbService.createDefaultLoginActionForWebsite).toHaveBeenCalledWith("website-1", null);
  });

  it("lets a failed query reject", async () => {
    const queryError = new Error("connection refused");
    mockDbService.findLoginActionForWebsite.mockRejectedValue(queryError);

    await expect(checkWebsiteForLoginForm(website)).rejects.toBe(queryError);
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });
});
