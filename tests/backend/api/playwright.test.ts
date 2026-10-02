import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the Playwright controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listScreenshotRunsForWebsite: vi.fn(),
  findScreenshotRunForWebsite: vi.fn(),
  createScreenshotRunForWebsite: vi.fn(),
}));

/** The browser work is replaced outright: no spec ever launches Chromium. */
const mockPlaywrightService = vi.hoisted(() => ({
  captureWebsiteScreenshot: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/playwrightService.js", () => mockPlaywrightService);

import { registerPlaywrightRoutes } from "../../../server/controllers/playwright.js";

/**
 * A committed directory standing in for SCREENSHOT_DIR. It holds one real PNG
 * at `website-id-from-db/existing-run.png`, so the image route is exercised
 * through the real `res.sendFile`.
 */
const FIXTURE_SCREENSHOT_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "screenshot-files",
);
const EXISTING_SCREENSHOT_FILE_NAME = "website-id-from-db/existing-run.png";
const EXISTING_SCREENSHOT_BYTES = readFileSync(
  path.join(FIXTURE_SCREENSHOT_DIRECTORY, EXISTING_SCREENSHOT_FILE_NAME),
);

/**
 * Builds a minimal app carrying only the Playwright routes, mounted the same
 * way server.ts mounts them (JSON body parsing first), with the fixture
 * directory as the screenshot directory.
 * @returns An app with JSON body parsing and the Playwright routes registered
 */
function createPlaywrightApp(): Express {
  const app = express();
  app.use(express.json());
  registerPlaywrightRoutes(app, FIXTURE_SCREENSHOT_DIRECTORY);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";

// The id in the request path and the id on the row the lookup returns are
// deliberately different, so each test can prove the run queries and the
// screenshot file name use the FOUND website's id, not the raw path parameter.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  // Deliberately not the defaults, so the test proves the ROW's settings are used.
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 1200,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const SCREENSHOT_RUNS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/screenshot-runs`;
const SCREENSHOT_IMAGE_PATH = `${SCREENSHOT_RUNS_PATH}/screenshot-run-1/screenshot`;

/** A saved name is `<found website id>/<uuid>.png`. */
const SAVED_SCREENSHOT_NAME_PATTERN = /^website-id-from-db\/[0-9a-f-]{36}\.png$/;

// Dates are ISO strings because that is how they cross the wire.
const sampleScreenshotRun = {
  id: "screenshot-run-1",
  websiteId: foundWebsite.id,
  requestedUrl: foundWebsite.url,
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  screenshotFileName: EXISTING_SCREENSHOT_FILE_NAME,
  durationMs: 840,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

/** What `captureWebsiteScreenshot` reports for a page that loaded with HTTP 200. */
const successfulCapture = {
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  screenshotWasCaptured: true,
  durationMs: 840,
};

/**
 * Reads the file path the controller asked the Playwright service to write.
 * @returns The second argument of the first `captureWebsiteScreenshot` call
 */
function readRequestedScreenshotFilePath(): string {
  const [, screenshotFilePath] = mockPlaywrightService.captureWebsiteScreenshot.mock.calls[0] as [
    string,
    string,
  ];
  return screenshotFilePath;
}

describe("Playwright routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks the website first; it exists unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  describe("GET /api/websites/:websiteId/screenshot-runs", () => {
    it("returns 200 with the website's runs, listed by the found website's id", async () => {
      mockDbService.listScreenshotRunsForWebsite.mockResolvedValue([sampleScreenshotRun]);

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleScreenshotRun]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listScreenshotRunsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found and lists nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listScreenshotRunsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection refused"));

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the list query rejects with a non-Error", async () => {
      mockDbService.listScreenshotRunsForWebsite.mockRejectedValue({ code: "P1001" });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST /api/websites/:websiteId/screenshot-runs", () => {
    it("visits the website's url, saves the screenshot under the found website's folder, and returns 201 with the recorded run", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue(successfulCapture);
      mockDbService.createScreenshotRunForWebsite.mockResolvedValue(sampleScreenshotRun);

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleScreenshotRun);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);

      const screenshotFilePath = readRequestedScreenshotFilePath();
      const savedScreenshotName = path
        .relative(FIXTURE_SCREENSHOT_DIRECTORY, screenshotFilePath)
        .split(path.sep)
        .join("/");
      expect(savedScreenshotName).toMatch(SAVED_SCREENSHOT_NAME_PATTERN);
      expect(screenshotFilePath).toBe(path.join(FIXTURE_SCREENSHOT_DIRECTORY, savedScreenshotName));
      expect(mockPlaywrightService.captureWebsiteScreenshot).toHaveBeenCalledWith(
        foundWebsite.url,
        screenshotFilePath,
        { networkIdleTimeoutMs: 7000, screenshotMinimumWaitMs: 1200 },
      );
      expect(mockDbService.createScreenshotRunForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        requestedUrl: foundWebsite.url,
        succeeded: true,
        httpStatus: 200,
        errorMessage: null,
        screenshotFileName: savedScreenshotName,
        durationMs: 840,
      });
    });

    it("records a failed visit that still captured the error page, and answers 201", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue({
        succeeded: false,
        httpStatus: 404,
        errorMessage: "The page responded with HTTP 404",
        screenshotWasCaptured: true,
        durationMs: 15,
      });
      const failedRun = {
        ...sampleScreenshotRun,
        succeeded: false,
        httpStatus: 404,
        errorMessage: "The page responded with HTTP 404",
      };
      mockDbService.createScreenshotRunForWebsite.mockResolvedValue(failedRun);

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(failedRun);
      expect(mockDbService.createScreenshotRunForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        expect.objectContaining({
          succeeded: false,
          httpStatus: 404,
          errorMessage: "The page responded with HTTP 404",
          screenshotFileName: expect.stringMatching(SAVED_SCREENSHOT_NAME_PATTERN),
        }),
      );
    });

    it("records a visit that never reached a page with no screenshot file name, and answers 201", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue({
        succeeded: false,
        httpStatus: null,
        errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/",
        screenshotWasCaptured: false,
        durationMs: 7,
      });
      const unreachableRun = {
        ...sampleScreenshotRun,
        succeeded: false,
        httpStatus: null,
        errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/",
        screenshotFileName: null,
        durationMs: 7,
      };
      mockDbService.createScreenshotRunForWebsite.mockResolvedValue(unreachableRun);

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(unreachableRun);
      expect(mockDbService.createScreenshotRunForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        requestedUrl: foundWebsite.url,
        succeeded: false,
        httpStatus: null,
        errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/",
        screenshotFileName: null,
        durationMs: 7,
      });
    });

    it("gives every run its own screenshot file name", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue(successfulCapture);
      mockDbService.createScreenshotRunForWebsite.mockResolvedValue(sampleScreenshotRun);
      const app = createPlaywrightApp();

      await request(app).post(SCREENSHOT_RUNS_PATH);
      await request(app).post(SCREENSHOT_RUNS_PATH);

      const [firstCall, secondCall] = mockPlaywrightService.captureWebsiteScreenshot.mock
        .calls as [[string, string], [string, string]];
      expect(firstCall[1]).not.toBe(secondCall[1]);
    });

    it("returns 404 Website not found and visits nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockPlaywrightService.captureWebsiteScreenshot).not.toHaveBeenCalled();
      expect(mockDbService.createScreenshotRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 and records nothing when the browser cannot be launched", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockRejectedValue(
        new Error("browserType.launch: Executable doesn't exist"),
      );

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "browserType.launch: Executable doesn't exist" });
      expect(mockDbService.createScreenshotRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the stringified value when recording the run rejects with a non-Error", async () => {
      mockPlaywrightService.captureWebsiteScreenshot.mockResolvedValue(successfulCapture);
      mockDbService.createScreenshotRunForWebsite.mockRejectedValue({ code: "P1001" });

      const res = await request(createPlaywrightApp()).post(SCREENSHOT_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot", () => {
    it("returns 200 with the PNG bytes, looking the run up under the found website", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue(sampleScreenshotRun);

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(res.body as Buffer, EXISTING_SCREENSHOT_BYTES)).toBe(0);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.findScreenshotRunForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "screenshot-run-1",
      );
    });

    it("returns 404 Website not found and looks up no run when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findScreenshotRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Screenshot run not found when the run does not exist, was deleted, or belongs to another website", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue(null);

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Screenshot run not found" });
    });

    it("returns 404 when the run captured no screenshot", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue({
        ...sampleScreenshotRun,
        screenshotFileName: null,
      });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "This run did not capture a screenshot" });
    });

    it("returns 404 Screenshot file not found when the file is gone from disk", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue({
        ...sampleScreenshotRun,
        screenshotFileName: "website-id-from-db/deleted-from-disk.png",
      });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Screenshot file not found" });
    });

    it("refuses a stored name that climbs out of the screenshot directory, serving no file", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue({
        ...sampleScreenshotRun,
        screenshotFileName: "../screenshot-files/website-id-from-db/existing-run.png",
      });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 500 with the send error when the stored name is not a readable file", async () => {
      mockDbService.findScreenshotRunForWebsite.mockResolvedValue({
        ...sampleScreenshotRun,
        screenshotFileName: "website-id-from-db",
      });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "EISDIR, read" });
    });

    it("returns 500 with the stringified value when the run lookup rejects with a non-Error", async () => {
      mockDbService.findScreenshotRunForWebsite.mockRejectedValue({ code: "P1001" });

      const res = await request(createPlaywrightApp()).get(SCREENSHOT_IMAGE_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });
});
