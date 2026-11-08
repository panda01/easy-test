import { useCallback, useEffect, useState } from "react";
import { useJsonResource } from "./useJsonResource";
import { usePolledJsonResource } from "./usePolledJsonResource";
import { actionAutoRefineJobsApiUrl, autoRefineJobApiUrl } from "../utils/routePaths";

/** How often a running auto-refine job is re-fetched, in milliseconds. */
export const AUTO_REFINE_POLL_INTERVAL_MS = 2000;

/**
 * Every value an auto-refine job's `status` can hold: `running` until it
 * ends, then how it ended - a run `passed`; it `gaveUp` after the most
 * refinements; a refinement came back `unchanged` (the same step plan); it
 * was `stopped` at the user's request; a step `failed`; or a server restart
 * `interrupted` it.
 */
export type AutoRefineJobStatus =
  | "running"
  | "passed"
  | "gaveUp"
  | "unchanged"
  | "stopped"
  | "failed"
  | "interrupted";

/**
 * Which step a running job is on: running the current version, refining it
 * into the next, or - after a Create version passed but its cleanup failed -
 * refining the delete action's version (`refiningCleanup`) or running that
 * on its own (`runningCleanup`).
 */
export type AutoRefineJobPhase = "running" | "refining" | "refiningCleanup" | "runningCleanup";

/**
 * One auto-refine job of an action, as the API returns it: a background job
 * that runs a version and, while it fails, refines it with Claude and runs the
 * refined version, up to `maxRefinements` times. Dates arrive as ISO strings
 * because they travel as JSON. Declared here rather than imported from the
 * server: the client never imports server code.
 */
export interface AutoRefineJobRecord {
  id: string;
  websiteId: string;
  actionId: string;
  /** The version the job started from (the one shown when the user clicked). */
  startActionScriptId: string;
  /** The version being run or refined right now; the last one once the job has ended. */
  currentActionScriptId: string;
  status: AutoRefineJobStatus;
  /** The step in flight while `status` is "running"; null once the job has ended. */
  phase: AutoRefineJobPhase | null;
  /** How many refinements the job has made so far. */
  refinementsDone: number;
  /** The most refinements the job will make (5). */
  maxRefinements: number;
  /** The run-form values the job sends with every run, by parameter key. */
  parameterValues: Record<string, string>;
  /** The versions the job created, oldest first. */
  createdActionScriptIds: string[];
  /** The runs the job recorded, oldest first. */
  actionScriptRunIds: string[];
  /** The delete action's versions the job refined after a cleanup failed, oldest first. */
  cleanupActionScriptIds: string[];
  /** The delete action's runs the job made on its own after refining it, oldest first. */
  cleanupActionScriptRunIds: string[];
  /** When the user asked the job to stop, or null. */
  stopRequestedAt: string | null;
  /** Why the job failed - or, for an `unchanged` ending on the Delete side, which refinement changed nothing; null otherwise. */
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the job ended; null while running. */
  finishedAt: string | null;
  deletedAt: string | null;
}

/** What `useAutoRefineJob` hands back. */
export interface AutoRefineJobState {
  /**
   * The job being watched on this visit - running or ended - or null when
   * none is: the latest polled record, or the record handed to `watchJob`
   * until the first poll answers.
   */
  job: AutoRefineJobRecord | null;
  /** Why the latest poll of the job failed (the last good record stays shown), or null. */
  pollErrorMessage: string | null;
  /** Starts watching a job - the record a start POST (201) or the stop POST (200) answered with - and shows it at once. */
  watchJob: (job: AutoRefineJobRecord) => void;
}

/**
 * Tells the polling hook whether to fetch the job again: only while it is
 * still running.
 * @param data - The latest response body
 * @returns True while the job's status is "running"
 */
function autoRefineJobIsStillRunning(data: unknown): boolean {
  // The API is the contract for this shape, as in the typed resource hooks.
  return (data as AutoRefineJobRecord).status === "running";
}

