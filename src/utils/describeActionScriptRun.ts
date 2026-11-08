/** The parts of a plan run its one-line outcome is built from. */
export interface ActionScriptRunOutcomeFields {
  /** True only when the login (if any) and every step finished in time - and, for a Create run, its cleanup too. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** Why the run stopped, or null; a Create run whose own steps passed but whose cleanup did not has one starting with "Cleanup". */
  errorMessage?: string | null;
  /** A Create run's cleanup outcome, or null / omitted when it does not apply. */
  cleanupOutcome?: string | null;
}

/** The start of a Create run's error when its own steps passed and only its cleanup did not (the server's `CLEANUP_ERROR_PREFIX`). */
const CLEANUP_ERROR_PREFIX = "Cleanup ";

/**
 * Says whether a run failed ONLY in its cleanup: its own steps passed, and
 * the Delete action's run failed or could not start. Such a run cannot be
 * refined; the delete action's run is what needs refining.
 * @param run - The run's outcome fields
 * @returns True for a cleanup-only failure
 */
export function runFailedOnlyInItsCleanup(run: ActionScriptRunOutcomeFields): boolean {
  const cleanupFailed = run.cleanupOutcome === "failed" || run.cleanupOutcome === "missing";
  const errorIsTheCleanups = run.errorMessage?.startsWith(CLEANUP_ERROR_PREFIX) ?? false;
  return !run.succeeded && cleanupFailed && errorIsTheCleanups;
}

/**
 * Summarizes how a plan run went, for a status line or a list row:
 * "Passed", "Timed out · stopped after 5 min", "Failed at step 3", "Failed
 * before the first step" (the login failed or the start page did not open -
 * the run's error message says which), "Failed · cleanup failed" (the run's
 * own steps passed but its delete action's run did not), or "Failed · no
 * cleanup" (it has no delete action, or that has no version).
 * @param run - The run's outcome fields
 * @returns The one-line outcome
 */
export function describeActionScriptRunOutcome(run: ActionScriptRunOutcomeFields): string {
  if (run.timedOut) {
    return "Timed out · stopped after 5 min";
  }
  if (run.succeeded) {
    return "Passed";
  }
  if (runFailedOnlyInItsCleanup(run)) {
    return run.cleanupOutcome === "missing" ? "Failed · no cleanup" : "Failed · cleanup failed";
  }
  const runStoppedAtAStep = run.failedStepNumber !== null;
  if (runStoppedAtAStep) {
    return `Failed at step ${String(run.failedStepNumber)}`;
  }
  return "Failed before the first step";
}
