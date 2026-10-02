import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the use case controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listUseCasesForWebsite: vi.fn(),
  findUseCaseForWebsite: vi.fn(),
  createUseCaseForWebsite: vi.fn(),
  updateUseCaseForWebsite: vi.fn(),
  softDeleteUseCaseForWebsite: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerUseCaseRoutes } from "../../../server/controllers/useCases.js";

/**
 * Builds a minimal app carrying only the use case routes, mounted the same way
 * server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the use case routes registered
 */
function createUseCasesApp(): Express {
  const app = express();
  app.use(express.json());
  registerUseCaseRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const USE_CASE_NOT_FOUND_MESSAGE = "Use case not found";

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

const USE_CASES_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/use-cases`;
const USE_CASE_PATH = `${USE_CASES_PATH}/use-case-1`;

// Dates are ISO strings because that is how they cross the wire.
const sampleUseCase = {
  id: "use-case-1",
  websiteId: foundWebsite.id,
  title: "Sign up",
  description: "Create an account and land on the dashboard",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

describe("use case routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks the website first; it exists unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  describe("GET /api/websites/:websiteId/use-cases", () => {
    it("returns 200 with the website's use cases, listed by the found website's id", async () => {
      mockDbService.listUseCasesForWebsite.mockResolvedValue([sampleUseCase]);

      const res = await request(createUseCasesApp()).get(USE_CASES_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleUseCase]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listUseCasesForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found and lists nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createUseCasesApp()).get(USE_CASES_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listUseCasesForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection refused"));

      const res = await request(createUseCasesApp()).get(USE_CASES_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the list query rejects with a non-Error", async () => {
      mockDbService.listUseCasesForWebsite.mockRejectedValue({ code: "P1001" });

      const res = await request(createUseCasesApp()).get(USE_CASES_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST /api/websites/:websiteId/use-cases", () => {
    it("returns 201 with the created use case, created under the found website with trimmed input", async () => {
      mockDbService.createUseCaseForWebsite.mockResolvedValue(sampleUseCase);

      const res = await request(createUseCasesApp())
        .post(USE_CASES_PATH)
        .send({
          title: "  Sign up ",
          description: " Create an account and land on the dashboard  ",
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleUseCase);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.createUseCaseForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Sign up",
        description: "Create an account and land on the dashboard",
      });
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createUseCasesApp())
        .post(USE_CASES_PATH)
        .send({ title: "Sign up" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A description is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.createUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and creates nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createUseCasesApp())
        .post(USE_CASES_PATH)
        .send({ title: "Sign up", description: "Create an account" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.createUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the insert fails", async () => {
      mockDbService.createUseCaseForWebsite.mockRejectedValue(new Error("insert failed"));

      const res = await request(createUseCasesApp())
        .post(USE_CASES_PATH)
        .send({ title: "Sign up", description: "Create an account" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "insert failed" });
    });
  });

  describe("GET /api/websites/:websiteId/use-cases/:useCaseId", () => {
    it("returns 200 with the use case looked up by the found website's id and the path use case id", async () => {
      mockDbService.findUseCaseForWebsite.mockResolvedValue(sampleUseCase);

      const res = await request(createUseCasesApp()).get(USE_CASE_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleUseCase);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.findUseCaseForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "use-case-1",
      );
    });

    it("returns 404 Website not found without looking up the use case when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createUseCasesApp()).get(USE_CASE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Use case not found when the website has no such active use case", async () => {
      mockDbService.findUseCaseForWebsite.mockResolvedValue(null);

      const res = await request(createUseCasesApp()).get(USE_CASE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: USE_CASE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the use case lookup fails", async () => {
      mockDbService.findUseCaseForWebsite.mockRejectedValue(new Error("query timed out"));

      const res = await request(createUseCasesApp()).get(USE_CASE_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("PUT /api/websites/:websiteId/use-cases/:useCaseId", () => {
    it("returns 200 with the updated use case and passes the found website's id, path use case id, and trimmed input", async () => {
      const updatedUseCase = { ...sampleUseCase, title: "Sign up with Google" };
      mockDbService.updateUseCaseForWebsite.mockResolvedValue(updatedUseCase);

      const res = await request(createUseCasesApp())
        .put(USE_CASE_PATH)
        .send({ title: " Sign up with Google ", description: " Use the OAuth button " });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedUseCase);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.updateUseCaseForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "use-case-1",
        { title: "Sign up with Google", description: "Use the OAuth button" },
      );
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createUseCasesApp())
        .put(USE_CASE_PATH)
        .send({ title: "   ", description: "Steps" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A title is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.updateUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and updates nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createUseCasesApp())
        .put(USE_CASE_PATH)
        .send({ title: "Sign up", description: "Create an account" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.updateUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Use case not found when the update matched no active use case", async () => {
      mockDbService.updateUseCaseForWebsite.mockResolvedValue(null);

      const res = await request(createUseCasesApp())
        .put(USE_CASE_PATH)
        .send({ title: "Sign up", description: "Create an account" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: USE_CASE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the update fails", async () => {
      mockDbService.updateUseCaseForWebsite.mockRejectedValue(new Error("update failed"));

      const res = await request(createUseCasesApp())
        .put(USE_CASE_PATH)
        .send({ title: "Sign up", description: "Create an account" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "update failed" });
    });
  });

  describe("DELETE /api/websites/:websiteId/use-cases/:useCaseId", () => {
    it("returns 204 with no body after soft deleting by the found website's id and the path use case id", async () => {
      mockDbService.softDeleteUseCaseForWebsite.mockResolvedValue(true);

      const res = await request(createUseCasesApp()).delete(USE_CASE_PATH);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.softDeleteUseCaseForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "use-case-1",
      );
    });

    it("returns 404 Website not found and deletes nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createUseCasesApp()).delete(USE_CASE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.softDeleteUseCaseForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Use case not found when no active use case was deleted", async () => {
      mockDbService.softDeleteUseCaseForWebsite.mockResolvedValue(false);

      const res = await request(createUseCasesApp()).delete(USE_CASE_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: USE_CASE_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the stringified value when the soft delete rejects with a non-Error", async () => {
      mockDbService.softDeleteUseCaseForWebsite.mockRejectedValue("database offline");

      const res = await request(createUseCasesApp()).delete(USE_CASE_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "database offline" });
    });
  });
});
