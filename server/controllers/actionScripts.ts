import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Express } from "express";
import {
  type Action,
  type ActionScript,
  type Website,
  findWebsiteById,
  findActionForWebsite,
  listActionScriptsForAction,
  findActionScriptForAction,
  createActionScriptForAction,
  listActionScriptRunsForScript,
  findActionScriptRunForScript,
  createActionScriptRunForScript,
} from "../services/dbService.js";
import { convertActionToScript } from "../services/scriptGenerationService.js";
import {
  FAILURE_SCREENSHOT_FILE_NAME,
  runPlaywrightScript,
} from "../services/scriptRunnerService.js";
import { describeError } from "../utils/describeError.js";
import { findScriptRuleViolations } from "../utils/findScriptRuleViolations.js";
import { readSendErrorStatus } from "../utils/readSendErrorStatus.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";
const SCRIPT_RUN_NOT_FOUND_MESSAGE = "Script run not found";
const RUN_HAS_NO_FAILURE_SCREENSHOT_MESSAGE = "This run did not capture a failure screenshot";
const FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Failure screenshot file not found";

/**
 * The status each known conversion failure answers with (see
 * `ScriptGenerationError` in the generation service). A missing API key is a
 * server configuration problem (503 Service Unavailable); the rest mean
 * Claude answered but its reply was unusable (502 Bad Gateway).
 */
const STATUS_BY_SCRIPT_GENERATION_FAILURE: Readonly<Record<string, number>> = {
  missingApiKey: 503,
  refused: 502,
  truncated: 502,
  unparseable: 502,
};

/** The outcome of looking up a chain of parent rows: all found, or the first one missing. */
type ParentLookup<TFound> =
  | { allWereFound: true; found: TFound }
  | { allWereFound: false; notFoundMessage: string };

/** The active website and action a script route works under. */
interface WebsiteAndAction {
  website: Website;
  action: Action;
}

/** The active website, action, and script a script-run route works under. */
interface WebsiteActionAndScript extends WebsiteAndAction {
  script: ActionScript;
}

/**
 * Looks up the active website, then the active action under it. Later lookups
 * use the FOUND rows' ids, never the raw path parameters.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @returns Both rows, or the 404 message for the first one missing
 */
async function findWebsiteAndAction(
  websiteId: string,
  actionId: string,
): Promise<ParentLookup<WebsiteAndAction>> {
  const website = await findWebsiteById(websiteId);
  if (website === null) {
    return { allWereFound: false, notFoundMessage: WEBSITE_NOT_FOUND_MESSAGE };
  }
  const action = await findActionForWebsite(website.id, actionId);
  if (action === null) {
    return { allWereFound: false, notFoundMessage: ACTION_NOT_FOUND_MESSAGE };
  }
  return { allWereFound: true, found: { website, action } };
}

/**
 * Looks up the active website, action, and script, in that order.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @param actionScriptId - Path parameter: the script's cuid
 * @returns All three rows, or the 404 message for the first one missing
 */
async function findWebsiteActionAndScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ParentLookup<WebsiteActionAndScript>> {
  const websiteAndActionLookup = await findWebsiteAndAction(websiteId, actionId);
  if (!websiteAndActionLookup.allWereFound) {
    return websiteAndActionLookup;
  }
  const { website, action } = websiteAndActionLookup.found;
  const script = await findActionScriptForAction(website.id, action.id, actionScriptId);
  if (script === null) {
    return { allWereFound: false, notFoundMessage: SCRIPT_NOT_FOUND_MESSAGE };
  }
  return { allWereFound: true, found: { website, action, script } };
}

/**
 * Picks the HTTP status for a failed conversion. Known failures are
 * `ScriptGenerationError`s, recognized structurally (by `name` and `reason`)
 * the same way dbService recognizes Prisma errors, so tests can throw plain
 * errors carrying those fields.
 * @param error - Whatever the conversion rejected with
 * @returns 503 for a missing API key, 502 for an unusable reply, 500 for anything else
 */
