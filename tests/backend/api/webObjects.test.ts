import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the web object controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listWebObjectsForWebsite: vi.fn(),
  renameWebObject: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerWebObjectRoutes } from "../../../server/controllers/webObjects.js";

/**
 * Builds a minimal app carrying only the web object routes, mounted the same
 * way server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the web object routes registered
 */
function createWebObjectsApp(): Express {
  const app = express();
  app.use(express.json());
  registerWebObjectRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const WEB_OBJECT_NOT_FOUND_MESSAGE = "Web object not found";

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove the later queries use the
// FOUND website's id, not the raw path parameter.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "http://localhost:5180/",
  name: "easy-test dev",
  description: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const WEB_OBJECTS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/web-objects`;
const WEB_OBJECT_PATH = `${WEB_OBJECTS_PATH}/web-object-1`;

// Dates are ISO strings because that is how they cross the wire.
const sampleWebObject = {
  id: "web-object-1",
  websiteId: foundWebsite.id,
  crawlRunId: "crawl-run-1",
  parentWebObjectId: null,
  instancePatternKey: "/websites/{website}",
  detectedName: "Website",
  name: null,
  instanceCount: 3,
  skippedLinkCount: 1,
  sortOrder: 0,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
  pagePatterns: [],
  crawlRun: { id: "crawl-run-1", createdAt: "2026-01-02T00:00:00.000Z" },
};

describe("Web object routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  describe("GET /api/websites/:websiteId/web-objects", () => {
    it("returns 200 with the website's web objects, looked up by the found website's id", async () => {
      mockDbService.listWebObjectsForWebsite.mockResolvedValue([sampleWebObject]);

      const res = await request(createWebObjectsApp()).get(WEB_OBJECTS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleWebObject]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listWebObjectsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createWebObjectsApp()).get(WEB_OBJECTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listWebObjectsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listWebObjectsForWebsite.mockRejectedValue(new Error("timeout"));

      const res = await request(createWebObjectsApp()).get(WEB_OBJECTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "timeout" });
    });
  });

  describe("PUT /api/websites/:websiteId/web-objects/:webObjectId", () => {
    it("returns 200 with the renamed object, renaming it on the found website with the trimmed name", async () => {
      const renamedWebObject = { ...sampleWebObject, name: "Site" };
      mockDbService.renameWebObject.mockResolvedValue(renamedWebObject);

      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: "  Site " });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(renamedWebObject);
      expect(mockDbService.renameWebObject).toHaveBeenCalledWith(foundWebsite.id, "web-object-1", "Site");
    });

    it("resets the object to its detected name for a null name", async () => {
      mockDbService.renameWebObject.mockResolvedValue(sampleWebObject);

      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: null });

      expect(res.status).toBe(200);
      expect(mockDbService.renameWebObject).toHaveBeenCalledWith(foundWebsite.id, "web-object-1", null);
    });

    it("returns 400 for an invalid body, before looking anything up", async () => {
      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: 5 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The name must be text, or null to use the detected name" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: "Site" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.renameWebObject).not.toHaveBeenCalled();
    });

    it("returns 404 Web object not found when the object does not exist or a newer crawl replaced it", async () => {
      mockDbService.renameWebObject.mockResolvedValue(null);

      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: "Site" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEB_OBJECT_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the rename fails", async () => {
      mockDbService.renameWebObject.mockRejectedValue(new Error("connection reset"));

      const res = await request(createWebObjectsApp()).put(WEB_OBJECT_PATH).send({ name: "Site" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection reset" });
    });
  });
});
