import { describe, it, expect } from "vitest";
import { describeActionScriptRunOutcome } from "../../src/utils/describeActionScriptRun";

describe("describeActionScriptRunOutcome", () => {
  it("says Passed for a passing run", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: true, timedOut: false, exitCode: 0, exitSignal: null }),
    ).toBe("Passed");
  });

  it("says Timed out for a run stopped at the time limit, whatever its exit", () => {
    expect(
      describeActionScriptRunOutcome({
        succeeded: false,
        timedOut: true,
        exitCode: null,
        exitSignal: "SIGKILL",
      }),
    ).toBe("Timed out · stopped after 5 min");
  });

  it("names the exit code of a run that exited with an error", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, exitCode: 1, exitSignal: null }),
    ).toBe("Failed · exit code 1");
  });

  it("names the signal that stopped a run, or says 'a signal' when none was reported", () => {
    expect(
      describeActionScriptRunOutcome({
        succeeded: false,
        timedOut: false,
        exitCode: null,
        exitSignal: "SIGSEGV",
      }),
    ).toBe("Failed · stopped by SIGSEGV");
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, exitCode: null, exitSignal: null }),
    ).toBe("Failed · stopped by a signal");
  });

  it("explains a failed run that exited 0 by its failure screenshot", () => {
    expect(
      describeActionScriptRunOutcome({ succeeded: false, timedOut: false, exitCode: 0, exitSignal: null }),
    ).toBe("Failed · failure screenshot captured");
  });
});
