import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { resolveScreenshotDirectory } from "../../../server/utils/resolveScreenshotDirectory.js";

const originalScreenshotDirectory = process.env.SCREENSHOT_DIR;

afterEach(() => {
  if (originalScreenshotDirectory === undefined) {
    delete process.env.SCREENSHOT_DIR;
  } else {
    process.env.SCREENSHOT_DIR = originalScreenshotDirectory;
  }
});

describe("resolveScreenshotDirectory", () => {
  it("resolves a relative value against the project root (the working directory)", () => {
    process.env.SCREENSHOT_DIR = "screenshots";
    expect(resolveScreenshotDirectory()).toBe(path.join(process.cwd(), "screenshots"));
  });

  it("resolves a nested relative value and trims surrounding whitespace", () => {
    process.env.SCREENSHOT_DIR = "  data/screenshots  ";
    expect(resolveScreenshotDirectory()).toBe(path.join(process.cwd(), "data", "screenshots"));
  });

  it("returns an absolute value as is, normalized", () => {
    process.env.SCREENSHOT_DIR = "/var/tmp/easy-test//shots/";
    expect(resolveScreenshotDirectory()).toBe("/var/tmp/easy-test/shots");
  });

  it("throws when SCREENSHOT_DIR is missing", () => {
    delete process.env.SCREENSHOT_DIR;
    expect(() => resolveScreenshotDirectory()).toThrow(/SCREENSHOT_DIR is not defined/);
  });

  it("throws when SCREENSHOT_DIR is empty", () => {
    process.env.SCREENSHOT_DIR = "";
    expect(() => resolveScreenshotDirectory()).toThrow(/SCREENSHOT_DIR is not defined/);
  });

  it("throws when SCREENSHOT_DIR is only whitespace", () => {
    process.env.SCREENSHOT_DIR = "   ";
    expect(() => resolveScreenshotDirectory()).toThrow(/SCREENSHOT_DIR is not defined/);
  });
});
