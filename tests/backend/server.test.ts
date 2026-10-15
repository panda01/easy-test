import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import path from "node:path";

/**
 * server.ts registers the website, use case, action, Playwright, action
 * script, crawl run, and credential controllers, and each of them imports dbService - whose module body
 * constructs a real PrismaClient. Every exported dbService function is
 * replaced so loading the full app never builds a client, and the wiring
 * tests below can choose what a query returns.
 */
const mockDbService = vi.hoisted(() => ({
  isUniqueConstraintViolation: vi.fn(),
  isRecordNotFound: vi.fn(),
  createWebsite: vi.fn(),
  listWebsitesWithSummaries: vi.fn(),
  findWebsiteByUrl: vi.fn(),
  findWebsiteById: vi.fn(),
  updateWebsite: vi.fn(),
  softDeleteWebsite: vi.fn(),
  listUseCasesForWebsite: vi.fn(),
  findUseCaseForWebsite: vi.fn(),
  createUseCaseForWebsite: vi.fn(),
  updateUseCaseForWebsite: vi.fn(),
  softDeleteUseCaseForWebsite: vi.fn(),
  listActionsForWebsite: vi.fn(),
  findActionForWebsite: vi.fn(),
  createActionForWebsite: vi.fn(),
  updateActionForWebsite: vi.fn(),
  softDeleteActionForWebsite: vi.fn(),
  listScreenshotRunsForWebsite: vi.fn(),
  findScreenshotRunForWebsite: vi.fn(),
  createScreenshotRunForWebsite: vi.fn(),
  listActionScriptsForAction: vi.fn(),
  findActionScriptForAction: vi.fn(),
  createActionScriptForAction: vi.fn(),
  createRefinedActionScriptForAction: vi.fn(),
  listActionScriptRunsForScript: vi.fn(),
  findActionScriptRunForScript: vi.fn(),
  createActionScriptRunForScript: vi.fn(),
  listCrawlRunsForWebsite: vi.fn(),
  findCrawlRunForWebsite: vi.fn(),
  createCrawlRunForWebsite: vi.fn(),
  recordCrawledPage: vi.fn(),
  finishCrawlRun: vi.fn(),
  markRunningCrawlRunsInterrupted: vi.fn(),
  listCrawledPageSummariesForRun: vi.fn(),
  findCrawledPageForRun: vi.fn(),
  markCrawlRunLoggedIn: vi.fn(),
  listCredentialsForWebsite: vi.fn(),
  findCredentialForWebsite: vi.fn(),
  findCredentialWithPasswordForWebsite: vi.fn(),
  createCredentialForWebsite: vi.fn(),
  updateCredentialForWebsite: vi.fn(),
  softDeleteCredentialForWebsite: vi.fn(),
  findLatestCrawledPagesForWebsite: vi.fn(),
}));

/** The Playwright service is replaced so loading the full app can never launch a browser. */
const mockPlaywrightService = vi.hoisted(() => ({
  captureWebsiteScreenshot: vi.fn(),
}));

/** Claude is replaced so loading the full app can never call the Anthropic API. */
const mockScriptGenerationService = vi.hoisted(() => ({
  convertActionToPlan: vi.fn(),
  refineActionPlan: vi.fn(),
}));

/** The model catalog is replaced so loading the full app can never call the Models API. */
const mockScriptModelService = vi.hoisted(() => ({
  listScriptModels: vi.fn(),
  findScriptModel: vi.fn(),
  chooseDefaultScriptModel: vi.fn(),
  chooseEffortForModel: vi.fn(),
}));

/** The plan runner is replaced so loading the full app can never launch a browser. */
const mockActionPlanRunnerService = vi.hoisted(() => ({
  FAILURE_SCREENSHOT_FILE_NAME: "failure.png",
  runActionPlan: vi.fn(),
}));

/** Crawling is replaced so loading the full app can never start a crawl or touch crawl runs at boot. */
const mockCrawlRunService = vi.hoisted(() => ({
  startCrawlRun: vi.fn(),
  markUnfinishedCrawlRunsInterrupted: vi.fn(),
}));

vi.mock("../../server/services/dbService.js", () => mockDbService);
vi.mock("../../server/services/crawlRunService.js", () => mockCrawlRunService);
vi.mock("../../server/services/playwrightService.js", () => mockPlaywrightService);
vi.mock("../../server/services/scriptGenerationService.js", () => mockScriptGenerationService);
vi.mock("../../server/services/actionPlanRunnerService.js", () => mockActionPlanRunnerService);
vi.mock("../../server/services/scriptModelService.js", () => mockScriptModelService);

