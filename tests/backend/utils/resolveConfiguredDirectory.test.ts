import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { resolveConfiguredDirectory } from "../../../server/utils/resolveConfiguredDirectory.js";

const VARIABLE_NAME = "EASY_TEST_SPEC_DIRECTORY";

afterEach(() => {
  delete process.env[VARIABLE_NAME];
});

describe("resolveConfiguredDirectory", () => {
  it("reads the named variable and resolves a relative value against the project root", () => {
    process.env[VARIABLE_NAME] = "some/folder";
    expect(resolveConfiguredDirectory(VARIABLE_NAME)).toBe(
      path.join(process.cwd(), "some", "folder"),
    );
  });

  it("trims surrounding whitespace", () => {
    process.env[VARIABLE_NAME] = "  folder  ";
    expect(resolveConfiguredDirectory(VARIABLE_NAME)).toBe(path.join(process.cwd(), "folder"));
  });

  it("returns an absolute value as is, normalized", () => {
    process.env[VARIABLE_NAME] = "/var/tmp//easy-test/";
    expect(resolveConfiguredDirectory(VARIABLE_NAME)).toBe("/var/tmp/easy-test");
  });

  it("names the missing variable in its error", () => {
    expect(() => resolveConfiguredDirectory(VARIABLE_NAME)).toThrow(
      "EASY_TEST_SPEC_DIRECTORY is not defined in environment variables",
    );
  });

  it("treats an empty or whitespace-only value as missing", () => {
    process.env[VARIABLE_NAME] = "   ";
    expect(() => resolveConfiguredDirectory(VARIABLE_NAME)).toThrow(/is not defined/);
  });
});
