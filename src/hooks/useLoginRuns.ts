import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { loginRunsApiUrl } from "../utils/routePaths";

/**
 * One "Run login" of a Login action, as the API returns it. Dates arrive as
 * ISO strings. Declared here rather than imported from the server: the
 * client never imports server code.
 */
export interface LoginRunRecord {
  id: string;
  websiteId: string;
  /** The Login action that ran. */
  actionId: string;
  /** The credential it logged in as (a snapshot of its name). */
  credentialName: string;
  /** The login page it opened (a snapshot). */
  loginUrl: string;
  /** True when the login form was submitted and went away. */
  succeeded: boolean;
  /** Why it failed (the username and password scrubbed out), or null when it passed. */
  errorMessage: string | null;
  /** Its screenshot (served by `loginRunScreenshotApiUrl`), or null when none could be taken. */
  screenshotFileName: string | null;
  /** Where the browser was at the end (scrubbed), or null. */
  finalPageUrl: string | null;
  /** The run's log. */
  output: string;
  /** Milliseconds from browser launch to browser close. */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Fetches a Login action's login runs, newest first
 * (`GET /api/websites/:websiteId/actions/:actionId/login-runs`).
 *
 * `isNeeded` lets the action page call this unconditionally: for any other
 * kind of action (or before the action has loaded) nothing is fetched.
 * @param websiteId - The owning website's cuid
 * @param actionId - The Login action's cuid
 * @param isNeeded - False to skip the request; true to fetch
 * @returns The loading / error / data state of the run list, with `reload`
 */
export function useLoginRuns(
  websiteId: string,
  actionId: string,
  isNeeded: boolean,
): JsonResourceState<LoginRunRecord[]> {
  const loginRunsResource = useJsonResource(isNeeded ? loginRunsApiUrl(websiteId, actionId) : null);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return loginRunsResource as JsonResourceState<LoginRunRecord[]>;
}
