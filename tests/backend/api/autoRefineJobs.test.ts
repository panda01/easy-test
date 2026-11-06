import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the auto-refine job controller (and its shared lookups) imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  findActionForWebsite: vi.fn(),
  findActionScriptForAction: vi.fn(),
  listAutoRefineJobsForAction: vi.fn(),
  findAutoRefineJobForAction: vi.fn(),
  requestAutoRefineJobStop: vi.fn(),
}));

/** Starting a job is replaced outright: no spec ever runs a plan or calls Claude. */
const mockAutoRefineService = vi.hoisted(() => ({
  startAutoRefineJob: vi.fn(),
}));

/**
 * The execution service is replaced down to the two messages the controller
 * answers with, so loading this spec never touches Playwright or the
 * Anthropic SDK. The strings are test-only: what matters is that the routes
 * answer with THESE exports.
 */
const mockActionScriptExecutionService = vi.hoisted(() => ({
  ACTION_ALREADY_RUNNING_MESSAGE: "This action is already running (test message)",
  EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE:
    "This version was saved from the step editor (test message)",
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/autoRefineService.js", () => mockAutoRefineService);
vi.mock(
  "../../../server/services/actionScriptExecutionService.js",
  () => mockActionScriptExecutionService,
);

import { registerAutoRefineJobRoutes } from "../../../server/controllers/autoRefineJobs.js";

/** Stands in for ACTION_SCRIPT_DIR; no spec writes to it, it is only handed on to the service. */
const ACTION_SCRIPT_DIRECTORY = "/tmp/easy-test-action-scripts-for-this-spec";

/**
 * Builds a minimal app carrying only the auto-refine job routes, mounted the
 * same way server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the auto-refine job routes registered
 */
function createAutoRefineJobsApp(): Express {
  const app = express();
  app.use(express.json());
  registerAutoRefineJobRoutes(app, ACTION_SCRIPT_DIRECTORY);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";
const AUTO_REFINE_JOB_NOT_FOUND_MESSAGE = "Auto-refine job not found";
const AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE =
  "This auto-refine job is not running, so it cannot be stopped";

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove the later queries use the
// FOUND rows' ids, not the raw path parameters.
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const foundAction = {
  id: "action-id-from-db",
  websiteId: foundWebsite.id,
  credentialId: null,
  title: "Log in",
  description: "Click Sign in and log in",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  credential: null,
};
/** A version Claude wrote, so it can be refined. */
const foundScript = {
  id: "script-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  websiteName: foundWebsite.name,
  startUrl: foundWebsite.url,
  actionTitle: foundAction.title,
  actionDescription: foundAction.description,
  credentialId: null,
  credentialName: null,
  summary: "Clicks Sign in",
  assumptions: ["The button is called Sign in"],
  plan: {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [{ action: "click", target: { role: "button", name: "Sign in" }, value: null }],
  },
  contextPageUrls: ["https://example.com/"],
  modelId: "claude-opus-5-5",
  effort: "high",
  editedFromActionScriptId: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
  refinement: null,
  latestRun: null,
};
/** The same version saved from the step editor: no model wrote it. */
const foundEditedScript = { ...foundScript, modelId: null, effort: null };

// Dates are ISO strings because that is how they cross the wire.
const runningJob = {
  id: "auto-refine-job-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  startActionScriptId: foundScript.id,
  currentActionScriptId: foundScript.id,
  status: "running",
  phase: "running",
  refinementsDone: 0,
  maxRefinements: 5,
  parameterValues: {},
  createdActionScriptIds: [],
  actionScriptRunIds: [],
  stopRequestedAt: null,
  errorMessage: null,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  finishedAt: null,
  deletedAt: null,
};
const stoppingJob = { ...runningJob, stopRequestedAt: "2026-01-03T00:01:00.000Z" };
const passedJob = {
  ...runningJob,
  id: "older-auto-refine-job-id-from-db",
  status: "passed",
  phase: null,
  refinementsDone: 1,
  createdActionScriptIds: ["refined-script-id-from-db"],
  actionScriptRunIds: ["run-1-id-from-db", "run-2-id-from-db"],
  currentActionScriptId: "refined-script-id-from-db",
  createdAt: "2026-01-02T00:00:00.000Z",
  finishedAt: "2026-01-02T00:10:00.000Z",
};

const ACTION_PATH = "/api/websites/website-id-from-path/actions/action-id-from-path";
const START_PATH = `${ACTION_PATH}/scripts/script-id-from-path/auto-refine-jobs`;
const JOBS_PATH = `${ACTION_PATH}/auto-refine-jobs`;
const JOB_PATH = `${JOBS_PATH}/auto-refine-job-id-from-path`;
const STOP_PATH = `${JOB_PATH}/stop`;

describe("Auto-refine job routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(foundAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(foundScript);
    mockDbService.findAutoRefineJobForAction.mockResolvedValue(runningJob);
  });

  describe("POST .../scripts/:actionScriptId/auto-refine-jobs", () => {
    it("starts a job from the found version and answers 201 with the running job at once", async () => {
      mockAutoRefineService.startAutoRefineJob.mockResolvedValue({
        started: true,
        job: runningJob,
        // Never resolves: the route must answer without waiting for the loop.
        completion: new Promise<void>(() => undefined),
      });

      const res = await request(createAutoRefineJobsApp())
        .post(START_PATH)
        .send({ parameterValues: { email: "ada@example.com" } });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(runningJob);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-id-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-id-from-path",
      );
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "script-id-from-path",
      );
      expect(mockAutoRefineService.startAutoRefineJob).toHaveBeenCalledWith(
        ACTION_SCRIPT_DIRECTORY,
        { website: foundWebsite, action: foundAction, script: foundScript },
        { email: "ada@example.com" },
      );
    });

    it("starts a job with no values when the body is left out", async () => {
      mockAutoRefineService.startAutoRefineJob.mockResolvedValue({
        started: true,
        job: runningJob,
        completion: new Promise<void>(() => undefined),
      });

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(201);
      expect(mockAutoRefineService.startAutoRefineJob).toHaveBeenCalledWith(
        ACTION_SCRIPT_DIRECTORY,
        { website: foundWebsite, action: foundAction, script: foundScript },
        {},
      );
    });

    it("answers 400 and starts nothing when the parameter values are not an object", async () => {
      const res = await request(createAutoRefineJobsApp())
        .post(START_PATH)
        .send({ parameterValues: "Voyager" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The parameter values must be an object of text values, by key",
      });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockAutoRefineService.startAutoRefineJob).not.toHaveBeenCalled();
    });

    it("answers 404 Website not found and starts nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
      expect(mockAutoRefineService.startAutoRefineJob).not.toHaveBeenCalled();
    });

    it("answers 404 Action not found and starts nothing when the action is not the website's", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
      expect(mockAutoRefineService.startAutoRefineJob).not.toHaveBeenCalled();
    });

    it("answers 404 Script not found and starts nothing when the version is not the action's", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: SCRIPT_NOT_FOUND_MESSAGE });
      expect(mockAutoRefineService.startAutoRefineJob).not.toHaveBeenCalled();
    });

    it("answers 409 and starts nothing when the version was saved from the step editor", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(foundEditedScript);

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: mockActionScriptExecutionService.EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE,
      });
      expect(mockAutoRefineService.startAutoRefineJob).not.toHaveBeenCalled();
    });

    it("answers 409 when the action is already running (a run or another job)", async () => {
      mockAutoRefineService.startAutoRefineJob.mockResolvedValue({
        started: false,
        reason: "actionIsRunning",
      });

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: mockActionScriptExecutionService.ACTION_ALREADY_RUNNING_MESSAGE,
      });
    });

    it("answers 500 with the error's message when the job cannot be created", async () => {
      mockAutoRefineService.startAutoRefineJob.mockRejectedValue(
        new Error("database connection lost"),
      );

      const res = await request(createAutoRefineJobsApp()).post(START_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "database connection lost" });
    });
  });

  describe("GET .../auto-refine-jobs", () => {
    it("lists the found action's jobs as the service orders them (newest first)", async () => {
      mockDbService.listAutoRefineJobsForAction.mockResolvedValue([runningJob, passedJob]);

      const res = await request(createAutoRefineJobsApp()).get(JOBS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([runningJob, passedJob]);
      expect(mockDbService.listAutoRefineJobsForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
      );
    });

    it("answers 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).get(JOBS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listAutoRefineJobsForAction).not.toHaveBeenCalled();
    });

    it("answers 404 Action not found when the action is not the website's", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).get(JOBS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockDbService.listAutoRefineJobsForAction).not.toHaveBeenCalled();
    });

    it("answers 500 with the error's message when the query fails", async () => {
      mockDbService.listAutoRefineJobsForAction.mockRejectedValue(new Error("query timed out"));

      const res = await request(createAutoRefineJobsApp()).get(JOBS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("GET .../auto-refine-jobs/:autoRefineJobId", () => {
    it("answers the job found under the found website and action", async () => {
      const res = await request(createAutoRefineJobsApp()).get(JOB_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(runningJob);
      expect(mockDbService.findAutoRefineJobForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "auto-refine-job-id-from-path",
      );
    });

    it("answers 404 Auto-refine job not found when the job is not the action's", async () => {
      mockDbService.findAutoRefineJobForAction.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).get(JOB_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
    });

    it("answers 404 Action not found when the action is not the website's", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).get(JOB_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockDbService.findAutoRefineJobForAction).not.toHaveBeenCalled();
    });

    it("answers 500 with the error's message when the query fails", async () => {
      mockDbService.findAutoRefineJobForAction.mockRejectedValue(new Error("query timed out"));

      const res = await request(createAutoRefineJobsApp()).get(JOB_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("POST .../auto-refine-jobs/:autoRefineJobId/stop", () => {
    it("records the stop request on the found job and answers 200 with stopRequestedAt set", async () => {
      mockDbService.findAutoRefineJobForAction
        .mockResolvedValueOnce(runningJob)
        .mockResolvedValueOnce(stoppingJob);
      mockDbService.requestAutoRefineJobStop.mockResolvedValue(true);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(stoppingJob);
      expect(res.body.stopRequestedAt).toBe("2026-01-03T00:01:00.000Z");
      expect(mockDbService.requestAutoRefineJobStop).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        runningJob.id,
      );
      // The job is read twice: once to check it is running, once to answer with the stop recorded.
      expect(mockDbService.findAutoRefineJobForAction).toHaveBeenCalledTimes(2);
      expect(mockDbService.findAutoRefineJobForAction).toHaveBeenNthCalledWith(
        1,
        foundWebsite.id,
        foundAction.id,
        "auto-refine-job-id-from-path",
      );
      expect(mockDbService.findAutoRefineJobForAction).toHaveBeenNthCalledWith(
        2,
        foundWebsite.id,
        foundAction.id,
        runningJob.id,
      );
    });

    it("answers 409 and writes nothing when the job has already ended", async () => {
      mockDbService.findAutoRefineJobForAction.mockResolvedValue(passedJob);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE });
      expect(mockDbService.requestAutoRefineJobStop).not.toHaveBeenCalled();
    });

    it("answers 409 when the job ended between the read and the write (the conditional write matched no row)", async () => {
      mockDbService.requestAutoRefineJobStop.mockResolvedValue(false);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE });
      expect(mockDbService.findAutoRefineJobForAction).toHaveBeenCalledTimes(1);
    });

    it("answers 404 Auto-refine job not found when the job is not the action's", async () => {
      mockDbService.findAutoRefineJobForAction.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
      expect(mockDbService.requestAutoRefineJobStop).not.toHaveBeenCalled();
    });

    it("answers 404 Auto-refine job not found when the job was deleted right after the stop was recorded", async () => {
      mockDbService.findAutoRefineJobForAction
        .mockResolvedValueOnce(runningJob)
        .mockResolvedValueOnce(null);
      mockDbService.requestAutoRefineJobStop.mockResolvedValue(true);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
    });

    it("answers 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findAutoRefineJobForAction).not.toHaveBeenCalled();
    });

    it("answers 500 with the error's message when the write fails", async () => {
      mockDbService.requestAutoRefineJobStop.mockRejectedValue(new Error("query timed out"));

      const res = await request(createAutoRefineJobsApp()).post(STOP_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });
});
