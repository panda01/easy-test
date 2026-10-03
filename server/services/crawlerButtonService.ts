import type { Page } from "playwright";
import type { CrawlButtonMode } from "../utils/crawlButtonModes.js";
import {
  isSameOriginUrl,
  normalizeCrawlUrl,
  type NormalizedCrawlUrl,
} from "../utils/normalizeCrawlUrl.js";
import {
  navigateToUrl,
  waitForPageReadiness,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import {
  trackPageRequests,
  waitForTrackedRequestsToFinish,
  waitOutMinimumWaitSince,
} from "./pageActionService.js";

/**
 * The elements the crawler treats as buttons: real `<button>`s, anything
 * marked `role="button"`, and button-like `<input>`s.
 */
export const CLICKABLE_BUTTON_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"]';

/**
 * Words that make a button RISKY: clicking it could change or lose data, end
 * the session, spend money, or tell someone something. A button whose text
 * holds one of them as a whole word (any case) is never clicked, in any mode.
 * A two-word entry also matches with a hyphen ("sign-out", "check-out").
 */
export const RISKY_BUTTON_WORDS = [
  // Making things
  "create",
  "add",
  "new",
  // Removing things
  "delete",
  "remove",
  "destroy",
  "archive",
  // Changing things
  "update",
  "edit",
  "save",
  "submit",
  "change",
  "reset",
  // Ending the session
  "log out",
  "logout",
  "log off",
  "logoff",
  "sign out",
  "signout",
  // Money
  "pay",
  "payment",
  "purchase",
  "buy",
  "checkout",
  "check out",
  "order",
  // Committing to something, or telling someone
  "confirm",
  "cancel",
  "send",
  "publish",
  "approve",
  "reject",
  "refund",
  "subscribe",
  "unsubscribe",
  "upload",
  "invite",
  "accept",
  "decline",
] as const;

/**
 * Turns one risky word into its regular expression source: the words of a
 * two-word entry may be separated by any run of spaces or hyphens.
 * @param riskyWord - One entry of `RISKY_BUTTON_WORDS`
 * @returns The entry's pattern source, e.g. `log[\s-]+out`
 */
function buildRiskyWordPatternSource(riskyWord: string): string {
  return riskyWord.split(" ").join("[\\s-]+");
}

/**
 * Matches button text holding any of `RISKY_BUTTON_WORDS` as a whole word, in
 * any case: "Delete session", "LOG OUT", and "Sign-out" match; "Address" and
 * "Newsletter" do not.
 */
export const RISKY_BUTTON_TEXT_PATTERN = new RegExp(
  `\\b(?:${RISKY_BUTTON_WORDS.map(buildRiskyWordPatternSource).join("|")})\\b`,
  "i",
);

/**
 * Matches button text holding "open" as a whole word, in any case: "Open",
 * "Open session", and "OPEN →" match; "Reopen" and "Opens" do not.
 */
export const OPEN_BUTTON_TEXT_PATTERN = /\bopen\b/i;

/**
 * The most buttons clicked on one page, in page order. Every click after the
 * first reloads the page, so this bounds how long one page can take.
 */
export const BUTTON_CLICKS_PER_PAGE_LIMIT = 20;

/** How long one button click may take (waiting for the button to be clickable included). */
export const BUTTON_CLICK_TIMEOUT_MS = 10_000;

/** One button as the browser reported it, before the crawler decides about it. */
export interface RawPageButton {
  /** The button's label, whitespace collapsed and trimmed; blank when it has none (icon-only). */
  text: string;
  /** Whether the button is rendered visibly (`Element.checkVisibility()`). */
  isVisible: boolean;
  /** Whether the button is disabled (`disabled`, or `aria-disabled="true"`). */
  isDisabled: boolean;
}

/** A button the crawler will click. */
export interface ChosenButton {
  /** Its position among the page's `CLICKABLE_BUTTON_SELECTOR` matches, in DOM order. */
  index: number;
  /** Its label, to check it is still the same button after a reload. */
  text: string;
}

/** A same-site page a button click landed on. */
export interface ButtonLink {
  /** The label of the button that was clicked. */
  buttonText: string;
  /** Where the click landed, normalized like a link. */
  link: NormalizedCrawlUrl;
}

/** Where the buttons being followed live, and how long to wait after each click. */
interface ButtonPage {
  /** The page's URL (its final URL), reloaded before every click but the first. */
  pageUrl: string;
  /** The page's identity; a click that stays on it led nowhere new. */
  pageIdentityUrl: string;
  /** The crawl's origin; a click that leaves it is ignored. */
  crawlOrigin: string;
  /** The website's network idle cap and minimum wait. */
  timingSettings: ScreenshotTimingSettings;
}

/**
 * The function the button scan runs INSIDE the browser: every matched
 * element's label, whether it is visible, and whether it is disabled, in DOM
 * order. The label is the first non-blank of `innerText`, `value` (for
 * `<input>` buttons), `aria-label`, and `title`, with its whitespace collapsed.
 *
 * Kept as an anonymous arrow function with no named helpers inside: `tsx`
 * (esbuild) wraps NAMED functions in a `__name(...)` helper that only exists
 * on the server, which fails in the page with "__name is not defined".
 * @param buttons - The elements that matched `CLICKABLE_BUTTON_SELECTOR`
 * @returns One raw button per element, in the same order
 */
export const readRawPageButtons = (buttons: Element[]): RawPageButton[] =>
  buttons.map((button) => {
    const buttonProperties = button as Element & {
      innerText?: unknown;
      value?: unknown;
      disabled?: unknown;
    };
    const labelCandidates: unknown[] = [
      buttonProperties.innerText,
      buttonProperties.value,
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
    ];
    const collapsedLabels = labelCandidates.map((labelCandidate) =>
      typeof labelCandidate === "string" ? labelCandidate.replace(/\s+/g, " ").trim() : "",
    );
    const text = collapsedLabels.find((collapsedLabel) => collapsedLabel !== "") ?? "";
    const isDisabled =
      buttonProperties.disabled === true || button.getAttribute("aria-disabled") === "true";
    return { text, isVisible: button.checkVisibility(), isDisabled };
  });

/**
 * Decides whether a button's label passes the crawl's button mode:
 * - `linksOnly`: never.
 * - `allButRisky`: unless the label holds a risky word.
 * - `openOnly`: when the label says "open" AND holds no risky word, so
 *   "Open and delete" is never clicked.
 * @param buttonText - The button's label
 * @param buttonMode - The crawl's button mode
 * @returns True when the mode allows clicking the button
 */
function buttonTextPassesMode(buttonText: string, buttonMode: CrawlButtonMode): boolean {
  const buttonTextIsRisky = RISKY_BUTTON_TEXT_PATTERN.test(buttonText);
  switch (buttonMode) {
    case "linksOnly":
      return false;
    case "allButRisky":
      return !buttonTextIsRisky;
    case "openOnly": {
      const buttonTextSaysOpen = OPEN_BUTTON_TEXT_PATTERN.test(buttonText);
      return buttonTextSaysOpen && !buttonTextIsRisky;
    }
  }
}

/**
 * Picks the buttons to click on a page: visible, enabled, labelled ones (an
 * icon-only button's action is unknown, so it is never clicked) whose label
 * passes the crawl's mode (see `buttonTextPassesMode`), in page order, at most
 * `BUTTON_CLICKS_PER_PAGE_LIMIT`.
 * @param buttons - The page's buttons, as `readRawPageButtons` reported them
 * @param buttonMode - The crawl's button mode
 * @returns Each chosen button's position and label
 */
export function chooseButtonsToClick(
  buttons: RawPageButton[],
  buttonMode: CrawlButtonMode,
): ChosenButton[] {
  const chosenButtons: ChosenButton[] = [];
  for (const [index, button] of buttons.entries()) {
    const buttonHasALabel = button.text !== "";
    const buttonCanBeClicked = button.isVisible && !button.isDisabled && buttonHasALabel;
    const buttonIsChosen = buttonCanBeClicked && buttonTextPassesMode(button.text, buttonMode);
    if (buttonIsChosen) {
      chosenButtons.push({ index, text: button.text });
    }
  }
  return chosenButtons.slice(0, BUTTON_CLICKS_PER_PAGE_LIMIT);
}

/**
 * Reads every button on the page as it is now.
 * @param page - The crawl's browser page
 * @returns The page's buttons, in DOM order
 * @throws When the page's buttons cannot be read, e.g. its context was destroyed
 */
async function readPageButtons(page: Page): Promise<RawPageButton[]> {
  return page.locator(CLICKABLE_BUTTON_SELECTOR).evaluateAll(readRawPageButtons);
}

/**
 * Loads the page again and waits until it is ready (the website's timing
 * settings, as for every crawled page), so the next click starts from the
 * page as it was crawled rather than wherever the last click left it.
 * @param page - The crawl's browser page
 * @param buttonPage - The page's URL and the website's timing settings
 * @returns True once the page is loaded and ready; false when the navigation failed or the page never became ready
 */
async function reloadButtonPage(page: Page, buttonPage: ButtonPage): Promise<boolean> {
  const navigation = await navigateToUrl(page, buttonPage.pageUrl);
  if (!navigation.navigationCompleted) {
    return false;
  }
  try {
    await waitForPageReadiness(page, buttonPage.timingSettings);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clicks one button, then gives the site time to answer: the requests the
 * click started finish (capped by the website's network idle cap), then the
 * rest of the website's minimum wait since the click passes. Request tracking
 * is always stopped, even when the click fails.
 * @param page - The crawl's browser page
 * @param chosenButton - The button to click (its position among the page's buttons)
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Resolves once the click's result has settled
 * @throws When the click fails (e.g. it timed out after `BUTTON_CLICK_TIMEOUT_MS`) or the page closes while waiting
 */
async function clickAndWaitForResult(
  page: Page,
  chosenButton: ChosenButton,
  timingSettings: ScreenshotTimingSettings,
): Promise<void> {
  // Counting starts BEFORE the click, so every request it starts is seen.
  const clickRequests = trackPageRequests(page);
  try {
    const clickedAt = performance.now();
    await page
      .locator(CLICKABLE_BUTTON_SELECTOR)
      .nth(chosenButton.index)
      .click({ timeout: BUTTON_CLICK_TIMEOUT_MS });
    await waitForTrackedRequestsToFinish(page, clickRequests, timingSettings.networkIdleTimeoutMs);
    await waitOutMinimumWaitSince(page, clickedAt, timingSettings.screenshotMinimumWaitMs);
  } finally {
    clickRequests.stop();
  }
}

/**
 * Reads where the browser is after a click, and keeps it when it is a new
 * page of the same site: a followable http(s) URL, on the crawl's origin,
 * with a different identity from the page the button is on. A click that
 * stayed put (it opened a dialog or a panel), only changed the query string
 * or hash, or left the site led nowhere new.
 * @param page - The crawl's browser page, after the click settled
 * @param chosenButton - The button that was clicked
 * @param buttonPage - The page the button is on, and the crawl's origin
 * @returns The button link, or null when the click led nowhere new
 */
function readButtonLink(
  page: Page,
  chosenButton: ChosenButton,
  buttonPage: ButtonPage,
): ButtonLink | null {
  const landedUrl = page.url();
  const landedLink = normalizeCrawlUrl(landedUrl, landedUrl);
  const clickLandedOnAFollowableUrl = landedLink !== null;
  if (!clickLandedOnAFollowableUrl) {
    return null;
  }
  const clickStayedOnTheSite = isSameOriginUrl(landedLink.identityUrl, buttonPage.crawlOrigin);
  const clickLeftTheButtonPage = landedLink.identityUrl !== buttonPage.pageIdentityUrl;
  const clickLedToANewPage = clickStayedOnTheSite && clickLeftTheButtonPage;
  return clickLedToANewPage ? { buttonText: chosenButton.text, link: landedLink } : null;
}

/**
 * Follows one chosen button:
 * 1. Reload the page first, unless this is the first click (the page is
 *    still as crawled then). A reload that fails skips the button.
 * 2. Read the page's buttons again, and skip this one when the element at its
 *    position no longer has the same label (the page changed).
 * 3. Click it and wait for the result (see `clickAndWaitForResult`).
 * 4. Keep where it landed when that is a new page of the site (see
 *    `readButtonLink`).
 *
 * Every failure - a click that timed out, a page whose context was destroyed
 * - skips this button only; this never rejects.
 * @param page - The crawl's browser page
 * @param chosenButton - The button to follow
 * @param buttonPage - The page the button is on, the crawl's origin, and the website's timing settings
 * @param isFirstClick - True for the page's first chosen button, which needs no reload
 * @returns Where the button led, or null when it led nowhere new or was skipped
 */
async function followOneButton(
  page: Page,
  chosenButton: ChosenButton,
  buttonPage: ButtonPage,
  isFirstClick: boolean,
): Promise<ButtonLink | null> {
  try {
    const pageNeedsReloading = !isFirstClick;
    if (pageNeedsReloading) {
      const pageWasReloaded = await reloadButtonPage(page, buttonPage);
      if (!pageWasReloaded) {
        return null;
      }
    }
    const currentButtons = await readPageButtons(page);
    const buttonIsStillTheSame = currentButtons.at(chosenButton.index)?.text === chosenButton.text;
    if (!buttonIsStillTheSame) {
      return null;
    }
    await clickAndWaitForResult(page, chosenButton, buttonPage.timingSettings);
    return readButtonLink(page, chosenButton, buttonPage);
  } catch {
    return null;
  }
}

/**
 * Clicks the page's buttons that the crawl's mode allows (see
 * `chooseButtonsToClick`), one at a time, and collects the same-site pages
 * they led to.
 *
 * The buttons are read once, on the page as crawled. Each chosen button is
 * then followed on a freshly reloaded page (every click but the first), after
 * checking it still carries the same label, and given time to answer: the
 * requests its click started, then the website's minimum wait (see
 * `followOneButton`). A click only counts when it lands on a different page
 * (identity) of the crawl's origin.
 *
 * A button that fails is skipped; the rest are still followed. This never
 * rejects: buttons that cannot be read at all mean no button links. When it
 * returns, the browser is wherever the last click left it. Pop-up windows and
 * `alert`/`confirm` dialogs a click opens are handled by the crawl (see
 * `crawlWithPage`).
 * @param page - The crawl's browser page, showing the page as crawled
 * @param pageUrl - The page's final URL, reloaded before every click but the first
 * @param pageIdentityUrl - The page's identity (origin + path); clicks that stay on it are ignored
 * @param crawlOrigin - The crawl's origin; clicks that leave it are ignored
 * @param buttonMode - Which buttons to click
 * @param timingSettings - The website's network idle cap and minimum wait, for each reload and click
 * @returns The pages the buttons led to, in click order (one per button that led somewhere new)
 */
export async function followPageButtons(
  page: Page,
  pageUrl: string,
  pageIdentityUrl: string,
  crawlOrigin: string,
  buttonMode: CrawlButtonMode,
  timingSettings: ScreenshotTimingSettings,
): Promise<ButtonLink[]> {
  let pageButtons: RawPageButton[];
  try {
    pageButtons = await readPageButtons(page);
  } catch {
    return [];
  }

  const chosenButtons = chooseButtonsToClick(pageButtons, buttonMode);
  const buttonPage: ButtonPage = { pageUrl, pageIdentityUrl, crawlOrigin, timingSettings };
  const buttonLinks: ButtonLink[] = [];
  for (const [clickNumber, chosenButton] of chosenButtons.entries()) {
    const isFirstClick = clickNumber === 0;
    const buttonLink = await followOneButton(page, chosenButton, buttonPage, isFirstClick);
    const buttonLedToANewPage = buttonLink !== null;
    if (buttonLedToANewPage) {
      buttonLinks.push(buttonLink);
    }
  }
  return buttonLinks;
}
