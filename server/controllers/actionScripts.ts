import { type Express } from "express";
import {
  findActionCleanupForCreateAction,
  findActionForWebsite,
  findLatestCrawledPagesForWebsite,
  findNewestActionScriptForAction,
  listActionScriptsForAction,
  createActionScriptForAction,
  listActionScriptRunsForScript,
  findActionScriptRunForScript,
  findActionScriptRunDetailForScript,
  findActionScriptRunScreenshotForRun,
  findLoginActionForWebsite,
  type ActionScriptWithPlan,
  type ActionWithCredential,
  type Website,
} from "../services/dbService.js";
import { convertActionToPlan, type ScriptModelChoice } from "../services/scriptGenerationService.js";
import { findScriptModel } from "../services/scriptModelService.js";
import { syncActionParametersQuietly } from "../services/actionParameterService.js";
import {
  ACTION_ALREADY_RUNNING_MESSAGE,
  CLEANUP_FAILURE_CANNOT_BE_REFINED_MESSAGE,
  EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE,
  LOGIN_ACTION_HAS_NO_STEPS_MESSAGE,
  ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE,
  RUN_ALREADY_BEING_REFINED_MESSAGE,
  runFailedOnlyInItsCleanup,
  allowedOriginsFor,
  claimActionRun,
  claimRunRefinement,
  describeFailedRun,
  findActionCredential,
  isActionScriptRequestProblem,
  performActionScriptRun,
  performRefinement,
  releaseActionRun,
  releaseRunRefinement,
  resolveEffortForModel,
} from "../services/actionScriptExecutionService.js";
import { describeError } from "../utils/describeError.js";
import { sendStoredImageFile } from "../utils/sendStoredImageFile.js";
import { extractActionSearchTerms, selectRelevantCrawledPages } from "../utils/selectRelevantCrawledPages.js";
import { statusForScriptGenerationFailure } from "../utils/statusForScriptGenerationFailure.js";
import {
  validateActionPlanEditInput,
  validateActionPlanRefineInput,
  validateRunParameterValuesInput,
  validateScriptModelChoiceInput,
} from "../utils/validateRequestBodies.js";
import { findWebsiteAndAction, findWebsiteActionAndScript } from "./actionLookups.js";
import { isLoginAction } from "../utils/scoreActionObjectRole.js";

const SCRIPT_RUN_NOT_FOUND_MESSAGE = "Script run not found";
const RUN_HAS_NO_FAILURE_SCREENSHOT_MESSAGE = "This run did not capture a failure screenshot";
const FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Failure screenshot file not found";
const STEP_SCREENSHOT_NOT_FOUND_MESSAGE = "Step screenshot not found";
const STEP_SCREENSHOT_WAS_NOT_TAKEN_MESSAGE = "This step screenshot could not be taken during the run";
const STEP_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Step screenshot file not found";

/**
 * Converts one action into a plan with Claude and saves it as a new version
 * - the work behind "Convert to script", shared by the action being
 * converted and, for a Create action, its Delete action. Claude gets the
 * website, the action, the NAME of its credential, and the aria snapshots of
 * the crawled pages most relevant to it (from the newest crawl done the way
 * the action runs); the same snapshots are stored on the version, and the
 * action's parameters are synced once it is saved.
 * @param website - The website
 * @param action - The action to convert
 * @param choice - The model and effort level to use
 * @returns The saved version
 * @throws {ScriptGenerationError} When Claude declined, its reply was cut off, or the reply was not a valid plan
 * @throws Anything else the Anthropic API call or a query rejects with
 */
async function convertActionAndSaveVersion(
  website: Website,
  action: ActionWithCredential,
  choice: ScriptModelChoice,
): Promise<ActionScriptWithPlan> {
  const credential = await findActionCredential(website, action);
  const allowedOrigins = allowedOriginsFor(website, await findLoginActionForWebsite(website.id));
  const crawledPages = await findLatestCrawledPagesForWebsite(website.id, credential?.id ?? null);
  const searchTerms = extractActionSearchTerms(action.title, action.description);
  const contextPages = selectRelevantCrawledPages(crawledPages, searchTerms);

  const snapshots = {
    websiteName: website.name,
    startUrl: website.url,
    actionTitle: action.title,
    actionDescription: action.description,
    credentialId: credential?.id ?? null,
    credentialName: credential?.name ?? null,
  };
  const conversion = await convertActionToPlan({ ...snapshots, allowedOrigins, contextPages }, choice);
  const created = await createActionScriptForAction(website.id, action.id, {
    ...snapshots,
    summary: conversion.summary,
    assumptions: conversion.assumptions,
    plan: conversion.plan,
    contextPageUrls: contextPages.map((page) => page.url),
    modelId: conversion.modelId,
    effort: conversion.effort,
    editedFromActionScriptId: null,
  });
  await syncActionParametersQuietly(website.id, action);
  return created;
}

