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
