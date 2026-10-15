import { describe, it, expect } from "vitest";
import {
  countActionStatuses,
  describeActionCount,
  describeActionStatusCounts,
  describeLatestRunLabel,
} from "../../src/utils/describeActionStatus";

const NOW = new Date("2026-10-13T14:30:00.000Z");

/** A latest run, passed, twelve minutes before `NOW`. */
const passedRun = {
  succeeded: true,
  timedOut: false,
  failedStepNumber: null,
  createdAt: "2026-10-13T14:18:00.000Z",
};

describe("describeLatestRunLabel", () => {
  it("says Not run yet without a run", () => {
    expect(describeLatestRunLabel(null, NOW)).toBe("Not run yet");
  });

  it("says when a passing run ran", () => {
    expect(describeLatestRunLabel(passedRun, NOW)).toBe("12 min ago");
  });

  it("says Timed out for a run stopped at the time limit", () => {
    expect(describeLatestRunLabel({ ...passedRun, succeeded: false, timedOut: true }, NOW)).toBe("Timed out");
  });

  it("names the step a failed run stopped at", () => {
    expect(describeLatestRunLabel({ ...passedRun, succeeded: false, failedStepNumber: 9 }, NOW)).toBe(
      "Failed at step 9",
    );
  });

  it("says Failed before step 1 when the run stopped before any step", () => {
    expect(describeLatestRunLabel({ ...passedRun, succeeded: false }, NOW)).toBe("Failed before step 1");
  });
});

describe("countActionStatuses / describeActionStatusCounts", () => {
  it("counts each action by its latest run", () => {
    const counts = countActionStatuses([
      { succeeded: true },
      { succeeded: true },
      { succeeded: false },
      null,
    ]);

    expect(counts).toEqual({ passed: 2, failed: 1, notRun: 1 });
    expect(describeActionStatusCounts(counts)).toBe("2 passed · 1 failed · 1 not run");
  });

  it("counts nothing for no actions", () => {
    expect(countActionStatuses([])).toEqual({ passed: 0, failed: 0, notRun: 0 });
  });
});

describe("describeActionCount", () => {
  it("uses the singular for one action and the plural otherwise", () => {
    expect(describeActionCount(1)).toBe("1 action");
    expect(describeActionCount(16)).toBe("16 actions");
  });
});
