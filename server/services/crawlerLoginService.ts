import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import {
  FIRST_FAILING_HTTP_STATUS,
  describeUnsuccessfulResponse,
  navigateToUrl,
  summarizeError,
  waitForPageReadiness,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import {
  trackPageRequests,
  waitForTrackedRequestsToFinish,
  waitOutMinimumWaitSince,
  type PageRequestTracker,
} from "./pageActionService.js";
import type { Action, Credential, Website } from "./dbService.js";
import { decryptCredentialPassword } from "../utils/credentialEncryption.js";

/**
 * How long the crawler waits for each login form field (and the submit button
 * when one is named) to appear, and for each fill and click to go through.
 */
export const LOGIN_STEP_TIMEOUT_MS = 10_000;

/**
 * How long, after submitting, the crawler waits for the login form to go
 * away. A login that works is noticed as soon as the form disappears; a
 * failed one is only declared once this has run out (and the sign-in's
 * requests have finished).
 */
export const LOGIN_RESULT_TIMEOUT_MS = 15_000;

/** The password field, when the Login action names no selector for it. */
export const DEFAULT_PASSWORD_FIELD_SELECTOR = 'input[type="password"]';

/**
 * The username field, when the Login action names no selector for it: the first
 * plain text-like input (no `type`, or text, email, or tel) in the login form.
 */
export const DEFAULT_USERNAME_FIELD_SELECTOR =
  'input:not([type]), input[type="text"], input[type="email"], input[type="tel"]';

/** The submit button, when the Login action names no selector for it. */
export const DEFAULT_SUBMIT_BUTTON_SELECTOR =
  'button[type="submit"], input[type="submit"], button:not([type])';

/** Why a login that went through every step still counts as failed. */
export const STILL_ON_LOGIN_FORM_MESSAGE =
  "Still on the login form after submitting - check the username and password";

/** Everything a browser needs to log in: where, as whom, and (optionally) which form fields to use. */
export interface CrawlLoginDetails {
  /** The page with the login form. */
  loginUrl: string;
  /** What to type into the username field. */
  username: string;
  /** What to type into the password field - decrypted, never logged. */
  password: string;
  /** A CSS selector for the username field, or null to find it automatically. */
  usernameSelector: string | null;
  /** A CSS selector for the password field, or null to find it automatically. */
  passwordSelector: string | null;
  /** A CSS selector for the submit button, or null to find it automatically. */
  submitSelector: string | null;
}

/** The parts of a Login action that say where and how it logs in. */
export type LoginActionSettings = Pick<
  Action,
  "title" | "loginUrl" | "usernameSelector" | "passwordSelector" | "submitSelector"
>;

/**
 * Picks the login page a Login action opens: its own `loginUrl` when it has
 * one, otherwise its website's (the default).
 * @param loginAction - The Login action
 * @param loginAction.loginUrl - Its own login page, or null to use the website's
 * @param website - Its website
 * @param website.loginUrl - The website's default login page, or null
 * @returns The effective login page, or null when neither has one
 */
export function findEffectiveLoginUrl(
  loginAction: { loginUrl: string | null },
  website: { loginUrl: string | null },
): string | null {
  return loginAction.loginUrl ?? website.loginUrl;
}

/**
 * Why a logged-in run or crawl cannot log in: the website has no Login
 * action (none was found by the login-form check, or it was deleted).
 */
export const WEBSITE_HAS_NO_LOGIN_ACTION_MESSAGE =
  "This website has no login action yet - look for a login form on its Credentials tab, or add an action with the kind Login";

/**
 * Says why a Login action cannot log in: neither it nor its website has a
 * login page.
 * @param loginActionTitle - The Login action's title
 * @returns The message, in plain words
 */
export function describeLoginActionWithoutLoginPage(loginActionTitle: string): string {
  return `The login action "${loginActionTitle}" has no login page URL, and neither does its website; add one to log in`;
}

/**
 * Decrypts a credential's password and gathers what a browser needs to log in
 * as it the way the website's Login action does - used by "Run login", by
 * the runs of actions that run as a credential, and by crawls alike. The login page is the
 * Login action's EFFECTIVE login URL (see `findEffectiveLoginUrl`), and the
 * three form-field selectors are the Login action's.
 * @param loginAction - The Login action: its title, login page, and selectors
 * @param credential - The credential to log in as, with its encrypted password
 * @param website - Its website, for the default login URL
 * @returns The login details, with the password decrypted (never log them)
 * @throws When neither the Login action nor the website has a login URL; when the password cannot be decrypted (no key configured, or the key changed since it was saved)
 */
export function buildLoginDetails(
  loginAction: LoginActionSettings,
  credential: Credential,
  website: Website,
): CrawlLoginDetails {
  const effectiveLoginUrl = findEffectiveLoginUrl(loginAction, website);
  if (effectiveLoginUrl === null) {
    throw new Error(
      `The login action "${loginAction.title}" has no login page URL, and neither does its website`,
    );
  }
  return {
    loginUrl: effectiveLoginUrl,
    username: credential.username,
    password: decryptCredentialPassword(credential.encryptedPassword),
    usernameSelector: loginAction.usernameSelector,
    passwordSelector: loginAction.passwordSelector,
    submitSelector: loginAction.submitSelector,
  };
}

/** How a login attempt ended. */
export type LoginAttempt =
  | {
      /** True: the login form was submitted and is gone. */
      loggedIn: true;
    }
  | {
      /** False: the crawler could not log in. */
      loggedIn: false;
      /** Why, in a sentence the user can act on. */
      errorMessage: string;
    };

/**
 * Waits up to `LOGIN_RESULT_TIMEOUT_MS` for the password field to stop being
 * visible. Returns as soon as it goes; running out of time is not an error
 * here - the caller looks at the field again to decide.
 * @param passwordField - The password field that was filled in
 * @returns Resolves once the field is gone or the time ran out
 */
async function waitForLoginFormToGo(passwordField: Locator): Promise<void> {
  try {
    await passwordField.waitFor({ state: "hidden", timeout: LOGIN_RESULT_TIMEOUT_MS });
  } catch {
    // Still visible after the limit: decided by the caller's last look.
  }
}

/**
 * Decides whether the submitted login worked, giving the site time to answer:
 *
 * 1. Wait up to `LOGIN_RESULT_TIMEOUT_MS` for the password field to go away -
 *    a working login is noticed the moment it does.
 * 2. Wait for the requests the submit started to finish (see
 *    `waitForTrackedRequestsToFinish`), capped by the website's network idle
 *    cap, so a sign-in still in flight ("Signing in…") is never judged.
 * 3. Wait out the rest of the website's minimum wait since the submit.
 * 4. Look at the password field once more. Still (or again) visible means
 *    the site showed the form again - a wrong username or password. Looking
 *    again matters: a site that re-renders its login page with an error
 *    briefly has no password field mid-reload, which step 1 sees as "gone".
 * @param page - The crawl's browser page
 * @param passwordField - The password field that was filled in
 * @param signInRequests - The tracker started right before the submit
 * @param submittedAt - The `performance.now()` reading taken when the form was submitted
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Whether the crawler is now logged in, and why not when it is not
 */
async function waitForLoginResult(
  page: Page,
  passwordField: Locator,
  signInRequests: PageRequestTracker,
  submittedAt: number,
  timingSettings: ScreenshotTimingSettings,
): Promise<LoginAttempt> {
  try {
    await waitForLoginFormToGo(passwordField);
    await waitForTrackedRequestsToFinish(
      page,
      signInRequests,
      timingSettings.networkIdleTimeoutMs,
    );
    await waitOutMinimumWaitSince(page, submittedAt, timingSettings.screenshotMinimumWaitMs);
    const passwordFieldIsStillVisible = await passwordField.isVisible();
    if (passwordFieldIsStillVisible) {
      return loginFailed(STILL_ON_LOGIN_FORM_MESSAGE);
    }
    return { loggedIn: true };
  } catch (error: unknown) {
    return loginFailed(`Whether the login worked could not be checked: ${summarizeError(error)}`);
  }
}

/**
 * Builds a failed login attempt.
 * @param errorMessage - Why the login failed
 * @returns The failed attempt
 */
function loginFailed(errorMessage: string): LoginAttempt {
  return { loggedIn: false, errorMessage };
}

/**
 * Names the selector a step used, for error messages: the Login action's own
 * selector when it has one, otherwise the fact that the crawler guessed.
 * @param customSelector - The Login action's selector for this field, or null
 * @returns A short parenthetical such as ` (selector "#user")`, or ` (found automatically)`
 */
function describeSelectorSource(customSelector: string | null): string {
  const selectorWasGiven = customSelector !== null;
  return selectorWasGiven ? ` (selector "${customSelector}")` : " (found automatically)";
}

/**
 * Waits for a field or button to be visible.
 * @param locator - What to wait for
 * @returns True when it became visible within `LOGIN_STEP_TIMEOUT_MS`; false when it did not (or the page went away)
 */
async function waitUntilVisible(locator: Locator): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: LOGIN_STEP_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the part of the page the login form lives in: the `<form>` that holds
 * the password field when there is one, otherwise the whole `<body>` (some
 * single-page apps use no `<form>` element at all). The username field and
 * submit button are searched for inside it, so a search box elsewhere on the
 * page is not mistaken for the username field.
 * @param page - The login page
 * @param passwordFieldSelector - The selector that found the password field
 * @returns The form, or the page's body
 */
async function locateLoginFormScope(page: Page, passwordFieldSelector: string): Promise<Locator> {
  const formsHoldingThePasswordField = page
    .locator("form")
    .filter({ has: page.locator(passwordFieldSelector) });
  const formCount = await formsHoldingThePasswordField.count();
  const passwordFieldIsInAForm = formCount > 0;
  return passwordFieldIsInAForm ? formsHoldingThePasswordField.first() : page.locator("body");
}

/**
 * Submits the login form: clicks the Login action's submit selector, or the
 * form's first visible submit button, or - when the form has none - presses
 * Enter in the password field, which submits a form the way a user would.
 * @param page - The login page
 * @param formScope - The login form (or the page's body)
 * @param passwordField - The filled-in password field
 * @param submitSelector - The Login action's submit button selector, or null
 * @returns Null once the form was submitted; otherwise why it could not be
 */
async function submitLoginForm(
  page: Page,
  formScope: Locator,
  passwordField: Locator,
  submitSelector: string | null,
): Promise<string | null> {
  const submitSelectorWasGiven = submitSelector !== null;
  if (submitSelectorWasGiven) {
    const namedSubmitButton = page.locator(submitSelector).first();
    const namedSubmitButtonIsVisible = await waitUntilVisible(namedSubmitButton);
    if (!namedSubmitButtonIsVisible) {
      return `No visible submit button was found on the login page${describeSelectorSource(submitSelector)}`;
    }
    await namedSubmitButton.click({ timeout: LOGIN_STEP_TIMEOUT_MS });
    return null;
  }

  const foundSubmitButton = formScope
    .locator(DEFAULT_SUBMIT_BUTTON_SELECTOR)
    .filter({ visible: true })
    .first();
  const submitButtonCount = await foundSubmitButton.count();
  const formHasASubmitButton = submitButtonCount > 0;
  if (formHasASubmitButton) {
    await foundSubmitButton.click({ timeout: LOGIN_STEP_TIMEOUT_MS });
    return null;
  }
  await passwordField.press("Enter", { timeout: LOGIN_STEP_TIMEOUT_MS });
  return null;
}

/**
 * Logs in on the given browser page, leaving its cookies (and any other
 * session state) in place for the pages visited after it.
 *
 * 1. Load `loginUrl` and wait until it is ready (the website's own timing
 *    settings, as for every crawled page).
 * 2. Find the password field (the Login action's selector, or the first visible
 *    `input[type="password"]`), then the username field (the Login action's
 *    selector, or the first visible text, email, or tel input in the same
 *    form).
 * 3. Type the username and password, then submit (the Login action's submit
 *    selector, the form's first visible submit button, or Enter in the
 *    password field).
 * 4. Give the site time to answer (see `waitForLoginResult`): up to
 *    `LOGIN_RESULT_TIMEOUT_MS` for the form to go, the requests the submit
 *    started to finish (capped by the website's network idle cap), and the
 *    website's minimum wait since the submit.
 * 5. The login SUCCEEDED when no password field is visible any more. A
 *    password field still on screen means the site showed the form again -
 *    almost always a wrong username or password.
 *
 * Every failure becomes `{ loggedIn: false, errorMessage }`; this never
 * rejects. Two-step logins (username on one screen, password on the next)
 * are not supported.
 * @param page - The crawl's browser page
 * @param login - Where and as whom to log in
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Whether the crawler is now logged in, and why not when it is not
 */
export async function logInWithCredential(
  page: Page,
  login: CrawlLoginDetails,
  timingSettings: ScreenshotTimingSettings,
): Promise<LoginAttempt> {
  const navigation = await navigateToUrl(page, login.loginUrl);
  if (!navigation.navigationCompleted) {
    return loginFailed(`The login page could not be loaded: ${navigation.errorMessage}`);
  }
  const { httpStatus } = navigation;
  const loginPageAnsweredWithAnError =
    httpStatus !== null && httpStatus >= FIRST_FAILING_HTTP_STATUS;
  if (loginPageAnsweredWithAnError) {
    return loginFailed(`The login page could not be loaded: ${describeUnsuccessfulResponse(httpStatus)}`);
  }
  try {
    await waitForPageReadiness(page, timingSettings);
  } catch (error: unknown) {
    return loginFailed(`The login page did not become ready: ${summarizeError(error)}`);
  }

  const passwordFieldSelector = login.passwordSelector ?? DEFAULT_PASSWORD_FIELD_SELECTOR;
  const passwordField = page.locator(passwordFieldSelector).filter({ visible: true }).first();
  const passwordFieldIsVisible = await waitUntilVisible(passwordField);
  if (!passwordFieldIsVisible) {
    return loginFailed(
      `No visible password field was found on the login page${describeSelectorSource(login.passwordSelector)}`,
    );
  }

  const formScope = await locateLoginFormScope(page, passwordFieldSelector);
  const { usernameSelector } = login;
  const usernameSelectorWasGiven = usernameSelector !== null;
  const usernameField = usernameSelectorWasGiven
    ? page.locator(usernameSelector).first()
    : formScope.locator(DEFAULT_USERNAME_FIELD_SELECTOR).filter({ visible: true }).first();
  const usernameFieldIsVisible = await waitUntilVisible(usernameField);
  if (!usernameFieldIsVisible) {
    return loginFailed(
      `No visible username field was found on the login page${describeSelectorSource(usernameSelector)}`,
    );
  }

  try {
    await usernameField.fill(login.username, { timeout: LOGIN_STEP_TIMEOUT_MS });
    await passwordField.fill(login.password, { timeout: LOGIN_STEP_TIMEOUT_MS });
  } catch (error: unknown) {
    return loginFailed(`The login form could not be filled in and submitted: ${summarizeError(error)}`);
  }

  // Counting starts BEFORE the submit, so every request it starts is seen.
  const signInRequests = trackPageRequests(page);
  try {
    const submittedAt = performance.now();
    const submitErrorMessage = await submitLoginForm(
      page,
      formScope,
      passwordField,
      login.submitSelector,
    );
    const formWasNotSubmitted = submitErrorMessage !== null;
    if (formWasNotSubmitted) {
      return loginFailed(submitErrorMessage);
    }
    return await waitForLoginResult(
      page,
      passwordField,
      signInRequests,
      submittedAt,
      timingSettings,
    );
  } catch (error: unknown) {
    return loginFailed(`The login form could not be filled in and submitted: ${summarizeError(error)}`);
  } finally {
    signInRequests.stop();
  }
}

/**
 * Saves a screenshot of what the browser shows right after a login failed -
 * usually the login form with the site's own error message - so the user
 * can see why. It captures the viewport (1280x720), like every other
 * screenshot in the app. Its folder is created when missing.
 *
 * Never rejects: the login has already failed, and a screenshot that cannot
 * be saved (e.g. the page closed) must not turn that into a different error.
 * The failure is logged instead.
 * @param page - The crawl's browser page, still on whatever the login ended at
 * @param screenshotFilePath - Absolute path of the PNG to write
 * @returns True when the PNG was written; false when it could not be
 */
export async function captureLoginFailureScreenshot(
  page: Page,
  screenshotFilePath: string,
): Promise<boolean> {
  try {
    await mkdir(path.dirname(screenshotFilePath), { recursive: true });
    await page.screenshot({ path: screenshotFilePath, timeout: LOGIN_STEP_TIMEOUT_MS });
    return true;
  } catch (error: unknown) {
    console.error(`[crawl] the login failure screenshot could not be saved: ${summarizeError(error)}`);
    return false;
  }
}
