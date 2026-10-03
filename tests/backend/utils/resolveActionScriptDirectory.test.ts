import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { resolveActionScriptDirectory } from "../../../server/utils/resolveActionScriptDirectory.js";

const originalActionScriptDirectory = process.env.ACTION_SCRIPT_DIR;

afterEach(() => {
  if (originalActionScriptDirectory === undefined) {
    delete process.env.ACTION_SCRIPT_DIR;
  } else {
    process.env.ACTION_SCRIPT_DIR = originalActionScriptDirectory;
  }
});

describe("resolveActionScriptDirectory", () => {
  it("resolves a relative value inside the project root", () => {
    process.env.ACTION_SCRIPT_DIR = "action-scripts";
    expect(resolveActionScriptDirectory()).toBe(path.join(process.cwd(), "action-scripts"));
  });

  it("accepts an absolute path that is inside the project root", () => {
    const insideTheProject = path.join(process.cwd(), "data", "runs");
    process.env.ACTION_SCRIPT_DIR = insideTheProject;
    expect(resolveActionScriptDirectory()).toBe(insideTheProject);
  });

  it("accepts a folder whose name merely starts with two dots", () => {
    process.env.ACTION_SCRIPT_DIR = "..runs";
    expect(resolveActionScriptDirectory()).toBe(path.join(process.cwd(), "..runs"));
  });

  it("throws for a folder outside the project, because generated scripts could not import playwright", () => {
    process.env.ACTION_SCRIPT_DIR = "/var/tmp/action-scripts";
    expect(() => resolveActionScriptDirectory()).toThrow(
      /ACTION_SCRIPT_DIR must be a folder inside the project .*import 'playwright'/,
    );
  });

  it("throws for a relative path that climbs out of the project", () => {
    process.env.ACTION_SCRIPT_DIR = "../action-scripts";
    expect(() => resolveActionScriptDirectory()).toThrow(/must be a folder inside the project/);
  });

  it("throws for the project root itself", () => {
    process.env.ACTION_SCRIPT_DIR = ".";
    expect(() => resolveActionScriptDirectory()).toThrow(/must be a folder inside the project/);
  });

  it("throws when ACTION_SCRIPT_DIR is missing", () => {
    delete process.env.ACTION_SCRIPT_DIR;
    expect(() => resolveActionScriptDirectory()).toThrow(/ACTION_SCRIPT_DIR is not defined/);
  });
});
