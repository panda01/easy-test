import { describe, it, expect } from "vitest";
import { describeActionLoginShort, isLoginActionRecord } from "../../src/utils/describeActionLogin";

/** The Admin credential, as an action read names it. */
const ADMIN_CREDENTIAL = { id: "credential-1", name: "Admin" };

describe("isLoginActionRecord", () => {
  it("is true only for an action whose kind the user set to Login", () => {
    expect(isLoginActionRecord({ userActionKind: "login" })).toBe(true);
    expect(isLoginActionRecord({ userActionKind: "parameters" })).toBe(false);
    expect(isLoginActionRecord({ userActionKind: "create" })).toBe(false);
    expect(isLoginActionRecord({ userActionKind: null })).toBe(false);
    expect(isLoginActionRecord({})).toBe(false);
  });
});

describe("describeActionLoginShort", () => {
  it.each([
    {
      label: "the Login action",
      action: { userActionKind: "login" as const, credential: null },
      expected: "Login",
    },
    {
      label: "the Login action, even with a stray credential",
      action: { userActionKind: "login" as const, credential: ADMIN_CREDENTIAL },
      expected: "Login",
    },
    {
      label: "another action that runs as a credential",
      action: { userActionKind: "read" as const, credential: ADMIN_CREDENTIAL },
      expected: "As Admin",
    },
    {
      label: "an action of a detected kind that runs as a credential",
      action: { userActionKind: null, credential: { id: "credential-2", name: "Editor" } },
      expected: "As Editor",
    },
    {
      label: "another action that runs logged out",
      action: { userActionKind: "delete" as const, credential: null },
      expected: "Logged out",
    },
    {
      label: "an action read without any login fields",
      action: {},
      expected: "Logged out",
    },
  ])("words $label as '$expected'", ({ action, expected }) => {
    expect(describeActionLoginShort(action)).toBe(expected);
  });
});
