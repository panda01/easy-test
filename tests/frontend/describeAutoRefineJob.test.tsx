import { describe, it, expect } from "vitest";
import {
  describeAutoRefineOutcome,
  describeAutoRefineProgress,
  type VersionNumberOfScriptId,
} from "../../src/utils/describeAutoRefineJob";
import { buildAutoRefineJobRecord } from "./support/frontendTestHelpers";

/** Numbers script-1 … script-6 as Versions 1 … 6; anything else is not listed. */
const versionNumberOf: VersionNumberOfScriptId = (scriptId) => {
  const versionNumberMatch = /^script-(\d)$/.exec(scriptId);
  return versionNumberMatch === null ? null : Number(versionNumberMatch[1]);
};

/** Knows no version at all - the list has not caught up with the job yet. */
const noVersionIsListed: VersionNumberOfScriptId = () => null;

describe("describeAutoRefineProgress", () => {
  it("counts the refinement and names the version being run", () => {
    const job = buildAutoRefineJobRecord({
      phase: "running",
      refinementsDone: 2,
      currentActionScriptId: "script-4",
      createdActionScriptIds: ["script-3", "script-4"],
    });

    expect(describeAutoRefineProgress(job, versionNumberOf)).toBe("Refinement 2 of 5 · Running Version 4…");
  });

  it("names the version being refined and the one it becomes", () => {
    const job = buildAutoRefineJobRecord({ phase: "refining", refinementsDone: 1, currentActionScriptId: "script-4" });

    expect(describeAutoRefineProgress(job, versionNumberOf)).toBe("Refining Version 4 into Version 5…");
  });

  it("says a stop is pending once one was requested", () => {
    const job = buildAutoRefineJobRecord({ phase: "refining", currentActionScriptId: "script-4", stopRequestedAt: "2026-04-05T03:06:05.000Z" });

    expect(describeAutoRefineProgress(job, versionNumberOf)).toBe(
      "Refining Version 4 into Version 5… · Stopping after this step…",
    );
  });

  it("falls back to the newest version when the version is not listed yet", () => {
    const runningJob = buildAutoRefineJobRecord({ phase: "running", currentActionScriptId: "unlisted" });
    const refiningJob = buildAutoRefineJobRecord({ phase: "refining", currentActionScriptId: "unlisted" });

    expect(describeAutoRefineProgress(runningJob, noVersionIsListed)).toBe(
      "Refinement 0 of 5 · Running the newest version…",
    );
    expect(describeAutoRefineProgress(refiningJob, noVersionIsListed)).toBe(
      "Refining the newest version into the next version…",
    );
  });
});

