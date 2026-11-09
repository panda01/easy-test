import { type ActionScriptRunRecord } from "./useActionScriptRuns";
import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { actionScriptRunApiUrl } from "../utils/routePaths";

/** When a step screenshot was taken: after the login, after the start URL opened, or after a plan step. */
export type ActionScriptRunScreenshotMoment = "loggedIn" | "startPage" | "step";

/**
 * One step screenshot a run took (or tried to take), as the run route
 * returns it. Exactly one of `fileName` and `errorMessage` is set. Dates
 * arrive as ISO strings because they travel as JSON.
 */
export interface ActionScriptRunScreenshotRecord {
  id: string;
  websiteId: string;
  actionId: string;
  actionScriptRunId: string;
  /** The 1-based order the run took its screenshots in. */
  position: number;
  /** When it was taken. */
  moment: ActionScriptRunScreenshotMoment;
  /** The 1-based plan step it follows, or null unless `moment` is `step`. */
  stepNumber: number | null;
  /** Non-null when the PNG was written; fetch it via `actionScriptRunScreenshotApiUrl`. */
  fileName: string | null;
  /** Why it could not be taken (first line, secrets scrubbed), or null when it was. */
  errorMessage: string | null;
  /** The address the browser was on, or null. */
  pageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** One run as the run page reads it: the run-list record plus its step screenshots, in the order they were taken. */
export interface ActionScriptRunDetailRecord extends ActionScriptRunRecord {
  /** The step screenshots, by `position`; empty for runs recorded before they existed. */
  screenshots: ActionScriptRunScreenshotRecord[];
}

/**
 * Fetches one run for the run page
 * (`GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId`).
 * Runs never change once their cleanup is recorded, so it is fetched once
 * per run.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The version that was run
 * @param actionScriptRunId - The run's cuid
 * @returns The loading / error / data state of that run
 */
export function useActionScriptRun(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): JsonResourceState<ActionScriptRunDetailRecord> {
  const runResource = useJsonResource(actionScriptRunApiUrl(websiteId, actionId, actionScriptId, actionScriptRunId));
  return runResource as JsonResourceState<ActionScriptRunDetailRecord>;
}
