// MUST be the first import - runs dotenv.config(...) so downstream modules
// that read `process.env.<X>` at their own load time find their values
// populated by the time their module bodies execute.
import "./bootEnv.js";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { resolveServerPort } from "./utils/resolveServerPort.js";
import { resolveScreenshotDirectory } from "./utils/resolveScreenshotDirectory.js";
import { resolveActionScriptDirectory } from "./utils/resolveActionScriptDirectory.js";
import { registerHealthRoutes } from "./controllers/health.js";
import { registerWebsiteRoutes } from "./controllers/websites.js";
import { registerUseCaseRoutes } from "./controllers/useCases.js";
import { registerActionRoutes } from "./controllers/actions.js";
import { registerPlaywrightRoutes } from "./controllers/playwright.js";
import { registerActionScriptRoutes } from "./controllers/actionScripts.js";

const app = express();
const PORT = resolveServerPort();
// Resolved once at boot so a missing SCREENSHOT_DIR is a startup error, not a
// 500 on the first screenshot. Passed to the Playwright routes explicitly.
const SCREENSHOT_DIRECTORY = resolveScreenshotDirectory();
// Same for ACTION_SCRIPT_DIR, which must also sit inside the project so the
// generated scripts can import 'playwright' from its node_modules.
const ACTION_SCRIPT_DIRECTORY = resolveActionScriptDirectory();

// === Express middleware ===
// Order is deliberate: body parsing, then cookies, then (once this project has
// one) auth middleware, then static mounts, then routes.
//
// There is no `cors` package anywhere in this codebase and there should not be
// one: the Vite dev server proxies /api to this process, so the browser only
// ever sees a single origin.
//
// There is also no global error middleware. Each route try/catches and returns
// `res.status(5xx).json({ error: message })` itself, so a failure reports the
// thing that actually failed instead of a generic handler's guess.
app.use(express.json());
app.use(cookieParser());

// DEV-ONLY SCAFFOLD: the production `express.static(dist)` mount goes here,
// and the production SPA fallback goes after route registration below. Both
// are omitted until this project grows a production deploy.

// === Route registration ===
// No `express.Router()` anywhere. Each controller exports a
// `register<Section>Routes(app)` that declares full literal paths, so grepping
// for "/api/health" finds the route in one hop.
registerHealthRoutes(app);
registerWebsiteRoutes(app);
registerUseCaseRoutes(app);
registerActionRoutes(app);
registerPlaywrightRoutes(app, SCREENSHOT_DIRECTORY);
registerActionScriptRoutes(app, ACTION_SCRIPT_DIRECTORY);

/**
 * Binds the Express app to a TCP port and logs the resolved URL.
 *
 * Split out of the module body and exported so a unit test can bind port 0,
 * assert the socket really came up, and close it again. The module-body call
 * below is skipped under NODE_ENV=test, so importing `app` into supertest
 * never grabs a socket.
 * @param expressApp - The app to bind
 * @param port - TCP port to listen on; 0 asks the OS for a free one
 * @returns The Node HTTP server, so callers can close it
 */
export function startListening(expressApp: Express, port: number): Server {
  return expressApp.listen(port, () => {
    console.log(`[server] easy-test API listening on http://localhost:${port}`);
  });
}

const serverIsUnderTest = process.env.NODE_ENV === "test";
if (!serverIsUnderTest) {
  startListening(app, PORT);
}

export { app };