describe("describeAutoRefineOutcome", () => {
  it("has nothing to say while the job runs", () => {
    expect(describeAutoRefineOutcome(buildAutoRefineJobRecord(), versionNumberOf)).toBeNull();
  });

  it("celebrates a pass, counting the refinements it took", () => {
    const passedAfterTwo = buildAutoRefineJobRecord({
      status: "passed",
      phase: null,
      refinementsDone: 2,
      currentActionScriptId: "script-4",
    });
    const passedAfterOne = buildAutoRefineJobRecord({ ...passedAfterTwo, refinementsDone: 1, currentActionScriptId: "script-3" });
    const passedAtOnce = buildAutoRefineJobRecord({ ...passedAfterTwo, refinementsDone: 0, currentActionScriptId: "script-2" });

    expect(describeAutoRefineOutcome(passedAfterTwo, versionNumberOf)).toEqual({
      severity: "success",
      text: "Version 4 passed after 2 refinements.",
    });
    expect(describeAutoRefineOutcome(passedAfterOne, versionNumberOf)).toEqual({
      severity: "success",
      text: "Version 3 passed after 1 refinement.",
    });
    expect(describeAutoRefineOutcome(passedAtOnce, versionNumberOf)).toEqual({
      severity: "success",
      text: "Version 2 passed with no refinements.",
    });
    expect(describeAutoRefineOutcome(passedAtOnce, noVersionIsListed)?.text).toBe(
      "The newest version passed with no refinements.",
    );
  });

  it("warns when the job gave up after the most refinements", () => {
    const job = buildAutoRefineJobRecord({ status: "gaveUp", phase: null, refinementsDone: 5, currentActionScriptId: "script-6" });

    expect(describeAutoRefineOutcome(job, versionNumberOf)).toEqual({
      severity: "warning",
      text: "Stopped after 5 refinements; Version 6 still fails.",
    });
  });

  it("warns when a refinement came back identical, naming the version it was refined from", () => {
    const identicalToCreated = buildAutoRefineJobRecord({
      status: "unchanged",
      phase: null,
      refinementsDone: 2,
      startActionScriptId: "script-3",
      currentActionScriptId: "script-5",
      createdActionScriptIds: ["script-4", "script-5"],
    });
    const identicalToStart = buildAutoRefineJobRecord({
      ...identicalToCreated,
      refinementsDone: 1,
      currentActionScriptId: "script-4",
      createdActionScriptIds: ["script-4"],
    });

    expect(describeAutoRefineOutcome(identicalToCreated, versionNumberOf)).toEqual({
      severity: "warning",
      text: "Stopped: Version 5 came back identical to Version 4.",
    });
    expect(describeAutoRefineOutcome(identicalToStart, versionNumberOf)?.text).toBe(
      "Stopped: Version 4 came back identical to Version 3.",
    );
    expect(describeAutoRefineOutcome(identicalToStart, noVersionIsListed)?.text).toBe(
      "Stopped: the newest version came back identical to the version before it.",
    );
  });

  it("notes a stop at the user's request", () => {
    const job = buildAutoRefineJobRecord({ status: "stopped", phase: null, currentActionScriptId: "script-3", stopRequestedAt: "2026-04-05T03:06:05.000Z" });

    expect(describeAutoRefineOutcome(job, versionNumberOf)).toEqual({
      severity: "info",
      text: "Stopped at your request after Version 3.",
    });
  });

  it("reports a failure with its reason, and an interruption", () => {
    const failedJob = buildAutoRefineJobRecord({ status: "failed", phase: null, errorMessage: "Claude is overloaded" });
    const failedWithoutReason = buildAutoRefineJobRecord({ status: "failed", phase: null, errorMessage: null });
    const interruptedJob = buildAutoRefineJobRecord({ status: "interrupted", phase: null });

    expect(describeAutoRefineOutcome(failedJob, versionNumberOf)).toEqual({
      severity: "error",
      text: "Auto-refine failed: Claude is overloaded",
    });
    expect(describeAutoRefineOutcome(failedWithoutReason, versionNumberOf)?.text).toBe(
      "Auto-refine failed: unknown reason",
    );
    expect(describeAutoRefineOutcome(interruptedJob, versionNumberOf)).toEqual({
      severity: "error",
      text: "Auto-refine was interrupted by a server restart.",
    });
  });
});

describe("describeAutoRefineProgress: the Delete side", () => {
  it("says the version passed and the delete action is being refined", () => {
    const job = buildAutoRefineJobRecord({ phase: "refiningCleanup", refinementsDone: 1, currentActionScriptId: "script-2" });

    expect(describeAutoRefineProgress(job, versionNumberOf)).toBe(
      "Refinement 1 of 5 · Version 2 passed; refining its delete action…",
    );
  });

  it("says the delete action is being run on its own", () => {
    const job = buildAutoRefineJobRecord({ phase: "runningCleanup", refinementsDone: 2, currentActionScriptId: "script-2" });

    expect(describeAutoRefineProgress(job, versionNumberOf)).toBe("Refinement 2 of 5 · Running its delete action on its own…");
    expect(describeAutoRefineProgress({ ...job, stopRequestedAt: "2026-04-05T03:06:05.000Z" }, versionNumberOf)).toBe(
      "Refinement 2 of 5 · Running its delete action on its own… · Stopping after this step…",
    );
  });
});

describe("describeAutoRefineOutcome: the Delete side", () => {
  it("says the version passed but the delete action's refinement changed nothing", () => {
    const job = buildAutoRefineJobRecord({
      status: "unchanged",
      phase: null,
      currentActionScriptId: "script-1",
      cleanupActionScriptIds: ["delete-script-2"],
      errorMessage: "its delete action's refinement came back identical to the version it refined, so refining again would go nowhere",
    });

    expect(describeAutoRefineOutcome(job, versionNumberOf)).toEqual({
      severity: "warning",
      text: "Stopped: Version 1 passed, but its delete action's refinement came back identical to the version it refined, so refining again would go nowhere.",
    });
  });
});
