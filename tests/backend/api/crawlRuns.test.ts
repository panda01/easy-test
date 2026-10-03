import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the crawl controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listCrawlRunsForWebsite: vi.fn(),
  findCrawlRunForWebsite: vi.fn(),
  listCrawledPageSummariesForRun: vi.fn(),
  findCrawledPageForRun: vi.fn(),
}));

/** Starting a crawl is replaced outright: no spec ever launches Chromium. */
const mockCrawlRunService = vi.hoisted(() => ({
  startCrawlRun: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/crawlRunService.js", () => mockCrawlRunService);

import { registerCrawlRunRoutes } from "../../../server/controllers/crawlRuns.js";

/**
 * Builds a minimal app carrying only the crawl routes, mounted the same way
 * server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the crawl routes registered
 */
function createCrawlRunApp(): Express {
  const app = express();
  app.use(express.json());
  registerCrawlRunRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CRAWL_RUN_NOT_FOUND_MESSAGE = "Crawl run not found";
const CRAWLED_PAGE_NOT_FOUND_MESSAGE = "Crawled page not found";
const CRAWL_ALREADY_RUNNING_MESSAGE = "A crawl is already running for this website";

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove the later queries use the
// FOUND rows' ids, not the raw path parameters.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const REQUESTED_CRAWL_RUN_ID = "crawl-run-id-from-path";
const REQUESTED_CRAWLED_PAGE_ID = "crawled-page-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "http://localhost:5180/",
  name: "easy-test dev",
  description: null,
  networkIdleTimeoutMs: 5000,
  screenshotMinimumWaitMs: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const CRAWL_RUNS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/crawl-runs`;
const CRAWL_RUN_PATH = `${CRAWL_RUNS_PATH}/${REQUESTED_CRAWL_RUN_ID}`;
const CRAWLED_PAGE_PATH = `${CRAWL_RUN_PATH}/pages/${REQUESTED_CRAWLED_PAGE_ID}`;

// Dates are ISO strings because that is how they cross the wire.
const runningCrawlRun = {
  id: "crawl-run-id-from-db",
  websiteId: foundWebsite.id,
  startUrl: foundWebsite.url,
  status: "running",
  pageLimit: 50,
  visitedPageCount: 0,
  waitingUrlCount: 0,
  errorMessage: null,
  durationMs: null,
  finishedAt: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

const crawledPageSummary = {
  id: "crawled-page-id-from-db",
  crawlRunId: runningCrawlRun.id,
  websiteId: foundWebsite.id,
  parentPageId: null,
  url: "http://localhost:5180/",
  requestedUrl: "http://localhost:5180/",
  finalUrl: "http://localhost:5180/",
  visitOrder: 0,
  depth: 0,
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  title: "easy-test",
  durationMs: 700,
  createdAt: "2026-01-02T00:00:01.000Z",
  updatedAt: "2026-01-02T00:00:01.000Z",
  deletedAt: null,
};

const fullCrawledPage = {
  ...crawledPageSummary,
  ariaSnapshot: '- heading "Hello World" [level=1]',
  linkedUrls: ["http://localhost:5180/websites"],
};

/** A rejection that is not an Error instance, to prove it is stringified. */
const nonErrorRejection = { code: "P1001" };

describe("Crawl run routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findCrawlRunForWebsite.mockResolvedValue(runningCrawlRun);
  });

  describe("GET /api/websites/:websiteId/crawl-runs", () => {
    it("returns 200 with the found website's crawl runs", async () => {
      mockDbService.listCrawlRunsForWebsite.mockResolvedValue([runningCrawlRun]);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([runningCrawlRun]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listCrawlRunsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listCrawlRunsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listCrawlRunsForWebsite.mockRejectedValue(new Error("connection lost"));

      const res = await request(createCrawlRunApp()).get(CRAWL_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });

    it("returns 500 with a stringified message when a query rejects with a non-Error", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(nonErrorRejection);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST /api/websites/:websiteId/crawl-runs", () => {
    it("starts a crawl of the found website and answers 201 with the running run at once", async () => {
      mockCrawlRunService.startCrawlRun.mockResolvedValue({
        crawlStarted: true,
        crawlRun: runningCrawlRun,
        crawlCompletion: new Promise<void>(() => undefined),
      });

      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(runningCrawlRun);
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(foundWebsite);
    });

    it("answers 409 and starts nothing when a crawl of the website is already running", async () => {
      mockCrawlRunService.startCrawlRun.mockResolvedValue({ crawlStarted: false });

      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: CRAWL_ALREADY_RUNNING_MESSAGE });
    });

    it("returns 404 Website not found and starts nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the run cannot be created", async () => {
      mockCrawlRunService.startCrawlRun.mockRejectedValue(new Error("connection refused"));

      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with a stringified message when starting rejects with a non-Error", async () => {
      mockCrawlRunService.startCrawlRun.mockRejectedValue(nonErrorRejection);

      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("GET /api/websites/:websiteId/crawl-runs/:crawlRunId", () => {
    it("returns 200 with the run and its page summaries, looked up by the found rows' ids", async () => {
      mockDbService.listCrawledPageSummariesForRun.mockResolvedValue([crawledPageSummary]);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...runningCrawlRun, pages: [crawledPageSummary] });
      expect(mockDbService.findCrawlRunForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CRAWL_RUN_ID,
      );
      expect(mockDbService.listCrawledPageSummariesForRun).toHaveBeenCalledWith(
        foundWebsite.id,
        runningCrawlRun.id,
      );
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findCrawlRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Crawl run not found when the run does not exist, was deleted, or belongs to another website", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
      expect(mockDbService.listCrawledPageSummariesForRun).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listCrawledPageSummariesForRun.mockRejectedValue(new Error("timeout"));

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "timeout" });
    });
  });

  describe("GET /api/websites/:websiteId/crawl-runs/:crawlRunId/pages/:crawledPageId", () => {
    it("returns 200 with the full page, looked up by the found rows' ids", async () => {
      mockDbService.findCrawledPageForRun.mockResolvedValue(fullCrawledPage);

      const res = await request(createCrawlRunApp()).get(CRAWLED_PAGE_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(fullCrawledPage);
      expect(mockDbService.findCrawledPageForRun).toHaveBeenCalledWith(
        foundWebsite.id,
        runningCrawlRun.id,
        REQUESTED_CRAWLED_PAGE_ID,
      );
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWLED_PAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findCrawlRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Crawl run not found when the run does not exist or was deleted", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWLED_PAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
      expect(mockDbService.findCrawledPageForRun).not.toHaveBeenCalled();
    });

    it("returns 404 Crawled page not found when the page does not exist or belongs to another run", async () => {
      mockDbService.findCrawledPageForRun.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(CRAWLED_PAGE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CRAWLED_PAGE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.findCrawledPageForRun.mockRejectedValue(new Error("deadlock detected"));

      const res = await request(createCrawlRunApp()).get(CRAWLED_PAGE_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "deadlock detected" });
    });
  });
});
