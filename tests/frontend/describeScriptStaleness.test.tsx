import { describe, it, expect } from "vitest";
import {
  describeChangedActionFields,
  findChangedActionFields,
} from "../../src/utils/describeScriptStaleness";

/** A plan's snapshot of a logged-out action titled "Log in". */
const snapshot = { actionTitle: "Log in", actionDescription: "Sign in", credentialId: null };

describe("findChangedActionFields", () => {
  it("finds nothing when the action still has the text and credential the plan was generated from", () => {
    expect(
      findChangedActionFields(snapshot, { title: "Log in", description: "Sign in", credentialId: null }),
    ).toEqual([]);
    expect(
      findChangedActionFields(
        { ...snapshot, credentialId: "credential-1" },
        { title: "Log in", description: "Sign in", credentialId: "credential-1" },
      ),
    ).toEqual([]);
  });

  it("finds a changed title, a changed description, or both (title first)", () => {
    expect(
      findChangedActionFields(snapshot, { title: "Log in now", description: "Sign in", credentialId: null }),
    ).toEqual(["title"]);
    expect(
      findChangedActionFields(snapshot, { title: "Log in", description: "Sign up", credentialId: null }),
    ).toEqual(["description"]);
    expect(findChangedActionFields(snapshot, { title: "X", description: "Y", credentialId: null })).toEqual([
      "title",
      "description",
    ]);
  });

  it("finds a changed credential: logged out to a credential, a credential to logged out, or another credential", () => {
    expect(
      findChangedActionFields(snapshot, {
        title: "Log in",
        description: "Sign in",
        credentialId: "credential-1",
      }),
    ).toEqual(["credential"]);
    expect(
      findChangedActionFields(
        { ...snapshot, credentialId: "credential-1" },
        { title: "Log in", description: "Sign in", credentialId: null },
      ),
    ).toEqual(["credential"]);
    expect(
      findChangedActionFields(
        { ...snapshot, credentialId: "credential-1" },
        { title: "Log in", description: "Sign in", credentialId: "credential-2" },
      ),
    ).toEqual(["credential"]);
  });

  it("lists every changed field in order: title, description, credential", () => {
    expect(
      findChangedActionFields(snapshot, { title: "X", description: "Y", credentialId: "credential-1" }),
    ).toEqual(["title", "description", "credential"]);
  });

  it("compares exactly, so a change in case counts", () => {
    expect(
      findChangedActionFields(snapshot, { title: "log in", description: "Sign in", credentialId: null }),
    ).toEqual(["title"]);
  });
});

describe("describeChangedActionFields", () => {
  it("names a single field as it is", () => {
    expect(describeChangedActionFields(["title"])).toBe("title");
    expect(describeChangedActionFields(["credential"])).toBe("credential");
  });

  it("joins two fields with 'and'", () => {
    expect(describeChangedActionFields(["title", "description"])).toBe("title and description");
    expect(describeChangedActionFields(["description", "credential"])).toBe("description and credential");
  });

  it("joins three fields with commas and a final 'and'", () => {
    expect(describeChangedActionFields(["title", "description", "credential"])).toBe(
      "title, description and credential",
    );
  });

  it("names nothing for an empty list", () => {
    expect(describeChangedActionFields([])).toBe("");
  });
});
