import { describe, it, expect } from "vitest";
import { statusForScriptGenerationFailure } from "../../../server/utils/statusForScriptGenerationFailure.js";

/**
 * Builds an error shaped like `ScriptGenerationError`.
 * @param reason - The failure reason
 * @returns An Error carrying `name` and `reason`
 */
function buildScriptGenerationError(reason: string): Error {
  return Object.assign(new Error(reason), { name: "ScriptGenerationError", reason });
}

describe("statusForScriptGenerationFailure", () => {
  it.each([
    ["missingApiKey", 503],
    ["unsupportedModel", 400],
    ["refused", 502],
    ["truncated", 502],
    ["unparseable", 502],
  ])("maps %s to %i", (reason, expectedStatus) => {
    expect(statusForScriptGenerationFailure(buildScriptGenerationError(reason))).toBe(expectedStatus);
  });

  it("answers 500 for an unknown reason", () => {
    expect(statusForScriptGenerationFailure(buildScriptGenerationError("somethingNew"))).toBe(500);
  });

  it("answers 500 for an error that only happens to carry a known reason", () => {
    expect(statusForScriptGenerationFailure(Object.assign(new Error("x"), { reason: "refused" }))).toBe(
      500,
    );
  });

  it("answers 500 for a non-object rejection", () => {
    expect(statusForScriptGenerationFailure("socket hang up")).toBe(500);
    expect(statusForScriptGenerationFailure(null)).toBe(500);
  });
});
