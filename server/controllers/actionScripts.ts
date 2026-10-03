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
  type EffortLevel,
  type ScriptModelOption,
  findScriptModel,
} from "../services/scriptModelService.js";
import {
  FAILURE_SCREENSHOT_FILE_NAME,
  runPlaywrightScript,
} from "../services/scriptRunnerService.js";
import { describeError } from "../utils/describeError.js";
import { findScriptRuleViolations } from "../utils/findScriptRuleViolations.js";
import { readSendErrorStatus } from "../utils/readSendErrorStatus.js";
import { statusForScriptGenerationFailure } from "../utils/statusForScriptGenerationFailure.js";
import { validateScriptModelChoiceInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";
const SCRIPT_RUN_NOT_FOUND_MESSAGE = "Script run not found";
const RUN_HAS_NO_FAILURE_SCREENSHOT_MESSAGE = "This run did not capture a failure screenshot";
const FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Failure screenshot file not found";

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

/** Whether a model offers the requested effort level, with the level narrowed when it does. */
type EffortResolution =
  | { isOffered: true; effort: EffortLevel | null }
  | { isOffered: false; problem: string };

/**
 * Checks a requested effort level against what the chosen model offers. A
 * model with no effort setting must be sent no level ("Standard"); any other
 * model must be sent one of its own levels.
 * @param model - The chosen model, from the live catalog
 * @param requestedEffort - The level the request asked for, or null
 * @returns The level to use, or a message saying what is wrong
 */
function resolveEffortForModel(
  model: ScriptModelOption,
  requestedEffort: string | null,
): EffortResolution {
  const offeredLevelsText = model.effortLevels.join(", ");
  const modelHasNoEffortSetting = model.effortLevels.length === 0;
  if (modelHasNoEffortSetting) {
    const noLevelWasRequested = requestedEffort === null;
    if (noLevelWasRequested) {
      return { isOffered: true, effort: null };
    }
    return {
      isOffered: false,
      problem: `${model.displayName} has no effort setting, so no effort level can be chosen for it`,
    };
  }

  const offeredLevel = model.effortLevels.find((effortLevel) => effortLevel === requestedEffort);
  if (offeredLevel !== undefined) {
    return { isOffered: true, effort: offeredLevel };
  }
  const noLevelWasRequested = requestedEffort === null;
  const problem = noLevelWasRequested
    ? `${model.displayName} needs an effort level: ${offeredLevelsText}`
    : `${model.displayName} does not offer the "${requestedEffort}" effort level; it offers ${offeredLevelsText}`;
  return { isOffered: false, problem };
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
   * Converts the action into a new Playwright script with Claude, using the
   * model and effort level the user picked, scans it for forbidden features,
   * and saves it as a new, immutable version.
   *
   * The model must be in the live model catalog (see `scriptModelService`)
   * and the effort level must be one it offers - or null for a model with no
   * effort setting. Claude gets the user's guidelines verbatim plus snapshots
   * of the website (name, URL as START_URL) and the action (title,
   * description); the same snapshots are stored on the script, along with the
   * model that answered (`modelId`) and the effort level sent (`effort`). Rule
   * violations only WARN: they are stored in `ruleViolations` and the script
   * is saved either way. The request lasts as long as Claude takes.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action to convert
   * @param body - JSON `{ modelId, effort }`; `modelId` required, `effort` a level the model offers or null for "Standard"
   * @returns 201 with the saved script; 400 with `{ error }` for an invalid body, a model not in the catalog, or an effort level the model does not offer; 404 with `{ error }` when the website or action does not exist or was deleted; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply had no usable script; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call or a query fails
   */
  app.post("/api/websites/:websiteId/actions/:actionId/scripts", async (req, res) => {
    const choiceValidation = validateScriptModelChoiceInput(req.body);
    if (!choiceValidation.isValid) {
      res.status(400).json({ error: choiceValidation.errorMessage });
      return;
    }
    const { modelId, effort: requestedEffort } = choiceValidation.input;

    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;

      const model = await findScriptModel(modelId);
      if (model === null) {
        res.status(400).json({ error: `Unknown model "${modelId}"; pick one from the model list` });
        return;
      }
      const effortResolution = resolveEffortForModel(model, requestedEffort);
      if (!effortResolution.isOffered) {
        res.status(400).json({ error: effortResolution.problem });
        return;
      }

      const conversionRequest = {
        websiteName: website.name,
        startUrl: website.url,
        actionTitle: action.title,
        actionDescription: action.description,
      };
      const conversion = await convertActionToScript(conversionRequest, {
        model,
        effort: effortResolution.effort,
      });

      const created = await createActionScriptForAction(website.id, action.id, {
        ...conversionRequest,
        summary: conversion.summary,
        assumptions: conversion.assumptions,
        code: conversion.code,
        ruleViolations: findScriptRuleViolations(conversion.code),
        modelId: conversion.modelId,
        effort: conversion.effort,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
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
