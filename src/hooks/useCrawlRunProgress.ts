import { type CrawlRunRecord } from "./useCrawlRuns";
import { type PolledJsonResourceState, usePolledJsonResource } from "./usePolledJsonResource";
import { crawlRunApiUrl } from "../utils/routePaths";

/** How often a running crawl is re-fetched, in milliseconds. */
export const CRAWL_RUN_POLL_INTERVAL_MS = 2000;

/**
 * One page a crawl visited, as the run's page list returns it: everything
 * except the aria snapshot and the link list (see `useCrawledPage`). Dates
 * arrive as ISO strings.
 */
export interface CrawledPageSummaryRecord {
  id: string;
  crawlRunId: string;
  websiteId: string;
  /** The page whose link led here; null for the start page. Makes the page tree. */
  parentPageId: string | null;
  /**
   * The page's identity: origin + path, without query string or hash - where
   * the browser landed, or the requested page when the landing page was
   * already recorded in this crawl.
   */
  url: string;
  /** What the browser loaded (the first link that reached the page). */
  requestedUrl: string;
  /** Where the browser ended up after redirects. */
  finalUrl: string;
  /** True when the browser landed on a different page (origin + path) than it requested. */
  wasRedirected: boolean;
  /** The text of the button whose click first led to this page, or null when a link (or the start URL) did. */
  foundByButtonText: string | null;
  /** Position in visiting order, counting from 0. */
  visitOrder: number;
  /** Links followed from the start page to reach it. */
  depth: number;
  /** True only when the page answered below HTTP 400 and its snapshot and links were read. */
  succeeded: boolean;
  /** The page's HTTP status, or null when there was no response. */
  httpStatus: number | null;
  /** Why the page failed, or null. */
  errorMessage: string | null;
  /** The page's `<title>`, or null. */
  title: string | null;
  /** How long visiting the page took, in milliseconds. */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** How a URL pattern relates to its web object: one instance's page, a sub-page of one, the list, or the create page. */
export type PagePatternRoleRecord = "instance" | "view" | "collection" | "create";

/** How a pattern's variable was recognised: by an id's shape, or as a slug from sibling pages built alike. */
export type PatternDetectionMethodRecord = "idShape" | "siblingStructure";

/** One URL pattern of a web object in a crawl run's grouping. */
export interface CrawlPageGroupingPatternRecord {
  /** The pattern as a path: `/websites/{website}/actions/{action}/edit`. */
  key: string;
  role: PagePatternRoleRecord;
  /** For a `view`, the part after the object's variable (`edit`); otherwise null. */
  viewName: string | null;
  detectedBy: PatternDetectionMethodRecord;
  /** The crawled pages it matched, in visiting order. */
  pageIds: string[];
}

/** One web object - a kind of thing the site has many of - in a crawl run's grouping. */
export interface CrawlPageGroupingWebObjectRecord {
  /** The saved web object's cuid, or null when this run's objects are not the website's saved ones (still running, or replaced by a newer crawl). */
  webObjectId: string | null;
  /** The pattern of one instance's page; the object's key. */
  instancePatternKey: string;
  /** The name to show: the user's rename, or the detected name. */
  displayName: string;
  /** What detection named it (`Action`). */
  detectedName: string;
  /** The parent object's key, or null. */
  parentInstancePatternKey: string | null;
  /** The distinct instances the crawl saw. */
  instanceValues: string[];
  /** Links to its pages the crawl skipped because it already had 3 of the same pattern. */
  skippedLinkCount: number;
  /** Its patterns: instance, views, list page, create page. */
  patterns: CrawlPageGroupingPatternRecord[];
}

/** A crawl run's pages grouped into web objects by their URL patterns. */
export interface CrawlPageGroupingRecord {
  /** The web objects, each parent before its children. */
  webObjects: CrawlPageGroupingWebObjectRecord[];
  /** The pages that belong to no web object, in visiting order. */
  standalonePageIds: string[];
}

/** A crawl run together with its pages in visiting order, and those pages grouped into web objects. */
export interface CrawlRunWithPagesRecord extends CrawlRunRecord {
  pages: CrawledPageSummaryRecord[];
  pageGrouping: CrawlPageGroupingRecord;
}

/**
 * Tells the polling hook whether to fetch the run again: only while it is
 * still running.
 * @param data - The latest response body
 * @returns True while the run's status is "running"
 */
function crawlRunIsStillRunning(data: unknown): boolean {
  // The API is the contract for this shape, as in the typed resource hooks.
  return (data as CrawlRunWithPagesRecord).status === "running";
}

/**
 * Fetches one crawl run with its page summaries
 * (`GET /api/websites/:websiteId/crawl-runs/:crawlRunId`) and, while the
 * crawl is running, fetches it again every `CRAWL_RUN_POLL_INTERVAL_MS`, so
 * the page tree grows live. Polling stops once the run has ended.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns The run's loading / error / data state, plus `pollErrorMessage`
 */
export function useCrawlRunProgress(
  websiteId: string,
  crawlRunId: string,
): PolledJsonResourceState<CrawlRunWithPagesRecord> {
  const crawlRunResource = usePolledJsonResource(
    crawlRunApiUrl(websiteId, crawlRunId),
    crawlRunIsStillRunning,
    CRAWL_RUN_POLL_INTERVAL_MS,
  );
  return crawlRunResource as PolledJsonResourceState<CrawlRunWithPagesRecord>;
}
