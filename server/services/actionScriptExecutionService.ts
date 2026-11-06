import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ActionScriptRun,
  type ActionScriptRunWithObjects,
  type ActionScriptWithPlan,
  type ActionWithCredential,
  type CredentialSummary,
  type Website,
  findCredentialForWebsite,
  findCredentialWithPasswordForWebsite,
  findLatestCrawledPagesForWebsite,
  createRefinedActionScriptForAction,
  createActionScriptRunForScript,
  findActionScriptRunWithObjects,
} from "./dbService.js";
import { type FailedRunDetails, refineActionPlan } from "./scriptGenerationService.js";
import {
  type EffortLevel,
  type ScriptModelOption,
  chooseEffortForModel,
  findScriptModel,
} from "./scriptModelService.js";
import {
  FAILURE_SCREENSHOT_FILE_NAME,
  runActionPlan,
  type PlanRunLogin,
} from "./actionPlanRunnerService.js";
import { buildCrawlLoginDetails } from "./crawlerLoginService.js";
import {
  followUpRecordedRun,
  loadVersionParameters,
  prepareParameterRun,
  syncActionParametersQuietly,
} from "./actionParameterService.js";
import {
  buildAllowedPlanOrigins,
  planUsesCredentialPlaceholders,
  validateActionPlan,
  type ActionPlan,
} from "../utils/actionPlanSchema.js";
import { applyParameterValues, expandAppliedPlan, readUsedParameterValues } from "../utils/actionParameters.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
} from "../utils/credentialEncryption.js";
import {
  type SelectedContextPage,
  extractActionSearchTerms,
  selectContextPagesByUrl,
  selectRelevantCrawledPages,
} from "../utils/selectRelevantCrawledPages.js";

export const ACTION_ALREADY_RUNNING_MESSAGE =
  "This action is already running; wait for that run to finish before starting another";
export const ACTION_CREDENTIAL_MISSING_MESSAGE =
  "This action's credential no longer exists; edit the action to pick another one";
export const PLAN_NEEDS_A_CREDENTIAL_MESSAGE =
  "This plan types the credential's username or password, but the action runs logged out; edit the action to pick a credential";
export const ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE = "Only a failed run can be refined; this run passed";
export const EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE =
  "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined";
export const RUN_ALREADY_BEING_REFINED_MESSAGE =
  "This run is already being refined; wait for that to finish";


/**
 * The folder, inside the action script directory, that `uploadFile` steps
 * pick their files from. Run folders are named by website cuid, so this name
 * cannot collide with one.
 */
export const UPLOADS_FOLDER_NAME = "uploads";

/** The HTTP statuses a request problem found while running or refining maps to. */
export type ActionScriptRequestProblemStatus = 400 | 409 | 503;

/**
 * A problem with the REQUEST that `performActionScriptRun` or
 * `performRefinement` found before (or instead of) doing its work - a missing
 * credential, a plan that no longer passes the rules, a model no longer
 * offered - as opposed to the work itself failing. A route answers it with
 * `httpStatus` and `message`; an auto-refine job ends `failed` with the
 * message.
 */
export class ActionScriptRequestProblem extends Error {
  /** The status a route answers this problem with. */
  readonly httpStatus: ActionScriptRequestProblemStatus;

  /**
   * @param httpStatus - The status a route answers this problem with
   * @param message - A human-readable explanation, shown to the user
   */
  constructor(httpStatus: ActionScriptRequestProblemStatus, message: string) {
    super(message);
    this.name = "ActionScriptRequestProblem";
    this.httpStatus = httpStatus;
  }
}

/**
 * Checks whether a thrown value is an `ActionScriptRequestProblem`. The check
 * is structural (by `name` and a numeric `httpStatus`), the same way
 * `statusForScriptGenerationFailure` recognizes a `ScriptGenerationError`, so
 * a test can throw a plain error carrying those fields.
 * @param error - Whatever a `catch` block received
 * @returns True when `error` carries the problem's name and a numeric `httpStatus`
 */
export function isActionScriptRequestProblem(error: unknown): error is ActionScriptRequestProblem {
  const errorIsAnObject = typeof error === "object" && error !== null;
  if (!errorIsAnObject) {
    return false;
  }
  const errorHasTheProblemName = "name" in error && error.name === "ActionScriptRequestProblem";
  const errorHasANumericStatus = "httpStatus" in error && typeof error.httpStatus === "number";
  return errorHasTheProblemName && errorHasANumericStatus;
}

