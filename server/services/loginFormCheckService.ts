import { chromium, type Locator, type Page } from "playwright";
import {
  type Website,
  adoptWebsiteLoginUrl,
  createDefaultLoginActionForWebsite,
  findLoginActionForWebsite,
} from "./dbService.js";
import {
  closeBrowserQuietly,
  navigateToUrl,
  summarizeError,
  waitForPageReadiness,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import { DEFAULT_PASSWORD_FIELD_SELECTOR, LOGIN_STEP_TIMEOUT_MS, findEffectiveLoginUrl } from "./crawlerLoginService.js";

/** The longest one login-form check may take, browser launch included. */
export const LOGIN_FORM_CHECK_TIME_LIMIT_MS = 20_000;

/** How long the check waits for a password field to show up after it followed a "Sign in" link. */
const PASSWORD_FIELD_APPEAR_TIMEOUT_MS = 5_000;

/**
 * The names of the links and buttons the check follows when the first page
 * has no password field: "Log in", "Login", "Sign in", "Signin", "Sign on"
 * (any case, surrounding spaces ignored).
 */
export const LOGIN_LINK_NAME_PATTERN = /^\s*(log\s?in|sign\s?in|sign\s?on)\s*$/i;

/**
 * The page's visible password fields - what counts as a login form.
 * @param page - The page to look at
 * @returns The locator of its visible password fields
 */
function locateVisiblePasswordFields(page: Page): Locator {
  return page.locator(DEFAULT_PASSWORD_FIELD_SELECTOR).filter({ visible: true });
}

/** What looking for a login form found. */
export type LoginFormSearch =
  | { outcome: "found"; loginUrl: string }
  | { outcome: "notFound" }
  | { outcome: "failed"; message: string };

/** What a website's login-form check did, as the API returns it (`loginCheck`). */
export interface LoginCheck {
  /**
   * `found`: a login form was found and the website's Login action was made;
   * `notFound`: the page (and its "Sign in" link, if any) has no login form;
   * `failed`: the check could not finish (the site did not load, the browser
   * could not start, or it ran out of time); `alreadyHasLoginAction`: the
   * website already has its Login action, so nothing was looked for.
   */
  outcome: "found" | "notFound" | "failed" | "alreadyHasLoginAction";
  /** Where the login form is (the Login action's effective login page), or null when none was found. */
  loginUrl: string | null;
  /** The website's Login action (just made, or the one it had), or null when it has none. */
  loginActionId: string | null;
  /** Why the check failed, or null. */
  message: string | null;
}

/**
 * Tells whether the page shows a password field right now.
 * @param page - The page to look at
 * @returns True when at least one password field is visible
 */
async function pageShowsAPasswordField(page: Page): Promise<boolean> {
  const visiblePasswordFieldCount = await locateVisiblePasswordFields(page).count();
  return visiblePasswordFieldCount > 0;
}

/**
 * Finds the first visible link - or, failing that, button - named like a way
 * to log in (see `LOGIN_LINK_NAME_PATTERN`).
 * @param page - The page to look at
 * @returns The link or button, or null when the page has none
 */
async function findLoginLink(page: Page): Promise<Locator | null> {
  const candidates = [
    page.getByRole("link", { name: LOGIN_LINK_NAME_PATTERN }),
    page.getByRole("button", { name: LOGIN_LINK_NAME_PATTERN }),
  ];
  for (const candidate of candidates) {
    const visibleCandidate = candidate.filter({ visible: true });
    const visibleCount = await visibleCandidate.count();
    if (visibleCount > 0) {
      return visibleCandidate.first();
    }
  }
  return null;
}

/**
 * Waits for the page to settle the way screenshots do; a failure only means
 * it is looked at as it is.
 * @param page - The page that just loaded
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Resolves once the page is ready, or the wait failed
 */
async function settlePage(page: Page, timingSettings: ScreenshotTimingSettings): Promise<void> {
  try {
    await waitForPageReadiness(page, timingSettings);
  } catch {
    // The page is looked at as it is.
  }
}

/**
 * Looks for a login form on an open page: opens the start page and looks for
 * a visible password field; when there is none, follows the first visible
 * "Log in" / "Sign in" link or button and looks again (waiting a few seconds
 * for the field, for forms that open in a pop-up or load late).
 * @param page - A fresh browser page
 * @param startUrl - Where to look first
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Where the login form is, that there is none, or why the page could not be opened
 * @throws When the browser fails in a way the steps do not catch (the page closed, for example)
 */
export async function searchPageForLoginForm(
  page: Page,
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
): Promise<LoginFormSearch> {
  const navigation = await navigateToUrl(page, startUrl);
  if (!navigation.navigationCompleted) {
    return { outcome: "failed", message: navigation.errorMessage };
  }
  await settlePage(page, timingSettings);
  if (await pageShowsAPasswordField(page)) {
    return { outcome: "found", loginUrl: page.url() };
  }

  const loginLink = await findLoginLink(page);
  if (loginLink === null) {
    return { outcome: "notFound" };
  }
  await loginLink.click({ timeout: LOGIN_STEP_TIMEOUT_MS });
  try {
    await page.waitForLoadState("load", { timeout: LOGIN_STEP_TIMEOUT_MS });
  } catch {
    // A link that opens a pop-up on the same page never fires a new load.
  }
  await settlePage(page, timingSettings);
  try {
    await locateVisiblePasswordFields(page)
      .first()
      .waitFor({ state: "visible", timeout: PASSWORD_FIELD_APPEAR_TIMEOUT_MS });
  } catch {
    return { outcome: "notFound" };
  }
  return { outcome: "found", loginUrl: page.url() };
}

/**
 * Looks for a login form starting at a URL, in a headless browser of its own
 * (see `searchPageForLoginForm`), within `timeLimitMs`. NEVER rejects: a
 * browser that cannot start, a page that throws, and running out of time all
 * become a `failed` search.
 * @param startUrl - Where to look first
 * @param timingSettings - The website's network idle cap and minimum wait
 * @param timeLimitMs - The most the whole check may take; defaults to `LOGIN_FORM_CHECK_TIME_LIMIT_MS`
 * @returns Where the login form is, that there is none, or why the check failed
 */
export async function findLoginForm(
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
  timeLimitMs: number = LOGIN_FORM_CHECK_TIME_LIMIT_MS,
): Promise<LoginFormSearch> {
  let timeLimitTimer: NodeJS.Timeout | undefined;
  const timeLimit = new Promise<LoginFormSearch>((resolve) => {
    timeLimitTimer = setTimeout(() => {
      resolve({
        outcome: "failed",
        message: `Looking for a login form took longer than ${String(Math.round(timeLimitMs / 1000))} seconds`,
      });
    }, timeLimitMs);
  });

  /**
   * Launches the browser and searches, closing the browser however it ends.
   * @returns What the search found
   */
  const searchInABrowser = async (): Promise<LoginFormSearch> => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      return await Promise.race([searchPageForLoginForm(page, startUrl, timingSettings), timeLimit]);
    } finally {
      await closeBrowserQuietly(browser);
    }
  };

  try {
    return await Promise.race([searchInABrowser(), timeLimit]);
  } catch (error: unknown) {
    return { outcome: "failed", message: summarizeError(error) };
  } finally {
    clearTimeout(timeLimitTimer);
  }
}

