import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import type { WebsiteLoginConversion } from "../../../server/services/dbService.js";

/**
 * The conversion itself (`convertLoginsToOneLoginActionPerWebsite`) is
 * replaced: its query shapes are covered by the dbService spec, and this spec
 * is about what the command-line script prints and which exit code it
 * leaves. `bootEnv` is replaced by an empty module so loading the script does
 * not read the project's `.env` files into this test process.
 */
const mockDbService = vi.hoisted(() => ({
  convertLoginsToOneLoginActionPerWebsite: vi.fn(),
}));

vi.mock("../../../server/bootEnv.js", () => ({}));
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import {
  describeWebsiteLoginConversion,
  runLoginMigration,
} from "../../../server/scripts/migrateLoginsToLoginActions.js";

// Read right after the import ran the script's module body, before any
// `beforeEach` resets the mock's call history: under vitest the script was
// not run directly, so it must not have converted anything on load.
const conversionCallsAtImport = mockDbService.convertLoginsToOneLoginActionPerWebsite.mock.calls.length;

/** What the message says when no website logs in. */
const NOTHING_TO_CONVERT_MESSAGE =
  "[login migration] no website has a credential or a login action - nothing to convert";

/** A website that had no Login action (logins were on its credentials), so "Log in" was made. */
const createdConversion: WebsiteLoginConversion = {
  websiteId: "website-1",
  websiteName: "Forge",
  loginActionId: "login-action-new",
  loginActionWasCreated: true,
  mergedLoginActionCount: 0,
  restoredCredentialActionCount: 0,
};

/** A website from the earlier design: its oldest Login action was kept, two merged into it, three actions given their credential back. */
const mergedConversion: WebsiteLoginConversion = {
  websiteId: "website-2",
  websiteName: "Atlas",
  loginActionId: "login-action-kept",
  loginActionWasCreated: false,
  mergedLoginActionCount: 2,
  restoredCredentialActionCount: 3,
};

/** The exit code before each test, restored after it so a failure test cannot fail the test run. */
let exitCodeBeforeTest: typeof process.exitCode;

beforeEach(() => {
  vi.resetAllMocks();
  exitCodeBeforeTest = process.exitCode;
});

afterEach(() => {
  process.exitCode = exitCodeBeforeTest;
  vi.restoreAllMocks();
});

describe("the login migration script", () => {
  it("converts nothing when it is only imported, not run from the command line", () => {
    expect(conversionCallsAtImport).toBe(0);
  });

  it("converts, then exits, when it is run from the command line (`npx tsx server/scripts/migrateLoginsToLoginActions.ts`)", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    mockDbService.convertLoginsToOneLoginActionPerWebsite.mockResolvedValue([]);
    const scriptPath = fileURLToPath(new URL("../../../server/scripts/migrateLoginsToLoginActions.ts", import.meta.url));
    const argumentsBeforeTest = process.argv;
    // The script's own path as the first argument after node is how it
    // knows it was run directly; a fresh module registry loads it again.
    process.argv = [argumentsBeforeTest[0], scriptPath];
    vi.resetModules();

    try {
      await import("../../../server/scripts/migrateLoginsToLoginActions.js");
    } finally {
      process.argv = argumentsBeforeTest;
    }

    expect(mockDbService.convertLoginsToOneLoginActionPerWebsite).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(NOTHING_TO_CONVERT_MESSAGE);
    expect(processExitSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith();
  });
});

describe("describeWebsiteLoginConversion", () => {
  it("names the website, the Login action it created, and how many were merged and given their credential back", () => {
    expect(describeWebsiteLoginConversion(createdConversion)).toBe(
      '"Forge": created login action login-action-new; 0 merged into it; 0 action(s) given their credential back',
    );
  });

  it("says when the website's Login action was kept, with what was merged into it", () => {
    expect(describeWebsiteLoginConversion(mergedConversion)).toBe(
      '"Atlas": kept login action login-action-kept; 2 merged into it; 3 action(s) given their credential back',
    );
  });
});

describe("runLoginMigration", () => {
  it("prints one line per website and leaves the exit code alone when the conversion succeeds", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.convertLoginsToOneLoginActionPerWebsite.mockResolvedValue([createdConversion, mergedConversion]);

    await runLoginMigration();

    expect(mockDbService.convertLoginsToOneLoginActionPerWebsite).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy.mock.calls).toEqual([
      ['[login migration] "Forge": created login action login-action-new; 0 merged into it; 0 action(s) given their credential back'],
      ['[login migration] "Atlas": kept login action login-action-kept; 2 merged into it; 3 action(s) given their credential back'],
    ]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCodeBeforeTest);
  });

  it("says there is nothing to convert when no website has a credential or a Login action", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.convertLoginsToOneLoginActionPerWebsite.mockResolvedValue([]);

    await runLoginMigration();

    expect(consoleLogSpy.mock.calls).toEqual([[NOTHING_TO_CONVERT_MESSAGE]]);
    expect(process.exitCode).toBe(exitCodeBeforeTest);
  });

  it("prints the failure and sets a non-zero exit code instead of rejecting when the conversion fails", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.convertLoginsToOneLoginActionPerWebsite.mockRejectedValue(new Error("deadlock detected"));

    await expect(runLoginMigration()).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith("[login migration] failed: deadlock detected");
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
