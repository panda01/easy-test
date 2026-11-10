import { type Express } from "express";
import { findLoginRunForAction, listLoginRunsForAction } from "../services/dbService.js";
import {
  ACTION_ALREADY_RUNNING_MESSAGE,
  claimActionRun,
  isActionScriptRequestProblem,
  releaseActionRun,
} from "../services/actionScriptExecutionService.js";
import { performLoginRun } from "../services/loginRunService.js";
import { describeError } from "../utils/describeError.js";
import { validateLoginRunStartInput } from "../utils/validateRequestBodies.js";
import { sendStoredImageFile } from "../utils/sendStoredImageFile.js";
import { findWebsiteAndAction } from "./actionLookups.js";

const LOGIN_RUN_NOT_FOUND_MESSAGE = "Login run not found";
const LOGIN_RUN_HAS_NO_SCREENSHOT_MESSAGE = "This login run could not take a screenshot";
const LOGIN_RUN_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Login run screenshot file not found";

/**
 * Registers the login run routes: "Run login" on a Login action, its run
 * history, and each run's screenshot. Every path is nested under
 * `/api/websites/:websiteId/actions/:actionId`, and every route first
 * confirms the website and the action are active (404 otherwise).
 * @param app - The express application to attach the routes to
 * @param actionScriptDirectory - Absolute path login run folders are written to and screenshots served from (the same directory plan runs use)
 */
export function registerLoginRunRoutes(app: Express, actionScriptDirectory: string): void {
  /**
   * Lists a Login action's active login runs, newest first. Each run says
   * who it logged in as and where (`credentialName`, `loginUrl`), whether it
   * `succeeded`, why not (`errorMessage`), its `screenshotFileName` (served
   * by the screenshot route below), `finalPageUrl`, `output`, and
   * `durationMs`. Any other action simply has none.
   * @route GET /api/websites/:websiteId/actions/:actionId/login-runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the Login action's cuid
   * @returns 200 with an array of login runs; 404 with `{ error }` when the website or action does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/actions/:actionId/login-runs", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      res.json(await listLoginRunsForAction(website.id, action.id));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Runs the Login action's login once, on its own ("Run login"), as the
   * credential the body names: a browser on this machine opens the Login
   * action's login page (its own, or the website's), types the credential's
   * username and password with the built-in login routine, submits, and
   * checks the form went away. The run is recorded with one screenshot -
   * logged in, or what the failure showed. The request lasts as long as the
   * login does (well under a minute).
   * @route POST /api/websites/:websiteId/actions/:actionId/login-runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the Login action's cuid
   * @param body - JSON `{ credentialId }`: the cuid of one of the website's credentials to log in as (required)
   * @returns 201 with the recorded login run (a failed login is still 201, with `succeeded: false`); 400 with `{ error }` for a missing or invalid `credentialId`, a credential that is not one of the website's, or when neither the Login action nor the website has a login page URL; 404 with `{ error }` when the website or action does not exist or was deleted; 409 with `{ error }` when the action is not a Login action or it is already running; 503 with `{ error }` when CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` when the password cannot be decrypted, the run folder cannot be written, the browser cannot start, or a query fails
   */
  app.post("/api/websites/:websiteId/actions/:actionId/login-runs", async (req, res) => {
    const validation = validateLoginRunStartInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;

      // Claimed BEFORE the first await below, so two requests that arrive
      // together cannot both log in as the same account; released however
      // this ends.
      const actionWasClaimed = claimActionRun(action.id);
      if (!actionWasClaimed) {
        res.status(409).json({ error: ACTION_ALREADY_RUNNING_MESSAGE });
        return;
      }
      try {
        const loginRun = await performLoginRun(actionScriptDirectory, website, action, validation.input.credentialId);
        res.status(201).json(loginRun);
      } finally {
        releaseActionRun(action.id);
      }
    } catch (error: unknown) {
      if (isActionScriptRequestProblem(error)) {
        res.status(error.httpStatus).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Serves one login run's screenshot as a PNG (`logged-in.png` after a
   * passed run, `failure.png` after a failed one). The stored relative name
   * is resolved inside the action script directory, so a name that tries to
   * climb out with `..` is refused rather than served.
   * @route GET /api/websites/:websiteId/actions/:actionId/login-runs/:loginRunId/screenshot
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the Login action's cuid
   * @param loginRunId - Path parameter: the login run's cuid
   * @returns 200 with the `image/png` bytes; 404 with `{ error }` when the website, action, or login run does not exist or was deleted, the run took no screenshot, or the file is gone from disk; 500 with `{ error }` when a query fails or the file cannot be read
   */
  app.get("/api/websites/:websiteId/actions/:actionId/login-runs/:loginRunId/screenshot", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      const loginRun = await findLoginRunForAction(website.id, action.id, req.params.loginRunId);
      if (loginRun === null) {
        res.status(404).json({ error: LOGIN_RUN_NOT_FOUND_MESSAGE });
        return;
      }
      const { screenshotFileName } = loginRun;
      const loginRunHasNoScreenshot = screenshotFileName === null;
      if (loginRunHasNoScreenshot) {
        res.status(404).json({ error: LOGIN_RUN_HAS_NO_SCREENSHOT_MESSAGE });
        return;
      }
      sendStoredImageFile(res, screenshotFileName, actionScriptDirectory, LOGIN_RUN_SCREENSHOT_FILE_NOT_FOUND_MESSAGE);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
