import { formatCount } from "./formatCount";

/** The parts of a crawl run its status line is built from. */
export interface CrawlRunStatusFields {
  /** Where the crawl is: still running, or how it ended. */
  status: string;
  /** Pages recorded so far. */
  visitedPageCount: number;
  /** The most pages the crawl may visit. */
  pageLimit: number;
}

/** The parts of a running crawl its progress line is built from. */
export interface CrawlRunProgressFields extends CrawlRunStatusFields {
  /** Links queued but not yet visited. */
  waitingUrlCount: number;
}

/** The parts of a crawl run its login line is built from. */
export interface CrawlRunLoginFields {
  /** Where the crawl is: still running, or how it ended. */
  status: string;
  /** True once the crawl has logged in. */
  isLoggedIn: boolean;
  /** The credential the crawl was started with, or null for a logged-out crawl. */
  credential: { name: string } | null;
}

/** How a crawl status is coloured: an MUI Alert severity. */
export type CrawlRunSeverity = "info" | "success" | "warning" | "error";

/**
 * Words what state a crawl is in, by its status.
 * @param run - The run's status and page limit
 * @returns e.g. "Running", "Finished", "Stopped at the 50-page limit"
 */
function describeCrawlRunState(run: CrawlRunStatusFields): string {
  switch (run.status) {
    case "running":
      return "Running";
    case "finished":
      return "Finished";
    case "stoppedAtPageLimit":
      return `Stopped at the ${String(run.pageLimit)}-page limit`;
    case "stoppedAtTimeLimit":
      return "Stopped at the time limit";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted (the server restarted or the browser closed)";
    default:
      return run.status;
  }
}

/**
 * Summarizes a crawl for a status line or a list row, e.g. "Running · 12
 * pages so far", "Finished · 34 pages", or "Stopped at the 50-page limit ·
 * 50 pages".
 * @param run - The run's status, page count, and page limit
 * @returns The crawl's state followed by its page count
 */
export function describeCrawlRunStatus(run: CrawlRunStatusFields): string {
  const pageCountText = formatCount(run.visitedPageCount, "page", "pages");
  const crawlIsRunning = run.status === "running";
  const pageCountSuffix = crawlIsRunning ? " so far" : "";
  return `${describeCrawlRunState(run)} · ${pageCountText}${pageCountSuffix}`;
}

/**
 * Words a running crawl's progress, e.g. "12 of up to 50 pages · 8 waiting"
 * (the waiting count is the links queued but not yet visited).
 * @param run - The run's counters and page limit
 * @returns The progress line
 */
export function describeCrawlRunProgress(run: CrawlRunProgressFields): string {
  return `${String(run.visitedPageCount)} of up to ${String(run.pageLimit)} pages · ${String(run.waitingUrlCount)} waiting`;
}

/**
 * Picks how a crawl status is coloured: running is informational, finished
 * is a success, stopping at a limit is a warning (pages were left), and a
 * failed or interrupted crawl is an error.
 * @param status - The run's status
 * @returns The matching Alert severity
 */
export function crawlRunSeverity(status: string): CrawlRunSeverity {
  switch (status) {
    case "running":
      return "info";
    case "finished":
      return "success";
    case "stoppedAtPageLimit":
    case "stoppedAtTimeLimit":
      return "warning";
    default:
      return "error";
  }
}

/**
 * Tells whether a crawl ended without logging in with its credential: the
 * login failed, or the crawl was cut off while logging in. A logged-out crawl
 * (no credential) and one still running never count.
 * @param run - The run's status, login state, and credential
 * @returns True when the crawl had a credential, has ended, and never logged in
 */
export function crawlRunLoginFailed(run: CrawlRunLoginFields): boolean {
  const crawlHasACredential = run.credential !== null;
  const crawlHasEnded = run.status !== "running";
  return crawlHasACredential && crawlHasEnded && !run.isLoggedIn;
}

/**
 * Words who a crawl viewed the site as, for the crawl's login tag:
 * - no credential: "Logged out";
 * - logged in: `Logged in as “Admin”` - every page of the run was viewed
 *   logged in, because the crawler records nothing before it logs in;
 * - still running and not logged in yet: `Logging in as “Admin”…`;
 * - ended without logging in (the login failed, or the crawl was cut off
 *   while logging in): `Not logged in — login as “Admin” failed`.
 * @param run - The run's status, login state, and credential
 * @returns The login line
 */
export function describeCrawlRunLogin(run: CrawlRunLoginFields): string {
  const { credential } = run;
  if (credential === null) {
    return "Logged out";
  }
  if (run.isLoggedIn) {
    return `Logged in as “${credential.name}”`;
  }
  if (crawlRunLoginFailed(run)) {
    return `Not logged in — login as “${credential.name}” failed`;
  }
  return `Logging in as “${credential.name}”…`;
}

/**
 * Words a crawl for its row in a website's crawl history: how it went
 * (`describeCrawlRunStatus`), or - for a crawl that never logged in with its
 * credential, so recorded nothing - the login failure instead.
 * @param run - The run's status, page counts, login state, and credential
 * @returns e.g. "Finished · 46 pages" or `Not logged in — login as “Admin” failed`
 */
export function describeCrawlRunHistoryLabel(
  run: CrawlRunStatusFields & CrawlRunLoginFields,
): string {
  return crawlRunLoginFailed(run) ? describeCrawlRunLogin(run) : describeCrawlRunStatus(run);
}

