import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the action script controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  findActionForWebsite: vi.fn(),
  listActionScriptsForAction: vi.fn(),
  findActionScriptForAction: vi.fn(),
  createActionScriptForAction: vi.fn(),
  listActionScriptRunsForScript: vi.fn(),
  findActionScriptRunForScript: vi.fn(),
  createActionScriptRunForScript: vi.fn(),
}));

/** Claude is replaced outright: no spec ever calls the Anthropic API. */
const mockScriptGenerationService = vi.hoisted(() => ({
  convertActionToScript: vi.fn(),
}));

/** Running is replaced outright: no spec ever starts node or a browser. */
const mockScriptRunnerService = vi.hoisted(() => ({
  FAILURE_SCREENSHOT_FILE_NAME: "failure.png",
  runPlaywrightScript: vi.fn(),
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/scriptGenerationService.js", () => mockScriptGenerationService);
vi.mock("../../../server/services/scriptRunnerService.js", () => mockScriptRunnerService);

import { registerActionScriptRoutes } from "../../../server/controllers/actionScripts.js";

/**
 * A committed directory standing in for ACTION_SCRIPT_DIR. It holds one real
 * PNG at `website-id-from-db/existing-run/failure.png`, so the failure
 * screenshot route is exercised through the real `res.sendFile`.
 */
const FIXTURE_ACTION_SCRIPT_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "action-script-files",
);
const EXISTING_FAILURE_SCREENSHOT_NAME = "website-id-from-db/existing-run/failure.png";
const EXISTING_FAILURE_SCREENSHOT_BYTES = readFileSync(
  path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, EXISTING_FAILURE_SCREENSHOT_NAME),
);

/**
 * Builds a minimal app carrying only the action script routes, mounted the
 * same way server.ts mounts them, with the fixture directory as the action
 * script directory.
 * @returns An app with JSON body parsing and the action script routes registered
 */
function createActionScriptsApp(): Express {
  const app = express();
  app.use(express.json());
  registerActionScriptRoutes(app, FIXTURE_ACTION_SCRIPT_DIRECTORY);
  return app;
}

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove later queries use the FOUND
// rows' ids, not the raw path parameters.
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 5000,
  screenshotMinimumWaitMs: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const foundAction = {
  id: "action-id-from-db",
  websiteId: foundWebsite.id,
  title: "Log in",
  description: "Click Sign in and log in",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const foundScript = {
  id: "script-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  websiteName: foundWebsite.name,
  startUrl: foundWebsite.url,
  actionTitle: foundAction.title,
  actionDescription: foundAction.description,
  summary: "Logs in",
  assumptions: [],
  code: "import { chromium } from 'playwright';\n",
  ruleViolations: [],
  modelId: "claude-opus-5-5",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};
const sampleRun = {
  id: "run-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  actionScriptId: foundScript.id,
  succeeded: false,
  exitCode: 1,
  exitSignal: null,
  timedOut: false,
  output: "✘ Stopped: Timeout",
  outputWasTruncated: false,
  failureScreenshotFileName: EXISTING_FAILURE_SCREENSHOT_NAME,
  durationMs: 4200,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
};

const SCRIPTS_PATH = "/api/websites/website-id-from-path/actions/action-id-from-path/scripts";
const RUNS_PATH = `${SCRIPTS_PATH}/script-id-from-path/runs`;
const FAILURE_SCREENSHOT_PATH = `${RUNS_PATH}/run-id-from-path/failure-screenshot`;

/** A run folder is `<found website id>/<uuid>`. */
const RUN_FOLDER_NAME_PATTERN = /^website-id-from-db\/[0-9a-f-]{36}$/;

/** What `convertActionToScript` returns for a clean conversion. */
const cleanConversion = {
  summary: "Logs in",
  assumptions: ["The button is called Sign in"],
  code: "import { chromium } from 'playwright';\nawait page.getByRole('button').click();\n",
  modelId: "claude-opus-5-5",
};

/** What `runPlaywrightScript` reports for a passing run. */
const passingRunResult = {
  succeeded: true,
  exitCode: 0,
  exitSignal: null,
  timedOut: false,
  output: "▶ Open the site\n✔ Use case completed\n",
  outputWasTruncated: false,
  failureScreenshotWasCaptured: false,
  durationMs: 3100,
};

/**
 * Builds the error `convertActionToScript` throws for a known failure, shaped
 * like `ScriptGenerationError` (the controller recognizes it structurally).
 * @param reason - The failure reason
 * @param message - The human-readable message
 * @returns An Error carrying `name` and `reason`
 */
function buildScriptGenerationError(reason: string, message: string): Error {
  return Object.assign(new Error(message), { name: "ScriptGenerationError", reason });
}

/**
 * Reads the run folder the controller asked the runner to use, relative to
 * the fixture directory and with `/` separators.
 * @returns The run folder name
 */
function readRequestedRunFolderName(): string {
  const [, runDirectory] = mockScriptRunnerService.runPlaywrightScript.mock.calls[0] as [
    string,
    string,
  ];
  return path.relative(FIXTURE_ACTION_SCRIPT_DIRECTORY, runDirectory).split(path.sep).join("/");
}

describe("Action script routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks its parents first; they exist unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(foundAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(foundScript);
  });

  describe("GET /api/websites/:websiteId/actions/:actionId/scripts", () => {
    it("returns 200 with the action's scripts, looked up under the found website and action", async () => {
      mockDbService.listActionScriptsForAction.mockResolvedValue([foundScript]);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([foundScript]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-id-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-id-from-path",
      );
      expect(mockDbService.listActionScriptsForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
      );
    });

    it("returns 404 Website not found and looks up no action when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and lists nothing when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.listActionScriptsForAction).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listActionScriptsForAction.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/scripts", () => {
    it("converts the found action, scans the code, saves the snapshots, and returns 201", async () => {
      mockScriptGenerationService.convertActionToScript.mockResolvedValue(cleanConversion);
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(foundScript);
      expect(mockScriptGenerationService.convertActionToScript).toHaveBeenCalledWith({
        websiteName: foundWebsite.name,
        startUrl: foundWebsite.url,
        actionTitle: foundAction.title,
        actionDescription: foundAction.description,
      });
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        {
          websiteName: foundWebsite.name,
          startUrl: foundWebsite.url,
          actionTitle: foundAction.title,
          actionDescription: foundAction.description,
          summary: cleanConversion.summary,
          assumptions: cleanConversion.assumptions,
          code: cleanConversion.code,
          ruleViolations: [],
          modelId: cleanConversion.modelId,
        },
      );
    });

    it("still saves a script that breaks rules, storing the violations as warnings", async () => {
      mockScriptGenerationService.convertActionToScript.mockResolvedValue({
        ...cleanConversion,
        code: "import { chromium } from 'playwright';\nawait page.getByLabel('Email').fill('a');\n",
      });
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(201);
      const [, , savedScript] = mockDbService.createActionScriptForAction.mock.calls[0] as [
        string,
        string,
        { ruleViolations: string[] },
      ];
      expect(savedScript.ruleViolations).toEqual([
        "Line 2: .fill( - sets a whole value at once; type with pressSequentially",
      ]);
    });

    it("returns 404 Action not found and converts nothing when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockScriptGenerationService.convertActionToScript).not.toHaveBeenCalled();
    });

    it("returns 503 and saves nothing when the API key is not configured", async () => {
      mockScriptGenerationService.convertActionToScript.mockRejectedValue(
        buildScriptGenerationError("missingApiKey", "ANTHROPIC_API_KEY is not set"),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "ANTHROPIC_API_KEY is not set" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it.each(["refused", "truncated", "unparseable"])(
      "returns 502 and saves nothing when Claude's reply is unusable (%s)",
      async (reason) => {
        mockScriptGenerationService.convertActionToScript.mockRejectedValue(
          buildScriptGenerationError(reason, `Claude failed: ${reason}`),
        );

        const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error: `Claude failed: ${reason}` });
        expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
      },
    );

    it("returns 500 for an error with an unknown reason", async () => {
      mockScriptGenerationService.convertActionToScript.mockRejectedValue(
        buildScriptGenerationError("somethingNew", "odd failure"),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "odd failure" });
    });

    it("returns 500 for an API error that only happens to carry a reason", async () => {
      mockScriptGenerationService.convertActionToScript.mockRejectedValue(
        Object.assign(new Error("rate limited"), { reason: "refused" }),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "rate limited" });
    });

    it("returns 500 with the stringified value when the conversion rejects with a non-Error", async () => {
      mockScriptGenerationService.convertActionToScript.mockRejectedValue("socket hang up");

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "socket hang up" });
    });
  });

  describe("GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs", () => {
    it("returns 200 with the script's runs, looked up under the found rows", async () => {
      mockDbService.listActionScriptRunsForScript.mockResolvedValue([sampleRun]);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleRun]);
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "script-id-from-path",
      );
      expect(mockDbService.listActionScriptRunsForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
      );
    });

    it("returns 404 Website not found before looking up the action or script", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Script not found when the script does not exist or belongs to another action", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script not found" });
      expect(mockDbService.listActionScriptRunsForScript).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.findActionScriptForAction.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs", () => {
    it("runs the stored code in a new folder under the found website and returns 201 with the run", async () => {
      mockScriptRunnerService.runPlaywrightScript.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleRun);
      expect(mockScriptRunnerService.runPlaywrightScript).toHaveBeenCalledWith(
        foundScript.code,
        expect.any(String),
      );
      expect(readRequestedRunFolderName()).toMatch(RUN_FOLDER_NAME_PATTERN);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        {
          succeeded: true,
          exitCode: 0,
          exitSignal: null,
          timedOut: false,
          output: passingRunResult.output,
          outputWasTruncated: false,
          failureScreenshotFileName: null,
          durationMs: 3100,
        },
      );
    });

    it("records a failed run's screenshot relative to the action script directory, and still answers 201", async () => {
      mockScriptRunnerService.runPlaywrightScript.mockResolvedValue({
        ...passingRunResult,
        succeeded: false,
        exitCode: 1,
        failureScreenshotWasCaptured: true,
      });
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      const [, , , recordedRun] = mockDbService.createActionScriptRunForScript.mock.calls[0] as [
        string,
        string,
        string,
        { succeeded: boolean; failureScreenshotFileName: string },
      ];
      expect(recordedRun.succeeded).toBe(false);
      expect(recordedRun.failureScreenshotFileName).toBe(
        `${readRequestedRunFolderName()}/failure.png`,
      );
    });

    it("records a timed-out run that was stopped by a signal, and still answers 201", async () => {
      mockScriptRunnerService.runPlaywrightScript.mockResolvedValue({
        ...passingRunResult,
        succeeded: false,
        exitCode: null,
        exitSignal: "SIGTERM",
        timedOut: true,
      });
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      const [, , , recordedRun] = mockDbService.createActionScriptRunForScript.mock.calls[0] as [
        string,
        string,
        string,
        { exitCode: number | null; exitSignal: string | null; timedOut: boolean },
      ];
      expect(recordedRun).toMatchObject({ exitCode: null, exitSignal: "SIGTERM", timedOut: true });
    });

    it("gives every run its own folder", async () => {
      mockScriptRunnerService.runPlaywrightScript.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      await request(createActionScriptsApp()).post(RUNS_PATH);
      await request(createActionScriptsApp()).post(RUNS_PATH);

      const [[, firstRunDirectory], [, secondRunDirectory]] = mockScriptRunnerService
        .runPlaywrightScript.mock.calls as [[string, string], [string, string]];
      expect(firstRunDirectory).not.toBe(secondRunDirectory);
    });

    it("returns 404 Script not found and runs nothing when the script does not exist", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script not found" });
      expect(mockScriptRunnerService.runPlaywrightScript).not.toHaveBeenCalled();
    });

    it("returns 500 and records nothing when node cannot be started", async () => {
      mockScriptRunnerService.runPlaywrightScript.mockRejectedValue(new Error("spawn ENOENT"));

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "spawn ENOENT" });
      expect(mockDbService.createActionScriptRunForScript).not.toHaveBeenCalled();
    });
  });

  describe("GET .../runs/:actionScriptRunId/failure-screenshot", () => {
    it("returns 200 with the PNG bytes, looking the run up under the found rows", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(res.body as Buffer, EXISTING_FAILURE_SCREENSHOT_BYTES)).toBe(0);
      expect(mockDbService.findActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        "run-id-from-path",
      );
    });

    it("returns 404 Action not found and looks up no run when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.findActionScriptRunForScript).not.toHaveBeenCalled();
    });

    it("returns 404 Script run not found when the run does not exist", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script run not found" });
    });

    it("returns 404 when the run wrote no failure screenshot", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: null,
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "This run did not capture a failure screenshot" });
    });

    it("returns 404 Failure screenshot file not found when the file is gone from disk", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "website-id-from-db/deleted-run/failure.png",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Failure screenshot file not found" });
    });

    it("refuses a stored name that climbs out of the action script directory, serving no file", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "../action-script-files/website-id-from-db/existing-run/failure.png",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 500 with the send error when the stored name is not a readable file", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "website-id-from-db",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "EISDIR, read" });
    });

    it("returns 500 with the stringified value when the run lookup rejects with a non-Error", async () => {
      mockDbService.findActionScriptRunForScript.mockRejectedValue({ code: "P1001" });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });
});
