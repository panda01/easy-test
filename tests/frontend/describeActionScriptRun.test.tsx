import { describe, it, expect } from "vitest";
import { describeActionScriptRunOutcome } from "../../src/utils/describeActionScriptRun";

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
