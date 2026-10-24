import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the created object controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listCreatedObjectsForWebsite: vi.fn(),
  removeCreatedObject: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerCreatedObjectRoutes } from "../../../server/controllers/createdObjects.js";

/**
 * Builds a minimal app carrying only the created object routes, mounted the
 * same way server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the created object routes registered
 */
function createCreatedObjectsApp(): Express {
  const app = express();
  app.use(express.json());
  registerCreatedObjectRoutes(app);
  return app;
}

// The id in the request path and the id on the row the lookup returns are
// deliberately different, so each test can prove the child query is scoped by
// the FOUND website's id rather than by the raw path parameter.
const foundWebsite = { id: "website-id-from-db", url: "https://example.com/", name: "Example" };
const CREATED_OBJECTS_PATH = "/api/websites/website-from-path/created-objects";

/** One created object as the list returns it (dates are ISO strings on the wire). */
const sampleCreatedObject = {
  id: "created-1",
  websiteId: foundWebsite.id,
  objectTypeKey: "/projects/{project}",
  objectTypeName: "Project",
  name: "Apollo 7",
  url: "https://example.com/projects/a7",
  lastSeenAt: null,
  notSeenSince: null,
  deletedOnSiteAt: null,
  deletedByActionScriptRun: null,
  action: { id: "action-1", title: "Create a project", deletedAt: null },
  createdAt: "2026-10-03T00:00:00.000Z",
};

describe("created object routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  describe("GET /api/websites/:websiteId/created-objects", () => {
    it("lists the found website's created objects", async () => {
      mockDbService.listCreatedObjectsForWebsite.mockResolvedValue([sampleCreatedObject]);

      const response = await request(createCreatedObjectsApp()).get(CREATED_OBJECTS_PATH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([sampleCreatedObject]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-from-path");
      expect(mockDbService.listCreatedObjectsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("answers 404 for a missing website and 500 when the query fails", async () => {
      mockDbService.findWebsiteById.mockResolvedValueOnce(null);
      const missingResponse = await request(createCreatedObjectsApp()).get(CREATED_OBJECTS_PATH);
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.body).toEqual({ error: "Website not found" });
      expect(mockDbService.listCreatedObjectsForWebsite).not.toHaveBeenCalled();

      mockDbService.listCreatedObjectsForWebsite.mockRejectedValue(new Error("database down"));
      const failedResponse = await request(createCreatedObjectsApp()).get(CREATED_OBJECTS_PATH);
      expect(failedResponse.status).toBe(500);
      expect(failedResponse.body).toEqual({ error: "database down" });
    });
  });

  describe("DELETE /api/websites/:websiteId/created-objects/:createdObjectId", () => {
    it("removes the created object from the found website's record", async () => {
      mockDbService.removeCreatedObject.mockResolvedValue(true);

      const response = await request(createCreatedObjectsApp()).delete(`${CREATED_OBJECTS_PATH}/created-1`);

      expect(response.status).toBe(204);
      expect(mockDbService.removeCreatedObject).toHaveBeenCalledWith(foundWebsite.id, "created-1");
    });

    it("answers 404 when nothing was removed or the website is missing, and 500 when the removal fails", async () => {
      mockDbService.removeCreatedObject.mockResolvedValueOnce(false);
      const notFoundResponse = await request(createCreatedObjectsApp()).delete(`${CREATED_OBJECTS_PATH}/created-9`);
      expect(notFoundResponse.status).toBe(404);
      expect(notFoundResponse.body).toEqual({ error: "Created object not found" });

      mockDbService.findWebsiteById.mockResolvedValueOnce(null);
      const missingResponse = await request(createCreatedObjectsApp()).delete(`${CREATED_OBJECTS_PATH}/created-1`);
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.body).toEqual({ error: "Website not found" });

      mockDbService.removeCreatedObject.mockRejectedValue(new Error("database down"));
      const failedResponse = await request(createCreatedObjectsApp()).delete(`${CREATED_OBJECTS_PATH}/created-1`);
      expect(failedResponse.status).toBe(500);
      expect(failedResponse.body).toEqual({ error: "database down" });
    });
  });
});
