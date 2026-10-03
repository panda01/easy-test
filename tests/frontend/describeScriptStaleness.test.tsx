import { describe, it, expect } from "vitest";
import {
  describeChangedActionFields,
  findChangedActionFields,
} from "../../src/utils/describeScriptStaleness";

const snapshot = { actionTitle: "Log in", actionDescription: "Sign in" };

describe("findChangedActionFields", () => {
  it("finds nothing when the action still has the text the script was generated from", () => {
    expect(findChangedActionFields(snapshot, { title: "Log in", description: "Sign in" })).toEqual([]);
  });

  it("finds a changed title, a changed description, or both (title first)", () => {
    expect(findChangedActionFields(snapshot, { title: "Log in now", description: "Sign in" })).toEqual([
      "title",
    ]);
    expect(findChangedActionFields(snapshot, { title: "Log in", description: "Sign up" })).toEqual([
      "description",
    ]);
    expect(findChangedActionFields(snapshot, { title: "X", description: "Y" })).toEqual([
      "title",
      "description",
    ]);
  });

  it("compares exactly, so a change in case counts", () => {
    expect(findChangedActionFields(snapshot, { title: "log in", description: "Sign in" })).toEqual([
      "title",
    ]);
  });
});

describe("describeChangedActionFields", () => {
  it("joins the fields with 'and'", () => {
    expect(describeChangedActionFields(["title"])).toBe("title");
    expect(describeChangedActionFields(["title", "description"])).toBe("title and description");
  });
});
