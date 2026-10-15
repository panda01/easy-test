/**
 * Whether a script version works, judged by its most recent run only:
 * `passed` or `failed` by that run's outcome, `notRun` when it has no runs
 * (an action with no versions yet counts as `notRun` too).
 */
export type ScriptRunStatus = "passed" | "failed" | "notRun";

/** The part of a version's newest run its status is decided by. */
export interface LatestRunOutcome {
  /** True when the run passed. */
  succeeded: boolean;
}

/**
 * Decides a version's run status from its most recent run - a pass after a
 * failure counts as passed, and a failure after a pass as failed.
 * @param latestRun - The version's newest run, or null when it has not been run (or there is no version)
 * @returns `passed`, `failed`, or `notRun`
 */
export function findScriptRunStatus(latestRun: LatestRunOutcome | null): ScriptRunStatus {
  const thereIsNoRunYet = latestRun === null;
  if (thereIsNoRunYet) {
    return "notRun";
  }
  return latestRun.succeeded ? "passed" : "failed";
}

/**
 * Names a run status in words, for the status icon's accessible name and
 * hover title.
 * @param status - The run status
 * @returns "Latest run passed", "Latest run failed", or "Not run yet"
 */
export function describeScriptRunStatus(status: ScriptRunStatus): string {
  switch (status) {
    case "passed":
      return "Latest run passed";
    case "failed":
      return "Latest run failed";
    case "notRun":
      return "Not run yet";
  }
}

/**
 * Names a run status in one word or two, for the phone's version dropdown
 * ("Version 5 · Failed · 24 min ago").
 * @param status - The run status
 * @returns "Passed", "Failed", or "Not run"
 */
export function describeScriptRunStatusBriefly(status: ScriptRunStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "notRun":
      return "Not run";
  }
}
