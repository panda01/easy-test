/** The parts of a script run its one-line outcome is built from. */
export interface ActionScriptRunOutcomeFields {
  /** True only for exit code 0, no timeout, and no failure screenshot. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** The process exit code, or null when it was killed by a signal. */
  exitCode: number | null;
  /** The signal that ended the process, or null when it exited on its own. */
  exitSignal: string | null;
}

/**
 * Summarizes how a script run went, for a status line or a list row:
 * "Passed", "Timed out · stopped after 5 min", "Failed · exit code 1",
 * "Failed · stopped by SIGKILL", or "Failed · failure screenshot captured"
 * (the script exited 0 but its template wrote failure.png).
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
  const processWasKilledBySignal = run.exitCode === null;
  if (processWasKilledBySignal) {
    return `Failed · stopped by ${run.exitSignal ?? "a signal"}`;
  }
  const processExitedWithAnError = run.exitCode !== 0;
  if (processExitedWithAnError) {
    return `Failed · exit code ${String(run.exitCode)}`;
  }
  return "Failed · failure screenshot captured";
}
