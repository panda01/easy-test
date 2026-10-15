import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { WEBSITES_API_URL, websiteApiUrl } from "../utils/routePaths";

/**
 * A website as the API returns it. Dates arrive as ISO strings because they
 * travel as JSON. Declared here rather than imported from the server: the
 * client never imports server code.
 */
export interface WebsiteRecord {
  id: string;
  url: string;
  name: string;
  description: string | null;
  /** How long a screenshot waits for network requests to finish, in ms; 0 = don't wait. */
  networkIdleTimeoutMs: number;
  /** A screenshot is never taken sooner than this after the page loads, in ms. */
  screenshotMinimumWaitMs: number;
  /** The website's login page, or null when it does not require login. Credentials inherit it. */
  loginUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The parts of a website's newest crawl run the dashboard shows. */
export interface WebsiteLatestCrawlRunRecord {
  id: string;
  /** Where the crawl is: still running, or how it ended (see `CrawlRunStatus`). */
  status: string;
  /** Pages recorded so far. */
  visitedPageCount: number;
  /** The most pages the crawl may visit. */
  pageLimit: number;
  createdAt: string;
  /** When the crawl ended; null while running. */
  finishedAt: string | null;
}

/**
 * What the website list says about each website for the dashboard: how many
 * of its actions pass, fail, or have not been run (by each action's newest
 * version's latest run), when any of its scripts last ran, and its newest
 * crawl.
 */
export interface WebsiteSummaryRecord {
  actionCount: number;
  passedActionCount: number;
  failedActionCount: number;
  notRunActionCount: number;
  /** When any of the website's scripts last ran, or null when none has. */
  latestRunAt: string | null;
  /** The newest crawl, or null when the website has never been crawled. */
  latestCrawlRun: WebsiteLatestCrawlRunRecord | null;
}

/** A website as the website LIST returns it: the website plus its dashboard summary. */
export type WebsiteWithSummaryRecord = WebsiteRecord & { summary: WebsiteSummaryRecord };

/** The body the client sends to create or replace a website. */
export interface WebsiteRequestBody {
  url: string;
  name: string;
  description: string;
  /** Whole milliseconds, 0-30000, and not lower than `screenshotMinimumWaitMs`. */
  networkIdleTimeoutMs: number;
  /** Whole milliseconds, 0-30000. */
  screenshotMinimumWaitMs: number;
  /** The website's login page; blank when it does not require login (the server stores null). */
  loginUrl: string;
}

/**
 * Fetches every active website with its dashboard summary
 * (`GET /api/websites`), newest first.
 * @returns The loading / error / data state of the website list
 */
export function useWebsites(): JsonResourceState<WebsiteWithSummaryRecord[]> {
  const websitesResource = useJsonResource(WEBSITES_API_URL);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return websitesResource as JsonResourceState<WebsiteWithSummaryRecord[]>;
}

/**
 * Fetches one active website (`GET /api/websites/:websiteId`). A deleted or
 * unknown id reports the server's "Website not found" as `errorMessage`.
 * @param websiteId - The website's cuid
 * @returns The loading / error / data state of that website
 */
export function useWebsite(websiteId: string): JsonResourceState<WebsiteRecord> {
  const websiteResource = useJsonResource(websiteApiUrl(websiteId));
  return websiteResource as JsonResourceState<WebsiteRecord>;
}