/**
 * The actions with a run in progress, in THIS process. One action runs one
 * plan at a time, because a second visible browser logging in as the same
 * credential would fight the first. Shared by the run route and the
 * auto-refine job, so a job holds its action for its whole loop.
 */
const actionIdsBeingRun = new Set<string>();

/**
 * The failed runs with a "Refine" in progress, by run id. Refining the same
 * run twice at once (a double click, or two tabs) would ask Claude twice and
 * save two versions, so the second request is refused instead.
 */
const actionScriptRunIdsBeingRefined = new Set<string>();

/**
 * Claims an action for one run. Synchronous - it checks and records the claim
 * with no `await` in between, so two requests that arrive together cannot both
 * claim it (Node runs one request's synchronous code to the end before the
 * other's). Release it with `releaseActionRun` however the run ends.
 * @param actionId - The action's cuid
 * @returns True when the action was free and is now claimed; false when a run of it is already in progress
 */
export function claimActionRun(actionId: string): boolean {
  const actionIsAlreadyRunning = actionIdsBeingRun.has(actionId);
  if (actionIsAlreadyRunning) {
    return false;
  }
  actionIdsBeingRun.add(actionId);
  return true;
}

/**
 * Releases an action claimed with `claimActionRun`. Releasing an action that
 * is not claimed is harmless.
 * @param actionId - The action's cuid
 */
export function releaseActionRun(actionId: string): void {
  actionIdsBeingRun.delete(actionId);
}

/**
 * Claims a failed run for one refinement, synchronously like
 * `claimActionRun`. Release it with `releaseRunRefinement` however the
 * refinement ends.
 * @param actionScriptRunId - The run's cuid
 * @returns True when the run was free and is now claimed; false when it is already being refined
 */
export function claimRunRefinement(actionScriptRunId: string): boolean {
  const runIsAlreadyBeingRefined = actionScriptRunIdsBeingRefined.has(actionScriptRunId);
  if (runIsAlreadyBeingRefined) {
    return false;
  }
  actionScriptRunIdsBeingRefined.add(actionScriptRunId);
  return true;
}

/**
 * Releases a run claimed with `claimRunRefinement`. Releasing a run that is
 * not claimed is harmless.
 * @param actionScriptRunId - The run's cuid
 */
export function releaseRunRefinement(actionScriptRunId: string): void {
  actionScriptRunIdsBeingRefined.delete(actionScriptRunId);
}

/** The active website and action a script route (or an auto-refine job) works under. */
export interface WebsiteAndAction {
  website: Website;
  action: ActionWithCredential;
}

/** The active website, action, and script a run or refinement works on. */
export interface WebsiteActionAndScript extends WebsiteAndAction {
  script: ActionScriptWithPlan;
}

/**
 * A failed run of a version Claude wrote, with its website, action, and
 * version - everything `performRefinement` starts from once the "refine a
 * failed run" route's (or the auto-refine job's) checks have passed.
 */
