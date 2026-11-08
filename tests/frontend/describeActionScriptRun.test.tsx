import { describe, it, expect } from "vitest";
import { describeActionScriptRunOutcome, runFailedOnlyInItsCleanup } from "../../src/utils/describeActionScriptRun";

describe("describeActionScriptRunOutcome", () => {
  it("says Passed for a passing run", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: true, timedOut: false, failedStepNumber: null }),
    ).toBe("Passed");
  });

  it("says Timed out for a run stopped at the time limit, whatever step it was on", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: true, failedStepNumber: 4 }),
    ).toBe("Timed out · stopped after 5 min");
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: true, failedStepNumber: null }),
    ).toBe("Timed out · stopped after 5 min");
  });

  it("names the step a failed run stopped at", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, failedStepNumber: 3 }),
    ).toBe("Failed at step 3");
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, failedStepNumber: 1 }),
    ).toBe("Failed at step 1");
  });

  it("says a run failed before the first step when it stopped at no step (login or start page)", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, failedStepNumber: null }),
    ).toBe("Failed before the first step");
  });
});

describe("cleanup outcomes", () => {
  /** A Create run whose own steps passed and whose cleanup (the delete action's run) failed. */
  const cleanupFailure = {
    succeeded: false,
    timedOut: false,
    failedStepNumber: null,
    errorMessage: "Cleanup failed: Step 2 (click): button not found",
    cleanupOutcome: "failed",
  };

  it("says the cleanup failed, or that there was none, for a run whose own steps passed", () => {
    expect(describeActionScriptRunOutcome(cleanupFailure)).toBe("Failed · cleanup failed");
    expect(
      describeActionScriptRunOutcome({
        ...cleanupFailure,
        cleanupOutcome: "missing",
        errorMessage: "Cleanup missing: This action has no delete action yet",
      }),
    ).toBe("Failed · no cleanup");
  });

  it("keeps the step wording when the run's own steps failed, whatever the cleanup did", () => {
    expect(
      describeActionScriptRunOutcome({ ...cleanupFailure, failedStepNumber: 3, errorMessage: "Step 3 failed" }),
    ).toBe("Failed at step 3");
  });

  it("runFailedOnlyInItsCleanup needs a failed run, a failed or missing cleanup, and the cleanup's error", () => {
    expect(runFailedOnlyInItsCleanup(cleanupFailure)).toBe(true);
    expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, succeeded: true })).toBe(false);
    expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, cleanupOutcome: "passed" })).toBe(false);
    expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, errorMessage: "Step 2 failed" })).toBe(false);
    expect(runFailedOnlyInItsCleanup({ succeeded: false, timedOut: false, failedStepNumber: 2 })).toBe(false);
  });
});
