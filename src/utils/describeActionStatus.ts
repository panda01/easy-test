import { formatCount } from "./formatCount";
import { formatRelativeTime } from "./formatRelativeTime";
import { type ScriptRunStatus, findScriptRunStatus } from "./describeScriptRunStatus";

/** The parts of an action's latest run its status label is built from. */
export interface LatestRunLabelFields {
  /** True when the run passed. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** When the run was recorded. */
  createdAt: string;
}

/** How many of a website's actions pass, fail, or have not been run. */
export interface ActionStatusCounts {
  passed: number;
  failed: number;
  notRun: number;
}

/**
 * Words an action's status for its row in the action list, short enough for
 * a narrow column: "Not run yet", when it last passed ("12 min ago"), or how
 * it failed ("Failed at step 9", "Timed out", "Failed before step 1").
 * @param latestRun - The newest version's latest run, or null when there is none
 * @param now - The current moment, for the relative time of a pass
 * @returns The status label
 */
export function describeLatestRunLabel(latestRun: LatestRunLabelFields | null, now: Date): string {
  if (latestRun === null) {
    return "Not run yet";
  }
  if (latestRun.succeeded) {
    return formatRelativeTime(latestRun.createdAt, now);
  }
  if (latestRun.timedOut) {
    return "Timed out";
  }
  const runStoppedAtAStep = latestRun.failedStepNumber !== null;
  return runStoppedAtAStep
    ? `Failed at step ${String(latestRun.failedStepNumber)}`
    : "Failed before step 1";
}

/**
 * Counts how many actions pass, fail, or have not been run, each judged by
 * its newest version's latest run (`findScriptRunStatus`).
 * @param latestRuns - Each action's newest version's latest run, or null
 * @returns The three counts
 */
export function countActionStatuses(
  latestRuns: readonly ({ succeeded: boolean } | null)[],
): ActionStatusCounts {
  const counts: ActionStatusCounts = { passed: 0, failed: 0, notRun: 0 };
  for (const latestRun of latestRuns) {
    const status: ScriptRunStatus = findScriptRunStatus(latestRun);
    counts[status] += 1;
  }
  return counts;
}

/**
 * Words the action counts the way the website page's Actions heading does:
 * "4 passed · 2 failed · 1 not run".
 * @param counts - How many actions pass, fail, or have not been run
 * @returns The summary line
 */
export function describeActionStatusCounts(counts: ActionStatusCounts): string {
  return `${String(counts.passed)} passed · ${String(counts.failed)} failed · ${String(counts.notRun)} not run`;
}

/**
 * Words how many actions a list holds, e.g. "16 actions".
 * @param actionCount - The number of actions
 * @returns The count with its noun
 */
export function describeActionCount(actionCount: number): string {
  return formatCount(actionCount, "action", "actions");
}
