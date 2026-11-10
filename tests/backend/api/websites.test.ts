import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/**
 * One mock per dbService function the website controller imports.
 * `isUniqueConstraintViolation` answers false unless a test says otherwise,
 * so a rejection is a plain 500 by default and a 409 only when a test opts in.
 */
const mockDbService = vi.hoisted(() => ({
  listWebsitesWithSummaries: vi.fn(),
  findWebsiteById: vi.fn(),
  createWebsite: vi.fn(),
  updateWebsite: vi.fn(),
  softDeleteWebsite: vi.fn(),
  isUniqueConstraintViolation: vi.fn<(error: unknown) => boolean>(() => false),
}));

/**
 * The login-form check is replaced outright: no spec here ever launches a
 * browser (its own spec covers what it looks for and makes).
 */
const mockLoginFormCheckService = vi.hoisted(() => ({
  checkWebsiteForLoginForm: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/loginFormCheckService.js", () => mockLoginFormCheckService);

import { registerWebsiteRoutes, WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE } from "../../../server/controllers/websites.js";

/**
 * Builds a minimal app carrying only the website routes, mounted the same way
 * server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the website routes registered
 */
function createWebsitesApp(): Express {
  const app = express();
  app.use(express.json());
  registerWebsiteRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const DUPLICATE_URL_MESSAGE = "Another website already uses this URL";

// Dates are ISO strings here because that is how they cross the wire: the
// response body is compared to these objects after JSON serialization.
const sampleWebsite = {
  id: "cuid-1",
  url: "https://example.com/",
  name: "Example",
  description: "a site to test",
  networkIdleTimeoutMs: 5000,
  screenshotMinimumWaitMs: 1,
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const otherWebsite = {
  ...sampleWebsite,
  id: "cuid-2",
  url: "https://other.example/",
  name: "Other",
  description: null,
};

/** What Prisma rejects with when a write collides with the unique URL index. */
const uniqueConstraintError = { code: "P2002", message: "Unique constraint failed" };

/** A login-form check that found no login form. */
const NOT_FOUND_LOGIN_CHECK = { outcome: "notFound", loginUrl: null, loginActionId: null, message: null };

/** A login-form check that found a login form and made the website's Login action. */
const FOUND_LOGIN_CHECK = {
  outcome: "found",
  loginUrl: "https://example.com/login",
  loginActionId: "login-action-1",
  message: null,
};

/** A login-form check that could not finish. */
const FAILED_LOGIN_CHECK = {
  outcome: "failed",
  loginUrl: null,
  loginActionId: null,
  message: "page.goto: net::ERR_NAME_NOT_RESOLVED",
};

describe("website routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // A created website's login-form check finds no form unless a test says otherwise.
    mockLoginFormCheckService.checkWebsiteForLoginForm.mockResolvedValue(NOT_FOUND_LOGIN_CHECK);
  });

  describe("GET /api/websites", () => {
    it("returns 200 with every website the service lists, each with its dashboard summary", async () => {
      const otherWebsiteWithSummary = {
        ...otherWebsite,
        summary: {
          actionCount: 3,
          passedActionCount: 1,
          failedActionCount: 1,
          notRunActionCount: 1,
          latestRunAt: "2026-01-10T00:00:00.000Z",
          latestCrawlRun: {
            id: "crawl-run-1",
            status: "running",
            visitedPageCount: 12,
            pageLimit: 50,
            createdAt: "2026-01-10T00:00:00.000Z",
            finishedAt: null,
          },
        },
      };
      mockDbService.listWebsitesWithSummaries.mockResolvedValue([otherWebsiteWithSummary, sampleWebsite]);

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([otherWebsiteWithSummary, sampleWebsite]);
      expect(mockDbService.listWebsitesWithSummaries).toHaveBeenCalledTimes(1);
    });

    it("returns 200 with an empty array when there are no websites", async () => {
      mockDbService.listWebsitesWithSummaries.mockResolvedValue([]);

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 500 with the error message when the query fails", async () => {
      mockDbService.listWebsitesWithSummaries.mockRejectedValue(new Error("connection refused"));

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the query rejects with a non-Error", async () => {
      mockDbService.listWebsitesWithSummaries.mockRejectedValue({ code: "P1001" });

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST /api/websites", () => {
    it("returns 201 with the created website and its login-form check, and stores the normalized input", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "  HTTPS://Example.COM ", name: "  Example  ", description: "   " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...sampleWebsite, loginCheck: NOT_FOUND_LOGIN_CHECK });
      expect(mockDbService.createWebsite).toHaveBeenCalledTimes(1);
      expect(mockDbService.createWebsite).toHaveBeenCalledWith({
        url: "https://example.com/",
        name: "Example",
        description: null,
        networkIdleTimeoutMs: 5000,
        screenshotMinimumWaitMs: 1,
        loginUrl: null,
      });
    });

    it("passes a trimmed description through to the service", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);

      await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example", description: "  a site to test " });

      expect(mockDbService.createWebsite).toHaveBeenCalledWith({
        url: "https://example.com/",
        name: "Example",
        description: "a site to test",
        networkIdleTimeoutMs: 5000,
        screenshotMinimumWaitMs: 1,
        loginUrl: null,
      });
    });

    it("passes the website's own screenshot timing settings through to the service", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);

      await request(createWebsitesApp()).post("/api/websites").send({
        url: "https://example.com",
        name: "Example",
        networkIdleTimeoutMs: 8000,
        screenshotMinimumWaitMs: 1200,
      });

      expect(mockDbService.createWebsite).toHaveBeenCalledWith({
        url: "https://example.com/",
        name: "Example",
        description: null,
        networkIdleTimeoutMs: 8000,
        screenshotMinimumWaitMs: 1200,
        loginUrl: null,
      });
    });

    it("passes the normalized login page URL through to the service", async () => {
      const websiteWithLoginUrl = { ...sampleWebsite, loginUrl: "https://example.com/login" };
      mockDbService.createWebsite.mockResolvedValue(websiteWithLoginUrl);
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);

      const res = await request(createWebsitesApp()).post("/api/websites").send({
        url: "https://example.com",
        name: "Example",
        loginUrl: "  HTTPS://Example.COM/login  ",
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...websiteWithLoginUrl, loginCheck: NOT_FOUND_LOGIN_CHECK });
      expect(mockDbService.createWebsite).toHaveBeenCalledWith({
        url: "https://example.com/",
        name: "Example",
        description: null,
        networkIdleTimeoutMs: 5000,
        screenshotMinimumWaitMs: 1,
        loginUrl: "https://example.com/login",
      });
    });

    it("returns 400 and stores nothing when the login page URL is not http or https", async () => {
      const res = await request(createWebsitesApp()).post("/api/websites").send({
        url: "https://example.com",
        name: "Example",
        loginUrl: "ftp://example.com/login",
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The login page URL must be a valid http:// or https:// address",
      });
      expect(mockDbService.createWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 and stores nothing when the network idle cap is below the minimum wait", async () => {
      const res = await request(createWebsitesApp()).post("/api/websites").send({
        url: "https://example.com",
        name: "Example",
        networkIdleTimeoutMs: 200,
        screenshotMinimumWaitMs: 300,
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The network idle cap cannot be lower than the minimum wait" });
      expect(mockDbService.createWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ name: "Example" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A URL is required" });
      expect(mockDbService.createWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 when no JSON body is sent", async () => {
      const res = await request(createWebsitesApp()).post("/api/websites");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.createWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 for a url that is not http or https", async () => {
      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "ftp://example.com", name: "Example" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The URL must be a valid http:// or https:// address" });
      expect(mockDbService.createWebsite).not.toHaveBeenCalled();
    });

    it("returns 409 when another active website already has the url", async () => {
      mockDbService.createWebsite.mockRejectedValue(uniqueConstraintError);
      mockDbService.isUniqueConstraintViolation.mockReturnValueOnce(true);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Duplicate" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: DUPLICATE_URL_MESSAGE });
      expect(mockDbService.isUniqueConstraintViolation).toHaveBeenCalledWith(
        uniqueConstraintError,
      );
    });

    it("returns 500 with the error message when the insert fails for another reason", async () => {
      const connectionError = new Error("connection refused");
      mockDbService.createWebsite.mockRejectedValue(connectionError);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
      expect(mockDbService.isUniqueConstraintViolation).toHaveBeenCalledWith(connectionError);
      expect(mockLoginFormCheckService.checkWebsiteForLoginForm).not.toHaveBeenCalled();
    });

    it("runs the login-form check on the created website, then answers the website as re-read after it, with the check", async () => {
      const websiteThatLearnedItsLoginPage = { ...sampleWebsite, loginUrl: FOUND_LOGIN_CHECK.loginUrl };
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockResolvedValue(FOUND_LOGIN_CHECK);
      mockDbService.findWebsiteById.mockResolvedValue(websiteThatLearnedItsLoginPage);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...websiteThatLearnedItsLoginPage, loginCheck: FOUND_LOGIN_CHECK });
      expect(mockLoginFormCheckService.checkWebsiteForLoginForm).toHaveBeenCalledWith(sampleWebsite);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(sampleWebsite.id);
      const checkOrder = mockLoginFormCheckService.checkWebsiteForLoginForm.mock.invocationCallOrder[0];
      const reReadOrder = mockDbService.findWebsiteById.mock.invocationCallOrder[0];
      expect(checkOrder).toBeLessThan(reReadOrder);
    });

    it("still answers 201 with a failed check when the login-form check could not finish", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockResolvedValue(FAILED_LOGIN_CHECK);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...sampleWebsite, loginCheck: FAILED_LOGIN_CHECK });
    });

    it.each([
      ["an Error, with its message", new Error("deadlock detected"), "deadlock detected"],
      ["a non-Error, stringified", "database offline", "database offline"],
    ])("turns a login-form check that throws %s into a failed check, still creating the website (201)", async (_label, thrown, message) => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockRejectedValue(thrown);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ...sampleWebsite,
        loginCheck: { outcome: "failed", loginUrl: null, loginActionId: null, message },
      });
      expect(mockDbService.isUniqueConstraintViolation).not.toHaveBeenCalled();
    });

    it("answers the website as created when the re-read finds it no longer (deleted meanwhile)", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...sampleWebsite, loginCheck: NOT_FOUND_LOGIN_CHECK });
    });

    it("returns 500 with the error message when the re-read fails", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);
      mockDbService.findWebsiteById.mockRejectedValue(new Error("query timed out"));

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("POST /api/websites/:websiteId/login-check", () => {
    it.each([
      ["found a login form", FOUND_LOGIN_CHECK],
      ["found no login form", NOT_FOUND_LOGIN_CHECK],
      ["could not finish", FAILED_LOGIN_CHECK],
    ])("returns 200 with the check when it %s, run on the website looked up by the path id", async (_label, loginCheck) => {
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockResolvedValue(loginCheck);

      const res = await request(createWebsitesApp()).post("/api/websites/cuid-1/login-check");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ loginCheck });
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("cuid-1");
      expect(mockLoginFormCheckService.checkWebsiteForLoginForm).toHaveBeenCalledWith(sampleWebsite);
    });

    it("returns 404 and checks nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createWebsitesApp()).post("/api/websites/deleted-or-unknown/login-check");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockLoginFormCheckService.checkWebsiteForLoginForm).not.toHaveBeenCalled();
    });

    it("returns 409 when the website already has its Login action", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockResolvedValue({
        outcome: "alreadyHasLoginAction",
        loginUrl: "https://example.com/login",
        loginActionId: "login-action-1",
        message: null,
      });

      const res = await request(createWebsitesApp()).post("/api/websites/cuid-1/login-check");

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE });
      expect(WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE).toBe(
        "This website already has its login action, so there is no login form to look for",
      );
    });

    it("returns 500 with the error message when the check's query fails", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);
      mockLoginFormCheckService.checkWebsiteForLoginForm.mockRejectedValue(new Error("deadlock detected"));

      const res = await request(createWebsitesApp()).post("/api/websites/cuid-1/login-check");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "deadlock detected" });
    });

    it("returns 500 with the error message when the website lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection refused"));

      const res = await request(createWebsitesApp()).post("/api/websites/cuid-1/login-check");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
      expect(mockLoginFormCheckService.checkWebsiteForLoginForm).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/websites/:websiteId", () => {
    it("returns 200 with the website looked up by the path id", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(sampleWebsite);

      const res = await request(createWebsitesApp()).get("/api/websites/cuid-1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleWebsite);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("cuid-1");
    });

    it("returns 404 when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createWebsitesApp()).get("/api/websites/deleted-or-unknown");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("query timed out"));

      const res = await request(createWebsitesApp()).get("/api/websites/cuid-1");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("PUT /api/websites/:websiteId", () => {
    it("returns 200 with the updated website and passes the path id and normalized input", async () => {
      const updatedWebsite = { ...sampleWebsite, name: "Renamed", description: null };
      mockDbService.updateWebsite.mockResolvedValue(updatedWebsite);

      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "HTTPS://EXAMPLE.com", name: " Renamed ", description: null });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedWebsite);
      expect(mockDbService.updateWebsite).toHaveBeenCalledTimes(1);
      expect(mockDbService.updateWebsite).toHaveBeenCalledWith("cuid-1", {
        url: "https://example.com/",
        name: "Renamed",
        description: null,
        networkIdleTimeoutMs: 5000,
        screenshotMinimumWaitMs: 1,
        loginUrl: null,
      });
    });

    it("replaces the login page URL with the normalized one sent", async () => {
      const updatedWebsite = { ...sampleWebsite, loginUrl: "https://example.com/sign-in" };
      mockDbService.updateWebsite.mockResolvedValue(updatedWebsite);

      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example", loginUrl: "HTTPS://EXAMPLE.com/sign-in" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedWebsite);
      expect(mockDbService.updateWebsite).toHaveBeenCalledWith(
        "cuid-1",
        expect.objectContaining({ loginUrl: "https://example.com/sign-in" }),
      );
    });

    it("clears the login page URL (the website then doesn't require login) when it is sent blank", async () => {
      mockDbService.updateWebsite.mockResolvedValue(sampleWebsite);

      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example", loginUrl: "   " });

      expect(res.status).toBe(200);
      expect(mockDbService.updateWebsite).toHaveBeenCalledWith(
        "cuid-1",
        expect.objectContaining({ loginUrl: null }),
      );
    });

    it("returns 400 and updates nothing when the login page URL is not a valid address", async () => {
      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example", loginUrl: "not a url" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The login page URL must be a valid http:// or https:// address",
      });
      expect(mockDbService.updateWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 and updates nothing when a timing setting is out of range", async () => {
      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example", networkIdleTimeoutMs: 30001 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The network idle cap must be a whole number of milliseconds from 0 to 30000",
      });
      expect(mockDbService.updateWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "   " });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A name is required" });
      expect(mockDbService.updateWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 when the description is not text", async () => {
      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example", description: 12 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The description must be text" });
      expect(mockDbService.updateWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 when no active website has the id", async () => {
      mockDbService.updateWebsite.mockResolvedValue(null);

      const res = await request(createWebsitesApp())
        .put("/api/websites/deleted-or-unknown")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
    });

    it("returns 409 when another active website already has the new url", async () => {
      mockDbService.updateWebsite.mockRejectedValue(uniqueConstraintError);
      mockDbService.isUniqueConstraintViolation.mockReturnValueOnce(true);

      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://other.example", name: "Example" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: DUPLICATE_URL_MESSAGE });
      expect(mockDbService.isUniqueConstraintViolation).toHaveBeenCalledWith(
        uniqueConstraintError,
      );
    });

    it("returns 500 with the stringified value when the update rejects with a non-Error", async () => {
      mockDbService.updateWebsite.mockRejectedValue("database offline");

      const res = await request(createWebsitesApp())
        .put("/api/websites/cuid-1")
        .send({ url: "https://example.com", name: "Example" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "database offline" });
      expect(mockDbService.isUniqueConstraintViolation).toHaveBeenCalledWith("database offline");
    });
  });

  describe("DELETE /api/websites/:websiteId", () => {
    it("returns 204 with no body after soft deleting the website with the path id", async () => {
      mockDbService.softDeleteWebsite.mockResolvedValue(true);

      const res = await request(createWebsitesApp()).delete("/api/websites/cuid-1");

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(mockDbService.softDeleteWebsite).toHaveBeenCalledWith("cuid-1");
    });

    it("returns 404 when no active website has the id", async () => {
      mockDbService.softDeleteWebsite.mockResolvedValue(false);

      const res = await request(createWebsitesApp()).delete("/api/websites/already-deleted");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the soft delete fails", async () => {
      mockDbService.softDeleteWebsite.mockRejectedValue(new Error("deadlock detected"));

      const res = await request(createWebsitesApp()).delete("/api/websites/cuid-1");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "deadlock detected" });
    });
  });
});
