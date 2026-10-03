import { chromium, type Browser, type Page } from "playwright";
import type { CrawledPageInput, CrawlProgress } from "./dbService.js";
import {
  FIRST_FAILING_HTTP_STATUS,
  closeBrowserQuietly,
  describeUnsuccessfulResponse,
  measureElapsedMs,
  navigateToUrl,
  summarizeError,
  waitForPageReadiness,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import {
  isSameOriginUrl,
  normalizeCrawlUrl,
  type NormalizedCrawlUrl,
} from "../utils/normalizeCrawlUrl.js";
import {
  captureLoginFailureScreenshot,
  logInWithCredential,
  type CrawlLoginDetails,
} from "./crawlerLoginService.js";
import { DEFAULT_CRAWL_BUTTON_MODE, type CrawlButtonMode } from "../utils/crawlButtonModes.js";
import { followPageButtons, type ButtonLink } from "./crawlerButtonService.js";

/** The most pages one crawl visits (the user's choice). Failed pages count too. */
export const CRAWL_PAGE_LIMIT = 50;

/**
 * How long one crawl may run: 10 minutes (the user's choice). It is checked
 * BETWEEN pages, so a crawl can overrun it by one page's own timeouts.
 */
export const CRAWL_TIME_LIMIT_MS = 600_000;

/**
 * How long one aria snapshot may take. Without it Playwright's 30 second
 * default applies, and a document with no `<body>` (an SVG or XML file)
 * would burn all of it.
 */
export const ARIA_SNAPSHOT_TIMEOUT_MS = 10_000;

/** The browser viewport, the same size the screenshots use. */
const CRAWL_VIEWPORT = { width: 1280, height: 720 };

/**
 * The links the crawler reads: every anchor with an `href`, except download
 * links (following one would download a file instead of loading a page).
 */
const FOLLOWABLE_LINK_SELECTOR = "a[href]:not([download])";

/**
 * Matches a URL path that looks like a logout link: `logout`, `log-out`,
 * `log_out`, `signout`, `sign-out`, `sign_out`, `logoff`, `log-off`, or
 * `log_off` as a whole path segment or word, in any case - `/logout`,
 * `/users/sign_out`, `/auth/log-off.php` - but not `/blog/outing` or
 * `/catalogout`.
 */
const LOGOUT_PATH_PATTERN = /(^|[/_.-])(log[-_]?out|sign[-_]?out|log[-_]?off)([/_.-]|$)/i;

/** Why a crawl stopped. */
export type CrawlStopReason =
  | "finished"
  | "stoppedAtPageLimit"
  | "stoppedAtTimeLimit"
  | "stoppedBecauseRunWasDeleted"
  | "stoppedBecauseBrowserClosed"
  | "loginFailed";

/** How a whole crawl ended. */
export interface CrawlOutcome {
  /** Why it stopped. */
  stopReason: CrawlStopReason;
  /** How many pages were visited (and handed to the recorder). */
  visitedPageCount: number;
  /** Links still queued when it stopped. */
  waitingUrlCount: number;
  /** Why the login failed when `stopReason` is `loginFailed`; null otherwise. */
  loginErrorMessage: string | null;
  /** True when the login failed AND a screenshot of it was written to `login.failureScreenshotPath`. */
  loginFailureScreenshotWasCaptured: boolean;
}

/**
 * Asks the crawler to log in before it visits any page, and tells the caller
 * when that worked.
 */
export interface CrawlLogin {
  /** Where and as whom to log in. */
  details: CrawlLoginDetails;
  /** Absolute path of the PNG to write if the login fails, showing what the browser saw. */
  failureScreenshotPath: string;
  /**
   * Records that the login succeeded. Called once, after logging in and
   * BEFORE the first page is recorded.
   * @returns True to go on crawling; false when the run is gone (deleted with its website), which stops the crawl
   */
  recordLoginSucceeded: () => Promise<boolean>;
}

/**
 * Saves one visited page, called once per page in visiting order.
 * @param visitedPage - What visiting the page produced
 * @param progress - The crawl's counters after this page
 * @returns The saved page's id (it becomes the parent of the links found on it), or null to stop the crawl
 */
export type RecordVisitedPage = (
  visitedPage: CrawledPageInput,
  progress: CrawlProgress,
) => Promise<string | null>;

/** One link waiting to be visited. */
interface QueuedCrawlUrl {
  /** The page's identity (origin + path). */
  identityUrl: string;
  /** What the browser will load (the first link that reached it, hash dropped). */
  loadUrl: string;
  /** How many links were followed from the start page to reach it. */
  depth: number;
  /** The saved page the link was found on, or null for the start page. */
  parentPageId: string | null;
  /** The label of the button whose click led here, or null when a link (or the start URL) did. */
  foundByButtonText: string | null;
}

/** Everything the crawl loop tracks between pages. */
interface CrawlState {
  /** Links waiting to be visited, oldest first (breadth first). */
  queue: QueuedCrawlUrl[];
  /** Every identity already visited or queued, so no page is visited twice. */
  seenIdentityUrls: Set<string>;
  /**
   * Every identity a visited page has been recorded under (see
   * `decideRecordedIdentity`), so no two pages of a run share one.
   */
  recordedIdentityUrls: Set<string>;
  /** Links are only followed on this origin; set from the start page's FINAL URL. */
  crawlOrigin: string | null;
  /** Pages visited so far. */
  visitedPageCount: number;
  /** Whether the crawl logged in first; logout links are never followed while it is. */
  isLoggedIn: boolean;
}

/** The fixed inputs of one crawl. */
interface CrawlContext {
  /** The website's network idle cap and minimum wait. */
  timingSettings: ScreenshotTimingSettings;
  /**
   * Whether the crawl's browser and page are both still open (see
   * `crawlNextPage`). The page is checked too because, when Playwright closes
   * the browser, the page closes a moment BEFORE the browser reports itself
   * disconnected - a visit can fail on the closed page while
   * `browser.isConnected()` still says true.
   */
  browserIsStillOpen: () => boolean;
  /** Saves each visited page. */
  recordVisitedPage: RecordVisitedPage;
  /** The `performance.now()` reading taken when the crawl began. */
  crawlStartedAt: number;
  /** Which buttons the crawl clicks on each page, on top of following links. */
  buttonMode: CrawlButtonMode;
}

/** What visiting one page produced. */
interface PageVisit {
  /** The page as it will be saved. */
  visitedPage: CrawledPageInput;
  /** The page's same-origin links, normalized and de-duplicated, in page order. */
  sameOriginLinks: NormalizedCrawlUrl[];
  /**
   * The same-origin pages the page's buttons led to, in click order (empty
   * when the crawl clicks no buttons, or the page failed or is off-origin).
   */
  buttonLinks: ButtonLink[];
}

/** The links an anchor scan found, before they are resolved on the server. */
interface RawPageLinks {
  /** The page's base URL (`document.baseURI`), which honours `<base href>`. */
  baseUrl: string;
  /** Every followable anchor's `href` attribute, exactly as written. */
  hrefs: string[];
}

/**
 * Builds the queue entry for the start page. The browser loads the website's
 * URL EXACTLY (it may carry a query string the site needs); only its identity
 * is normalized.
 * @param startUrl - The website's URL
 * @returns The first queue entry: depth 0, no parent, not found by a button
 */
function buildStartEntry(startUrl: string): QueuedCrawlUrl {
  const normalizedStartUrl = normalizeCrawlUrl(startUrl, startUrl);
  const identityUrl = normalizedStartUrl?.identityUrl ?? startUrl;
  return {
    identityUrl,
    loadUrl: startUrl,
    depth: 0,
    parentPageId: null,
    foundByButtonText: null,
  };
}

/**
 * Remembers the crawl's origin the first time a page reports its final URL -
 * the start page's. Taking it from where the start page ENDED UP means an
 * http to https or apex to www redirect does not end the crawl after one page.
 * @param state - The crawl state to update
 * @param finalUrl - The page's URL after redirects
 */
function rememberCrawlOriginOnce(state: CrawlState, finalUrl: string): void {
  const originIsAlreadyKnown = state.crawlOrigin !== null;
  if (originIsAlreadyKnown) return;
  try {
    state.crawlOrigin = new URL(finalUrl).origin;
  } catch {
    state.crawlOrigin = null;
  }
}

/**
 * Marks a page's final URL as seen, so a link to where it redirected is not
 * visited again.
 * @param state - The crawl state to update
 * @param finalUrl - The page's URL after redirects
 */
function markFinalUrlAsSeen(state: CrawlState, finalUrl: string): void {
  const normalizedFinalUrl = normalizeCrawlUrl(finalUrl, finalUrl);
  if (normalizedFinalUrl !== null) {
    state.seenIdentityUrls.add(normalizedFinalUrl.identityUrl);
  }
}

/** Where a visited page is recorded, and whether it redirected. */
interface RecordedIdentity {
  /** The identity (origin + path) the page is recorded under. */
  url: string;
  /** True when the browser landed on a different page than it requested. */
  wasRedirected: boolean;
}

/**
 * Decides which identity a visited page is recorded under: WHERE THE BROWSER
 * LANDED, so a link to `/` that redirects to `/calendar` is recorded as
 * `/calendar` (and marked `wasRedirected`).
 *
 * The one exception: when the page it landed on is already recorded in this
 * crawl (another link redirected there first, or it was visited directly),
 * this page keeps the identity it was requested at - a second row for the
 * same identity would break `(crawlRunId, url)` uniqueness - and its
 * `finalUrl` still names the page it landed on. A final URL that cannot be
 * parsed counts as no redirect.
 * @param state - The crawl state (which identities are already recorded)
 * @param queuedUrl - The queue entry that was visited
 * @param finalUrl - Where the browser ended up
 * @returns The identity to record the page under, and whether it redirected
 */
function decideRecordedIdentity(
  state: CrawlState,
  queuedUrl: QueuedCrawlUrl,
  finalUrl: string,
): RecordedIdentity {
  const normalizedFinalUrl = normalizeCrawlUrl(finalUrl, finalUrl);
  const landedIdentityUrl = normalizedFinalUrl?.identityUrl ?? queuedUrl.identityUrl;
  const pageWasRedirected = landedIdentityUrl !== queuedUrl.identityUrl;
  if (!pageWasRedirected) {
    return { url: queuedUrl.identityUrl, wasRedirected: false };
  }
  const landingPageIsAlreadyRecorded = state.recordedIdentityUrls.has(landedIdentityUrl);
  const recordedUrl = landingPageIsAlreadyRecorded ? queuedUrl.identityUrl : landedIdentityUrl;
  return { url: recordedUrl, wasRedirected: true };
}

/**
 * Remembers the identity a page was just recorded under, and takes that
 * identity off the queue if it was still waiting there: a page that was
 * reached through a redirect has been visited, so its own link must not be
 * visited again (it would also break `(crawlRunId, url)` uniqueness).
 * @param state - The crawl state to update
 * @param recordedUrl - The identity the page is recorded under
 */
function claimRecordedIdentity(state: CrawlState, recordedUrl: string): void {
  state.recordedIdentityUrls.add(recordedUrl);
  state.queue = state.queue.filter((queuedUrl) => queuedUrl.identityUrl !== recordedUrl);
}

/**
 * Takes Playwright's aria snapshot of the page's `<body>`.
 * @param page - The page that is ready
 * @returns The YAML snapshot, or the reason it could not be taken
 */
async function takeAriaSnapshot(
  page: Page,
): Promise<{ ariaSnapshot: string | null; errorMessage: string | null }> {
  try {
    const ariaSnapshot = await page
      .locator("body")
      .ariaSnapshot({ timeout: ARIA_SNAPSHOT_TIMEOUT_MS });
    return { ariaSnapshot, errorMessage: null };
  } catch (error: unknown) {
    const errorMessage = `The aria snapshot could not be taken: ${summarizeError(error)}`;
    return { ariaSnapshot: null, errorMessage };
  }
}

/**
 * Reads the page's `<title>`. A late client-side navigation can destroy the
 * page's context mid-read; the title is optional, so that is reported as no
 * title rather than as a failed page.
 * @param page - The page that is ready
 * @returns The title, or null when it is empty or could not be read
 */
async function readPageTitle(page: Page): Promise<string | null> {
  try {
    const title = await page.title();
    const titleIsEmpty = title.trim() === "";
    return titleIsEmpty ? null : title;
  } catch {
    return null;
  }
}

/**
 * The function the anchor scan runs INSIDE the browser: the page's base URL
 * and every matched anchor's raw `href` attribute. Raw attributes (not the
 * `.href` property) because an SVG `<a>`'s `.href` is not a string; they are
 * resolved on the server by `normalizeCrawlUrl`.
 *
 * Kept as an anonymous arrow function with no named helpers inside: `tsx`
 * (esbuild) wraps NAMED functions in a `__name(...)` helper that only exists
 * on the server, which fails in the page with "__name is not defined".
 * @param anchors - The anchors that matched `FOLLOWABLE_LINK_SELECTOR`
 * @returns The page's base URL and the anchors' raw hrefs
 */
export const readRawPageLinks = (anchors: Element[]): RawPageLinks => ({
  baseUrl: document.baseURI,
  hrefs: anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
});

/**
 * Reads every followable link on the page and keeps the ones on the crawl's
 * origin: resolved, normalized, and de-duplicated by identity (the first
 * occurrence's load URL wins), in page order.
 * @param page - The page that is ready
 * @param crawlOrigin - The origin links must be on
 * @returns The same-origin links
 * @throws When the page's anchors cannot be read, e.g. its context was destroyed
 */
async function collectSameOriginLinks(
  page: Page,
  crawlOrigin: string,
): Promise<NormalizedCrawlUrl[]> {
  const rawPageLinks = await page.locator(FOLLOWABLE_LINK_SELECTOR).evaluateAll(readRawPageLinks);
  const linksByIdentity = new Map<string, NormalizedCrawlUrl>();
  for (const rawHref of rawPageLinks.hrefs) {
    const normalizedLink = normalizeCrawlUrl(rawHref, rawPageLinks.baseUrl);
    const linkIsFollowable =
      normalizedLink !== null && isSameOriginUrl(normalizedLink.identityUrl, crawlOrigin);
    const linkIsNew = linkIsFollowable && !linksByIdentity.has(normalizedLink.identityUrl);
    if (linkIsNew) {
      linksByIdentity.set(normalizedLink.identityUrl, normalizedLink);
    }
  }
  return [...linksByIdentity.values()];
}

/**
 * Reads a ready page's links when its final URL is on the crawl's origin. A
 * page that redirected off-site is recorded, but its links are not followed.
 * @param page - The page that is ready
 * @param state - The crawl state (for the origin)
 * @param finalUrl - The page's URL after redirects
 * @returns The links (empty when off-origin), or the reason they could not be read
 */
async function readLinksWhenOnOrigin(
  page: Page,
  state: CrawlState,
  finalUrl: string,
): Promise<{ links: NormalizedCrawlUrl[]; errorMessage: string | null }> {
  const { crawlOrigin } = state;
  const pageIsOnCrawlOrigin = crawlOrigin !== null && isSameOriginUrl(finalUrl, crawlOrigin);
  if (!pageIsOnCrawlOrigin) {
    return { links: [], errorMessage: null };
  }
  try {
    const links = await collectSameOriginLinks(page, crawlOrigin);
    return { links, errorMessage: null };
  } catch (error: unknown) {
    const errorMessage = `The page's links could not be read: ${summarizeError(error)}`;
    return { links: [], errorMessage };
  }
}

/**
 * Builds the visit of a page that could not be read at all: navigation threw,
 * or the page never became ready. It has no snapshot, title, links, or button
 * links (its buttons are never clicked).
 * @param queuedUrl - The queue entry that was visited
 * @param state - The crawl state (for the visit order)
 * @param failure - The final URL, HTTP status (if any), and why it failed
 * @param failure.finalUrl - Where the browser ended up (the requested URL when navigation threw)
 * @param failure.httpStatus - The main response's HTTP status, or null
 * @param failure.errorMessage - Why the page failed
 * @param visitStartedAt - The `performance.now()` reading taken when the visit began
 * @returns The failed visit
 */
function buildUnreadablePageVisit(
  queuedUrl: QueuedCrawlUrl,
  state: CrawlState,
  failure: { finalUrl: string; httpStatus: number | null; errorMessage: string },
  visitStartedAt: number,
): PageVisit {
  const recordedIdentity = decideRecordedIdentity(state, queuedUrl, failure.finalUrl);
  return {
    visitedPage: {
      parentPageId: queuedUrl.parentPageId,
      url: recordedIdentity.url,
      requestedUrl: queuedUrl.loadUrl,
      finalUrl: failure.finalUrl,
      wasRedirected: recordedIdentity.wasRedirected,
      foundByButtonText: queuedUrl.foundByButtonText,
      buttonUrls: [],
      visitOrder: state.visitedPageCount,
      depth: queuedUrl.depth,
      succeeded: false,
      httpStatus: failure.httpStatus,
      errorMessage: failure.errorMessage,
      title: null,
      ariaSnapshot: null,
      linkedUrls: [],
      durationMs: measureElapsedMs(visitStartedAt),
    },
    sameOriginLinks: [],
    buttonLinks: [],
  };
}

/**
 * Clicks the page's buttons when the crawl's button mode asks for it (see
 * `followPageButtons`), but only on a page that fully succeeded - it answered
 * below HTTP 400, and its snapshot and links were read - and whose final URL
 * is on the crawl's origin. Each click after the first reloads the page from
 * its final URL.
 * @param page - The crawl's browser page, still showing the page as crawled
 * @param state - The crawl state (for the origin)
 * @param context - The crawl's button mode and the website's timing settings
 * @param finalUrl - The page's URL after redirects
 * @param pageSucceeded - True when everything on the page was read
 * @returns The same-origin pages the buttons led to, in click order; empty when no button is clicked
 */
async function followButtonsWhenAsked(
  page: Page,
  state: CrawlState,
  context: CrawlContext,
  finalUrl: string,
  pageSucceeded: boolean,
): Promise<ButtonLink[]> {
  const crawlClicksButtons = context.buttonMode !== "linksOnly";
  const { crawlOrigin } = state;
  const pageIsOnCrawlOrigin = crawlOrigin !== null && isSameOriginUrl(finalUrl, crawlOrigin);
  const normalizedFinalUrl = normalizeCrawlUrl(finalUrl, finalUrl);
  const pageHasAnIdentity = normalizedFinalUrl !== null;
  const buttonsShouldBeClicked =
    crawlClicksButtons && pageSucceeded && pageIsOnCrawlOrigin && pageHasAnIdentity;
  if (!buttonsShouldBeClicked) {
    return [];
  }
  return followPageButtons(
    page,
    finalUrl,
    normalizedFinalUrl.identityUrl,
    crawlOrigin,
    context.buttonMode,
    context.timingSettings,
  );
}

/**
 * Visits one queued URL: navigate, wait until ready (the website's timing
 * settings, as for screenshots), then read the final URL, the aria snapshot,
 * the title, and the same-origin links - and, LAST, because every click moves
 * the browser away from the page, follow its buttons when the crawl's button
 * mode asks for it (see `followButtonsWhenAsked`).
 *
 * The final URL is read AFTER the readiness wait, because client-side
 * redirects (the history API, react-router's `<Navigate>`) only happen after
 * `load`. A page counts as succeeded only when it answered below HTTP 400 and
 * both its snapshot and its links were read; buttons are only clicked on a
 * page that succeeded. The page's `buttonUrls` are the identities its buttons
 * led to, de-duplicated, in click order, and `durationMs` includes the
 * clicks. Every failure is recorded on the page; none rejects.
 * @param page - The crawl's browser page
 * @param queuedUrl - What to visit
 * @param state - The crawl state (origin, seen URLs, visit order)
 * @param context - The website's timing settings and the crawl's button mode
 * @returns The page as it will be saved, its same-origin links, and the pages its buttons led to
 */
async function visitCrawlPage(
  page: Page,
  queuedUrl: QueuedCrawlUrl,
  state: CrawlState,
  context: CrawlContext,
): Promise<PageVisit> {
  const { timingSettings } = context;
  const visitStartedAt = performance.now();
  const navigation = await navigateToUrl(page, queuedUrl.loadUrl);
  if (!navigation.navigationCompleted) {
    const failure = {
      finalUrl: queuedUrl.loadUrl,
      httpStatus: null,
      errorMessage: navigation.errorMessage,
    };
    return buildUnreadablePageVisit(queuedUrl, state, failure, visitStartedAt);
  }

  const { httpStatus } = navigation;
  try {
    await waitForPageReadiness(page, timingSettings);
  } catch (error: unknown) {
    const errorMessage = `The page did not become ready: ${summarizeError(error)}`;
    const failure = { finalUrl: page.url(), httpStatus, errorMessage };
    return buildUnreadablePageVisit(queuedUrl, state, failure, visitStartedAt);
  }

  const finalUrl = page.url();
  rememberCrawlOriginOnce(state, finalUrl);
  markFinalUrlAsSeen(state, finalUrl);
  const snapshot = await takeAriaSnapshot(page);
  const title = await readPageTitle(page);
  const linkRead = await readLinksWhenOnOrigin(page, state, finalUrl);

  const responseIsSuccessful = httpStatus !== null && httpStatus < FIRST_FAILING_HTTP_STATUS;
  const responseErrorMessage = responseIsSuccessful
    ? null
    : describeUnsuccessfulResponse(httpStatus);
  const errorMessages = [responseErrorMessage, snapshot.errorMessage, linkRead.errorMessage].filter(
    (errorMessage): errorMessage is string => errorMessage !== null,
  );
  const everythingWasRead = errorMessages.length === 0;
  const recordedIdentity = decideRecordedIdentity(state, queuedUrl, finalUrl);
  const buttonLinks = await followButtonsWhenAsked(
    page,
    state,
    context,
    finalUrl,
    everythingWasRead,
  );
  const buttonIdentityUrls = buttonLinks.map((buttonLink) => buttonLink.link.identityUrl);

  return {
    visitedPage: {
      parentPageId: queuedUrl.parentPageId,
      url: recordedIdentity.url,
      requestedUrl: queuedUrl.loadUrl,
      finalUrl,
      wasRedirected: recordedIdentity.wasRedirected,
      foundByButtonText: queuedUrl.foundByButtonText,
      buttonUrls: [...new Set(buttonIdentityUrls)],
      visitOrder: state.visitedPageCount,
      depth: queuedUrl.depth,
      succeeded: everythingWasRead,
      httpStatus,
      errorMessage: everythingWasRead ? null : errorMessages.join("; "),
      title,
      ariaSnapshot: snapshot.ariaSnapshot,
      linkedUrls: linkRead.links.map((link) => link.identityUrl),
      durationMs: measureElapsedMs(visitStartedAt),
    },
    sameOriginLinks: linkRead.links,
    buttonLinks,
  };
}

/**
 * Checks whether a link looks like it would log the crawler out (see
 * `LOGOUT_PATH_PATTERN`). Only the path is checked; the origin, query, and
 * hash are ignored.
 * @param identityUrl - A normalized link (origin + path)
 * @returns True when the link's path looks like a logout
 */
export function isLogoutLink(identityUrl: string): boolean {
  try {
    const linkPath = new URL(identityUrl).pathname;
    return LOGOUT_PATH_PATTERN.test(linkPath);
  } catch {
    return false;
  }
}

/**
 * Checks whether a page may be queued: it was neither visited nor queued yet,
 * and - while the crawl is logged in - it does not look like a logout (see
 * `isLogoutLink`): following one would end the session and turn every later
 * page into a logged-out one.
 * @param state - The crawl state (seen identities, and whether the crawl is logged in)
 * @param identityUrl - The page's identity (origin + path)
 * @returns True when the page is new and safe to queue
 */
function isUnseenAndSafeToQueue(state: CrawlState, identityUrl: string): boolean {
  const pageWasSeen = state.seenIdentityUrls.has(identityUrl);
  const pageWouldLogOut = state.isLoggedIn && isLogoutLink(identityUrl);
  return !pageWasSeen && !pageWouldLogOut;
}

/**
 * Picks the links that were neither visited nor queued yet, and marks them
 * seen so a later page cannot queue them again. While the crawl is logged in,
 * logout links are left out (see `isUnseenAndSafeToQueue`). They are still
 * listed in the page's `linkedUrls`.
 * @param state - The crawl state to update
 * @param sameOriginLinks - A visited page's same-origin links
 * @returns The new links, in page order
 */
function claimUnseenLinks(
  state: CrawlState,
  sameOriginLinks: NormalizedCrawlUrl[],
): NormalizedCrawlUrl[] {
  const unseenLinks = sameOriginLinks.filter((link) =>
    isUnseenAndSafeToQueue(state, link.identityUrl),
  );
  for (const unseenLink of unseenLinks) {
    state.seenIdentityUrls.add(unseenLink.identityUrl);
  }
  return unseenLinks;
}

/**
 * Picks the button links whose page was neither visited nor queued yet - not
 * even by one of this page's own links, which are claimed first, so a page
 * reachable both ways counts as found by the link - and marks them seen.
 * When two buttons led to the same page, the first one's label is kept.
 * While the crawl is logged in, logout-looking pages are left out, as for
 * links (see `isUnseenAndSafeToQueue`). They are still listed in the page's
 * `buttonUrls`.
 * @param state - The crawl state to update
 * @param buttonLinks - The pages a visited page's buttons led to, in click order
 * @returns The new button links, in click order
 */
function claimUnseenButtonLinks(state: CrawlState, buttonLinks: ButtonLink[]): ButtonLink[] {
  const unseenButtonLinks: ButtonLink[] = [];
  for (const buttonLink of buttonLinks) {
    const { identityUrl } = buttonLink.link;
    const buttonLinkIsNew = isUnseenAndSafeToQueue(state, identityUrl);
    if (buttonLinkIsNew) {
      state.seenIdentityUrls.add(identityUrl);
      unseenButtonLinks.push(buttonLink);
    }
  }
  return unseenButtonLinks;
}

/**
 * Decides whether the crawl stops before visiting the next page.
 * @param state - The crawl state
 * @param crawlStartedAt - The `performance.now()` reading taken when the crawl began
 * @returns Why the crawl stops, or null to keep crawling
 */
function decideWhetherToStop(state: CrawlState, crawlStartedAt: number): CrawlStopReason | null {
  const queueIsEmpty = state.queue.length === 0;
  if (queueIsEmpty) {
    return "finished";
  }
  const pageLimitIsReached = state.visitedPageCount >= CRAWL_PAGE_LIMIT;
  if (pageLimitIsReached) {
    return "stoppedAtPageLimit";
  }
  const timeLimitIsReached = measureElapsedMs(crawlStartedAt) >= CRAWL_TIME_LIMIT_MS;
  if (timeLimitIsReached) {
    return "stoppedAtTimeLimit";
  }
  return null;
}

/**
 * Visits the next queued URL, saves it, and queues the new links found on it
 * - and then the new pages its buttons led to, each with its button's label
 * as `foundByButtonText` - as its children, one level deeper.
 *
 * When the browser (or its page) closed during the visit, the crawl stops at once
 * and the visit is NOT saved: its failure ("browser has been closed") says
 * nothing about the page, and every later page would fail the same way. The
 * URL goes back on the queue, so it counts as waiting. In practice this is a
 * server restart - `tsx watch` sends SIGTERM, and Playwright's own SIGTERM
 * handler closes the browser before the process exits.
 *
 * The new links and button links are claimed BEFORE the page is saved, so
 * the saved progress already counts them as waiting; they are queued after,
 * because their parent is the saved page's id. Links are claimed first, so a
 * page reachable both by a link and by a button counts as found by the link.
 * @param page - The crawl's browser page
 * @param state - The crawl state to update
 * @param context - The timing settings, the button mode, the recorder, and the crawl's start time
 * @returns Why the crawl stops now, or null to keep crawling
 */
async function crawlNextPage(
  page: Page,
  state: CrawlState,
  context: CrawlContext,
): Promise<CrawlStopReason | null> {
  const queuedUrl = state.queue.shift();
  // Never true in practice - the loop only calls this while links are
  // waiting - but it narrows `queuedUrl` without a non-null assertion.
  const queueWasEmpty = queuedUrl === undefined;
  if (queueWasEmpty) {
    return "finished";
  }

  const visit = await visitCrawlPage(page, queuedUrl, state, context);
  const browserClosedDuringVisit = !context.browserIsStillOpen();
  if (browserClosedDuringVisit) {
    state.queue.unshift(queuedUrl);
    return "stoppedBecauseBrowserClosed";
  }
  claimRecordedIdentity(state, visit.visitedPage.url);
  const newLinks = claimUnseenLinks(state, visit.sameOriginLinks);
  const newButtonLinks = claimUnseenButtonLinks(state, visit.buttonLinks);
  state.visitedPageCount += 1;
  const progress = {
    visitedPageCount: state.visitedPageCount,
    waitingUrlCount: state.queue.length + newLinks.length + newButtonLinks.length,
  };
  const crawledPageId = await context.recordVisitedPage(visit.visitedPage, progress);
  const runWasDeleted = crawledPageId === null;
  if (runWasDeleted) {
    return "stoppedBecauseRunWasDeleted";
  }

  const newChildren = [
    ...newLinks.map((newLink) => ({ link: newLink, foundByButtonText: null })),
    ...newButtonLinks.map((newButtonLink) => ({
      link: newButtonLink.link,
      foundByButtonText: newButtonLink.buttonText,
    })),
  ];
  for (const newChild of newChildren) {
    state.queue.push({
      identityUrl: newChild.link.identityUrl,
      loadUrl: newChild.link.loadUrl,
      depth: queuedUrl.depth + 1,
      parentPageId: crawledPageId,
      foundByButtonText: newChild.foundByButtonText,
    });
  }
  return decideWhetherToStop(state, context.crawlStartedAt);
}

/** What the login step before the crawl decided. */
interface LoginStep {
  /** Why the crawl stops before visiting any page, or null to go on crawling. */
  stopReason: CrawlStopReason | null;
  /** True when the crawl logged in and goes on as a logged-in user. */
  isLoggedIn: boolean;
  /** Why the login failed when `stopReason` is `loginFailed`; null otherwise. */
  loginErrorMessage: string | null;
  /** True when the login failed and its screenshot was written. */
  loginFailureScreenshotWasCaptured: boolean;
}

/**
 * Logs in before the crawl when it was asked to, on the crawl's own page so
 * the session cookies carry over to every page visited after it. Nothing is
 * recorded until this has succeeded.
 *
 * - No login asked for: crawl on, logged out.
 * - The browser closed while logging in (a server restart): stop as
 *   `stoppedBecauseBrowserClosed`, like a visit would.
 * - The login failed: screenshot what the browser shows (see
 *   `captureLoginFailureScreenshot`), then stop as `loginFailed` with its
 *   reason - no page is visited.
 * - The login succeeded but the run is gone: stop as
 *   `stoppedBecauseRunWasDeleted`.
 * @param page - The crawl's browser page
 * @param login - What to log in as, or null to crawl logged out
 * @param context - The timing settings and the open-browser check
 * @returns Whether to crawl on, and whether the crawl is logged in
 */
async function logInWhenAsked(
  page: Page,
  login: CrawlLogin | null,
  context: CrawlContext,
): Promise<LoginStep> {
  const noLoginFailure = { loginErrorMessage: null, loginFailureScreenshotWasCaptured: false };
  const loginWasNotAskedFor = login === null;
  if (loginWasNotAskedFor) {
    return { stopReason: null, isLoggedIn: false, ...noLoginFailure };
  }

  const loginAttempt = await logInWithCredential(page, login.details, context.timingSettings);
  const browserClosedDuringLogin = !context.browserIsStillOpen();
  if (browserClosedDuringLogin) {
    return { stopReason: "stoppedBecauseBrowserClosed", isLoggedIn: false, ...noLoginFailure };
  }
  if (!loginAttempt.loggedIn) {
    const loginFailureScreenshotWasCaptured = await captureLoginFailureScreenshot(
      page,
      login.failureScreenshotPath,
    );
    return {
      stopReason: "loginFailed",
      isLoggedIn: false,
      loginErrorMessage: loginAttempt.errorMessage,
      loginFailureScreenshotWasCaptured,
    };
  }

  const runIsStillActive = await login.recordLoginSucceeded();
  if (!runIsStillActive) {
    return { stopReason: "stoppedBecauseRunWasDeleted", isLoggedIn: true, ...noLoginFailure };
  }
  return { stopReason: null, isLoggedIn: true, ...noLoginFailure };
}

/**
 * Closes a pop-up window (a new tab or `window.open`) that a button click
 * opened, so the crawl keeps working on its one page. A pop-up that cannot be
 * closed (it, or the browser, is already gone) is left alone - it must not
 * turn into an unhandled rejection.
 * @param popup - The page Playwright reported in its "popup" event
 */
function closePopupQuietly(popup: Page): void {
  popup.close().catch(() => undefined);
}

/**
 * Runs the breadth-first crawl on an open browser page - after logging in,
 * when asked to - until it stops (see `decideWhetherToStop`), the login
 * fails, the recorder says the run is gone, or the browser closes.
 *
 * When the crawl clicks buttons, every pop-up window a click opens is closed
 * at once (see `closePopupQuietly`). `alert`, `confirm`, and `prompt` dialogs
 * need nothing here: with no "dialog" listener, Playwright dismisses them
 * itself (a `confirm` answers "Cancel"), so a click never accepts one.
 * @param browser - The crawl's browser, to notice when it has closed
 * @param page - The crawl's browser page
 * @param startUrl - The website's URL
 * @param timingSettings - The website's network idle cap and minimum wait
 * @param recordVisitedPage - Saves each visited page
 * @param login - What to log in as before the first page, or null to crawl logged out
 * @param buttonMode - Which buttons to click on each page, on top of following links
 * @returns How the crawl ended
 */
async function crawlWithPage(
  browser: Browser,
  page: Page,
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
  recordVisitedPage: RecordVisitedPage,
  login: CrawlLogin | null,
  buttonMode: CrawlButtonMode,
): Promise<CrawlOutcome> {
  const context: CrawlContext = {
    timingSettings,
    browserIsStillOpen: () => browser.isConnected() && !page.isClosed(),
    recordVisitedPage,
    crawlStartedAt: performance.now(),
    buttonMode,
  };
  const crawlClicksButtons = buttonMode !== "linksOnly";
  if (crawlClicksButtons) {
    page.on("popup", closePopupQuietly);
  }

  const loginStep = await logInWhenAsked(page, login, context);
  const loginStopReason = loginStep.stopReason;
  const loginStoppedTheCrawl = loginStopReason !== null;
  if (loginStoppedTheCrawl) {
    return {
      stopReason: loginStopReason,
      visitedPageCount: 0,
      waitingUrlCount: 0,
      loginErrorMessage: loginStep.loginErrorMessage,
      loginFailureScreenshotWasCaptured: loginStep.loginFailureScreenshotWasCaptured,
    };
  }

  const startEntry = buildStartEntry(startUrl);
  const state: CrawlState = {
    queue: [startEntry],
    seenIdentityUrls: new Set([startEntry.identityUrl]),
    recordedIdentityUrls: new Set(),
    crawlOrigin: null,
    visitedPageCount: 0,
    isLoggedIn: loginStep.isLoggedIn,
  };

  let stopReason = decideWhetherToStop(state, context.crawlStartedAt);
  while (stopReason === null) {
    stopReason = await crawlNextPage(page, state, context);
  }
  return {
    stopReason,
    visitedPageCount: state.visitedPageCount,
    waitingUrlCount: state.queue.length,
    loginErrorMessage: null,
    loginFailureScreenshotWasCaptured: false,
  };
}

/**
 * Crawls a website from `startUrl` with a headless Chromium on this machine:
 * visits the start page, then - breadth first - every same-origin page linked
 * from a visited page, up to `CRAWL_PAGE_LIMIT` pages and
 * `CRAWL_TIME_LIMIT_MS`.
 *
 * BUTTONS: with the default `linksOnly` mode it only follows links and never
 * clicks anything. With `allButRisky` or `openOnly`, it also clicks each
 * successful same-origin page's buttons that the mode allows (see
 * `chooseButtonsToClick` - risky ones such as delete, pay, or log out never),
 * after reading the page's snapshot and links, reloading the page before
 * every click but the first. A click that lands on a NEW page of the same
 * site is recorded in the page's `buttonUrls`, and that page is queued like a
 * link found on it, with the button's label as its `foundByButtonText`; a
 * page reachable both by a link and by a button counts as found by the link.
 * Pop-up windows a click opens are closed, and `alert`/`confirm` dialogs are
 * dismissed (Playwright's default), never accepted.
 *
 * Two links are the same page when their origin + path match (query string
 * and hash ignored); a page is loaded with the first link that reached it,
 * and recorded under where it LANDED - a redirected page is recorded as the
 * page it was redirected to, with `wasRedirected` (see
 * `decideRecordedIdentity`).
 * Each page is handed to `recordVisitedPage` as soon as it is visited, and the
 * id that returns becomes the parent of the links found on it - so the saved
 * pages form a tree rooted at the start page.
 *
 * A page that fails (HTTP 400+, DNS error, timeout, a download link, a
 * snapshot that could not be taken) is a recorded page with
 * `succeeded: false`, not a failed crawl. If the browser itself closes
 * mid-crawl (e.g. the server is restarting), the crawl stops with
 * `stoppedBecauseBrowserClosed`. This only rejects when the browser cannot be
 * launched or open a page, or when `recordVisitedPage` or
 * `login.recordLoginSucceeded` rejects.
 *
 * LOGGING IN: with a `login`, the crawler first logs in on the same browser
 * page (see `logInWithCredential`), so its session carries over, and records
 * nothing until that succeeds. A failed login is screenshotted to
 * `login.failureScreenshotPath`, then stops the crawl at once with
 * `loginFailed` and its reason, having visited no page. While logged in,
 * pages that look like a logout (see `isLogoutLink`) are never followed,
 * whether a link or a button led there.
 * Every call launches and closes its own browser.
 * @param startUrl - The website's URL; loaded exactly as given
 * @param timingSettings - The website's network idle cap and minimum wait, applied to every page
 * @param recordVisitedPage - Saves each visited page; returning null stops the crawl
 * @param login - What to log in as before the first page; null (the default) crawls as a logged-out visitor
 * @param buttonMode - Which buttons to click on each page, on top of following links; links only by default
 * @returns Why the crawl stopped, how many pages it visited, how many links were still waiting, and why the login failed (when it did)
 * @throws When the browser cannot be launched or open a page, or `recordVisitedPage` or `login.recordLoginSucceeded` rejects
 */
export async function crawlWebsite(
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
  recordVisitedPage: RecordVisitedPage,
  login: CrawlLogin | null = null,
  buttonMode: CrawlButtonMode = DEFAULT_CRAWL_BUTTON_MODE,
): Promise<CrawlOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: CRAWL_VIEWPORT, acceptDownloads: false });
    return await crawlWithPage(
      browser,
      page,
      startUrl,
      timingSettings,
      recordVisitedPage,
      login,
      buttonMode,
    );
  } finally {
    await closeBrowserQuietly(browser);
  }
}