import {
  app,
  startListening,
  serveBuiltClientFiles,
  serveClientRoutesFromIndexHtml,
} from "../../server/server.js";
import { resolveActionScriptDirectory } from "../../server/utils/resolveActionScriptDirectory.js";
import { resolveScreenshotDirectory } from "../../server/utils/resolveScreenshotDirectory.js";

// Read right after the import ran server.ts's module body, before any
// `beforeEach` resets the mocks' call history.
const interruptedMarkCallsAtImport =
  mockCrawlRunService.markUnfinishedCrawlRunsInterrupted.mock.calls.length;

// Dates are ISO strings because that is how they cross the wire.
const sampleWebsite = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 5000,
  screenshotMinimumWaitMs: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const sampleUseCase = {
  id: "use-case-1",
  websiteId: sampleWebsite.id,
  title: "Sign up",
  description: "Create an account",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

const sampleAction = {
  id: "action-1",
  websiteId: sampleWebsite.id,
  credentialId: null,
  title: "Log in",
  description: "Enter credentials and submit",
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
  credential: null,
};

const sampleScreenshotRun = {
  id: "screenshot-run-1",
  websiteId: sampleWebsite.id,
  requestedUrl: sampleWebsite.url,
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  screenshotFileName: "website-1/run.png",
  durationMs: 840,
  createdAt: "2026-01-04T00:00:00.000Z",
  updatedAt: "2026-01-04T00:00:00.000Z",
  deletedAt: null,
};

describe("server.ts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("serves /api/health through the fully wired app", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("parses a JSON body (express.json is mounted before the routes)", async () => {
    const res = await request(app).post("/api/health").send({ hello: "world" });
    // No POST handler is registered, so express falls through to its 404.
    // What this proves is that express.json() did not blow up on the body.
    expect(res.status).toBe(404);
  });

  it("wires the website routes into the full app", async () => {
    mockDbService.listWebsitesWithSummaries.mockResolvedValue([sampleWebsite]);

    const res = await request(app).get("/api/websites");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleWebsite]);
    expect(mockDbService.listWebsitesWithSummaries).toHaveBeenCalledTimes(1);
  });

  it("wires the use case routes into the full app", async () => {
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.listUseCasesForWebsite.mockResolvedValue([sampleUseCase]);

    const res = await request(app).get(`/api/websites/${sampleWebsite.id}/use-cases`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleUseCase]);
    expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(sampleWebsite.id);
    expect(mockDbService.listUseCasesForWebsite).toHaveBeenCalledWith(sampleWebsite.id);
  });

  it("wires the action routes into the full app", async () => {
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.listActionsForWebsite.mockResolvedValue([sampleAction]);

    const res = await request(app).get(`/api/websites/${sampleWebsite.id}/actions`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleAction]);
    expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(sampleWebsite.id);
    expect(mockDbService.listActionsForWebsite).toHaveBeenCalledWith(sampleWebsite.id);
  });

  it("wires the Playwright screenshot run routes into the full app", async () => {
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.listScreenshotRunsForWebsite.mockResolvedValue([sampleScreenshotRun]);

    const res = await request(app).get(`/api/websites/${sampleWebsite.id}/screenshot-runs`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleScreenshotRun]);
    expect(mockDbService.listScreenshotRunsForWebsite).toHaveBeenCalledWith(sampleWebsite.id);
  });

  it("hands the Playwright routes the screenshot directory resolved from SCREENSHOT_DIR at boot", async () => {
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue({
      succeeded: true,
      httpStatus: 200,
      errorMessage: null,
      screenshotWasCaptured: true,
      durationMs: 840,
    });
    mockDbService.createScreenshotRunForWebsite.mockResolvedValue(sampleScreenshotRun);

    const res = await request(app).post(`/api/websites/${sampleWebsite.id}/screenshot-runs`);

    expect(res.status).toBe(201);
    const [visitedUrl, screenshotFilePath] = mockPlaywrightService.captureWebsiteScreenshot.mock
      .calls[0] as [string, string];
    expect(visitedUrl).toBe(sampleWebsite.url);
    // bootEnv loaded SCREENSHOT_DIR from .env, as it does for `npm run dev`.
    const configuredScreenshotDirectory = resolveScreenshotDirectory();
    expect(screenshotFilePath.startsWith(configuredScreenshotDirectory + path.sep)).toBe(true);
  });

  it("wires the action script routes into the full app", async () => {
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);
    mockDbService.listActionScriptsForAction.mockResolvedValue([]);

    const res = await request(app).get(
      `/api/websites/${sampleWebsite.id}/actions/${sampleAction.id}/scripts`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockDbService.listActionScriptsForAction).toHaveBeenCalledWith(
      sampleWebsite.id,
      sampleAction.id,
    );
  });

  it("wires the script model route into the full app", async () => {
    mockScriptModelService.listScriptModels.mockResolvedValue([]);
    mockScriptModelService.chooseDefaultScriptModel.mockReturnValue(null);

    const res = await request(app).get("/api/script-models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [], defaultModelId: null, defaultEffort: null });
  });

  it("wires the crawl run routes into the full app", async () => {
    const runningCrawlRun = {
      id: "crawl-run-1",
      websiteId: sampleWebsite.id,
      startUrl: sampleWebsite.url,
      status: "running",
    };
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.listCrawlRunsForWebsite.mockResolvedValue([runningCrawlRun]);
    mockCrawlRunService.startCrawlRun.mockResolvedValue({
      crawlStarted: true,
      crawlRun: runningCrawlRun,
      crawlCompletion: Promise.resolve(),
    });

    const listResponse = await request(app).get(`/api/websites/${sampleWebsite.id}/crawl-runs`);
    const startResponse = await request(app).post(`/api/websites/${sampleWebsite.id}/crawl-runs`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([runningCrawlRun]);
    expect(startResponse.status).toBe(201);
    expect(startResponse.body).toEqual(runningCrawlRun);
  });

  it("wires the credential routes into the full app", async () => {
    const savedCredential = {
      id: "credential-1",
      websiteId: sampleWebsite.id,
      name: "Admin",
      description: null,
      username: "admin@example.com",
      loginUrl: "https://example.com/login",
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    };
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.listCredentialsForWebsite.mockResolvedValue([savedCredential]);

    const res = await request(app).get(`/api/websites/${sampleWebsite.id}/credentials`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ ...savedCredential, hasPassword: true }]);
    expect(mockDbService.listCredentialsForWebsite).toHaveBeenCalledWith(sampleWebsite.id);
  });

  it("does not mark crawl runs interrupted when imported under test (that boot step only runs with the real listener)", () => {
    // The module body ran once, at import, with NODE_ENV=test.
    expect(interruptedMarkCallsAtImport).toBe(0);
  });

  it("hands the action script routes the directory resolved from ACTION_SCRIPT_DIR at boot", async () => {
    const sampleScript = {
      id: "action-script-1",
      websiteId: sampleWebsite.id,
      actionId: sampleAction.id,
      plan: {
        name: "Log in",
        startUrl: sampleWebsite.url,
        steps: [{ action: "click", target: { role: "button", name: "Sign in" }, value: null }],
      },
    };
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(sampleScript);
    mockActionPlanRunnerService.runActionPlan.mockResolvedValue({
      succeeded: true,
      timedOut: false,
      errorMessage: null,
      failedStepNumber: null,
      output: "",
      outputWasTruncated: false,
      failureScreenshotWasCaptured: false,
      failingPageUrl: null,
      failingPageAriaSnapshot: null,
      durationMs: 1200,
    });
    mockDbService.createActionScriptRunForScript.mockResolvedValue({ id: "run-1" });

    const res = await request(app).post(
      `/api/websites/${sampleWebsite.id}/actions/${sampleAction.id}/scripts/${sampleScript.id}/runs`,
    );

    expect(res.status).toBe(201);
    const [{ runDirectory, uploadsDirectory }] = mockActionPlanRunnerService.runActionPlan.mock
      .calls[0] as [{ runDirectory: string; uploadsDirectory: string }];
    // bootEnv loaded ACTION_SCRIPT_DIR from .env, as it does for `npm run dev`.
    const configuredActionScriptDirectory = resolveActionScriptDirectory();
    expect(runDirectory.startsWith(configuredActionScriptDirectory + path.sep)).toBe(true);
    expect(uploadsDirectory).toBe(path.join(configuredActionScriptDirectory, "uploads"));
  });

  it("wires the refine-a-failed-run route into the full app", async () => {
    const sampleScript = { id: "action-script-1", websiteId: sampleWebsite.id, modelId: "claude-opus-5-5" };
    const passingRun = { id: "run-1", succeeded: true, errorMessage: null };
    mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(sampleScript);
    mockDbService.findActionScriptRunForScript.mockResolvedValue(passingRun);

    const res = await request(app)
      .post(
        `/api/websites/${sampleWebsite.id}/actions/${sampleAction.id}/scripts/${sampleScript.id}/runs/${passingRun.id}/refinements`,
      )
      .send({ note: "Try again" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Only a failed run can be refined; this run passed" });
    expect(mockDbService.findActionScriptRunForScript).toHaveBeenCalledWith(
      sampleWebsite.id,
      sampleAction.id,
      sampleScript.id,
      passingRun.id,
    );
    expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
  });

  it("parses a JSON body before it reaches the website routes", async () => {
    mockDbService.createWebsite.mockResolvedValue(sampleWebsite);

    const res = await request(app)
      .post("/api/websites")
      .send({ url: "https://Example.com", name: "Example" });

    expect(res.status).toBe(201);
    expect(mockDbService.createWebsite).toHaveBeenCalledWith({
      url: "https://example.com/",
      name: "Example",
      description: null,
      networkIdleTimeoutMs: 5000,
      screenshotMinimumWaitMs: 1,
      loginUrl: null,
    });
  });

  it("404s an unknown path instead of hanging", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
  });

  it("does not serve the built client under test (only NODE_ENV=production mounts it)", async () => {
    const res = await request(app).get("/websites/website-1");
    expect(res.status).toBe(404);
  });

  it("startListening binds a real socket and hands back a closeable server", async () => {
    const probeApp = express();
    const server = startListening(probeApp, 0);

    await new Promise<void>((resolve) => {
      server.once("listening", () => {
        resolve();
      });
    });

    const address = server.address();
    expect(address).not.toBeNull();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
});

/**
 * A committed directory standing in for the `vite build` output (`dist/`): an
 * `index.html` and one file under `assets/`.
 */
const FIXTURE_CLIENT_BUILD_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "client-build-files",
);

