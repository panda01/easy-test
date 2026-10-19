import { CRAWL_RUN_POLL_INTERVAL_MS } from "./useCrawlRunProgress";
import { type PolledJsonResourceState, usePolledJsonResource } from "./usePolledJsonResource";
import { crawlRunsApiUrl } from "../utils/routePaths";

/** Every value a crawl run's `status` can hold. */
export type CrawlRunStatus =
  | "running"
  | "finished"
  | "stoppedAtPageLimit"
  | "stoppedAtTimeLimit"
  | "failed"
  | "interrupted";

/**
 * Which buttons a crawl clicks on each page, on top of following links:
 * none (`linksOnly`), every labelled button except risky ones
 * (`allButRisky`), or only "open" buttons (`openOnly`). Mirrors
 * `server/utils/crawlButtonModes.ts`; the client never imports server code.
 */
export type CrawlButtonModeRecord = "linksOnly" | "allButRisky" | "openOnly";

/** The credential a crawl run was started with, as the run names it. */
export interface CrawlRunCredentialRecord {
  id: string;
  name: string;
}

/**
 * One crawl of a website, as the API returns it (without its pages). Dates
 * arrive as ISO strings because they travel as JSON. Declared here rather
 * than imported from the server: the client never imports server code.
 */
export interface CrawlRunRecord {
  id: string;
  websiteId: string;
  /** The credential the crawl logs in as; null for a crawl as a logged-out visitor. */
  credentialId: string | null;
  /**
   * True once the crawl has logged in (it records no page before that), so
   * every page of a run with `isLoggedIn: true` was viewed logged in. Always
   * false without a credential, and when the login failed.
   */
  isLoggedIn: boolean;
  /** The id and name of the credential the crawl was started with (kept after it is deleted), or null. */
  credential: CrawlRunCredentialRecord | null;
  /** Which buttons the crawl clicked on each page. */
  buttonMode: CrawlButtonModeRecord;
  /** The website's URL at crawl time - where the crawl started. */
  startUrl: string;
  /** Where the crawl is: still running, or how it ended. */
  status: CrawlRunStatus;
  /** The most pages the crawl may visit. */
  pageLimit: number;
  /** Pages recorded so far. */
  visitedPageCount: number;
  /** Links queued but not yet visited. */
  waitingUrlCount: number;
  /** Links skipped because the crawl already had 3 pages of their URL pattern; 0 until the crawl ends. */
  skippedSimilarUrlCount: number;
  /** The same skipped links, per pattern key (`/websites/{website}`); empty until the crawl ends. */
  skippedSimilarUrlCountsByPattern: Record<string, number>;
  /** Why the crawl failed or was interrupted, or null. */
  errorMessage: string | null;
  /** Set when the login failed and a screenshot of it was saved (served by `crawlRunLoginFailureScreenshotApiUrl`); null otherwise. */
  loginFailureScreenshotFileName: string | null;
  /** How long the crawl took in milliseconds; null while running (and for runs found interrupted at boot). */
  durationMs: number | null;
  /** When the crawl ended; null while running. */
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Tells the polling hook whether to fetch the list again: only while one of
 * the website's crawls is still running.
 * @param data - The latest response body
 * @returns True while a listed run's status is "running"
 */
function aListedCrawlIsRunning(data: unknown): boolean {
  // The API is the contract for this shape, as in the typed resource hooks.
  return (data as CrawlRunRecord[]).some((run) => run.status === "running");
}

/**
 * Fetches a website's crawl runs (`GET /api/websites/:websiteId/crawl-runs`),
 * newest first, and - while one of them is running - fetches the list again
 * every `CRAWL_RUN_POLL_INTERVAL_MS`, so the website page's "Crawl running"
 * card counts pages live and the run moves into the history once it ends.
 *
 * There is no "add the POSTed run" helper like the screenshot runs have:
 * starting a crawl navigates to the new run's own page, and coming back
 * remounts the website page, which fetches the list again.
 * @param websiteId - The website's cuid
 * @returns The loading / error / data state of the crawl run list, plus `pollErrorMessage`
 */
export function useCrawlRuns(websiteId: string): PolledJsonResourceState<CrawlRunRecord[]> {
  const crawlRunsResource = usePolledJsonResource(
    crawlRunsApiUrl(websiteId),
    aListedCrawlIsRunning,
    CRAWL_RUN_POLL_INTERVAL_MS,
  );
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return crawlRunsResource as PolledJsonResourceState<CrawlRunRecord[]>;
}
