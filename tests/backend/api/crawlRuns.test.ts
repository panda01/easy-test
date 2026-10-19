import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** One mock per dbService function the crawl controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listCrawlRunsForWebsite: vi.fn(),
  findCrawlRunForWebsite: vi.fn(),
  listCrawledPageSummariesForRun: vi.fn(),
  findCrawledPageForRun: vi.fn(),
  findCredentialWithPasswordForWebsite: vi.fn(),
  findWebObjectNamesForCrawlRun: vi.fn(),
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
 * The committed directory standing in for SCREENSHOT_DIR (shared with the
 * Playwright route spec). It holds one real PNG at
 * `website-id-from-db/existing-run.png`, so the login failure screenshot
 * route is exercised through the real `res.sendFile`.
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
 * Builds a minimal app carrying only the crawl routes, mounted the same way
 * server.ts mounts them (JSON body parsing first), with the fixture directory
 * as the screenshot directory.
 * @returns An app with JSON body parsing and the crawl routes registered
 */
function createCrawlRunApp(): Express {
  const app = express();
  app.use(express.json());
  registerCrawlRunRoutes(app, FIXTURE_SCREENSHOT_DIRECTORY);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CRAWL_RUN_NOT_FOUND_MESSAGE = "Crawl run not found";
const CRAWLED_PAGE_NOT_FOUND_MESSAGE = "Crawled page not found";
const CRAWL_ALREADY_RUNNING_MESSAGE = "A crawl is already running for this website";
const CREDENTIAL_NOT_FOUND_MESSAGE = "Credential not found";
const CREDENTIAL_HAS_NO_EFFECTIVE_LOGIN_URL_MESSAGE =
  "This credential has no login page URL, and neither does the website";
const BUTTON_MODE_INVALID_MESSAGE =
  "The button mode must be one of: linksOnly, allButRisky, openOnly";

/** The key in the environment before this spec ran, restored after each test. */
const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

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
  /** No login URL of its own: only a credential with its own URL can log in. */
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const CRAWL_RUNS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/crawl-runs`;
const CRAWL_RUN_PATH = `${CRAWL_RUNS_PATH}/${REQUESTED_CRAWL_RUN_ID}`;
const CRAWLED_PAGE_PATH = `${CRAWL_RUN_PATH}/pages/${REQUESTED_CRAWLED_PAGE_ID}`;
const LOGIN_FAILURE_SCREENSHOT_PATH = `${CRAWL_RUN_PATH}/login-failure-screenshot`;

// Dates are ISO strings because that is how they cross the wire.
const runningCrawlRun = {
  id: "crawl-run-id-from-db",
  websiteId: foundWebsite.id,
  credentialId: null,
  isLoggedIn: false,
  credential: null,
  startUrl: foundWebsite.url,
  status: "running",
  pageLimit: 50,
  buttonMode: "linksOnly",
  visitedPageCount: 0,
  waitingUrlCount: 0,
  errorMessage: null,
  loginFailureScreenshotFileName: null,
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

/** A credential of the found website, as the crawl start reads it (with its encrypted password). */
const foundCredential = {
  id: "credential-id-from-db",
  websiteId: foundWebsite.id,
  name: "Admin",
  description: null,
  username: "admin@example.com",
  encryptedPassword: "aXY.dGFn.Y2lwaGVy",
  loginUrl: "http://localhost:5180/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

/** A rejection that is not an Error instance, to prove it is stringified. */
const nonErrorRejection = { code: "P1001" };

describe("Crawl run routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findCrawlRunForWebsite.mockResolvedValue(runningCrawlRun);
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    }
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
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
        foundWebsite,
        null,
        FIXTURE_SCREENSHOT_DIRECTORY,
        "linksOnly",
      );
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
    });

    it("crawls logged out, without needing the encryption key, when the credential id is null", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      mockCrawlRunService.startCrawlRun.mockResolvedValue({
        crawlStarted: true,
        crawlRun: runningCrawlRun,
        crawlCompletion: new Promise<void>(() => undefined),
      });

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: null });

      expect(res.status).toBe(201);
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
        foundWebsite,
        null,
        FIXTURE_SCREENSHOT_DIRECTORY,
        "linksOnly",
      );
    });

    it("looks the credential up under the found website and starts a logged-in crawl with it", async () => {
      const loggedInRun = {
        ...runningCrawlRun,
        credentialId: foundCredential.id,
        credential: { id: foundCredential.id, name: foundCredential.name },
      };
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(foundCredential);
      mockCrawlRunService.startCrawlRun.mockResolvedValue({
        crawlStarted: true,
        crawlRun: loggedInRun,
        crawlCompletion: new Promise<void>(() => undefined),
      });

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(loggedInRun);
      expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "credential-id-from-request",
      );
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
        foundWebsite,
        foundCredential,
        FIXTURE_SCREENSHOT_DIRECTORY,
        "linksOnly",
      );
    });

    it.each(["allButRisky", "openOnly", "linksOnly"])(
      "passes the button mode %s through to the crawl start",
      async (buttonMode) => {
        mockCrawlRunService.startCrawlRun.mockResolvedValue({
          crawlStarted: true,
          crawlRun: { ...runningCrawlRun, buttonMode },
          crawlCompletion: new Promise<void>(() => undefined),
        });

        const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH).send({ buttonMode });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ ...runningCrawlRun, buttonMode });
        expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
          foundWebsite,
          null,
          FIXTURE_SCREENSHOT_DIRECTORY,
          buttonMode,
        );
      },
    );

    it("returns 400 and starts nothing for an unknown button mode", async () => {
      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ buttonMode: "clickEverything" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: BUTTON_MODE_INVALID_MESSAGE });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("starts a logged-in crawl, with the button mode, as a credential with its own login URL on a website with none", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(foundCredential);
      mockCrawlRunService.startCrawlRun.mockResolvedValue({
        crawlStarted: true,
        crawlRun: runningCrawlRun,
        crawlCompletion: new Promise<void>(() => undefined),
      });

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request", buttonMode: "openOnly" });

      expect(res.status).toBe(201);
      expect(foundWebsite.loginUrl).toBeNull();
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
        foundWebsite,
        foundCredential,
        FIXTURE_SCREENSHOT_DIRECTORY,
        "openOnly",
      );
    });

    it("starts a logged-in crawl as a credential with no login URL of its own when it inherits the website's", async () => {
      const websiteWithLoginUrl = { ...foundWebsite, loginUrl: "http://localhost:5180/sign-in" };
      const inheritingCredential = { ...foundCredential, loginUrl: null };
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(inheritingCredential);
      mockCrawlRunService.startCrawlRun.mockResolvedValue({
        crawlStarted: true,
        crawlRun: runningCrawlRun,
        crawlCompletion: new Promise<void>(() => undefined),
      });

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request" });

      expect(res.status).toBe(201);
      expect(mockCrawlRunService.startCrawlRun).toHaveBeenCalledWith(
        websiteWithLoginUrl,
        inheritingCredential,
        FIXTURE_SCREENSHOT_DIRECTORY,
        "linksOnly",
      );
    });

    it("returns 400 and starts nothing when neither the credential nor the website has a login URL", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue({
        ...foundCredential,
        loginUrl: null,
      });

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: CREDENTIAL_HAS_NO_EFFECTIVE_LOGIN_URL_MESSAGE });
      expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "credential-id-from-request",
      );
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("returns 400 and starts nothing when the credential id is not a non-blank string", async () => {
      const res = await request(createCrawlRunApp()).post(CRAWL_RUNS_PATH).send({ credentialId: 7 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The credential id must be a non-blank string, or null to crawl logged out",
      });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("returns 404 Credential not found and starts nothing when the credential is not the website's or was deleted", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(null);

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "someone-elses-credential" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("returns 503 and starts nothing when a credential is chosen but the encryption key is not configured", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request" });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/CREDENTIAL_ENCRYPTION_KEY is not set/);
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockCrawlRunService.startCrawlRun).not.toHaveBeenCalled();
    });

    it("returns 500 with the reason when the credential's password cannot be decrypted", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(foundCredential);
      mockCrawlRunService.startCrawlRun.mockRejectedValue(
        new Error("The saved password could not be decrypted"),
      );

      const res = await request(createCrawlRunApp())
        .post(CRAWL_RUNS_PATH)
        .send({ credentialId: "credential-id-from-request" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "The saved password could not be decrypted" });
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
    it("returns 200 with the run, its page summaries without their structure skeletons, and their grouping, looked up by the found rows' ids", async () => {
      mockDbService.listCrawledPageSummariesForRun.mockResolvedValue([
        { ...crawledPageSummary, structureSkeleton: "heading[level=1]" },
      ]);
      mockDbService.findWebObjectNamesForCrawlRun.mockResolvedValue([]);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...runningCrawlRun,
        pages: [crawledPageSummary],
        pageGrouping: { webObjects: [], standalonePageIds: [crawledPageSummary.id] },
      });
      expect(mockDbService.findWebObjectNamesForCrawlRun).toHaveBeenCalledWith(
        foundWebsite.id,
        runningCrawlRun.id,
      );
      expect(mockDbService.findCrawlRunForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CRAWL_RUN_ID,
      );
      expect(mockDbService.listCrawledPageSummariesForRun).toHaveBeenCalledWith(
        foundWebsite.id,
        runningCrawlRun.id,
      );
    });

    it("groups the run's pages into web objects, with the links it skipped and the saved object's id and name", async () => {
      const websitePageIds = ["page-website-1", "page-website-2"];
      const websitePages = websitePageIds.map((pageId, pageIndex) => ({
        ...crawledPageSummary,
        id: pageId,
        url: `http://localhost:5180/websites/cmurhdofb000c93uhb9b32qk${String(pageIndex)}`,
        visitOrder: pageIndex + 1,
        structureSkeleton: "main",
      }));
      mockDbService.findCrawlRunForWebsite.mockResolvedValue({
        ...runningCrawlRun,
        status: "finished",
        skippedSimilarUrlCount: 4,
        skippedSimilarUrlCountsByPattern: { "/websites/{website}": 4 },
      });
      mockDbService.listCrawledPageSummariesForRun.mockResolvedValue([
        { ...crawledPageSummary, structureSkeleton: "heading[level=1]" },
        ...websitePages,
      ]);
      mockDbService.findWebObjectNamesForCrawlRun.mockResolvedValue([
        { id: "web-object-1", instancePatternKey: "/websites/{website}", detectedName: "Website", name: "Site" },
      ]);

      const res = await request(createCrawlRunApp()).get(CRAWL_RUN_PATH);

      expect(res.status).toBe(200);
      expect(res.body.pageGrouping).toEqual({
        webObjects: [
          {
            webObjectId: "web-object-1",
            instancePatternKey: "/websites/{website}",
            displayName: "Site",
            detectedName: "Website",
            parentInstancePatternKey: null,
            instanceValues: ["cmurhdofb000c93uhb9b32qk0", "cmurhdofb000c93uhb9b32qk1"],
            skippedLinkCount: 4,
            patterns: [
              {
                key: "/websites/{website}",
                role: "instance",
                viewName: null,
                detectedBy: "idShape",
                pageIds: websitePageIds,
              },
            ],
          },
        ],
        standalonePageIds: [crawledPageSummary.id],
      });
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

  describe("GET /api/websites/:websiteId/crawl-runs/:crawlRunId/login-failure-screenshot", () => {
    /** A run whose login failed and was screenshotted. */
    const failedLoginRun = {
      ...runningCrawlRun,
      status: "failed",
      credentialId: "credential-id-from-db",
      credential: { id: "credential-id-from-db", name: "Admin" },
      errorMessage: 'Login as "Admin" failed: Still on the login form after submitting',
      loginFailureScreenshotFileName: EXISTING_SCREENSHOT_FILE_NAME,
    };

    it("returns 200 with the PNG bytes, looking the run up under the found website", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue(failedLoginRun);

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(res.body as Buffer, EXISTING_SCREENSHOT_BYTES)).toBe(0);
      expect(mockDbService.findCrawlRunForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CRAWL_RUN_ID,
      );
    });

    it("returns 404 Website not found and looks up no run when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findCrawlRunForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Crawl run not found when the run does not exist or was deleted", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue(null);

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
    });

    it("returns 404 when the run has no login failure screenshot", async () => {
      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "This crawl has no login failure screenshot" });
    });

    it("returns 404 Screenshot file not found when the file is gone from disk", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue({
        ...failedLoginRun,
        loginFailureScreenshotFileName: "website-id-from-db/deleted-from-disk.png",
      });

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Screenshot file not found" });
    });

    it("refuses a stored name that climbs out of the screenshot directory, serving no file", async () => {
      mockDbService.findCrawlRunForWebsite.mockResolvedValue({
        ...failedLoginRun,
        loginFailureScreenshotFileName: "../screenshot-files/website-id-from-db/existing-run.png",
      });

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 500 with the error message when the run lookup fails", async () => {
      mockDbService.findCrawlRunForWebsite.mockRejectedValue(new Error("connection lost"));

      const res = await request(createCrawlRunApp()).get(LOGIN_FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });
});
