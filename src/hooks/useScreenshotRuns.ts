import { useCallback, useState } from "react";
import { useJsonResource } from "./useJsonResource";
import { screenshotRunsApiUrl } from "../utils/routePaths";

/**
 * One recorded visit to a website, as the API returns it. Dates arrive as ISO
 * strings because they travel as JSON. Declared here rather than imported from
 * the server: the client never imports server code.
 */
export interface ScreenshotRunRecord {
  id: string;
  websiteId: string;
  /** The URL the browser visited (the website's URL at run time). */
  requestedUrl: string;
  /** True only when the page loaded with an HTTP status below 400. */
  succeeded: boolean;
  /** The page's HTTP status, or null when there was no response. */
  httpStatus: number | null;
  /** Why the run failed, or null when it succeeded. */
  errorMessage: string | null;
  /** Non-null when a screenshot was captured; fetch it via `screenshotRunImageApiUrl`. */
  screenshotFileName: string | null;
  /** How long the navigation took, in milliseconds. */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** What `useScreenshotRuns` hands back. */
export interface ScreenshotRunsState {
  /** Runs taken on this visit to the page, then the fetched runs; newest first. */
  runs: ScreenshotRunRecord[];
  /** True until the run list for the current website has arrived. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** Adds a run the page just recorded (the POST's response) to the front of `runs`. */
  addTakenRun: (takenRun: ScreenshotRunRecord) => void;
}

/**
 * Fetches a website's recorded screenshot runs
 * (`GET /api/websites/:websiteId/screenshot-runs`), newest first, and lets the
 * page add the run a "Take screenshot" POST just recorded without refetching.
 *
 * The POST already returns the saved row, so instead of re-requesting the
 * whole list, runs taken on this visit are kept locally and shown ahead of the
 * fetched ones. Two guards keep that merge honest:
 * - taken runs are filtered by `websiteId`, because React Router reuses the
 *   page component when navigating from one website straight to another, and
 *   a slow POST could resolve after the navigation;
 * - a fetched run whose id was also taken is dropped, so a run can never be
 *   listed twice.
 *
 * Unlike `useJsonResource`, `runs` is never null: it is empty while loading or
 * after a failed fetch, apart from any runs taken in the meantime.
 * @param websiteId - The owning website's cuid
 * @returns The merged runs, the list request's state, and `addTakenRun`
 */
export function useScreenshotRuns(websiteId: string): ScreenshotRunsState {
  const runsResource = useJsonResource(screenshotRunsApiUrl(websiteId));
  const [takenRuns, setTakenRuns] = useState<ScreenshotRunRecord[]>([]);

  const addTakenRun = useCallback((takenRun: ScreenshotRunRecord): void => {
    setTakenRuns((previousTakenRuns) => [takenRun, ...previousTakenRuns]);
  }, []);

  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  const fetchedRuns = (runsResource.data ?? []) as ScreenshotRunRecord[];
  const takenRunsForThisWebsite = takenRuns.filter((takenRun) => takenRun.websiteId === websiteId);
  const takenRunIds = new Set(takenRunsForThisWebsite.map((takenRun) => takenRun.id));
  const fetchedRunsNotAlsoTaken = fetchedRuns.filter((fetchedRun) => !takenRunIds.has(fetchedRun.id));

  return {
    runs: [...takenRunsForThisWebsite, ...fetchedRunsNotAlsoTaken],
    isLoading: runsResource.isLoading,
    errorMessage: runsResource.errorMessage,
    addTakenRun,
  };
}
