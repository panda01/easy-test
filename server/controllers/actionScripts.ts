import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Express, type Response } from "express";
import {
  type ActionScriptRun,
  type ActionScriptWithPlan,
  type ActionWithCredential,
  type CredentialSummary,
  type Website,
  findWebsiteById,
  findActionForWebsite,
  findCredentialForWebsite,
  findCredentialWithPasswordForWebsite,
  findLatestCrawledPagesForWebsite,
  listActionScriptsForAction,
  findActionScriptForAction,
  createActionScriptForAction,
  createRefinedActionScriptForAction,
  listActionScriptRunsForScript,
  findActionScriptRunForScript,
  createActionScriptRunForScript,
} from "../services/dbService.js";
import {
  type FailedRunDetails,
  convertActionToPlan,
  refineActionPlan,
} from "../services/scriptGenerationService.js";
import {
  type EffortLevel,
  type ScriptModelOption,
  chooseEffortForModel,
  findScriptModel,
} from "../services/scriptModelService.js";
import {
  FAILURE_SCREENSHOT_FILE_NAME,
  runActionPlan,
  type PlanRunLogin,
} from "../services/actionPlanRunnerService.js";
import { buildCrawlLoginDetails } from "../services/crawlerLoginService.js";
import {
  buildAllowedPlanOrigins,
  planUsesCredentialPlaceholders,
  validateActionPlan,
} from "../utils/actionPlanSchema.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
} from "../utils/credentialEncryption.js";
import { describeError } from "../utils/describeError.js";
import { readSendErrorStatus } from "../utils/readSendErrorStatus.js";
import {
  type SelectedContextPage,
  extractActionSearchTerms,
  selectContextPagesByUrl,
  selectRelevantCrawledPages,
} from "../utils/selectRelevantCrawledPages.js";
import { statusForScriptGenerationFailure } from "../utils/statusForScriptGenerationFailure.js";
import {
  validateActionPlanEditInput,
  validateActionPlanRefineInput,
  validateScriptModelChoiceInput,
} from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";
const SCRIPT_RUN_NOT_FOUND_MESSAGE = "Script run not found";
const RUN_HAS_NO_FAILURE_SCREENSHOT_MESSAGE = "This run did not capture a failure screenshot";
const FAILURE_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Failure screenshot file not found";
const ACTION_ALREADY_RUNNING_MESSAGE =
  "This action is already running; wait for that run to finish before starting another";
const ACTION_CREDENTIAL_MISSING_MESSAGE =
  "This action's credential no longer exists; edit the action to pick another one";
const PLAN_NEEDS_A_CREDENTIAL_MESSAGE =
  "This plan types the credential's username or password, but the action runs logged out; edit the action to pick a credential";
const ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE = "Only a failed run can be refined; this run passed";
const EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE =
  "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined";
const RUN_ALREADY_BEING_REFINED_MESSAGE =
  "This run is already being refined; wait for that to finish";

/**
 * The folder, inside the action script directory, that `uploadFile` steps
 * pick their files from. Run folders are named by website cuid, so this name
 * cannot collide with one.
 */
export const UPLOADS_FOLDER_NAME = "uploads";

/**
 * The actions with a run in progress. One action runs one plan at a time,
 * because a second visible browser logging in as the same credential would
 * fight the first.
 */
const actionIdsBeingRun = new Set<string>();

/**
 * The failed runs with a "Refine" in progress, by run id. Refining the same
 * run twice at once (a double click, or two tabs) would ask Claude twice and
 * save two versions, so the second request is refused instead.
 */
const actionScriptRunIdsBeingRefined = new Set<string>();

/** The outcome of looking up a chain of parent rows: all found, or the first one missing. */
type ParentLookup<TFound> =
  | { allWereFound: true; found: TFound }
  | { allWereFound: false; notFoundMessage: string };

/** The active website and action a script route works under. */
interface WebsiteAndAction {
  website: Website;
  action: ActionWithCredential;
}

/** The active website, action, and script a script-run route works under. */
interface WebsiteActionAndScript extends WebsiteAndAction {
  script: ActionScriptWithPlan;
}

/**
 * A failed run of a version Claude wrote, with its website, action, and
 * version - everything the "refine a failed run" route starts from once its
 * checks have passed.
 */
