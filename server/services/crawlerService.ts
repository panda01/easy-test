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

/** Why a crawl stopped. */
export type CrawlStopReason =
  | "finished"
  | "stoppedAtPageLimit"
  | "stoppedAtTimeLimit"
  | "stoppedBecauseRunWasDeleted"
  | "stoppedBecauseBrowserClosed";

/** How a whole crawl ended. */
export interface CrawlOutcome {
  /** Why it stopped. */
  stopReason: CrawlStopReason;
  /** How many pages were visited (and handed to the recorder). */
  visitedPageCount: number;
  /** Links still queued when it stopped. */
  waitingUrlCount: number;
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
}

/** Everything the crawl loop tracks between pages. */
interface CrawlState {
  /** Links waiting to be visited, oldest first (breadth first). */
  queue: QueuedCrawlUrl[];
  /** Every identity already visited or queued, so no page is visited twice. */
  seenIdentityUrls: Set<string>;
  /** Links are only followed on this origin; set from the start page's FINAL URL. */
  crawlOrigin: string | null;
  /** Pages visited so far. */
  visitedPageCount: number;
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
}

/** What visiting one page produced. */
interface PageVisit {
  /** The page as it will be saved. */
  visitedPage: CrawledPageInput;
  /** The page's same-origin links, normalized and de-duplicated, in page order. */
  sameOriginLinks: NormalizedCrawlUrl[];
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
 * @returns The first queue entry: depth 0, no parent
 */
function buildStartEntry(startUrl: string): QueuedCrawlUrl {
  const normalizedStartUrl = normalizeCrawlUrl(startUrl, startUrl);
  const identityUrl = normalizedStartUrl?.identityUrl ?? startUrl;
  return { identityUrl, loadUrl: startUrl, depth: 0, parentPageId: null };
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
 * or the page never became ready. It has no snapshot, title, or links.
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
  return {
    visitedPage: {
      parentPageId: queuedUrl.parentPageId,
      url: queuedUrl.identityUrl,
      requestedUrl: queuedUrl.loadUrl,
      finalUrl: failure.finalUrl,
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
  };
}

/**
 * Visits one queued URL: navigate, wait until ready (the website's timing
 * settings, as for screenshots), then read the final URL, the aria snapshot,
 * the title, and the same-origin links.
 *
 * The final URL is read AFTER the readiness wait, because client-side
 * redirects (the history API, react-router's `<Navigate>`) only happen after
 * `load`. A page counts as succeeded only when it answered below HTTP 400 and
 * both its snapshot and its links were read. Every failure is recorded on the
 * page; none rejects.
 * @param page - The crawl's browser page
 * @param queuedUrl - What to visit
 * @param state - The crawl state (origin, seen URLs, visit order)
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns The page as it will be saved, and its same-origin links
 */
async function visitCrawlPage(
  page: Page,
  queuedUrl: QueuedCrawlUrl,
  state: CrawlState,
  timingSettings: ScreenshotTimingSettings,
): Promise<PageVisit> {
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

  return {
    visitedPage: {
      parentPageId: queuedUrl.parentPageId,
      url: queuedUrl.identityUrl,
      requestedUrl: queuedUrl.loadUrl,
      finalUrl,
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
  };
}

/**
 * Picks the links that were neither visited nor queued yet, and marks them
 * seen so a later page cannot queue them again.
 * @param state - The crawl state to update
 * @param sameOriginLinks - A visited page's same-origin links
 * @returns The new links, in page order
 */
function claimUnseenLinks(
  state: CrawlState,
  sameOriginLinks: NormalizedCrawlUrl[],
): NormalizedCrawlUrl[] {
  const unseenLinks = sameOriginLinks.filter(
    (link) => !state.seenIdentityUrls.has(link.identityUrl),
  );
  for (const unseenLink of unseenLinks) {
    state.seenIdentityUrls.add(unseenLink.identityUrl);
  }
  return unseenLinks;
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
 * as its children.
 *
 * When the browser (or its page) closed during the visit, the crawl stops at once
 * and the visit is NOT saved: its failure ("browser has been closed") says
 * nothing about the page, and every later page would fail the same way. The
 * URL goes back on the queue, so it counts as waiting. In practice this is a
 * server restart - `tsx watch` sends SIGTERM, and Playwright's own SIGTERM
 * handler closes the browser before the process exits.
 *
 * The new links are claimed BEFORE the page is saved, so the saved progress
 * already counts them as waiting; they are queued after, because their parent
 * is the saved page's id.
 * @param page - The crawl's browser page
 * @param state - The crawl state to update
 * @param context - The timing settings, the recorder, and the crawl's start time
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

  const visit = await visitCrawlPage(page, queuedUrl, state, context.timingSettings);
  const browserClosedDuringVisit = !context.browserIsStillOpen();
  if (browserClosedDuringVisit) {
    state.queue.unshift(queuedUrl);
    return "stoppedBecauseBrowserClosed";
  }
  const newLinks = claimUnseenLinks(state, visit.sameOriginLinks);
  state.visitedPageCount += 1;
  const progress = {
    visitedPageCount: state.visitedPageCount,
    waitingUrlCount: state.queue.length + newLinks.length,
  };
  const crawledPageId = await context.recordVisitedPage(visit.visitedPage, progress);
  const runWasDeleted = crawledPageId === null;
  if (runWasDeleted) {
    return "stoppedBecauseRunWasDeleted";
  }

  for (const newLink of newLinks) {
    state.queue.push({
      identityUrl: newLink.identityUrl,
      loadUrl: newLink.loadUrl,
      depth: queuedUrl.depth + 1,
      parentPageId: crawledPageId,
    });
  }
  return decideWhetherToStop(state, context.crawlStartedAt);
}

/**
 * Runs the breadth-first crawl on an open browser page until it stops (see
 * `decideWhetherToStop`), the recorder says the run is gone, or the browser
 * closes.
 * @param browser - The crawl's browser, to notice when it has closed
 * @param page - The crawl's browser page
 * @param startUrl - The website's URL
 * @param timingSettings - The website's network idle cap and minimum wait
 * @param recordVisitedPage - Saves each visited page
 * @returns How the crawl ended
 */
async function crawlWithPage(
  browser: Browser,
  page: Page,
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
  recordVisitedPage: RecordVisitedPage,
): Promise<CrawlOutcome> {
  const context: CrawlContext = {
    timingSettings,
    browserIsStillOpen: () => browser.isConnected() && !page.isClosed(),
    recordVisitedPage,
    crawlStartedAt: performance.now(),
  };
  const startEntry = buildStartEntry(startUrl);
  const state: CrawlState = {
    queue: [startEntry],
    seenIdentityUrls: new Set([startEntry.identityUrl]),
    crawlOrigin: null,
    visitedPageCount: 0,
  };

  let stopReason = decideWhetherToStop(state, context.crawlStartedAt);
  while (stopReason === null) {
    stopReason = await crawlNextPage(page, state, context);
  }
  return {
    stopReason,
    visitedPageCount: state.visitedPageCount,
    waitingUrlCount: state.queue.length,
  };
}

/**
 * Crawls a website from `startUrl` with a headless Chromium on this machine:
 * visits the start page, then - breadth first - every same-origin page linked
 * from a visited page (links only; it never clicks anything), up to
 * `CRAWL_PAGE_LIMIT` pages and `CRAWL_TIME_LIMIT_MS`.
 *
 * Two links are the same page when their origin + path match (query string
 * and hash ignored); a page is loaded with the first link that reached it.
 * Each page is handed to `recordVisitedPage` as soon as it is visited, and the
 * id that returns becomes the parent of the links found on it - so the saved
 * pages form a tree rooted at the start page.
 *
 * A page that fails (HTTP 400+, DNS error, timeout, a download link, a
 * snapshot that could not be taken) is a recorded page with
 * `succeeded: false`, not a failed crawl. If the browser itself closes
 * mid-crawl (e.g. the server is restarting), the crawl stops with
 * `stoppedBecauseBrowserClosed`. This only rejects when the browser cannot be
 * launched or open a page, or when `recordVisitedPage` rejects.
 * Every call launches and closes its own browser.
 * @param startUrl - The website's URL; loaded exactly as given
 * @param timingSettings - The website's network idle cap and minimum wait, applied to every page
 * @param recordVisitedPage - Saves each visited page; returning null stops the crawl
 * @returns Why the crawl stopped, how many pages it visited, and how many links were still waiting
 * @throws When the browser cannot be launched or open a page, or `recordVisitedPage` rejects
 */
export async function crawlWebsite(
  startUrl: string,
  timingSettings: ScreenshotTimingSettings,
  recordVisitedPage: RecordVisitedPage,
): Promise<CrawlOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: CRAWL_VIEWPORT, acceptDownloads: false });
    return await crawlWithPage(browser, page, startUrl, timingSettings, recordVisitedPage);
  } finally {
    await closeBrowserQuietly(browser);
  }
}
