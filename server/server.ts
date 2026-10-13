// MUST be the first import - runs dotenv.config(...) so downstream modules
// that read `process.env.<X>` at their own load time find their values
// populated by the time their module bodies execute.
import "./bootEnv.js";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import path from "node:path";
import { resolveServerPort } from "./utils/resolveServerPort.js";
import { describeError } from "./utils/describeError.js";
import { readSendErrorStatus } from "./utils/readSendErrorStatus.js";
import { resolveScreenshotDirectory } from "./utils/resolveScreenshotDirectory.js";
import { resolveActionScriptDirectory } from "./utils/resolveActionScriptDirectory.js";
import { registerHealthRoutes } from "./controllers/health.js";
import { registerWebsiteRoutes } from "./controllers/websites.js";
import { registerUseCaseRoutes } from "./controllers/useCases.js";
import { registerActionRoutes } from "./controllers/actions.js";
import { registerPlaywrightRoutes } from "./controllers/playwright.js";
import { registerActionScriptRoutes } from "./controllers/actionScripts.js";
import { registerScriptModelRoutes } from "./controllers/scriptModels.js";
import { registerCrawlRunRoutes } from "./controllers/crawlRuns.js";
import { registerCredentialRoutes } from "./controllers/credentials.js";
import { markUnfinishedCrawlRunsInterrupted } from "./services/crawlRunService.js";

const app = express();
const PORT = resolveServerPort();
// Resolved once at boot so a missing SCREENSHOT_DIR is a startup error, not a
// 500 on the first screenshot. Passed to the Playwright routes explicitly.
const SCREENSHOT_DIRECTORY = resolveScreenshotDirectory();
// Same for ACTION_SCRIPT_DIR, which must also sit inside the project so the
// generated scripts can import 'playwright' from its node_modules.
const ACTION_SCRIPT_DIRECTORY = resolveActionScriptDirectory();
// `npm start` runs this process under pm2 with NODE_ENV=production
// (ecosystem.config.json), and then it serves the built client itself. In
// development the Vite dev server serves the client and proxies /api here.
const serverIsInProduction = process.env.NODE_ENV === "production";
// Where `vite build` writes the client (vite.config.ts `build.outDir`),
// resolved against the project root like SCREENSHOT_DIR.
const CLIENT_BUILD_DIRECTORY = path.join(process.cwd(), "dist");

// === Express middleware ===
// Order is deliberate: body parsing, then cookies, then (once this project has
// one) auth middleware, then static mounts, then routes.
//
// There is no `cors` package anywhere in this codebase and there should not be
// one: the Vite dev server proxies /api to this process, and in production this
// process serves the built client itself, so the browser only ever sees a
// single origin.
//
// There is also no global error middleware. Each route try/catches and returns
// `res.status(5xx).json({ error: message })` itself, so a failure reports the
// thing that actually failed instead of a generic handler's guess.
app.use(express.json());
app.use(cookieParser());

// Production only: the built client's files (index.html, /assets/*). A
// request that matches no file falls through to the routes below.
if (serverIsInProduction) {
  serveBuiltClientFiles(app, CLIENT_BUILD_DIRECTORY);
}

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
registerScriptModelRoutes(app);
registerCrawlRunRoutes(app, SCREENSHOT_DIRECTORY);
registerCredentialRoutes(app);

// Production only, and after every route so the API always wins: any other
// page load answers index.html, so react-router can render a client route.
if (serverIsInProduction) {
  serveClientRoutesFromIndexHtml(app, CLIENT_BUILD_DIRECTORY);
}

/**
 * Serves the Vite production build's files (`index.html`, `/assets/*`) as
 * static files, so the browser loads the client from this same origin.
 *
 * Production only; the module body mounts it before the routes when
 * NODE_ENV=production. Exported so a unit test can mount it on a fresh app
 * against a fixture directory.
 * @param expressApp - The app to mount the static files on
 * @param clientBuildDirectory - Absolute path of the `vite build` output (`dist/`)
 */
export function serveBuiltClientFiles(expressApp: Express, clientBuildDirectory: string): void {
  expressApp.use(express.static(clientBuildDirectory));
}

/**
 * Answers every page load (GET or HEAD) outside `/api` with the built
 * `index.html`, so a reload or a pasted link on a client route such as
 * `/websites/:websiteId` reaches react-router instead of Express's 404.
 * Other methods, and `/api` paths no route matched, fall through to Express's
 * own 404.
 *
 * Production only; the module body mounts it after every route when
 * NODE_ENV=production. Exported so a unit test can mount it on a fresh app
 * against a fixture directory.
 * @param expressApp - The app to mount the fallback on
 * @param clientBuildDirectory - Absolute path of the `vite build` output (`dist/`)
 */
export function serveClientRoutesFromIndexHtml(
  expressApp: Express,
  clientBuildDirectory: string,
): void {
  expressApp.use((req, res, next) => {
    const requestIsAPageLoad = req.method === "GET" || req.method === "HEAD";
    const requestIsForTheApi = req.path === "/api" || req.path.startsWith("/api/");
    if (!requestIsAPageLoad || requestIsForTheApi) {
      next();
      return;
    }

    /**
     * Answers the request when index.html could not be sent (no build in
     * `clientBuildDirectory`, or a read error).
     * @param sendError - Undefined when the file was sent; otherwise why it could not be
     */
    const handleIndexHtmlSent = (sendError?: Error): void => {
      const fileWasSent = sendError === undefined;
      if (fileWasSent) return;
      // The client went away mid-stream: the headers are already out, and
      // writing a JSON error now would throw ERR_HTTP_HEADERS_SENT.
      const responseAlreadyStarted = res.headersSent;
      if (responseAlreadyStarted) return;
      const sendErrorStatus = readSendErrorStatus(sendError) ?? 500;
      res.status(sendErrorStatus).json({ error: describeError(sendError) });
    };

    res.sendFile("index.html", { root: clientBuildDirectory }, handleIndexHtmlSent);
  });
}

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
  // A crawl only runs inside this process, so any crawl run still "running"
  // was cut off by a restart. Awaited BEFORE listening, so it can never flip
  // a crawl this process starts. It never rejects (failures are logged).
  await markUnfinishedCrawlRunsInterrupted();
  startListening(app, PORT);
  if (serverIsInProduction) {
    console.log(`[server] production: serving the built client from ${CLIENT_BUILD_DIRECTORY}`);
  }
}

export { app };
