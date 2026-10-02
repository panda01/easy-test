import { describe, it, expect } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { registerHealthRoutes } from "../../../server/controllers/health.js";

/**
 * Builds a minimal app carrying only the health route.
 *
 * Mounted standalone rather than importing the full server so this spec can
 * never be affected by unrelated boot work added to server.ts later.
 *
 * @returns {Express} An app with the health routes registered
 */
function createHealthApp(): Express {
  const app = express();
  app.use(express.json());
  registerHealthRoutes(app);
  return app;
}

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(createHealthApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("reports process uptime as a non-negative number", async () => {
    const res = await request(createHealthApp()).get("/api/health");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
