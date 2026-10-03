import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Express } from "express";
import {
  findWebsiteById,
  listScreenshotRunsForWebsite,
  findScreenshotRunForWebsite,
  createScreenshotRunForWebsite,
} from "../services/dbService.js";
import { captureWebsiteScreenshot } from "../services/playwrightService.js";
import { describeError } from "../utils/describeError.js";
import { readSendErrorStatus } from "../utils/readSendErrorStatus.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const SCREENSHOT_RUN_NOT_FOUND_MESSAGE = "Screenshot run not found";
const RUN_HAS_NO_SCREENSHOT_MESSAGE = "This run did not capture a screenshot";
const SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Screenshot file not found";

/**
 * Builds a new screenshot's file name, relative to the screenshot directory:
 * one folder per website, one uniquely named PNG per run. The `/` separator
 * is what gets stored in the database, whatever the OS.
 * @param websiteId - The cuid of the website row (never a raw path parameter)
 * @returns `<websiteId>/<random uuid>.png`
 */
function buildScreenshotFileName(websiteId: string): string {
  return `${websiteId}/${randomUUID()}.png`;
}

/**
 * Registers the Playwright controller's routes: visiting a website with a
 * headless browser on this machine, screenshotting what it sees, and reading
 * back the recorded runs and their images.
 *
 * Every path is nested under `/api/websites/:websiteId`, and every route first
 * confirms that website is active - a deleted or unknown website answers 404
 * "Website not found" before anything else happens. Runs are soft deleted
 * together with their website.
 *
 * Unlike the CRUD registrars this one takes a second argument: the screenshot
 * directory, resolved once at boot by `resolveScreenshotDirectory()` in
 * `server.ts`, so tests can point it at a fixture directory.
 * @param app - The express application to attach the routes to
 * @param screenshotDirectory - Absolute path screenshots are written to and served from
 */
export function registerPlaywrightRoutes(app: Express, screenshotDirectory: string): void {
  /**
   * Lists a website's active screenshot runs, newest first.
   * @route GET /api/websites/:websiteId/screenshot-runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of screenshot runs; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/screenshot-runs", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const screenshotRuns = await listScreenshotRunsForWebsite(website.id);
      res.json(screenshotRuns);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Visits the website's URL with a headless Chromium on this machine, writes
   * a 1280x720 viewport screenshot when the page answered at all, and records
   * the run.
   *
   * A failed VISIT is still a successfully recorded run, so it answers 201
   * with `succeeded: false`: an HTTP 400+ page (screenshot kept), or a DNS
   * error / refused connection / timeout (no screenshot,
   * `screenshotFileName: null`).
   *
   * After the page loads, the screenshot waits for network idle (at most the
   * website's `networkIdleTimeoutMs`), then for the page to paint, and is
   * never taken sooner than the website's `screenshotMinimumWaitMs` after
   * load. If the network is still busy when the cap runs out, it is taken at
   * once. The request lasts up to the 30 second navigation timeout plus the
   * cap.
   * @route POST /api/websites/:websiteId/screenshot-runs
   * @param websiteId - Path parameter: the website's cuid
   * @returns 201 with the recorded screenshot run; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when the screenshot directory cannot be created, the browser cannot launch, or a query fails
   */
  app.post("/api/websites/:websiteId/screenshot-runs", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }

      const screenshotFileName = buildScreenshotFileName(website.id);
      const screenshotFilePath = path.join(screenshotDirectory, screenshotFileName);
      const capture = await captureWebsiteScreenshot(website.url, screenshotFilePath, {
        networkIdleTimeoutMs: website.networkIdleTimeoutMs,
        screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
      });

      const created = await createScreenshotRunForWebsite(website.id, {
        requestedUrl: website.url,
        succeeded: capture.succeeded,
        httpStatus: capture.httpStatus,
        errorMessage: capture.errorMessage,
        screenshotFileName: capture.screenshotWasCaptured ? screenshotFileName : null,
        durationMs: capture.durationMs,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Serves one run's screenshot as a PNG.
   *
   * The file is sent with `root` set to the screenshot directory, so the
   * stored relative name is resolved inside it: a name that tries to climb
   * out with `..` is refused rather than served, and a screenshot directory
   * that itself sits under a dot-folder still works.
   * @route GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot
   * @param websiteId - Path parameter: the owning website's cuid
   * @param screenshotRunId - Path parameter: the screenshot run's cuid
   * @returns 200 with the `image/png` bytes; 404 with `{ error }` when the website or the run does not exist or was deleted, the run captured no screenshot, or the file is gone from disk; 500 with `{ error }` when a query fails or the file cannot be read
   */
  app.get(
    "/api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot",
    async (req, res) => {
      try {
        const website = await findWebsiteById(req.params.websiteId);
        if (website === null) {
          res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
          return;
        }
        const screenshotRun = await findScreenshotRunForWebsite(
          website.id,
          req.params.screenshotRunId,
        );
        if (screenshotRun === null) {
          res.status(404).json({ error: SCREENSHOT_RUN_NOT_FOUND_MESSAGE });
          return;
        }
        const { screenshotFileName } = screenshotRun;
        const runHasNoScreenshot = screenshotFileName === null;
        if (runHasNoScreenshot) {
          res.status(404).json({ error: RUN_HAS_NO_SCREENSHOT_MESSAGE });
          return;
        }

        /**
         * Answers the request when the file could not be sent. This callback
         * owns every send outcome: it runs after this async handler has
         * returned, so the surrounding try/catch never sees send errors.
         * @param sendError - Undefined when the file was sent; otherwise why it could not be
         */
        const handleScreenshotFileSent = (sendError?: Error): void => {
          const fileWasSent = sendError === undefined;
          if (fileWasSent) return;
          // The client went away mid-stream: the headers are already out, and
          // writing a JSON error now would throw ERR_HTTP_HEADERS_SENT.
          const responseAlreadyStarted = res.headersSent;
          if (responseAlreadyStarted) return;
          const fileIsMissing = readSendErrorStatus(sendError) === 404;
          if (fileIsMissing) {
            res.status(404).json({ error: SCREENSHOT_FILE_NOT_FOUND_MESSAGE });
            return;
          }
          res.status(500).json({ error: describeError(sendError) });
        };

        res.sendFile(screenshotFileName, { root: screenshotDirectory }, handleScreenshotFileSent);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );
}