/**
 * Picks how a crawl's history row is coloured: as its status is
 * (`crawlRunSeverity`), except that a crawl whose login failed is an error.
 * @param run - The run's status, login state, and credential
 * @returns The matching severity
 */
export function crawlRunHistorySeverity(run: CrawlRunLoginFields): CrawlRunSeverity {
  return crawlRunLoginFailed(run) ? "error" : crawlRunSeverity(run.status);
}

/**
 * Picks how a crawl's login line is coloured: logged in is a success, a
 * logged-out crawl or one still logging in is informational, and a crawl
 * that ended without logging in with its credential is an error.
 * @param run - The run's status, login state, and credential
 * @returns The matching Alert severity
 */
export function crawlRunLoginSeverity(run: CrawlRunLoginFields): CrawlRunSeverity {
  const crawlHasNoCredential = run.credential === null;
  const crawlIsRunning = run.status === "running";
  if (run.isLoggedIn) {
    return "success";
  }
  if (crawlHasNoCredential || crawlIsRunning) {
    return "info";
  }
  return "error";
}

/**
 * Shortens a crawled page's identity URL to what a site map shows: its path,
 * e.g. "/websites/abc". A URL that does not parse is shown as it is.
 * @param url - The page's identity URL (origin + path)
 * @returns The URL's path
 */
export function formatCrawledPagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Reduces a URL to a crawled page's identity, the way the crawler does:
 * origin + path, with the query string and hash dropped. A URL that does not
 * parse is returned as it is.
 * @param url - Any absolute URL, e.g. a page's `requestedUrl` or `finalUrl`
 * @returns The URL's identity
 */
export function identifyCrawledUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Shows one end of a redirect: just its path when it is on the same site as
 * the other end, or its full origin + path when the redirect left the site
 * (e.g. to a sign-in provider), so "/login" on another site is never mistaken
 * for this site's "/login".
 * @param url - The end to show
 * @param otherEndUrl - The other end of the redirect
 * @returns The path, or origin + path when the two ends are on different sites
 */
function formatRedirectEnd(url: string, otherEndUrl: string): string {
  try {
    const bothEndsAreOnOneSite = new URL(url).origin === new URL(otherEndUrl).origin;
    return bothEndsAreOnOneSite ? formatCrawledPagePath(url) : identifyCrawledUrl(url);
  } catch {
    return url;
  }
}

/** The parts of a crawled page its redirect is described from. */
export interface CrawledPageLabelFields {
  /** The identity the page is recorded under. */
  url: string;
  /** What the browser loaded. */
  requestedUrl: string;
  /** Where the browser ended up. */
  finalUrl: string;
  /** True when the browser landed on a different page than it requested. */
  wasRedirected: boolean;
}

/**
 * The longest a crawl may run, in milliseconds (10 minutes), for the crawl
 * page's "2:14 of 10:00 max". Mirrors `CRAWL_TIME_LIMIT_MS` in
 * `server/services/crawlerService.ts`; the client never imports server code.
 */
export const CRAWL_TIME_LIMIT_MS = 600_000;

/** The parts of a crawled page its site map note is built from. */
export interface SiteMapNoteFields extends CrawledPageLabelFields {
  /** True only when the page answered below HTTP 400 and was read. */
  succeeded: boolean;
  /** The page's HTTP status, or null when there was no response. */
  httpStatus: number | null;
  /** The text of the button whose click first led here, or null when a link (or the start URL) did. */
  foundByButtonText: string | null;
}

/**
 * Words the short note a site map row shows after the page's path, checked
 * in this order:
 * - a failed page: its status ("HTTP 404"), or "No response";
 * - a redirect recorded where it landed: where it was requested ("from /");
 * - a redirect onto a page already recorded: where it landed ("→ /calendar");
 * - a page a button led to: the button ("via “Open Yoga”");
 * - otherwise nothing.
 * @param page - The page's URLs, redirect flag, outcome, and button text
 * @returns The note, or an empty string
 */
export function describeSiteMapNote(page: SiteMapNoteFields): string {
  if (!page.succeeded) {
    return page.httpStatus === null ? "No response" : `HTTP ${String(page.httpStatus)}`;
  }
  if (page.wasRedirected) {
    const pageIsRecordedWhereItLanded = identifyCrawledUrl(page.finalUrl) === page.url;
    return pageIsRecordedWhereItLanded
      ? `from ${formatRedirectEnd(identifyCrawledUrl(page.requestedUrl), page.url)}`
      : `→ ${formatRedirectEnd(identifyCrawledUrl(page.finalUrl), page.url)}`;
  }
  const aButtonLedHere = page.foundByButtonText !== null;
  return aButtonLedHere ? `via “${page.foundByButtonText ?? ""}”` : "";
}

/**
 * Words a crawled page's redirect for its details, or nothing when it was
 * not redirected: "Redirected from /" for a page recorded where it landed,
 * "Redirected to /calendar" for one recorded where it was requested.
 * @param page - The page's recorded, requested, and final URLs, and whether it redirected
 * @returns The redirect fact, or null when there was no redirect
 */
export function describeRedirectFact(page: CrawledPageLabelFields): string | null {
  if (!page.wasRedirected) {
    return null;
  }
  const pageIsRecordedWhereItLanded = identifyCrawledUrl(page.finalUrl) === page.url;
  return pageIsRecordedWhereItLanded
    ? `Redirected from ${formatRedirectEnd(identifyCrawledUrl(page.requestedUrl), page.url)}`
    : `Redirected to ${formatRedirectEnd(identifyCrawledUrl(page.finalUrl), page.url)}`;
}
