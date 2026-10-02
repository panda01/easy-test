import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import path from "node:path";

/**
 * server.ts registers the website, use case, action, and Playwright
 * controllers, and each of them imports dbService - whose module body
 * constructs a real PrismaClient. Every exported dbService function is
 * replaced so loading the full app never builds a client, and the wiring
 * tests below can choose what a query returns.
 */
const mockDbService = vi.hoisted(() => ({
  isUniqueConstraintViolation: vi.fn(),
  isRecordNotFound: vi.fn(),
  createWebsite: vi.fn(),
  listWebsites: vi.fn(),
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
}));

/** The Playwright service is replaced so loading the full app can never launch a browser. */
const mockPlaywrightService = vi.hoisted(() => ({
  captureWebsiteScreenshot: vi.fn(),
}));

vi.mock("../../server/services/dbService.js", () => mockDbService);
vi.mock("../../server/services/playwrightService.js", () => mockPlaywrightService);

import { app, startListening } from "../../server/server.js";
import { resolveScreenshotDirectory } from "../../server/utils/resolveScreenshotDirectory.js";

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
  title: "Log in",
  description: "Enter credentials and submit",
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
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
    mockDbService.listWebsites.mockResolvedValue([sampleWebsite]);

    const res = await request(app).get("/api/websites");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleWebsite]);
    expect(mockDbService.listWebsites).toHaveBeenCalledTimes(1);
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
    });
  });

  it("404s an unknown path instead of hanging", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
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