function statusForConversionFailure(error: unknown): number {
  const errorIsAnObject = typeof error === "object" && error !== null;
  if (!errorIsAnObject) {
    return 500;
  }
  const errorIsAScriptGenerationError =
    "name" in error && error.name === "ScriptGenerationError";
  const reason: unknown = "reason" in error ? error.reason : undefined;
  const reasonIsKnown = typeof reason === "string" && reason in STATUS_BY_SCRIPT_GENERATION_FAILURE;
  if (errorIsAScriptGenerationError && reasonIsKnown) {
    return STATUS_BY_SCRIPT_GENERATION_FAILURE[reason];
  }
  return 500;
}

/**
 * Builds a new run's folder name, relative to the action script directory:
 * one folder per website, one uniquely named folder per run. The `/`
 * separator is what gets stored in the database, whatever the OS.
 * @param websiteId - The cuid of the website row (never a raw path parameter)
 * @returns `<websiteId>/<random uuid>`
 */
function buildRunFolderName(websiteId: string): string {
  return `${websiteId}/${randomUUID()}`;
}

/**
 * Registers the action script routes: converting an action into a Playwright
 * script with Claude, listing an action's scripts, running a script, listing
 * a script's runs, and serving a failed run's screenshot.
 *
 * Every path is nested under `/api/websites/:websiteId/actions/:actionId`, and
 * every route first confirms the website and then the action are active,
 * answering 404 for the first one missing. Scripts and runs are create-only:
 * there are no PUT or DELETE routes, and they are soft deleted together with
 * their action or website.
 * @param app - The express application to attach the routes to
 * @param actionScriptDirectory - Absolute path script runs are written to and failure screenshots served from
 */
