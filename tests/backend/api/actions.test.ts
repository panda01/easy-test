import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the action controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listActionsForWebsite: vi.fn(),
  findActionForWebsite: vi.fn(),
  createActionForWebsite: vi.fn(),
  updateActionForWebsite: vi.fn(),
  softDeleteActionForWebsite: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerActionRoutes } from "../../../server/controllers/actions.js";

/**
 * Builds a minimal app carrying only the action routes, mounted the same way
 * server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the action routes registered
 */
function createActionsApp(): Express {
  const app = express();
  app.use(express.json());
  registerActionRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";

// The id in the request path and the id on the row the lookup returns are
// deliberately different, so each test can prove the child query is scoped by
// the FOUND website's id rather than by the raw path parameter.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const ACTIONS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/actions`;
const ACTION_PATH = `${ACTIONS_PATH}/action-1`;

// Dates are ISO strings because that is how they cross the wire.
const sampleAction = {
  id: "action-1",
  websiteId: foundWebsite.id,
  title: "Log in",
  description: "Enter credentials and submit the form",
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
};

describe("action routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks the website first; it exists unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  describe("GET /api/websites/:websiteId/actions", () => {
    it("returns 200 with the website's actions, listed by the found website's id", async () => {
      mockDbService.listActionsForWebsite.mockResolvedValue([sampleAction]);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleAction]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listActionsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found and lists nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listActionsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection refused"));

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the list query rejects with a non-Error", async () => {
      mockDbService.listActionsForWebsite.mockRejectedValue(503);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "503" });
    });
  });

  describe("POST /api/websites/:websiteId/actions", () => {
    it("returns 201 with the created action, created under the found website with trimmed input", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: " Log in  ", description: "  Enter credentials and submit the form " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleAction);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Log in",
        description: "Enter credentials and submit the form",
      });
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send([{ title: "Log in", description: "Enter credentials" }]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and creates nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the insert fails", async () => {
      mockDbService.createActionForWebsite.mockRejectedValue(new Error("insert failed"));

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "insert failed" });
    });
  });

  describe("GET /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 200 with the action looked up by the found website's id and the path action id", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleAction);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
      );
    });

    it("returns 404 Website not found without looking up the action when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when the website has no such active action", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the action lookup fails", async () => {
      mockDbService.findActionForWebsite.mockRejectedValue(new Error("query timed out"));

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("PUT /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 200 with the updated action and passes the found website's id, path action id, and trimmed input", async () => {
      const updatedAction = { ...sampleAction, title: "Log out" };
      mockDbService.updateActionForWebsite.mockResolvedValue(updatedAction);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "  Log out", description: "Open the menu and log out  " });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedAction);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
        { title: "Log out", description: "Open the menu and log out" },
      );
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log out", description: 42 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A description is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and updates nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when the update matched no active action", async () => {
      mockDbService.updateActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the update fails", async () => {
      mockDbService.updateActionForWebsite.mockRejectedValue(new Error("update failed"));

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "update failed" });
    });
  });

  describe("DELETE /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 204 with no body after soft deleting by the found website's id and the path action id", async () => {
      mockDbService.softDeleteActionForWebsite.mockResolvedValue(true);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.softDeleteActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
      );
    });

    it("returns 404 Website not found and deletes nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.softDeleteActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when no active action was deleted", async () => {
      mockDbService.softDeleteActionForWebsite.mockResolvedValue(false);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the stringified value when the soft delete rejects with a non-Error", async () => {
      mockDbService.softDeleteActionForWebsite.mockRejectedValue("database offline");

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "database offline" });
    });
  });
});
