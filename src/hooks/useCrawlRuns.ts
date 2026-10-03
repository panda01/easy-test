import { type JsonResourceState, useJsonResource } from "./useJsonResource";
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
 * Fetches a website's crawl runs (`GET /api/websites/:websiteId/crawl-runs`),
 * newest first.
 *
 * A plain fetch, with no "add the POSTed run" helper like the screenshot runs
 * have: starting a crawl navigates to the new run's own page, and coming back
 * remounts the website page, which fetches the list again.
 * @param websiteId - The website's cuid
 * @returns The loading / error / data state of the crawl run list
 */
export function useCrawlRuns(websiteId: string): JsonResourceState<CrawlRunRecord[]> {
  const crawlRunsResource = useJsonResource(crawlRunsApiUrl(websiteId));
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return crawlRunsResource as JsonResourceState<CrawlRunRecord[]>;
}