interface RefinableRun extends WebsiteActionAndScript {
  /** The failed run to refine. */
  run: ActionScriptRun;
  /** How the run failed, as Claude is shown it. */
  failedRun: FailedRunDetails;
  /** The model that wrote the version (never null here: an edited version cannot be refined). */
  sourceModelId: string;
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
 * Looks up the credential an action runs as, without its password - for its
 * name and login URL.
 * @param website - The action's website row
 * @param action - The action row
 * @returns The credential, or null when the action runs logged out (or its credential is gone)
 */
async function findActionCredential(
  website: Website,
  action: ActionWithCredential,
): Promise<CredentialSummary | null> {
  const { credentialId } = action;
  const actionRunsLoggedOut = credentialId === null;
  if (actionRunsLoggedOut) return null;
  return findCredentialForWebsite(website.id, credentialId);
}

/**
 * The origins a plan for this action may open: the website's own, and the
 * login pages' (the website's and the credential's).
 * @param website - The action's website row
 * @param credential - The action's credential, or null
 * @returns The allowed origins
 */
function allowedOriginsFor(website: Website, credential: CredentialSummary | null): string[] {
  return buildAllowedPlanOrigins([website.url, website.loginUrl, credential?.loginUrl ?? null]);
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
 * The body of the "run a version" route, after the lookups and the
 * one-run-per-action claim: checks the action's credential and the stored
 * plan, runs the plan, records the run, and answers the request.
 * @param res - The route's response
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The active website, action, and version to run
 * @returns Resolves once the response is sent (errors reject, for the route's catch)
 */
async function runPlanAndRecordRun(
  res: Response,
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
): Promise<void> {
  const { website, action, script } = found;
  const { credentialId } = action;
  const actionRunsLoggedIn = credentialId !== null;
  if (actionRunsLoggedIn && !credentialEncryptionIsConfigured()) {
    res.status(503).json({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
    return;
  }
  const credential = actionRunsLoggedIn
    ? await findCredentialWithPasswordForWebsite(website.id, credentialId)
    : null;
  if (actionRunsLoggedIn && credential === null) {
    res.status(409).json({ error: ACTION_CREDENTIAL_MISSING_MESSAGE });
    return;
  }
  const credentialHasNoLoginUrl =
    credential !== null && credential.loginUrl === null && website.loginUrl === null;
  if (credentialHasNoLoginUrl) {
    res.status(400).json({
      error: `The credential "${credential.name}" has no login page URL, and neither does its website; add one to log in`,
    });
    return;
  }

  const allowedOrigins = allowedOriginsFor(website, credential);
  const planValidation = validateActionPlan(script.plan, allowedOrigins);
  if (!planValidation.isValid) {
    res.status(409).json({
      error: `This version's plan can no longer run: ${planValidation.errorMessage}`,
    });
    return;
  }
  const plan = planValidation.input;
  const planNeedsAMissingCredential = planUsesCredentialPlaceholders(plan) && credential === null;
  if (planNeedsAMissingCredential) {
    res.status(409).json({ error: PLAN_NEEDS_A_CREDENTIAL_MESSAGE });
    return;
  }
  const login: PlanRunLogin | null =
    credential === null
      ? null
      : { credentialName: credential.name, details: buildCrawlLoginDetails(credential, website) };

  const runFolderName = buildRunFolderName(website.id);
  const run = await runActionPlan({
    plan,
    login,
    timingSettings: {
      networkIdleTimeoutMs: website.networkIdleTimeoutMs,
      screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
    },
    allowedOrigins,
    runDirectory: path.join(actionScriptDirectory, runFolderName),
    uploadsDirectory: path.join(actionScriptDirectory, UPLOADS_FOLDER_NAME),
  });

  const created = await createActionScriptRunForScript(website.id, action.id, script.id, {
    succeeded: run.succeeded,
    timedOut: run.timedOut,
    errorMessage: run.errorMessage,
    failedStepNumber: run.failedStepNumber,
    credentialName: login?.credentialName ?? null,
    output: run.output,
    outputWasTruncated: run.outputWasTruncated,
    failureScreenshotFileName: run.failureScreenshotWasCaptured
      ? `${runFolderName}/${FAILURE_SCREENSHOT_FILE_NAME}`
      : null,
    failingPageUrl: run.failingPageUrl,
    failingPageAriaSnapshot: run.failingPageAriaSnapshot,
    durationMs: run.durationMs,
  });
  res.status(201).json(created);
}

/**
 * Describes a recorded run as the failure a refinement shows Claude, copying
 * the run row's fields.
 * @param run - A recorded script run
 * @returns The failure's details, or null when the run passed or recorded no error (so there is nothing to fix)
 */
function describeFailedRun(run: ActionScriptRun): FailedRunDetails | null {
  const { errorMessage } = run;
  const runDidNotFail = run.succeeded || errorMessage === null;
  if (runDidNotFail) return null;
  return {
    errorMessage,
    failedStepNumber: run.failedStepNumber,
    timedOut: run.timedOut,
    output: run.output,
    failingPageUrl: run.failingPageUrl,
    failingPageAriaSnapshot: run.failingPageAriaSnapshot,
  };
}

/**
 * Chooses the effort level a refinement asks for: the level the source
 * version was written at, when its model still offers it (null included, for
 * a model with no effort setting); otherwise the level `chooseEffortForModel`
 * falls back to for that model.
 * @param model - The model that wrote the source version, from the live catalog
 * @param sourceEffort - The effort level stored on the source version, or null for "Standard"
 * @returns The level to send, or null for a model with no effort setting
 */
function chooseRefinementEffort(
  model: ScriptModelOption,
  sourceEffort: string | null,
): EffortLevel | null {
  const sourceEffortResolution = resolveEffortForModel(model, sourceEffort);
  if (sourceEffortResolution.isOffered) {
    return sourceEffortResolution.effort;
  }
  return chooseEffortForModel(model, null);
}

/**
 * Picks the crawled pages a refinement shows Claude: the pages the source
 * version was shown (`contextPageUrls`), read from the newest crawl done the
 * way that version ran. When that crawl has none of them, the pages are
 * picked afresh the way "Convert to script" picks them, from the version's
 * own action title and description.
 * @param website - The action's website row
 * @param script - The version being refined
 * @returns The pages to show Claude; empty when the website was never crawled
 */
async function selectRefinementContextPages(
  website: Website,
  script: ActionScriptWithPlan,
): Promise<SelectedContextPage[]> {
  const crawledPages = await findLatestCrawledPagesForWebsite(website.id, script.credentialId);
  const sourceVersionPages = selectContextPagesByUrl(crawledPages, script.contextPageUrls);
  const sourceVersionPagesWereFound = sourceVersionPages.length > 0;
  if (sourceVersionPagesWereFound) {
    return sourceVersionPages;
  }
  const searchTerms = extractActionSearchTerms(script.actionTitle, script.actionDescription);
  return selectRelevantCrawledPages(crawledPages, searchTerms);
}

/**
 * Checks whether a thrown value is Node's "no such file or directory" error.
 * @param error - Whatever a file system call rejected with
 * @returns True when `error` is an object whose `code` is `ENOENT`
 */
function isFileMissingError(error: unknown): boolean {
  const errorIsAnObject = typeof error === "object" && error !== null;
  return errorIsAnObject && "code" in error && error.code === "ENOENT";
}

/**
 * Reads a failed run's screenshot, for Claude, as base64. A missing file is
 * not an error - the refinement is then sent without the image - and a
 * stored name that would resolve outside the action script directory is
 * never read.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param failureScreenshotFileName - The run's stored screenshot name (relative to that directory), or null when it captured none
 * @returns The PNG as base64, or null when there is no name, the name leaves the directory, or the file is gone
 * @throws Any read error other than the file being missing (e.g. no permission to read it)
 */
async function readFailureScreenshotAsBase64(
  actionScriptDirectory: string,
  failureScreenshotFileName: string | null,
): Promise<string | null> {
  const runCapturedNoScreenshot = failureScreenshotFileName === null;
  if (runCapturedNoScreenshot) return null;

  const resolvedDirectory = path.resolve(actionScriptDirectory);
  const directoryPrefix = resolvedDirectory.endsWith(path.sep)
    ? resolvedDirectory
    : `${resolvedDirectory}${path.sep}`;
  const screenshotPath = path.resolve(resolvedDirectory, failureScreenshotFileName);
  const screenshotIsInsideTheDirectory = screenshotPath.startsWith(directoryPrefix);
  if (!screenshotIsInsideTheDirectory) return null;

  try {
    const screenshotBytes = await readFile(screenshotPath);
    return screenshotBytes.toString("base64");
  } catch (error: unknown) {
    if (isFileMissingError(error)) return null;
    throw error;
  }
}

/**
 * The body of the "refine a failed run" route, after the lookups, the checks
 * that the run failed and that Claude wrote its version, and the
 * one-refine-per-run claim: asks the model that wrote the version to fix it,
 * saves Claude's reply as a new version together with its refinement row,
 * and answers the request.
 *
 * Claude is shown the SOURCE version's snapshots (website, action, and
 * credential name, like the edit route copies them), the action's current
 * allowed origins, the source version's context pages, its summary,
 * assumptions, and plan, how the run failed, the failure screenshot when its
 * file is still on disk, and the user's note.
 * @param res - The route's response
 * @param actionScriptDirectory - Absolute path of the action script directory (where the run's failure screenshot lives)
 * @param source - The failed run, the version it ran, and their website and action
 * @param note - The user's hint for Claude, or null
 * @returns Resolves once the response is sent (errors reject, for the route's catch)
 */
async function refineRunAndSaveVersion(
  res: Response,
  actionScriptDirectory: string,
  source: RefinableRun,
  note: string | null,
): Promise<void> {
  const { website, action, script, run, failedRun, sourceModelId } = source;
  const model = await findScriptModel(sourceModelId);
  if (model === null) {
    res.status(409).json({
      error: `The model that wrote this version (${sourceModelId}) is no longer offered, so it cannot refine it; convert the action again`,
    });
    return;
  }
  const effort = chooseRefinementEffort(model, script.effort);

  const actionCredential = await findActionCredential(website, action);
  const allowedOrigins = allowedOriginsFor(website, actionCredential);
  const contextPages = await selectRefinementContextPages(website, script);
  const failureScreenshotPngBase64 = await readFailureScreenshotAsBase64(
    actionScriptDirectory,
    run.failureScreenshotFileName,
  );

  const sourceSnapshots = {
    websiteName: script.websiteName,
    startUrl: script.startUrl,
    actionTitle: script.actionTitle,
    actionDescription: script.actionDescription,
    credentialName: script.credentialName,
  };
  const refinement = await refineActionPlan(
    {
      ...sourceSnapshots,
      allowedOrigins,
      contextPages,
      previousSummary: script.summary,
      previousAssumptions: script.assumptions,
      previousPlan: script.plan,
      failedRun,
      failureScreenshotPngBase64,
      note,
    },
    { model, effort },
  );

  const created = await createRefinedActionScriptForAction(
    website.id,
    action.id,
    {
      ...sourceSnapshots,
      credentialId: script.credentialId,
      summary: refinement.summary,
      assumptions: refinement.assumptions,
      plan: refinement.plan,
      contextPageUrls: contextPages.map((page) => page.url),
      modelId: refinement.modelId,
      effort: refinement.effort,
      editedFromActionScriptId: null,
    },
    {
      sourceActionScriptId: script.id,
      actionScriptRunId: run.id,
      note,
      inputTokens: refinement.usage.inputTokens,
      outputTokens: refinement.usage.outputTokens,
      cacheReadInputTokens: refinement.usage.cacheReadInputTokens,
      cacheCreationInputTokens: refinement.usage.cacheCreationInputTokens,
      screenshotWasSent: refinement.screenshotWasSent,
    },
  );
  res.status(201).json(created);
}

/**
 * Registers the action script routes: converting an action into a JSON step
 * plan with Claude, listing an action's plan versions, saving an edited plan
 * as a new version, running a plan, listing a version's runs, serving a
 * failed run's screenshot, and refining a failed run into a new version with
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
 * @param actionScriptDirectory - Absolute path run folders are written to, failure screenshots served from, and the `uploads` folder lives in
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
   * model that answered, and the effort level sent. The request lasts as long
   * as Claude takes.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action to convert
   * @param body - JSON `{ modelId, effort }`; `modelId` required, `effort` a level the model offers or null for "Standard"
   * @returns 201 with the saved version; 400 with `{ error }` for an invalid body, a model not in the catalog, or an effort level the model does not offer; 404 with `{ error }` when the website or action does not exist or was deleted; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply was not a valid plan; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call or a query fails
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

      const credential = await findActionCredential(website, action);
      const allowedOrigins = allowedOriginsFor(website, credential);
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
      const conversion = await convertActionToPlan(
        { ...snapshots, allowedOrigins, contextPages },
        { model, effort: effortResolution.effort },
      );

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
      res.status(201).json(created);
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
   * source, and `modelId` and `effort` are null (no model wrote it).
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/edits
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version that was edited
   * @param body - JSON `{ plan }`; the whole edited plan `{ name, startUrl, steps }`
   * @returns 201 with the new version; 400 with `{ error }` listing every problem when the body or the plan is invalid; 404 with `{ error }` when the website, action, or source version does not exist or was deleted; 500 with `{ error }` when a query fails
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

        const credential = await findActionCredential(website, action);
        const editValidation = validateActionPlanEditInput(
          req.body,
          allowedOriginsFor(website, credential),
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
        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

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
   * A run that FAILED (a failed login, a step that could not be done, or the
   * 5 minute time limit) is still a successfully recorded run, so it answers
   * 201 with `succeeded: false`, plus the address (`failingPageUrl`) and aria
   * snapshot (`failingPageAriaSnapshot`) of the page it failed on, when they
   * could be read. The request lasts as long as the run does, at most 5
   * minutes plus a few seconds to stop it.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version to run
   * @returns 201 with the recorded run; 400 with `{ error }` when the action's credential has no login URL and neither does the website; 404 with `{ error }` when the website, action, or version does not exist or was deleted; 409 with `{ error }` when the action is already running, its credential is gone, the plan no longer passes the plan rules, or the plan types a credential the action does not have; 503 with `{ error }` when the action has a credential but CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` when the password cannot be decrypted, the run folder cannot be written, the browser cannot start, or a query fails
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

        const actionIsAlreadyRunning = actionIdsBeingRun.has(action.id);
        if (actionIsAlreadyRunning) {
          res.status(409).json({ error: ACTION_ALREADY_RUNNING_MESSAGE });
          return;
        }
        // Claimed BEFORE the first await below, so two requests that arrive
        // together cannot both start a run; released however this ends.
        actionIdsBeingRun.add(action.id);
        try {
          await runPlanAndRecordRun(res, actionScriptDirectory, { website, action, script });
        } finally {
          actionIdsBeingRun.delete(action.id);
        }
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
   * @returns 201 with the new version, including its `refinement` (the refinement row plus `actionScriptRun: { id, errorMessage, failedStepNumber, timedOut, failingPageAriaSnapshot }`); 400 with `{ error }` when the body is not a JSON object, the note is not text, or the note is over 2000 characters; 404 with `{ error }` when the website, action, version, or run does not exist or was deleted; 409 with `{ error }` when the run passed (or recorded no error), the version was saved from the step editor (no model wrote it), the run is already being refined, or the model that wrote the version is no longer offered; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply was not a valid plan; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Anthropic API call, the screenshot read, or a query fails
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
        const sourceModelId = script.modelId;
        const versionWasSavedFromTheEditor = sourceModelId === null;
        if (versionWasSavedFromTheEditor) {
          res.status(409).json({ error: EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE });
          return;
        }
        const runIsAlreadyBeingRefined = actionScriptRunIdsBeingRefined.has(run.id);
        if (runIsAlreadyBeingRefined) {
          res.status(409).json({ error: RUN_ALREADY_BEING_REFINED_MESSAGE });
          return;
        }
        // Claimed with no await since the check above, so two requests that
        // arrive together cannot both refine the run; released however this ends.
        actionScriptRunIdsBeingRefined.add(run.id);
        try {
          await refineRunAndSaveVersion(
            res,
            actionScriptDirectory,
            { website, action, script, run, failedRun, sourceModelId },
            note,
          );
        } finally {
          actionScriptRunIdsBeingRefined.delete(run.id);
        }
      } catch (error: unknown) {
        res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
      }
    },
  );
}