/**
 * The login-form check of one website: when it has no Login action yet,
 * looks for a login form - first on its login page URL when it has one,
 * otherwise on its URL (see `findLoginForm`) - and, when one is found, makes
 * the website's Login action ("Log in", see `createDefaultLoginActionForWebsite`):
 * - a website with no login page URL LEARNS the page the form is on
 *   (`adoptWebsiteLoginUrl`), and the Login action uses it;
 * - a website whose login page URL is not where the form turned out to be
 *   (the form was behind its "Sign in" link) keeps its URL, and the Login
 *   action gets the form's page as its own.
 * Runs when a website is created, and when the user asks for it.
 * @param website - The active website
 * @returns What the check did (see `LoginCheck`)
 * @throws When a query fails (the browser part never throws)
 */
export async function checkWebsiteForLoginForm(website: Website): Promise<LoginCheck> {
  const loginActionBefore = await findLoginActionForWebsite(website.id);
  if (loginActionBefore !== null) {
    return {
      outcome: "alreadyHasLoginAction",
      loginUrl: findEffectiveLoginUrl(loginActionBefore, website),
      loginActionId: loginActionBefore.id,
      message: null,
    };
  }

  const startUrl = website.loginUrl ?? website.url;
  const search = await findLoginForm(startUrl, {
    networkIdleTimeoutMs: website.networkIdleTimeoutMs,
    screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
  });
  if (search.outcome === "notFound") {
    return { outcome: "notFound", loginUrl: null, loginActionId: null, message: null };
  }
  if (search.outcome === "failed") {
    return { outcome: "failed", loginUrl: null, loginActionId: null, message: search.message };
  }

  // The browser took seconds: a Login action may have been made meanwhile.
  const loginActionMadeMeanwhile = await findLoginActionForWebsite(website.id);
  if (loginActionMadeMeanwhile !== null) {
    return {
      outcome: "alreadyHasLoginAction",
      loginUrl: findEffectiveLoginUrl(loginActionMadeMeanwhile, website),
      loginActionId: loginActionMadeMeanwhile.id,
      message: null,
    };
  }

  const websiteHasNoLoginPage = website.loginUrl === null;
  const formIsNotOnTheWebsitesLoginPage = !websiteHasNoLoginPage && website.loginUrl !== search.loginUrl;
  if (websiteHasNoLoginPage) {
    await adoptWebsiteLoginUrl(website.id, search.loginUrl);
  }
  const loginAction = await createDefaultLoginActionForWebsite(
    website.id,
    formIsNotOnTheWebsitesLoginPage ? search.loginUrl : null,
  );
  return { outcome: "found", loginUrl: search.loginUrl, loginActionId: loginAction.id, message: null };
}
