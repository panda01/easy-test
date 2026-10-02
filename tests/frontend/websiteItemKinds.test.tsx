import { describe, it, expect } from "vitest";
import { ACTION_KIND, USE_CASE_KIND } from "../../src/utils/websiteItemKinds";

describe("websiteItemKinds", () => {
  it("describes use cases with their labels and the use-cases URL segment", () => {
    expect(USE_CASE_KIND).toEqual({
      kindId: "useCase",
      singularLabel: "use case",
      pluralLabel: "use cases",
      singularTitle: "Use case",
      pluralTitle: "Use cases",
      pathSegment: "use-cases",
    });
  });

  it("describes actions with their labels and the actions URL segment", () => {
    expect(ACTION_KIND).toEqual({
      kindId: "action",
      singularLabel: "action",
      pluralLabel: "actions",
      singularTitle: "Action",
      pluralTitle: "Actions",
      pathSegment: "actions",
    });
  });

  it("gives the two kinds distinct ids, so React keys built from them never collide", () => {
    expect(USE_CASE_KIND.kindId).not.toBe(ACTION_KIND.kindId);
  });
});
