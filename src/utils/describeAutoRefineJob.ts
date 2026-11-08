import { type AutoRefineJobRecord } from "../hooks/useAutoRefineJob";
import { formatCount } from "./formatCount";

/** How an auto-refine outcome is coloured: an MUI Alert severity. */
export type AutoRefineSeverity = "info" | "success" | "warning" | "error";

/** One line about an ended auto-refine job, with the tone to show it in. */
export interface AutoRefineOutcomeMessage {
  severity: AutoRefineSeverity;
  text: string;
}

/**
 * Maps a version's id to its number in the action's list, or null when it is
 * not listed (the list has not caught up with the job yet, or the version
 * was deleted). The action page supplies it from its own list.
 */
export type VersionNumberOfScriptId = (scriptId: string) => number | null;

/**
 * Names a version by its number, falling back to "the newest version" when
 * its number is not known yet - the job's versions are listed only after the
 * page refetches them.
 * @param scriptId - The version's id
 * @param versionNumberOf - The page's id-to-number mapping
 * @returns "Version 4", or "the newest version"
 */
function nameVersion(scriptId: string, versionNumberOf: VersionNumberOfScriptId): string {
  const versionNumber = versionNumberOf(scriptId);
  const versionIsListed = versionNumber !== null;
  return versionIsListed ? `Version ${String(versionNumber)}` : "the newest version";
}

/**
 * Names the version the job will refine the current one into: the next
 * number when the current one is known.
 * @param currentScriptId - The version being refined
 * @param versionNumberOf - The page's id-to-number mapping
 * @returns "Version 5", or "the next version"
 */
function nameNextVersion(currentScriptId: string, versionNumberOf: VersionNumberOfScriptId): string {
  const currentVersionNumber = versionNumberOf(currentScriptId);
  const currentVersionIsListed = currentVersionNumber !== null;
  return currentVersionIsListed ? `Version ${String(currentVersionNumber + 1)}` : "the next version";
}

/**
 * Finds the version an `unchanged` job's last refinement was refined from:
 * the created version before the current one, or the start version when the
 * current one is the first the job created.
 * @param job - The job
 * @returns The id of the version the current one came back identical to
 */
function findVersionRefinedIntoCurrent(job: AutoRefineJobRecord): string {
  const currentIndex = job.createdActionScriptIds.indexOf(job.currentActionScriptId);
  const currentIsTheFirstCreated = currentIndex <= 0;
  if (currentIsTheFirstCreated) return job.startActionScriptId;
  return job.createdActionScriptIds[currentIndex - 1];
}

/**
 * Upper-cases the first letter, for a version name that starts a sentence
 * ("the newest version" → "The newest version").
 * @param text - The text
 * @returns The text with its first letter upper-cased
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Words what a running auto-refine job is doing right now, for the status
 * line under the Auto-refine button:
 * - phase "running": "Refinement 2 of 5 · Running Version 4…";
 * - phase "refining": "Refining Version 4 into Version 5…";
 * - phase "refiningCleanup": "Refinement 2 of 5 · Refining its delete action…"
 *   (the Create version passed; its cleanup, the delete action's run, failed);
 * - phase "runningCleanup": "Running its delete action on its own…";
 * - once a stop was requested, " · Stopping after this step…" is appended,
 *   since a step in flight cannot be cut short.
 * @param job - The running job
 * @param versionNumberOf - The page's id-to-number mapping
 * @returns The status line
 */
export function describeAutoRefineProgress(
  job: AutoRefineJobRecord,
  versionNumberOf: VersionNumberOfScriptId,
): string {
  const currentVersionName = nameVersion(job.currentActionScriptId, versionNumberOf);
  const refinementCountText = `Refinement ${String(job.refinementsDone)} of ${String(job.maxRefinements)}`;
  let stepText: string;
  switch (job.phase) {
    case "refining":
      stepText = `Refining ${currentVersionName} into ${nameNextVersion(job.currentActionScriptId, versionNumberOf)}…`;
      break;
    case "refiningCleanup":
      stepText = `${refinementCountText} · ${currentVersionName} passed; refining its delete action…`;
      break;
    case "runningCleanup":
      stepText = `${refinementCountText} · Running its delete action on its own…`;
      break;
    default:
      stepText = `${refinementCountText} · Running ${currentVersionName}…`;
  }
  const stopWasRequested = job.stopRequestedAt !== null;
  return stopWasRequested ? `${stepText} · Stopping after this step…` : stepText;
}

/**
 * Words how an auto-refine job ended, with the tone to show it in:
 * - passed (success): "Version 4 passed after 2 refinements." / "with no refinements.";
 * - gaveUp (warning): "Stopped after 5 refinements; Version 6 still fails.";
 * - unchanged (warning): "Stopped: Version 5 came back identical to Version 4.", or on the
 *   Delete side "Stopped: Version 1 passed, but its delete action's refinement came back
 *   identical to the version it refined, so refining again would go nowhere.";
 * - stopped (info): "Stopped at your request after Version 3.";
 * - failed (error): "Auto-refine failed: <errorMessage>";
 * - interrupted (error): "Auto-refine was interrupted by a server restart."
 * A version not yet listed is "the newest version".
 * @param job - The job
 * @param versionNumberOf - The page's id-to-number mapping
 * @returns The outcome line and its severity, or null while the job is still running
 */
export function describeAutoRefineOutcome(
  job: AutoRefineJobRecord,
  versionNumberOf: VersionNumberOfScriptId,
): AutoRefineOutcomeMessage | null {
  const currentVersionName = nameVersion(job.currentActionScriptId, versionNumberOf);
  switch (job.status) {
    case "running":
      return null;
    case "passed": {
      const noRefinementsWereNeeded = job.refinementsDone === 0;
      const refinementsText = noRefinementsWereNeeded
        ? "with no refinements"
        : `after ${formatCount(job.refinementsDone, "refinement", "refinements")}`;
      return { severity: "success", text: `${capitalise(currentVersionName)} passed ${refinementsText}.` };
    }
    case "gaveUp":
      return {
        severity: "warning",
        text: `Stopped after ${formatCount(job.maxRefinements, "refinement", "refinements")}; ${currentVersionName} still fails.`,
      };
    case "unchanged": {
      // On the Delete side the job's own version passed; the server says which plan came back identical.
      const deleteSideMessage = job.errorMessage;
      if (deleteSideMessage !== null) {
        return { severity: "warning", text: `Stopped: ${currentVersionName} passed, but ${deleteSideMessage}.` };
      }
      const previousVersionName = nameVersion(findVersionRefinedIntoCurrent(job), versionNumberOf);
      const bothNamesAreUnknown = previousVersionName === currentVersionName;
      const previousText = bothNamesAreUnknown ? "the version before it" : previousVersionName;
      return {
        severity: "warning",
        text: `Stopped: ${currentVersionName} came back identical to ${previousText}.`,
      };
    }
    case "stopped":
      return { severity: "info", text: `Stopped at your request after ${currentVersionName}.` };
    case "failed":
      return { severity: "error", text: `Auto-refine failed: ${job.errorMessage ?? "unknown reason"}` };
    case "interrupted":
      return { severity: "error", text: "Auto-refine was interrupted by a server restart." };
  }
}
