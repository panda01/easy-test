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
  /** The created objects a deleting run deleted on the site. */
  deletedObjects: RunObjectSummary[];
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