/**
 * Finds the Delete action linked to a Create action when that Delete action
 * has no version yet - the one "Convert to script" also converts.
 * @param website - The website
 * @param action - The action being converted (any kind; only a linked Create action finds anything)
 * @returns The linked Delete action without a version, or null
 */
async function findDeleteActionWithoutAVersion(
  website: Website,
  action: ActionWithCredential,
): Promise<ActionWithCredential | null> {
  const link = await findActionCleanupForCreateAction(website.id, action.id);
  if (link === null) return null;
  const deleteAction = await findActionForWebsite(website.id, link.deleteActionId);
  if (deleteAction === null) return null;
  const deleteActionHasAVersion = (await findNewestActionScriptForAction(website.id, deleteAction.id)) !== null;
  return deleteActionHasAVersion ? null : deleteAction;
}

/**
 * Registers the action script routes: converting an action into a JSON step
 * plan with Claude, listing an action's plan versions, saving an edited plan
 * as a new version, running a plan, listing a version's runs, reading one
 * run with its step screenshots, serving a failed run's screenshot and a
 * run's step screenshots, and refining a failed run into a new version with
 * Claude.
 *
 * Every path is nested under `/api/websites/:websiteId/actions/:actionId`, and
 * every route first confirms the website and then the action are active,
 * answering 404 for the first one missing. Versions, runs, and refinements are
 * create-only: there are no PUT or DELETE routes, and they are soft deleted
 * together with their action or website. Every version a route answers with
 * carries `refinement` - the refinement that produced it, or null - and
 * `latestRun` - its newest run (`{ id, succeeded, createdAt }`), or null when
 * it has not been run. (The routes keep the name "scripts".)
 * @param app - The express application to attach the routes to
 * @param actionScriptDirectory - Absolute path run folders are written to, failure and step screenshots served from, and the `uploads` folder lives in
 */
