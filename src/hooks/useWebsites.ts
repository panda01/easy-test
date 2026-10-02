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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The body the client sends to create or replace a website. */
export interface WebsiteRequestBody {
  url: string;
  name: string;
  description: string;
  /** Whole milliseconds, 0-30000, and not lower than `screenshotMinimumWaitMs`. */
  networkIdleTimeoutMs: number;
  /** Whole milliseconds, 0-30000. */
  screenshotMinimumWaitMs: number;
}

/**
 * Fetches every active website (`GET /api/websites`), newest first.
 * @returns The loading / error / data state of the website list
 */
export function useWebsites(): JsonResourceState<WebsiteRecord[]> {
  const websitesResource = useJsonResource(WEBSITES_API_URL);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return websitesResource as JsonResourceState<WebsiteRecord[]>;
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
