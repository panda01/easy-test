import { type Request, type Response, type Express } from "express";

/**
 * Registers the /api/health route on the given express app. Used for
 * liveness probes by manual curl checks, the throwaway Playwright sniff
 * scripts, and any future monitoring. Intentionally unauthenticated and
 * dependency-free - no database, no auth - so it can be hit before the rest
 * of the app is warm and still answer when the database is down.
 * @param app - The express application to attach the route to
 */
export function registerHealthRoutes(app: Express): void {
  /**
   * Returns a small JSON payload indicating the server is up.
   * @route GET /api/health
   * @returns `{ status: "ok", uptime }`, where `uptime` is process uptime in seconds
   */
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
}
