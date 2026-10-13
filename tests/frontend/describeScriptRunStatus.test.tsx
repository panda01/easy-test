import { describe, it, expect } from "vitest";
import {
  describeScriptRunStatus,
  findScriptRunStatus,
} from "../../src/utils/describeScriptRunStatus";

describe("findScriptRunStatus", () => {
  it("is passed when the latest run passed", () => {
    expect(findScriptRunStatus({ succeeded: true })).toBe("passed");
  });

  it("is failed when the latest run failed", () => {
    expect(findScriptRunStatus({ succeeded: false })).toBe("failed");
  });

  it("is notRun when there is no run yet (or no version)", () => {
    expect(findScriptRunStatus(null)).toBe("notRun");
  });
});

describe("describeScriptRunStatus", () => {
  it("names each status in words", () => {
    expect(describeScriptRunStatus("passed")).toBe("Latest run passed");
    expect(describeScriptRunStatus("failed")).toBe("Latest run failed");
    expect(describeScriptRunStatus("notRun")).toBe("Not run yet");
  });
});
