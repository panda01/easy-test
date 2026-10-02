import { describe, it, expect } from "vitest";
import {
  describeScreenshotRunOutcome,
  formatRunDuration,
} from "../../src/utils/describeScreenshotRun";

describe("describeScreenshotRunOutcome", () => {
  it("names a successful run and its HTTP status", () => {
    expect(describeScreenshotRunOutcome({ succeeded: true, httpStatus: 200 })).toBe(
      "Succeeded · HTTP 200",
    );
  });

  it("names a failed run that got an HTTP status", () => {
    expect(describeScreenshotRunOutcome({ succeeded: false, httpStatus: 404 })).toBe(
      "Failed · HTTP 404",
    );
  });

  it("says No response for a run that never reached a page", () => {
    expect(describeScreenshotRunOutcome({ succeeded: false, httpStatus: null })).toBe(
      "Failed · No response",
    );
  });
});

describe("formatRunDuration", () => {
  it("formats milliseconds as seconds with one decimal", () => {
    expect(formatRunDuration(1234)).toBe("1.2 s");
    expect(formatRunDuration(30000)).toBe("30.0 s");
  });

  it("rounds a very short run to 0.0 s", () => {
    expect(formatRunDuration(7)).toBe("0.0 s");
    expect(formatRunDuration(0)).toBe("0.0 s");
  });

  it("rounds to the nearest tenth", () => {
    expect(formatRunDuration(1250)).toBe("1.3 s");
    expect(formatRunDuration(1249)).toBe("1.2 s");
  });
});