/** A build directory whose `index.html` is a DIRECTORY, so sending it fails with EISDIR. */
const FIXTURE_CLIENT_BUILD_WITH_UNREADABLE_INDEX = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "client-build-with-unreadable-index",
);

/**
 * Builds an app mounted the way server.ts mounts it under NODE_ENV=production:
 * the built client's files before the routes, one API route standing in for
 * the real ones, and the client-route fallback last.
 * @param clientBuildDirectory - The build directory to serve
 * @returns The app, ready for supertest
 */
function createProductionClientApp(clientBuildDirectory: string): express.Express {
  const productionApp = express();
  serveBuiltClientFiles(productionApp, clientBuildDirectory);
  productionApp.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  serveClientRoutesFromIndexHtml(productionApp, clientBuildDirectory);
  return productionApp;
}

describe("production client serving", () => {
  it("serves the built index.html at /", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).get("/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain("<title>fixture client build</title>");
  });

  it("serves a built asset file", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).get(
      "/assets/app.js",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("fixture client build asset");
  });

  it("answers a client route with index.html so react-router can render it", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).get(
      "/websites/website-1/actions/action-1",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain("<title>fixture client build</title>");
  });

  it("answers a HEAD request on a client route too", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).head(
      "/websites",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
  });

  it("lets a registered API route answer instead of the fallback", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).get(
      "/api/health",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("leaves an unmatched /api path, and /api itself, to Express's 404", async () => {
    const productionApp = createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY);

    const unknownApiResponse = await request(productionApp).get("/api/definitely-not-a-route");
    const bareApiResponse = await request(productionApp).get("/api");

    expect(unknownApiResponse.status).toBe(404);
    expect(unknownApiResponse.text).not.toContain("fixture client build");
    expect(bareApiResponse.status).toBe(404);
    expect(bareApiResponse.text).not.toContain("fixture client build");
  });

  it("leaves a non-GET request on a client route to Express's 404", async () => {
    const res = await request(createProductionClientApp(FIXTURE_CLIENT_BUILD_DIRECTORY)).post(
      "/websites/website-1",
    );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain("fixture client build");
  });

  it("answers 404 with the send error when there is no build to serve", async () => {
    const missingBuildDirectory = path.join(FIXTURE_CLIENT_BUILD_DIRECTORY, "no-build-here");

    const res = await request(createProductionClientApp(missingBuildDirectory)).get("/websites");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body.error).toMatch(/ENOENT/);
  });

  it("answers 500 with the send error when index.html cannot be read", async () => {
    const res = await request(
      createProductionClientApp(FIXTURE_CLIENT_BUILD_WITH_UNREADABLE_INDEX),
    ).get("/websites");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "EISDIR, read" });
  });
});
