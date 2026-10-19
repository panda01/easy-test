import { describe, it, expect } from "vitest";
import {
  chooseWebObjectName,
  describePagePatternRole,
  describeWebObjectCounts,
  measureWebObjectDepths,
} from "../../src/utils/describeWebObject";

describe("describePagePatternRole", () => {
  it.each([
    ["instance", null, "Instance page"],
    ["view", "edit", "View · edit"],
    ["view", null, "View · "],
    ["collection", null, "List page"],
    ["create", null, "Create page"],
  ] as const)("labels a %s pattern (view %j) as %j", (role, viewName, label) => {
    expect(describePagePatternRole(role, viewName)).toBe(label);
  });
});

describe("describeWebObjectCounts", () => {
  it("counts the instances, singular or plural", () => {
    expect(describeWebObjectCounts(1, 0)).toBe("1 instance");
    expect(describeWebObjectCounts(3, 0)).toBe("3 instances");
  });

  it("adds the links the crawl skipped", () => {
    expect(describeWebObjectCounts(3, 9)).toBe("3 instances · 9 more skipped");
  });
});

describe("chooseWebObjectName", () => {
  const renamedNamesById = new Map<string, string | null>([
    ["renamed", "Test step"],
    ["reset", null],
  ]);

  it("prefers a name saved on this visit, then the name the object came with, then the detected name", () => {
    expect(chooseWebObjectName("renamed", "Old name", "Action", renamedNamesById)).toBe("Test step");
    expect(chooseWebObjectName("reset", "Old name", "Action", renamedNamesById)).toBe("Action");
    expect(chooseWebObjectName("untouched", "Old name", "Action", renamedNamesById)).toBe("Old name");
    expect(chooseWebObjectName("untouched", null, "Action", renamedNamesById)).toBe("Action");
  });

  it("uses the name the object came with when it is not saved (no id)", () => {
    expect(chooseWebObjectName(null, "Website", "Website", renamedNamesById)).toBe("Website");
  });
});

describe("measureWebObjectDepths", () => {
  it("puts top-level objects at 0 and each child one below its parent", () => {
    const depthsByKey = measureWebObjectDepths([
      { instancePatternKey: "/websites/{website}", parentInstancePatternKey: null },
      { instancePatternKey: "/websites/{website}/actions/{action}", parentInstancePatternKey: "/websites/{website}" },
      {
        instancePatternKey: "/websites/{website}/actions/{action}/runs/{run}",
        parentInstancePatternKey: "/websites/{website}/actions/{action}",
      },
      { instancePatternKey: "/orphans/{orphan}", parentInstancePatternKey: "/missing/{parent}" },
    ]);

    expect([...depthsByKey.entries()]).toEqual([
      ["/websites/{website}", 0],
      ["/websites/{website}/actions/{action}", 1],
      ["/websites/{website}/actions/{action}/runs/{run}", 2],
      ["/orphans/{orphan}", 0],
    ]);
  });
});