export function registerActionScriptRoutes(app: Express, actionScriptDirectory: string): void {
  /**
   * Lists an action's active scripts (every version), newest first.
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @returns 200 with an array of scripts; 404 with `{ error }` when the website or action does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/actions/:actionId/scripts", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      const scripts = await listActionScriptsForAction(website.id, action.id);
      res.json(scripts);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Converts the action into a new Playwright script with Claude, scans it for
   * forbidden features, and saves it as a new, immutable version.
   *
   * Claude gets the user's guidelines verbatim plus snapshots of the website
   * (name, URL as START_URL) and the action (title, description); the same
   * snapshots are stored on the script. Rule violations only WARN: they are
   * stored in `ruleViolations` and the script is saved either way. The request
   * lasts as long as Claude takes - often a minute or more.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action to convert
   * @returns 201 with the saved script; 404 with `{ error }` when the website or action does not exist or was deleted; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply had no usable script; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call or a query fails
   */
  app.post("/api/websites/:websiteId/actions/:actionId/scripts", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;

      const conversionRequest = {
        websiteName: website.name,
        startUrl: website.url,
        actionTitle: action.title,
        actionDescription: action.description,
      };
      const conversion = await convertActionToScript(conversionRequest);

      const created = await createActionScriptForAction(website.id, action.id, {
        ...conversionRequest,
        summary: conversion.summary,
        assumptions: conversion.assumptions,
        code: conversion.code,
        ruleViolations: findScriptRuleViolations(conversion.code),
        modelId: conversion.modelId,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(statusForConversionFailure(error)).json({ error: describeError(error) });
    }
  });

  /**
   * Lists a script's active runs, newest first.
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the script's cuid
   * @returns 200 with an array of runs; 404 with `{ error }` when the website, action, or script does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs",
    async (req, res) => {
      try {
        const lookup = await findWebsiteActionAndScript(
          req.params.websiteId,
          req.params.actionId,
          req.params.actionScriptId,
        );
        if (!lookup.allWereFound) {
          res.status(404).json({ error: lookup.notFoundMessage });
          return;
        }
        const { website, action, script } = lookup.found;
        const runs = await listActionScriptRunsForScript(website.id, action.id, script.id);
        res.json(runs);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Runs the stored script with `node` on this machine - it opens a visible
   * browser window - and records the run.
   *
   * The script is written to `<ACTION_SCRIPT_DIR>/<websiteId>/<uuid>/script.mjs`
   * and runs with no environment variables. A run that FAILED (non-zero exit,
   * a failure screenshot, or the 5 minute time limit) is still a successfully
   * recorded run, so it answers 201 with `succeeded: false`. The request lasts
   * as long as the script does, at most 5 minutes plus a few seconds to stop it.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the script to run
   * @returns 201 with the recorded run; 404 with `{ error }` when the website, action, or script does not exist or was deleted; 500 with `{ error }` when the run folder cannot be written, node cannot be started, or a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs",
    async (req, res) => {
      try {
        const lookup = await findWebsiteActionAndScript(
          req.params.websiteId,
          req.params.actionId,
          req.params.actionScriptId,
        );
        if (!lookup.allWereFound) {
          res.status(404).json({ error: lookup.notFoundMessage });
          return;
        }
        const { website, action, script } = lookup.found;

        const runFolderName = buildRunFolderName(website.id);
        const runDirectory = path.join(actionScriptDirectory, runFolderName);
        const run = await runPlaywrightScript(script.code, runDirectory);

        const created = await createActionScriptRunForScript(website.id, action.id, script.id, {
          succeeded: run.succeeded,
          exitCode: run.exitCode,
          exitSignal: run.exitSignal,
          timedOut: run.timedOut,
          output: run.output,
          outputWasTruncated: run.outputWasTruncated,
          failureScreenshotFileName: run.failureScreenshotWasCaptured
            ? `${runFolderName}/${FAILURE_SCREENSHOT_FILE_NAME}`
            : null,
          durationMs: run.durationMs,
        });
        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Serves one failed run's screenshot as a PNG.
   *
   * The file is sent with `root` set to the action script directory, so the
   * stored relative name is resolved inside it and a name that tries to climb
   * out with `..` is refused rather than served.
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/failure-screenshot
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the script's cuid
   * @param actionScriptRunId - Path parameter: the run's cuid
   * @returns 200 with the `image/png` bytes; 404 with `{ error }` when the website, action, script, or run does not exist or was deleted, the run wrote no failure screenshot, or the file is gone from disk; 500 with `{ error }` when a query fails or the file cannot be read
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/failure-screenshot",
    async (req, res) => {
      try {
        const lookup = await findWebsiteActionAndScript(
          req.params.websiteId,
          req.params.actionId,
          req.params.actionScriptId,
        );
        if (!lookup.allWereFound) {
          res.status(404).json({ error: lookup.notFoundMessage });
          return;
        }
        const { website, action, script } = lookup.found;
        const run = await findActionScriptRunForScript(
          website.id,
          action.id,
          script.id,
          req.params.actionScriptRunId,
        );
        if (run === null) {
          res.status(404).json({ error: SCRIPT_RUN_NOT_FOUND_MESSAGE });
          return;
        }
        const { failureScreenshotFileName } = run;
        const runHasNoFailureScreenshot = failureScreenshotFileName === null;
        if (runHasNoFailureScreenshot) {
          res.status(404).json({ error: RUN_HAS_NO_FAILURE_SCREENSHOT_MESSAGE });
          return;
        }

        /**
         * Answers the request when the file could not be sent. This callback
         * owns every send outcome: it runs after this async handler has
         * returned, so the surrounding try/catch never sees send errors.
         * @param sendError - Undefined when the file was sent; otherwise why it could not be
         */
        const handleFailureScreenshotSent = (sendError?: Error): void => {
          const fileWasSent = sendError === undefined;
          if (fileWasSent) return;
          // The client went away mid-stream: the headers are already out, and
          // writing a JSON error now would throw ERR_HTTP_HEADERS_SENT.
          const responseAlreadyStarted = res.headersSent;
          if (responseAlreadyStarted) return;
          const fileIsMissing = readSendErrorStatus(sendError) === 404;
          if (fileIsMissing) {
            res.status(404).json({ error: FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE });
            return;
          }
          res.status(500).json({ error: describeError(sendError) });
        };

        res.sendFile(
          failureScreenshotFileName,
          { root: actionScriptDirectory },
          handleFailureScreenshotSent,
        );
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );
}