export function registerActionScriptRoutes(app: Express, actionScriptDirectory: string): void {
  /**
   * Lists an action's active plan versions, newest first. Each carries its
   * `refinement`: for a version refined from a failed run, the refinement row
   * with that run's id, error, failed step, time-out flag, and failing-page
   * snapshot; null for any other version. Each also carries its `latestRun`
   * (`{ id, succeeded, createdAt }` of its newest run, or null when it has not
   * been run), so the versions list can show whether each version passes.
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @returns 200 with an array of versions; 404 with `{ error }` when the website or action does not exist or was deleted; 500 with `{ error }` when a query fails
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
   * Converts the action into a new JSON step plan with Claude, using the
   * model and effort level the user picked, and saves it as a new, immutable
   * version.
   *
   * The model must be in the live model catalog (see `scriptModelService`)
   * and the effort level must be one it offers - or null for a model with no
   * effort setting. Claude gets the plan guidelines verbatim, plus snapshots
   * of the website (name, URL), the action (title, description), the NAME of
   * the credential the action logs in as (never its username or password),
   * and the aria snapshots of the crawled pages most relevant to the action
   * (`selectRelevantCrawledPages`, from the newest crawl done the same way the
   * action runs). The reply must pass every plan rule; the same snapshots are
   * stored on the version, with the pages' URLs (`contextPageUrls`), the
   * model that answered, and the effort level sent. The action's parameters
   * are synced once it is saved.
   *
   * A CREATE action's linked Delete action is converted too, in the same
   * request with the same model and effort, when it has no version yet - so
   * the first run can clean up. That version is answered as
   * `deleteActionScript` (null when none was made); a failure of that second
   * conversion does not fail the request: the Create version is saved and
   * `deleteActionConversionError` says what went wrong. The request lasts as
   * long as Claude takes, once or twice.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action to convert
   * @param body - JSON `{ modelId, effort }`; `modelId` required, `effort` a level the model offers or null for "Standard"
   * @returns 201 with the saved version plus `deleteActionScript` and `deleteActionConversionError`; 400 with `{ error }` for an invalid body, a model not in the catalog, or an effort level the model does not offer; 404 with `{ error }` when the website or action does not exist or was deleted; 409 with `{ error }` when the action is a Login action (it logs in by itself and has no steps); 502 with `{ error }` when Claude declined, its reply was cut off, or the reply was not a valid plan; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call or a query fails
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
      if (isLoginAction(action)) {
        res.status(409).json({ error: LOGIN_ACTION_HAS_NO_STEPS_MESSAGE });
        return;
      }

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

      const choice = { model, effort: effortResolution.effort };
      const created = await convertActionAndSaveVersion(website, action, choice);

      // A Create action's Delete action gets its first version in the same
      // request, so the first run can clean up; a failure there is reported
      // in the body, not as a failed request - the Create version is saved.
      let deleteActionScript: ActionScriptWithPlan | null = null;
      let deleteActionConversionError: string | null = null;
      const deleteActionToConvert = await findDeleteActionWithoutAVersion(website, action);
      if (deleteActionToConvert !== null) {
        try {
          deleteActionScript = await convertActionAndSaveVersion(website, deleteActionToConvert, choice);
        } catch (deleteConversionError: unknown) {
          deleteActionConversionError = describeError(deleteConversionError);
        }
      }
      res.status(201).json({ ...created, deleteActionScript, deleteActionConversionError });
    } catch (error: unknown) {
      res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
    }
  });

  /**
   * Saves an edited plan (steps reordered, added, removed, or changed in the
   * step editor) as a NEW version; the version it was edited from is never
   * changed.
   *
   * The plan must pass every rule a generated plan passes
   * (`validateActionPlan`): only the allowed step actions, each with the
   * target and value it needs, and nothing that leaves the website's
   * origins. The new version copies its source's snapshots, summary,
   * assumptions, and context pages; `editedFromActionScriptId` names the
   * source, and `modelId` and `effort` are null (no model wrote it). The
   * action's parameters are synced once it is saved.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/edits
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version that was edited
   * @param body - JSON `{ plan }`; the whole edited plan `{ name, startUrl, steps }`
   * @returns 201 with the new version; 400 with `{ error }` listing every problem when the body or the plan is invalid; 404 with `{ error }` when the website, action, or source version does not exist or was deleted; 409 with `{ error }` when the action is a Login action (it logs in by itself and has no steps - even one that kept versions from before its kind changed); 500 with `{ error }` when a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/edits",
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
        const { website, action, script: sourceScript } = lookup.found;
        if (isLoginAction(action)) {
          res.status(409).json({ error: LOGIN_ACTION_HAS_NO_STEPS_MESSAGE });
          return;
        }

        const editValidation = validateActionPlanEditInput(
          req.body,
          allowedOriginsFor(website, await findLoginActionForWebsite(website.id)),
        );
        if (!editValidation.isValid) {
          res.status(400).json({ error: editValidation.errorMessage });
          return;
        }

        const created = await createActionScriptForAction(website.id, action.id, {
          websiteName: sourceScript.websiteName,
          startUrl: sourceScript.startUrl,
          actionTitle: sourceScript.actionTitle,
          actionDescription: sourceScript.actionDescription,
          credentialId: sourceScript.credentialId,
          credentialName: sourceScript.credentialName,
          summary: sourceScript.summary,
          assumptions: sourceScript.assumptions,
          plan: editValidation.input.plan,
          contextPageUrls: sourceScript.contextPageUrls,
          modelId: null,
          effort: null,
          editedFromActionScriptId: sourceScript.id,
        });
        await syncActionParametersQuietly(website.id, action);
        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Lists a script's active runs, newest first, each with the object it
   * created (`createdObject`, or null) and the created objects it deleted
   * (`deletedObjects`).
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
   * Returns one active run for the run page: the run with the object it
   * created (`createdObject`, or null), the created objects it deleted
   * (`deletedObjects`), its cleanup links (`cleanupRun`, `cleanedUpRun`),
   * and its step screenshots (`screenshots`, active rows in the order they
   * were taken; each image is served by the screenshot route below).
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the script's cuid
   * @param actionScriptRunId - Path parameter: the run's cuid
   * @returns 200 with the run; 404 with `{ error }` when the website, action, script, or run does not exist or was deleted (or the run belongs to another script); 500 with `{ error }` when a query fails
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId",
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
        const run = await findActionScriptRunDetailForScript(
          website.id,
          action.id,
          script.id,
          req.params.actionScriptRunId,
        );
        if (run === null) {
          res.status(404).json({ error: SCRIPT_RUN_NOT_FOUND_MESSAGE });
          return;
        }
        res.json(run);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Runs a version's plan in a visible browser on this machine and records
   * the run.
   *
   * When the action has a credential, the browser first logs in as it (the
   * crawler's login routine) and the run records the credential's name; the
   * password is decrypted only in memory. The stored plan is validated again
   * against the website's CURRENT origins, then each step runs through the
   * runner's fixed list of allowed actions - the plan is never turned into
   * code. One action runs one plan at a time.
   *
   * PARAMETERS: the body may give a value for each of the version's
   * parameters (see the parameters route); a key left out keeps the
   * version's own value. A blank optional parameter skips the steps that use
   * it, an added field with a value adds a step, and the plan the values make
   * must pass every plan rule. The run records the values it used (secrets
   * left out), its final address, and - for a Create action - its confirm
   * step and whether it succeeded; a Create run whose confirm step succeeded
   * records the object it made, and a passed deleting Object run marks the
   * created object it deleted. The parameters then learn from the fields the
   * run read.
   *
   * A run that FAILED (a failed login, a step that could not be done, or the
   * 5 minute time limit) is still a successfully recorded run, so it answers
   * 201 with `succeeded: false`, plus the address (`failingPageUrl`) and aria
   * snapshot (`failingPageAriaSnapshot`) of the page it failed on, when they
   * could be read.
   *
   * CLEANUP: a run of a Create action then runs its linked Delete action's
   * newest version on the object it made (unless `cleanUpAfterwards` is
   * false), and records the outcome on the run as `cleanupOutcome`,
   * `cleanupActionScriptRunId` (the Delete run, answered as `cleanupRun`) and
   * `cleanupErrorMessage`; a run whose cleanup failed or could not start (no
   * delete action, or no version of it) is recorded as FAILED even when its
   * own steps passed. The request then lasts as long as both runs do: each at
   * most 5 minutes plus a few seconds to stop it.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version to run
   * @param body - Optional JSON `{ parameterValues, cleanUpAfterwards }`: the values by parameter key, each text of at most 1000 characters without `{{`; `cleanUpAfterwards` true (the default) or false
   * @returns 201 with the recorded run (with `createdObject`, `deletedObjects`, `cleanupRun`, and `cleanedUpRun`); 400 with `{ error }` when the body is invalid, a key is not one of the version's parameters, a required value is blank, an object value has no known address for a version that opens it by address, the plan the values make breaks a plan rule, or the website's Login action has no login URL and neither does the website; 404 with `{ error }` when the website, action, or version does not exist or was deleted; 409 with `{ error }` when the action is already running, it is a Login action, its credential no longer exists, it runs as a credential but the website has no Login action, the plan no longer passes the plan rules, or the plan types a credential the action does not have; 503 with `{ error }` when the action has a credential but CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` when the password cannot be decrypted, the run folder cannot be written, the browser cannot start, or a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs",
    async (req, res) => {
      const valuesValidation = validateRunParameterValuesInput(req.body);
      if (!valuesValidation.isValid) {
        res.status(400).json({ error: valuesValidation.errorMessage });
        return;
      }
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

        // Claimed BEFORE the first await below, so two requests that arrive
        // together cannot both start a run; released however this ends. An
        // auto-refine job holds the same claim for its whole loop.
        const actionWasClaimed = claimActionRun(action.id);
        if (!actionWasClaimed) {
          res.status(409).json({ error: ACTION_ALREADY_RUNNING_MESSAGE });
          return;
        }
        try {
          const recordedRun = await performActionScriptRun(
            actionScriptDirectory,
            { website, action, script },
            valuesValidation.input.parameterValues,
            {
              cleanUpAfterwards: valuesValidation.input.cleanUpAfterwards,
              isCleanupRun: false,
              markDeletedCreatedObjectId: null,
            },
          );
          res.status(201).json(recordedRun);
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
        sendStoredImageFile(res, failureScreenshotFileName, actionScriptDirectory, FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Serves one step screenshot of a run as a PNG - one of the screenshots
   * the run took after logging in, opening the start URL, or a step.
   *
   * The screenshot is found by its row id, scoped to the run (and its
   * action, script, and website), and the file sent is the one that row
   * names - a path never comes from the URL. It is sent with `root` set to
   * the action script directory (see `sendStoredImageFile`).
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/screenshots/:screenshotId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the script's cuid
   * @param actionScriptRunId - Path parameter: the run's cuid
   * @param screenshotId - Path parameter: the step screenshot's cuid
   * @returns 200 with the `image/png` bytes; 404 with `{ error }` when the website, action, script, run, or screenshot does not exist or was deleted, the screenshot could not be taken during the run (it has no file), or the file is gone from disk; 500 with `{ error }` when a query fails or the file cannot be read
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/screenshots/:screenshotId",
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
        const screenshot = await findActionScriptRunScreenshotForRun(
          website.id,
          action.id,
          run.id,
          req.params.screenshotId,
        );
        if (screenshot === null) {
          res.status(404).json({ error: STEP_SCREENSHOT_NOT_FOUND_MESSAGE });
          return;
        }
        const { fileName } = screenshot;
        const screenshotWasNotTaken = fileName === null;
        if (screenshotWasNotTaken) {
          res.status(404).json({ error: STEP_SCREENSHOT_WAS_NOT_TAKEN_MESSAGE });
          return;
        }
        sendStoredImageFile(res, fileName, actionScriptDirectory, STEP_SCREENSHOT_FILE_NOT_FOUND_MESSAGE);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Refines a FAILED run: asks the model that wrote the run's version to fix
   * its plan, and saves the reply as a NEW, immutable version together with a
   * refinement row linking it to the source version and the run. The source
   * version and the run are never changed.
   *
   * Claude is shown the source version's snapshots (website name and URL,
   * action title and description, credential NAME - never its username or
   * password), the action's current allowed origins, the crawled pages the
   * source version was shown (from the newest crawl; picked afresh with
   * `selectRelevantCrawledPages` when none of them are left), the source
   * version's summary, assumptions, and plan, the run's error, failed step,
   * time-out flag, step log, failing-page URL and aria snapshot, the failure
   * screenshot (left out when its file is gone, and recorded as not sent),
   * and the user's optional note. The model is the source version's; the
   * effort is the source version's when the model still offers it, otherwise
   * `chooseEffortForModel`'s fallback.
   *
   * The new version copies the source version's snapshots (so it shows "Out
   * of date" when the action has changed since), stores the pages actually
   * sent as `contextPageUrls`, the model that answered and the effort sent,
   * and has `editedFromActionScriptId` null. Its `refinement` stores only
   * what exists nowhere else: the note, the call's token usage, and whether
   * the screenshot was sent; the error and step are joined from the run. A
   * failed Claude call writes nothing. One run can be refined once at a time.
   * The request lasts as long as Claude takes.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/refinements
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version whose run failed
   * @param actionScriptRunId - Path parameter: the failed run to refine
   * @param body - Optional JSON `{ note }`; `note` is text of at most 2000 characters once trimmed, or null / left out / blank for no note
   * @returns 201 with the new version, including its `refinement` (the refinement row plus `actionScriptRun: { id, errorMessage, failedStepNumber, timedOut, failingPageAriaSnapshot }`); 400 with `{ error }` when the body is not a JSON object, the note is not text, or the note is over 2000 characters; 404 with `{ error }` when the website, action, version, or run does not exist or was deleted; 409 with `{ error }` when the run passed (or recorded no error), the run failed only in its cleanup (refine the delete action's run instead), the version was saved from the step editor (no model wrote it), the run is already being refined, or the model that wrote the version is no longer offered; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply was not a valid plan; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call, the screenshot read, or a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/refinements",
    async (req, res) => {
      const refineValidation = validateActionPlanRefineInput(req.body);
      if (!refineValidation.isValid) {
        res.status(400).json({ error: refineValidation.errorMessage });
        return;
      }
      const { note } = refineValidation.input;

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

        const failedRun = describeFailedRun(run);
        if (failedRun === null) {
          res.status(409).json({ error: ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE });
          return;
        }
        if (runFailedOnlyInItsCleanup(run)) {
          res.status(409).json({ error: CLEANUP_FAILURE_CANNOT_BE_REFINED_MESSAGE });
          return;
        }
        const sourceModelId = script.modelId;
        const versionWasSavedFromTheEditor = sourceModelId === null;
        if (versionWasSavedFromTheEditor) {
          res.status(409).json({ error: EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE });
          return;
        }
        // Claimed with no await since the lookups above resolved, so two
        // requests that arrive together cannot both refine the run; released
        // however this ends.
        const runWasClaimed = claimRunRefinement(run.id);
        if (!runWasClaimed) {
          res.status(409).json({ error: RUN_ALREADY_BEING_REFINED_MESSAGE });
          return;
        }
        try {
          const refinedVersion = await performRefinement(
            actionScriptDirectory,
            { website, action, script, run, failedRun, sourceModelId },
            note,
          );
          res.status(201).json(refinedVersion);
        } finally {
          releaseRunRefinement(run.id);
        }
      } catch (error: unknown) {
        if (isActionScriptRequestProblem(error)) {
          res.status(error.httpStatus).json({ error: error.message });
          return;
        }
        res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
      }
    },
  );
}
