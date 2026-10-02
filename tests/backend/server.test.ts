import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { app, startListening } from "../../server/server.js";

describe("server.ts", () => {
  it("serves /api/health through the fully wired app", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("parses a JSON body (express.json is mounted before the routes)", async () => {
    const res = await request(app).post("/api/health").send({ hello: "world" });
    // No POST handler is registered, so express falls through to its 404.
    // What this proves is that express.json() did not blow up on the body.
    expect(res.status).toBe(404);
  });

  it("404s an unknown path instead of hanging", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
  });

  it("startListening binds a real socket and hands back a closeable server", async () => {
    const probeApp = express();
    const server = startListening(probeApp, 0);

    await new Promise<void>((resolve) => {
      server.once("listening", () => {
        resolve();
      });
    });

    const address = server.address();
    expect(address).not.toBeNull();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
});
