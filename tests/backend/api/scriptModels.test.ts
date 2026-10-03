import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/**
 * The catalog service is mocked except for `chooseDefaultScriptModel`, which
 * is pure, so the route's default choice is the real one.
 */
const mockScriptModelService = vi.hoisted(() => ({ listScriptModels: vi.fn() }));

vi.mock("../../../server/services/scriptModelService.js", async (importOriginal) => {
  const actualService =
    await importOriginal<typeof import("../../../server/services/scriptModelService.js")>();
  return { ...actualService, listScriptModels: mockScriptModelService.listScriptModels };
});

import { registerScriptModelRoutes } from "../../../server/controllers/scriptModels.js";

/**
 * Builds a minimal app carrying only the script model route.
 * @returns An app with the script model route registered
 */
function createScriptModelsApp(): Express {
  const app = express();
  app.use(express.json());
  registerScriptModelRoutes(app);
  return app;
}

const opusModel = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  supportsAdaptiveThinking: true,
  fallbackModel: { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
};
const haikuModel = {
  id: "claude-haiku-4-5-20251001",
  displayName: "Claude Haiku 4.5",
  effortLevels: [],
  supportsAdaptiveThinking: false,
  fallbackModel: null,
};

describe("GET /api/script-models", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with every usable model and the default choice", async () => {
    mockScriptModelService.listScriptModels.mockResolvedValue([haikuModel, opusModel]);

    const res = await request(createScriptModelsApp()).get("/api/script-models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      models: [haikuModel, opusModel],
      defaultModelId: "claude-opus-5-5",
      defaultEffort: "high",
    });
  });

  it("returns null defaults when no model is usable", async () => {
    mockScriptModelService.listScriptModels.mockResolvedValue([]);

    const res = await request(createScriptModelsApp()).get("/api/script-models");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [], defaultModelId: null, defaultEffort: null });
  });

  it("returns 503 with the reason when no API key is configured", async () => {
    mockScriptModelService.listScriptModels.mockRejectedValue(
      Object.assign(new Error("ANTHROPIC_API_KEY is not set in .env.local"), {
        name: "ScriptGenerationError",
        reason: "missingApiKey",
      }),
    );

    const res = await request(createScriptModelsApp()).get("/api/script-models");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "ANTHROPIC_API_KEY is not set in .env.local" });
  });

  it("returns 500 when the Models API call fails", async () => {
    mockScriptModelService.listScriptModels.mockRejectedValue(new Error("Connection error."));

    const res = await request(createScriptModelsApp()).get("/api/script-models");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Connection error." });
  });
});
