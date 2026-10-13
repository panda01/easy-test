/** The parts of a plan run its one-line outcome is built from. */
export interface ActionScriptRunOutcomeFields {
  /** True only when the login (if any) and every step finished in time. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
}

/**
 * Summarizes how a plan run went, for a status line or a list row:
 * "Passed", "Timed out · stopped after 5 min", "Failed at step 3", or
 * "Failed before the first step" (the login failed or the start page did not
 * open - the run's error message says which).
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
  const runStoppedAtAStep = run.failedStepNumber !== null;
  if (runStoppedAtAStep) {
    return `Failed at step ${String(run.failedStepNumber)}`;
  }
  return "Failed before the first step";
}
