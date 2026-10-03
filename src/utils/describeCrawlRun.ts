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
 * Words a running crawl's progress, e.g. "Visited 12 of up to 50 pages · 30
 * links waiting".
 * @param run - The run's counters and page limit
 * @returns The progress line
 */
export function describeCrawlRunProgress(run: CrawlRunProgressFields): string {
  const waitingText = formatCount(run.waitingUrlCount, "link", "links");
  return `Visited ${String(run.visitedPageCount)} of up to ${String(run.pageLimit)} pages · ${waitingText} waiting`;
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
 * Words who a crawl viewed the site as:
 * - no credential: "Crawled logged out (no credential)";
 * - logged in: `Logged in as "Admin"` - every page of the run was viewed
 *   logged in, because the crawler records nothing before it logs in;
 * - still running and not logged in yet: `Logging in as "Admin"…`;
 * - ended without logging in (the login failed, or the crawl was cut off
 *   while logging in): `Not logged in - the login as "Admin" did not succeed`.
 * @param run - The run's status, login state, and credential
 * @returns The login line
 */
export function describeCrawlRunLogin(run: CrawlRunLoginFields): string {
  const { credential } = run;
  if (credential === null) {
    return "Crawled logged out (no credential)";
  }
  if (run.isLoggedIn) {
    return `Logged in as "${credential.name}"`;
  }
  const crawlIsRunning = run.status === "running";
  if (crawlIsRunning) {
    return `Logging in as "${credential.name}"…`;
  }
  return `Not logged in - the login as "${credential.name}" did not succeed`;
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
 * Words which buttons a crawl clicked, by its button mode:
 * - `linksOnly`: "links only" (it clicked no buttons);
 * - `allButRisky`: "clicked buttons except risky ones";
 * - `openOnly`: "clicked only “Open” buttons".
 *
 * A mode this client does not know yet is shown as it is.
 * @param buttonMode - The run's button mode
 * @returns The mode in words
 */
export function describeCrawlButtonMode(buttonMode: string): string {
  switch (buttonMode) {
    case "linksOnly":
      return "links only";
    case "allButRisky":
      return "clicked buttons except risky ones";
    case "openOnly":
      return "clicked only “Open” buttons";
    default:
      return buttonMode;
  }
}

/**
 * Builds the ending a crawl's lines add for its button mode: nothing for a
 * crawl that only followed links (the default, which needs no mention), else
 * " · " and the mode in words, e.g. " · clicked buttons except risky ones".
 * @param buttonMode - The run's button mode
 * @returns The suffix to append, or an empty string
 */
export function formatCrawlButtonModeSuffix(buttonMode: string): string {
  const crawlOnlyFollowedLinks = buttonMode === "linksOnly";
  return crawlOnlyFollowedLinks ? "" : ` · ${describeCrawlButtonMode(buttonMode)}`;
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

/** The parts of a crawled page its site map label is built from. */
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
 * Labels a crawled page in the site map and its details, showing a redirect:
 * - not redirected: its path, e.g. "/schools";
 * - redirected, recorded where it landed: "/calendar (from /)";
 * - redirected onto a page already in the crawl (so recorded under the URL it
 *   was requested at): "/home → /calendar".
 * @param page - The page's recorded, requested, and final URLs, and whether it redirected
 * @returns The label
 */
export function describeCrawledPagePath(page: CrawledPageLabelFields): string {
  if (!page.wasRedirected) {
    return formatCrawledPagePath(page.url);
  }
  const pageIsRecordedWhereItLanded = identifyCrawledUrl(page.finalUrl) === page.url;
  if (pageIsRecordedWhereItLanded) {
    const landedPath = formatRedirectEnd(page.url, page.requestedUrl);
    const requestedPath = formatRedirectEnd(identifyCrawledUrl(page.requestedUrl), page.url);
    return `${landedPath} (from ${requestedPath})`;
  }
  const requestedPath = formatCrawledPagePath(page.url);
  const landedPath = formatRedirectEnd(identifyCrawledUrl(page.finalUrl), page.url);
  return `${requestedPath} → ${landedPath}`;
}