/**
 * Picks the record to show out of the latest poll and the record handed to
 * `watchJob`: the handed-in one when there is no poll yet, or when it is
 * newer (the stop route answers with the job after its `stopRequestedAt` was
 * set, which the last poll of the same job cannot know yet).
 * @param polledJob - What the latest poll answered, or null before the first one
 * @param watchedJob - The record handed to `watchJob`, or null
 * @returns The record to show, or null when there is neither
 */
function pickNewerJobRecord(
  polledJob: AutoRefineJobRecord | null,
  watchedJob: AutoRefineJobRecord | null,
): AutoRefineJobRecord | null {
  if (polledJob === null) return watchedJob;
  if (watchedJob === null) return polledJob;
  const watchedRecordIsNewer = Date.parse(watchedJob.updatedAt) > Date.parse(polledJob.updatedAt);
  return watchedRecordIsNewer ? watchedJob : polledJob;
}

/**
 * Follows an action's auto-refine job from the action's page:
 * - on mount it reads the action's job list
 *   (`GET /api/websites/:websiteId/actions/:actionId/auto-refine-jobs`) once
 *   and, when a job is still running, watches it - so reloading the page
 *   mid-job picks the job up again;
 * - the watched job is fetched
 *   (`GET /api/websites/:websiteId/actions/:actionId/auto-refine-jobs/:jobId`)
 *   every `AUTO_REFINE_POLL_INTERVAL_MS` while it runs, and once more when it
 *   ends;
 * - `watchJob(job)` switches to the job a start or stop request answered
 *   with, showing that record until the first poll replaces it - or, for the
 *   job already watched, while it is newer (by `updatedAt`) than the last poll.
 *
 * A job watched for another action (React Router reuses the page when the
 * route params change) is ignored, so the hook never polls across actions.
 * A failed re-poll keeps the last record and is reported as
 * `pollErrorMessage`; so is a failed first fetch of a watched job, in which
 * case the handed-in record stays shown.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns The watched job, the poll's trouble, and `watchJob`
 */
export function useAutoRefineJob(websiteId: string, actionId: string): AutoRefineJobState {
  const jobListResource = useJsonResource(actionAutoRefineJobsApiUrl(websiteId, actionId));
  // The API is the contract for this shape; see useJsonResource.
  const listedJobs = jobListResource.data as AutoRefineJobRecord[] | null;
  const [watchedJob, setWatchedJob] = useState<AutoRefineJobRecord | null>(null);

  const watchedJobBelongsToThisAction =
    watchedJob !== null && watchedJob.websiteId === websiteId && watchedJob.actionId === actionId;
  const watchedJobForThisAction = watchedJobBelongsToThisAction ? watchedJob : null;

  useEffect(() => {
    const aJobIsAlreadyWatched = watchedJobForThisAction !== null;
    if (aJobIsAlreadyWatched || listedJobs === null) return;
    const runningJob = listedJobs.find((listedJob) => listedJob.status === "running") ?? null;
    const aListedJobIsRunning = runningJob !== null;
    if (aListedJobIsRunning) setWatchedJob(runningJob);
  }, [listedJobs, watchedJobForThisAction]);

  const watchedJobUrl =
    watchedJobForThisAction === null
      ? null
      : autoRefineJobApiUrl(websiteId, actionId, watchedJobForThisAction.id);
  const polledJobResource = usePolledJsonResource(
    watchedJobUrl,
    autoRefineJobIsStillRunning,
    AUTO_REFINE_POLL_INTERVAL_MS,
  );
  const polledJob = polledJobResource.data as AutoRefineJobRecord | null;

  const watchJob = useCallback((job: AutoRefineJobRecord): void => {
    setWatchedJob(job);
  }, []);

  return {
    job: pickNewerJobRecord(polledJob, watchedJobForThisAction),
    pollErrorMessage: polledJobResource.pollErrorMessage ?? polledJobResource.errorMessage,
    watchJob,
  };
}
