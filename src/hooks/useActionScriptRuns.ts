import { useRecordListWithAdditions } from "./useRecordListWithAdditions";
import { actionScriptRunsApiUrl } from "../utils/routePaths";

/** An object a run created or deleted, as the run list names it. */
export interface RunObjectSummary {
  /** The created object's record id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its own page, or null. */
  url: string | null;
  /** Its type's name, or null. */
  objectTypeName: string | null;
}

/**
 * One recorded run of a script, as the API returns it. Dates arrive as ISO
 * strings because they travel as JSON. Declared here rather than imported from
 * the server: the client never imports server code.
 */
export interface ActionScriptRunRecord {
  id: string;
  websiteId: string;
  actionId: string;
  actionScriptId: string;
  /** True only when the login (if any) and every step finished in time. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** Why the run stopped, or null when it passed. */
  errorMessage: string | null;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** The credential the run logged in as, or null for a logged-out run. */
  credentialName: string | null;
  /** The run's step log. */
  output: string;
  /** True when the start of the output was dropped to fit the cap. */
  outputWasTruncated: boolean;
  /** Non-null when the run saved a failure screenshot; fetch it via `actionScriptRunFailureScreenshotApiUrl`. */
  failureScreenshotFileName: string | null;
  /** The URL the browser was on when the run failed (credentials scrubbed), or null when it passed or none was captured. */
  failingPageUrl: string | null;
  /** The failing page's aria snapshot (credentials scrubbed, capped), or null when it passed or none was captured. */
  failingPageAriaSnapshot: string | null;
  /** How long the run took, in milliseconds. */
  durationMs: number;
  /** The values the run used (secrets left out; "" for a blank one) - read with `readUsedParameterValues`; empty for older runs. */
  parameterValues: unknown;
  /** The address the browser was on when the run ended, or null. */
  finalPageUrl: string | null;
  /** A Create run's confirm step, or null. */
  confirmStepNumber: number | null;
  /** Whether the confirm step ran with no error showing; null when it was never reached (or the run has none). */
  confirmStepSucceeded: boolean | null;
  /** The object a Create run made (still in the record), or null. */
  createdObject: RunObjectSummary | null;
  /** The created objects a Delete run deleted on the site. */
  deletedObjects: RunObjectSummary[];
  /** A Create run's cleanup outcome (see `CleanupOutcomeRecord`), or null for other kinds and older runs. */
  cleanupOutcome: CleanupOutcomeRecord | null;
  /** The Delete action's run that cleaned up after this Create run, or null. */
  cleanupActionScriptRunId: string | null;
  /** The Delete run's error, or why the cleanup could not start; null when it passed, was turned off, or does not apply. */
  cleanupErrorMessage: string | null;
  /** The cleanup run named by `cleanupActionScriptRunId`, when it could be read. */
  cleanupRun: RunCleanupSummary | null;
  /** For a Delete run that was a cleanup: the Create run it cleaned up after, or null. */
  cleanedUpRun: CleanedUpRunSummary | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * What happened to a Create run's cleanup: `passed` / `failed` (the Delete
 * run's outcome), `off` (unticked for this run), `notReached` (no object was
 * made), or `missing` (no Delete action, or none of its versions).
 */
export type CleanupOutcomeRecord = "missing" | "off" | "notReached" | "passed" | "failed";

/** The Delete action's run that cleaned up after a Create run, as the run list names it. */
export interface RunCleanupSummary {
  /** The Delete run's cuid. */
  id: string;
  /** The Delete action's cuid. */
  actionId: string;
  /** The Delete version's cuid. */
  actionScriptId: string;
  /** Whether the Delete run passed. */
  succeeded: boolean;
  /** Why it stopped, or null. */
  errorMessage: string | null;
  /** The step it stopped at, or null. */
  failedStepNumber: number | null;
  /** True when it hit the time limit. */
  timedOut: boolean;
  /** When it ran (ISO). */
  createdAt: string;
  /** The Delete action, by title. */
  action: { title: string };
}

/** The Create run a Delete run cleaned up after, as the run list names it. */
export interface CleanedUpRunSummary {
  /** The Create run's cuid. */
  id: string;
  /** The Create action's cuid. */
  actionId: string;
  /** The Create version's cuid. */
  actionScriptId: string;
  /** The Create action, by title. */
  action: { title: string };
}

/** What `useActionScriptRuns` hands back. */
export interface ActionScriptRunsState {
  /** Runs of the given script, newest first; empty while there is no script. */
  runs: ActionScriptRunRecord[];
  /** True until the run list for the current script has arrived. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** Adds a run a "Run script" POST just recorded to the front of `runs`. */
  addFinishedRun: (finishedRun: ActionScriptRunRecord) => void;
  /** Fetches the runs again (an auto-refine job recorded one), keeping the current list shown meanwhile. */
  reloadRuns: () => void;
}

/**
 * Fetches a script's recorded runs
 * (`GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs`),
 * newest first, and lets the page add the run a "Run script" POST just
 * recorded without refetching.
 *
 * `actionScriptId` may be null - the action has no script yet - in which case
 * nothing is fetched and `runs` is empty, so the page can call this hook
 * unconditionally.
 *
 * `reloadRuns` fetches the list again without blanking it, for runs an
 * auto-refine job recorded on the server (there is no POST response to add).
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script whose runs to show, or null when there is none
 * @returns The runs, the list request's state, `addFinishedRun`, and `reloadRuns`
 */
export function useActionScriptRuns(
  websiteId: string,
  actionId: string,
  actionScriptId: string | null,
): ActionScriptRunsState {
  const thereIsNoScript = actionScriptId === null;
  const runsApiUrl = thereIsNoScript
    ? null
    : actionScriptRunsApiUrl(websiteId, actionId, actionScriptId);

  /**
   * Keeps an added run only while it belongs to the script shown.
   * @param run - A run added on this visit
   * @returns True when it belongs to the current script
   */
  const runBelongsToThisScript = (run: ActionScriptRunRecord): boolean =>
    run.actionScriptId === actionScriptId;

  const runList = useRecordListWithAdditions<ActionScriptRunRecord>(
    runsApiUrl,
    runBelongsToThisScript,
  );

  return {
    runs: runList.records,
    isLoading: runList.isLoading,
    errorMessage: runList.errorMessage,
    addFinishedRun: runList.addRecord,
    reloadRuns: runList.reload,
  };
}