export interface RefinableRun extends WebsiteActionAndScript {
  /** The failed run to refine. */
  run: ActionScriptRun;
  /** How the run failed, as Claude is shown it. */
  failedRun: FailedRunDetails;
  /** The model that wrote the version (never null here: an edited version cannot be refined). */
  sourceModelId: string;
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
export function resolveEffortForModel(
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
export async function findActionCredential(
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
export function allowedOriginsFor(website: Website, credential: CredentialSummary | null): string[] {
  return buildAllowedPlanOrigins([website.url, website.loginUrl, credential?.loginUrl ?? null]);
}

/**
 * Builds a new run's folder name, relative to the action script directory:
 * one folder per website, one uniquely named folder per run. The `/`
 * separator is what gets stored in the database, whatever the OS.
 * @param websiteId - The cuid of the website row (never a raw path parameter)
 * @returns `<websiteId>/<random uuid>`
 */
export function buildRunFolderName(websiteId: string): string {
  return `${websiteId}/${randomUUID()}`;
}

/**
 * Runs one version with the given parameter values and records the run -
 * the work behind the "run a version" route and each run of an auto-refine
 * job, after the lookups and the one-run-per-action claim (`claimActionRun`).
 *
 * Checks the action's credential and the stored plan, puts the run's
 * parameter values in (see `prepareParameterRun`) and checks the plan they
 * make, runs it, records the run with the values it used, and follows the run
 * up (see `followUpRecordedRun`: the parameters learn from it, and a Create or
 * deleting run updates the created objects). A run that FAILED is still a
 * successfully recorded run (`succeeded: false`); only a run that could not be
 * started or recorded throws.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The active website, action, and version to run
 * @param parameterValues - The run's values, by parameter key (validated as text)
 * @returns The recorded run, with the objects it created and deleted when they could be read
 * @throws {ActionScriptRequestProblem} 503 when the action has a credential but no encryption key is configured; 409 when its credential is gone, the stored plan no longer passes the plan rules, or the plan types a credential the action does not have; 400 when the credential has no login URL and neither does the website, a value is not accepted, or the plan the values make breaks a plan rule
 * @throws Anything else the password decryption, the runner, or a query rejects with
 */
export async function performActionScriptRun(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  parameterValues: Record<string, string>,
): Promise<ActionScriptRunWithObjects | ActionScriptRun> {
  const { website, action, script } = found;
  const { credentialId } = action;
  const actionRunsLoggedIn = credentialId !== null;
  if (actionRunsLoggedIn && !credentialEncryptionIsConfigured()) {
    throw new ActionScriptRequestProblem(503, CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE);
  }
  const credential = actionRunsLoggedIn
    ? await findCredentialWithPasswordForWebsite(website.id, credentialId)
    : null;
  if (actionRunsLoggedIn && credential === null) {
    throw new ActionScriptRequestProblem(409, ACTION_CREDENTIAL_MISSING_MESSAGE);
  }
  const credentialHasNoLoginUrl =
    credential !== null && credential.loginUrl === null && website.loginUrl === null;
  if (credentialHasNoLoginUrl) {
    throw new ActionScriptRequestProblem(
      400,
      `The credential "${credential.name}" has no login page URL, and neither does its website; add one to log in`,
    );
  }

  const allowedOrigins = allowedOriginsFor(website, credential);
  const planValidation = validateActionPlan(script.plan, allowedOrigins);
  if (!planValidation.isValid) {
    throw new ActionScriptRequestProblem(
      409,
      `This version's plan can no longer run: ${planValidation.errorMessage}`,
    );
  }
  const plan = planValidation.input;
  const planNeedsAMissingCredential = planUsesCredentialPlaceholders(plan) && credential === null;
  if (planNeedsAMissingCredential) {
    throw new ActionScriptRequestProblem(409, PLAN_NEEDS_A_CREDENTIAL_MESSAGE);
  }
  const login: PlanRunLogin | null =
    credential === null
      ? null
      : { credentialName: credential.name, details: buildCrawlLoginDetails(credential, website) };

  const parametersView = await loadVersionParameters(website.id, action, script);
  const preparedRun = prepareParameterRun(parametersView, plan, parameterValues);
  if (!preparedRun.isReady) {
    throw new ActionScriptRequestProblem(400, preparedRun.errorMessage);
  }
  const valuedPlanValidation = validateActionPlan(expandAppliedPlan(preparedRun.applied), allowedOrigins);
  if (!valuedPlanValidation.isValid) {
    throw new ActionScriptRequestProblem(
      400,
      `With these values the plan cannot run: ${valuedPlanValidation.errorMessage}`,
    );
  }

  const runFolderName = buildRunFolderName(website.id);
  const run = await runActionPlan({
    plan: preparedRun.applied.plan,
    login,
    timingSettings: {
      networkIdleTimeoutMs: website.networkIdleTimeoutMs,
      screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
    },
    allowedOrigins,
    runDirectory: path.join(actionScriptDirectory, runFolderName),
    uploadsDirectory: path.join(actionScriptDirectory, UPLOADS_FOLDER_NAME),
    parameterRun: preparedRun.parameterRun,
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
    parameterValues: preparedRun.applied.usedValues,
    finalPageUrl: run.finalPageUrl,
    confirmStepNumber: preparedRun.parameterRun.confirmStepNumber,
    confirmStepSucceeded: preparedRun.parameterRun.confirmStepNumber === null ? null : run.confirmStepSucceeded,
  });
  await followUpRecordedRun({
    websiteId: website.id,
    action,
    actionScriptId: script.id,
    plan: script.plan,
    actionScriptRunId: created.id,
    view: parametersView,
    applied: preparedRun.applied,
    runResult: run,
  });
  const createdWithObjects = await findActionScriptRunWithObjects(website.id, created.id);
  return createdWithObjects ?? created;
}

/**
 * Puts the values a failed run used back into its version's plan, so Claude
 * refines the plan that actually ran. When the values no longer fit (the
 * parameters changed since), the version's own plan is sent as it is.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @param script - The version that ran
 * @param run - The failed run
 * @returns The plan with the run's values in
 */
export async function planWithRunValues(
  websiteId: string,
  action: ActionWithCredential,
  script: ActionScriptWithPlan,
  run: ActionScriptRun,
): Promise<ActionPlan> {
  const runValues = Object.fromEntries(
    readUsedParameterValues(run.parameterValues).map((usedValue) => [usedValue.key, usedValue.value]),
  );
  const runUsedNoValues = Object.keys(runValues).length === 0;
  if (runUsedNoValues) return script.plan;
  const view = await loadVersionParameters(websiteId, action, script);
  const knownKeys = new Set(view.parameters.map((parameter) => parameter.key));
  const knownRunValues = Object.fromEntries(Object.entries(runValues).filter(([parameterKey]) => knownKeys.has(parameterKey)));
  const applied = applyParameterValues(script.plan, view.parameters, knownRunValues, view.objectChoices);
  return applied.problems.length === 0 ? applied.plan : script.plan;
}

/**
 * Describes a recorded run as the failure a refinement shows Claude, copying
 * the run row's fields.
 * @param run - A recorded script run
 * @returns The failure's details, or null when the run passed or recorded no error (so there is nothing to fix)
 */
export function describeFailedRun(run: ActionScriptRun): FailedRunDetails | null {
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
export function chooseRefinementEffort(
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
export async function selectRefinementContextPages(
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
export async function readFailureScreenshotAsBase64(
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
 * Refines one failed run into a new version - the work behind the "refine a
 * failed run" route and each refinement of an auto-refine job, after the
 * lookups, the checks that the run failed and that Claude wrote its version,
 * and the one-refine-per-run claim (`claimRunRefinement`): asks the model
 * that wrote the version to fix it, and saves Claude's reply as a new version
 * together with its refinement row.
 *
 * Claude is shown the SOURCE version's snapshots (website, action, and
 * credential name, like the edit route copies them), the action's current
 * allowed origins, the source version's context pages, its summary,
 * assumptions, and plan - with the run's parameter values put back in (see
 * `planWithRunValues`) - how the run failed, the failure screenshot when its
 * file is still on disk, and the user's note. The new version's parameters
 * are synced once it is saved.
 * @param actionScriptDirectory - Absolute path of the action script directory (where the run's failure screenshot lives)
 * @param source - The failed run, the version it ran, and their website and action
 * @param note - The user's hint for Claude, or null
 * @returns The new version, with its `refinement`
 * @throws {ActionScriptRequestProblem} 409 when the model that wrote the version is no longer offered
 * @throws {ScriptGenerationError} When Claude declined, its reply was cut off, or the reply was not a valid plan (see `refineActionPlan`)
 * @throws Anything else the screenshot read, the Anthropic API call, or a query rejects with
 */
export async function performRefinement(
  actionScriptDirectory: string,
  source: RefinableRun,
  note: string | null,
): Promise<ActionScriptWithPlan> {
  const { website, action, script, run, failedRun, sourceModelId } = source;
  const model = await findScriptModel(sourceModelId);
  if (model === null) {
    throw new ActionScriptRequestProblem(
      409,
      `The model that wrote this version (${sourceModelId}) is no longer offered, so it cannot refine it; convert the action again`,
    );
  }
  const effort = chooseRefinementEffort(model, script.effort);
  const planThatRan = await planWithRunValues(website.id, action, script, run);

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
      previousPlan: planThatRan,
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
  await syncActionParametersQuietly(website.id, action);
  return created;
}
