import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/**
 * One mock per dbService function the website controller imports.
 * `isUniqueConstraintViolation` answers false unless a test says otherwise,
 * so a rejection is a plain 500 by default and a 409 only when a test opts in.
 */
const mockDbService = vi.hoisted(() => ({
  listWebsites: vi.fn(),
  findWebsiteById: vi.fn(),
  createWebsite: vi.fn(),
  updateWebsite: vi.fn(),
  softDeleteWebsite: vi.fn(),
  isUniqueConstraintViolation: vi.fn<(error: unknown) => boolean>(() => false),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerWebsiteRoutes } from "../../../server/controllers/websites.js";

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

describe("website routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("GET /api/websites", () => {
    it("returns 200 with every website the service lists", async () => {
      mockDbService.listWebsites.mockResolvedValue([otherWebsite, sampleWebsite]);

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([otherWebsite, sampleWebsite]);
      expect(mockDbService.listWebsites).toHaveBeenCalledTimes(1);
    });

    it("returns 200 with an empty array when there are no websites", async () => {
      mockDbService.listWebsites.mockResolvedValue([]);

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 500 with the error message when the query fails", async () => {
      mockDbService.listWebsites.mockRejectedValue(new Error("connection refused"));

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the query rejects with a non-Error", async () => {
      mockDbService.listWebsites.mockRejectedValue({ code: "P1001" });

      const res = await request(createWebsitesApp()).get("/api/websites");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST /api/websites", () => {
    it("returns 201 with the created website and stores the normalized input", async () => {
      mockDbService.createWebsite.mockResolvedValue(sampleWebsite);

      const res = await request(createWebsitesApp())
        .post("/api/websites")
        .send({ url: "  HTTPS://Example.COM ", name: "  Example  ", description: "   " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleWebsite);
      expect(mockDbService.createWebsite).toHaveBeenCalledTimes(1);
      expect(mockDbService.createWebsite).toHaveBeenCalledWith({
        url: "https://example.com/",
        name: "Example",
        description: null,
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
      });
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
      });
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
