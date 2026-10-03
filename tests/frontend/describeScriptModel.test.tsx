import { describe, it, expect } from "vitest";
import { describeScriptModel } from "../../src/utils/describeScriptModel";
import { buildScriptModelCatalog } from "./support/frontendTestHelpers";

const catalogModels = buildScriptModelCatalog().models;

describe("describeScriptModel", () => {
  it("names a listed model with its id and the recorded effort level", () => {
    expect(describeScriptModel("claude-opus-5-5", "high", catalogModels)).toBe(
      "Claude Opus 5.5 (claude-opus-5-5) · high effort",
    );
  });

  it("says Standard effort for a model with no effort setting", () => {
    expect(describeScriptModel("claude-haiku-4-5-20251001", null, catalogModels)).toBe(
      "Claude Haiku 4.5 (claude-haiku-4-5-20251001) · Standard effort",
    );
  });

  it("says the effort was not recorded for a model that has effort levels but none was stored", () => {
    expect(describeScriptModel("claude-opus-5-5", null, catalogModels)).toBe(
      "Claude Opus 5.5 (claude-opus-5-5) · effort not recorded",
    );
  });

  it("shows a model the catalog does not list (loading, failed, or retired) by its id alone", () => {
    expect(describeScriptModel("claude-retired-1", "low", [])).toBe("claude-retired-1 · low effort");
    expect(describeScriptModel("claude-retired-1", null, [])).toBe("claude-retired-1 · no effort level");
  });
});
