import { useRecordListWithAdditions } from "./useRecordListWithAdditions";
import { actionScriptRunsApiUrl } from "../utils/routePaths";

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
  /** True only for exit code 0, no timeout, and no failure screenshot. */
  succeeded: boolean;
  /** The process exit code, or null when it was killed by a signal. */
  exitCode: number | null;
  /** The signal that ended the process, or null when it exited on its own. */
  exitSignal: string | null;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** The script's combined output (its step log). */
  output: string;
  /** True when the start of the output was dropped to fit the cap. */
  outputWasTruncated: boolean;
  /** Non-null when the script wrote a failure screenshot; fetch it via `actionScriptRunFailureScreenshotApiUrl`. */
  failureScreenshotFileName: string | null;
  /** How long the script ran, in milliseconds. */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script whose runs to show, or null when there is none
 * @returns The runs, the list request's state, and `addFinishedRun`
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
  };
}
