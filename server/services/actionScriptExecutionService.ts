import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type Action,
  type ActionScriptRun,
  type ActionScriptRunScreenshotInput,
  type ActionScriptRunWithObjects,
  type ActionScriptWithPlan,
  type ActionWithCredential,
  type CleanupOutcome,
  type CredentialSummary,
  type Website,
  findActionCleanupForCreateAction,
  findActionForWebsite,
  findCredentialForWebsite,
  findCredentialWithPasswordForWebsite,
  findLatestCrawledPagesForWebsite,
  findLoginActionForWebsite,
  findNewestActionScriptForAction,
  createRefinedActionScriptForAction,
  createActionScriptRunForScript,
  findActionScriptRunWithObjects,
  recordActionScriptRunCleanup,
} from "./dbService.js";
import { describeError } from "../utils/describeError.js";
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
  type RunStepScreenshot,
} from "./actionPlanRunnerService.js";
import {
  WEBSITE_HAS_NO_LOGIN_ACTION_MESSAGE,
  buildLoginDetails,
  describeLoginActionWithoutLoginPage,
  findEffectiveLoginUrl,
} from "./crawlerLoginService.js";
import { isLoginAction } from "../utils/scoreActionObjectRole.js";
import {
  type RunFollowUpOutcome,
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
import {
  applyParameterValues,
  expandAppliedPlan,
  readUsedParameterValues,
  type UsedParameterValue,
  type VersionParameter,
} from "../utils/actionParameters.js";
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
  "This plan types the credential's username or password, but the action runs logged out; edit the action to pick a credential to log in as";
export const LOGIN_ACTION_HAS_NO_STEPS_MESSAGE =
  "A login action logs in by itself, so it has no steps to write, run, or refine; use Run login instead";
export const ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE = "Only a failed run can be refined; this run passed";
export const EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE =
  "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined";
export const RUN_ALREADY_BEING_REFINED_MESSAGE =
  "This run is already being refined; wait for that to finish";
export const CLEANUP_FAILURE_CANNOT_BE_REFINED_MESSAGE =
  "This run's own steps passed; only its cleanup failed. Refine the delete action's run instead";

/** Why a Create run's cleanup could not start (its `cleanupErrorMessage`), by case. */
export const CLEANUP_NO_DELETE_ACTION_MESSAGE = "This action has no delete action yet";
export const CLEANUP_DELETE_ACTION_GONE_MESSAGE = "Its delete action no longer exists";
export const CLEANUP_NO_DELETE_VERSION_MESSAGE = "Its delete action has no version yet";
export const CLEANUP_DELETE_ACTION_BUSY_MESSAGE = "Its delete action is already running";

/** The start of a Create run's `errorMessage` when its own steps passed and only the cleanup did not (see `runFailedOnlyInItsCleanup`). */
export const CLEANUP_ERROR_PREFIX = "Cleanup ";

/** How a run of a version is to be done, beyond its parameter values. */
export interface ActionScriptRunOptions {
  /** False when the user unticked "Clean up afterwards": a Create run then records `off` and runs no cleanup. */
  cleanUpAfterwards: boolean;
  /** True for the cleanup run itself (the Delete action's run), which never cleans up in turn. */
  isCleanupRun: boolean;
  /** For a cleanup run: the created object to mark deleted when it passes; null otherwise. */
  markDeletedCreatedObjectId: string | null;
}

/** The options of an ordinary run started by the user or an auto-refine job. */
export const DEFAULT_RUN_OPTIONS: ActionScriptRunOptions = {
  cleanUpAfterwards: true,
  isCleanupRun: false,
  markDeletedCreatedObjectId: null,
};


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
 * Looks up the credential an action's runs log in as, without its password -
 * for its name.
 * @param website - The action's website row
 * @param action - The action row
 * @returns The credential, or null when the action runs logged out (or the credential is gone)
 */
export async function findActionCredential(
  website: Website,
  action: ActionWithCredential,
): Promise<CredentialSummary | null> {
  const credentialId = action.credentialId;
  const actionRunsLoggedOut = credentialId === null;
  if (actionRunsLoggedOut) return null;
  return findCredentialForWebsite(website.id, credentialId);
}

/**
 * The origins a plan for this website's actions may open: the website's own,
 * and the login pages' (the website's and its Login action's own).
 * @param website - The action's website row
 * @param loginAction - The website's Login action (see `findLoginActionForWebsite`), or null when it has none
 * @returns The allowed origins
 */
export function allowedOriginsFor(website: Website, loginAction: Pick<Action, "loginUrl"> | null): string[] {
  return buildAllowedPlanOrigins([website.url, website.loginUrl, loginAction?.loginUrl ?? null]);
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
 * Turns the step screenshots a run took into the rows recorded with it:
 * numbered 1, 2, 3 ... in the order they were taken, with each file name
 * made relative to the action script directory by prefixing the run's
 * folder (the same way `failureScreenshotFileName` is built). A screenshot
 * that could not be taken keeps `fileName` null and its error.
 * @param runFolderName - The run's folder, relative to the action script directory (see `buildRunFolderName`)
 * @param stepScreenshots - What the runner took, in order
 * @returns The rows to record, in order
 */
export function buildStepScreenshotInputs(
  runFolderName: string,
  stepScreenshots: RunStepScreenshot[],
): ActionScriptRunScreenshotInput[] {
  return stepScreenshots.map((stepScreenshot, screenshotIndex) => ({
    position: screenshotIndex + 1,
    moment: stepScreenshot.moment,
    stepNumber: stepScreenshot.stepNumber,
    fileName: stepScreenshot.fileName === null ? null : `${runFolderName}/${stepScreenshot.fileName}`,
    errorMessage: stepScreenshot.errorMessage,
    pageUrl: stepScreenshot.pageUrl,
  }));
}

/**
 * Runs one version with the given parameter values and records the run -
 * the work behind the "run a version" route and each run of an auto-refine
 * job, after the lookups and the one-run-per-action claim (`claimActionRun`).
 *
 * Checks how the action logs in (the credential it runs as, and the website's
 * Login action and its login page) and the stored plan, puts the run's
 * parameter values in (see `prepareParameterRun`) and checks the plan they
 * make, runs it, records the run with the values it used, and follows the run
 * up (see `followUpRecordedRun`: the parameters learn from it, and a Create or
 * Delete run updates the created objects). A run that FAILED is still a
 * successfully recorded run (`succeeded: false`); only a run that could not be
 * started or recorded throws.
 *
 * CLEANUP: a run of a Create action (not itself a cleanup run) then cleans up
 * after itself (see `cleanUpAfterCreateRun`): the linked Delete action's
 * newest version is run on the object this run recorded, and the outcome is
 * written on this run - which counts as FAILED when the cleanup failed or
 * could not start, however its own steps went. `options.cleanUpAfterwards`
 * false skips that and records `off`.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The active website, action, and version to run
 * @param parameterValues - The run's values, by parameter key (validated as text)
 * @param options - Whether to clean up afterwards, and whether this IS the cleanup run (see `ActionScriptRunOptions`)
 * @returns The recorded run, with the objects it created and deleted and its cleanup run when they could be read
 * @throws {ActionScriptRequestProblem} 503 when the action logs in but no encryption key is configured; 409 when it is itself a Login action (which has no steps), its credential no longer exists, it runs as a credential but the website has no Login action, the stored plan no longer passes the plan rules, or the plan types a credential the action does not have; 400 when the Login action has no login URL and neither does the website, a value is not accepted, or the plan the values make breaks a plan rule
 * @throws Anything else the password decryption, the runner, or a query rejects with
 */
export async function performActionScriptRun(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  parameterValues: Record<string, string>,
  options: ActionScriptRunOptions = DEFAULT_RUN_OPTIONS,
): Promise<ActionScriptRunWithObjects | ActionScriptRun> {
  const { website, action, script } = found;
  if (isLoginAction(action)) {
    throw new ActionScriptRequestProblem(409, LOGIN_ACTION_HAS_NO_STEPS_MESSAGE);
  }
  const credentialId = action.credentialId;
  const actionRunsLoggedIn = credentialId !== null;
  if (actionRunsLoggedIn && !credentialEncryptionIsConfigured()) {
    throw new ActionScriptRequestProblem(503, CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE);
  }
  const credential =
    credentialId === null ? null : await findCredentialWithPasswordForWebsite(website.id, credentialId);
  const actionsCredentialIsGone = actionRunsLoggedIn && credential === null;
  if (actionsCredentialIsGone) {
    throw new ActionScriptRequestProblem(409, ACTION_CREDENTIAL_MISSING_MESSAGE);
  }
  const loginAction = await findLoginActionForWebsite(website.id);
  const credentialHasNoLoginActionToLogInWith = credential !== null && loginAction === null;
  if (credentialHasNoLoginActionToLogInWith) {
    throw new ActionScriptRequestProblem(409, WEBSITE_HAS_NO_LOGIN_ACTION_MESSAGE);
  }
  const loginActionHasNoLoginPage =
    credential !== null && loginAction !== null && findEffectiveLoginUrl(loginAction, website) === null;
  if (loginActionHasNoLoginPage) {
    throw new ActionScriptRequestProblem(400, describeLoginActionWithoutLoginPage(loginAction.title));
  }

  const allowedOrigins = allowedOriginsFor(website, loginAction);
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
    loginAction === null || credential === null
      ? null
      : {
          loginActionTitle: loginAction.title,
          credentialName: credential.name,
          details: buildLoginDetails(loginAction, credential, website),
        };

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
    stepScreenshots: buildStepScreenshotInputs(runFolderName, run.stepScreenshots),
  });
  const followUpOutcome = await followUpRecordedRun({
    websiteId: website.id,
    action,
    actionScriptId: script.id,
    plan: script.plan,
    actionScriptRunId: created.id,
    view: parametersView,
    applied: preparedRun.applied,
    runResult: run,
    markDeletedCreatedObjectId: options.markDeletedCreatedObjectId,
  });
  const runCleansUpAfterItself = !options.isCleanupRun && parametersView.role.kind === "create";
  if (runCleansUpAfterItself) {
    await cleanUpAfterCreateRun(actionScriptDirectory, found, created, followUpOutcome, {
      cleanUpAfterwards: options.cleanUpAfterwards,
      usedValues: preparedRun.applied.usedValues,
    });
  }
  const createdWithObjects = await findActionScriptRunWithObjects(website.id, created.id);
  return createdWithObjects ?? created;
}

/** How a cleanup attempt ended, before it is written on the Create run. */
interface CleanupAttempt {
  /** What happened. */
  outcome: CleanupOutcome;
  /** The Delete action's run, when one ran. */
  cleanupRun: ActionScriptRun | null;
  /** The Delete run's error, or why no cleanup could start; null when it passed or was turned off. */
  errorMessage: string | null;
}

/** What a cleanup needs from the Create run it follows, beyond the recorded object. */
export interface CleanupRunInputs {
  /** False when the user turned cleanup off for this run. */
  cleanUpAfterwards: boolean;
  /** The values the Create run used (secrets left out); the Delete run gets the ones its version mirrors, by key. */
  usedValues: UsedParameterValue[];
}

/**
 * Picks the values a cleanup run (or a Delete-only run of auto-refine) sends:
 * the Create run's used values whose keys the Delete version has - its
 * mirrored parameters share the Create action's keys - so a Create run that
 * typed "Voyager" cleans up "Voyager". Other keys are dropped, because a run
 * refuses a key its version does not know.
 * @param usedValues - The Create run's used values
 * @param deleteParameters - The Delete version's parameters
 * @returns The values to run the Delete version with, by key
 */
export function pickCleanupValues(
  usedValues: UsedParameterValue[],
  deleteParameters: Pick<VersionParameter, "key">[],
): Record<string, string> {
  const deleteKeys = new Set(deleteParameters.map((parameter) => parameter.key));
  return Object.fromEntries(
    usedValues.filter((usedValue) => deleteKeys.has(usedValue.key)).map((usedValue) => [usedValue.key, usedValue.value]),
  );
}

/**
 * Tries the cleanup of a Create run: finds the linked Delete action and its
 * newest version, claims the Delete action, and runs that version on the
 * created object - with the Create run's values for the parameters the
 * Delete version mirrors (`pickCleanupValues`), and the object's id for the
 * delete mark. Every reason not to run is an outcome, never a throw.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The website, Create action, and version that just ran
 * @param followUpOutcome - The object the Create run recorded, if any
 * @param inputs - Whether cleanup is on for this run, and the values the Create run used
 * @returns How the attempt ended
 */
async function attemptCleanup(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  followUpOutcome: RunFollowUpOutcome,
  inputs: CleanupRunInputs,
): Promise<CleanupAttempt> {
  const { website, action } = found;
  if (!inputs.cleanUpAfterwards) {
    return { outcome: "off", cleanupRun: null, errorMessage: null };
  }
  const link = await findActionCleanupForCreateAction(website.id, action.id);
  if (link === null) {
    return { outcome: "missing", cleanupRun: null, errorMessage: CLEANUP_NO_DELETE_ACTION_MESSAGE };
  }
  const deleteAction = await findActionForWebsite(website.id, link.deleteActionId);
  if (deleteAction === null) {
    return { outcome: "missing", cleanupRun: null, errorMessage: CLEANUP_DELETE_ACTION_GONE_MESSAGE };
  }
  const deleteScript = await findNewestActionScriptForAction(website.id, deleteAction.id);
  if (deleteScript === null) {
    return { outcome: "missing", cleanupRun: null, errorMessage: CLEANUP_NO_DELETE_VERSION_MESSAGE };
  }
  const { createdObjectId, createdObjectName } = followUpOutcome;
  const nothingWasCreated = createdObjectId === null || createdObjectName === null;
  if (nothingWasCreated) {
    return { outcome: "notReached", cleanupRun: null, errorMessage: null };
  }
  const deleteActionWasClaimed = claimActionRun(deleteAction.id);
  if (!deleteActionWasClaimed) {
    return { outcome: "failed", cleanupRun: null, errorMessage: CLEANUP_DELETE_ACTION_BUSY_MESSAGE };
  }
  try {
    // The Delete version mirrors the Create action's parameters (same keys),
    // so the Create run's values go in by key; a key the version does not
    // have is dropped rather than refused.
    const deleteView = await loadVersionParameters(website.id, deleteAction, deleteScript);
    const cleanupValues = pickCleanupValues(inputs.usedValues, deleteView.parameters);
    const cleanupRun = await performActionScriptRun(
      actionScriptDirectory,
      { website, action: deleteAction, script: deleteScript },
      cleanupValues,
      { cleanUpAfterwards: false, isCleanupRun: true, markDeletedCreatedObjectId: createdObjectId },
    );
    return {
      outcome: cleanupRun.succeeded ? "passed" : "failed",
      cleanupRun,
      errorMessage: cleanupRun.succeeded ? null : cleanupRun.errorMessage,
    };
  } catch (cleanupError: unknown) {
    return { outcome: "failed", cleanupRun: null, errorMessage: describeError(cleanupError) };
  } finally {
    releaseActionRun(deleteAction.id);
  }
}

/**
 * Cleans up after a recorded Create run and writes the outcome on it (see the
 * `ActionScriptRun` model's cleanup doc): runs the linked Delete action's
 * newest version on the object the run made, or records why it could not -
 * turned off for this run (`off`), nothing was made (`notReached`), no Delete
 * action or no version of it (`missing`). The run counts as FAILED when the
 * outcome is `failed` or `missing`: when its own steps had passed, its error
 * becomes "Cleanup failed: …" / "Cleanup missing: …"; when they had failed,
 * its own error stays. NEVER rejects - the run is already recorded; a failure
 * to write the outcome is logged.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The website, Create action, and version that just ran
 * @param createdRun - The Create run as recorded
 * @param followUpOutcome - The object the run recorded, if any
 * @param inputs - Whether cleanup is on for this run, and the values the Create run used
 * @returns Resolves once the outcome is written (or found to match no row)
 */
export async function cleanUpAfterCreateRun(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  createdRun: ActionScriptRun,
  followUpOutcome: RunFollowUpOutcome,
  inputs: CleanupRunInputs,
): Promise<void> {
  try {
    const attempt = await attemptCleanup(actionScriptDirectory, found, followUpOutcome, inputs);
    const cleanupCountsAsAFailure = attempt.outcome === "failed" || attempt.outcome === "missing";
    const ownStepsPassed = createdRun.succeeded;
    const errorMessage =
      ownStepsPassed && cleanupCountsAsAFailure
        ? `${CLEANUP_ERROR_PREFIX}${attempt.outcome}: ${attempt.errorMessage ?? "no reason recorded"}`
        : createdRun.errorMessage;
    await recordActionScriptRunCleanup(found.website.id, createdRun.id, {
      cleanupOutcome: attempt.outcome,
      cleanupActionScriptRunId: attempt.cleanupRun?.id ?? null,
      cleanupErrorMessage: attempt.errorMessage,
      succeeded: ownStepsPassed && !cleanupCountsAsAFailure,
      errorMessage,
    });
  } catch (recordError: unknown) {
    console.error(`[cleanup] run ${createdRun.id} could not record its cleanup: ${describeError(recordError)}`);
  }
}

/**
 * Says whether a recorded run failed ONLY in its cleanup: its own steps
 * passed, and the Delete action's run failed or could not start. Such a run
 * cannot be refined - its plan is fine; the delete action's run is what needs
 * refining.
 * @param run - A recorded run
 * @returns True for a cleanup-only failure
 */
export function runFailedOnlyInItsCleanup(run: ActionScriptRun): boolean {
  const cleanupFailed = run.cleanupOutcome === "failed" || run.cleanupOutcome === "missing";
  const errorIsTheCleanups = run.errorMessage?.startsWith(CLEANUP_ERROR_PREFIX) ?? false;
  return !run.succeeded && cleanupFailed && errorIsTheCleanups;
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
 * @throws {ActionScriptRequestProblem} 409 when the action is a Login action (it has no steps), or the model that wrote the version is no longer offered
 * @throws {ScriptGenerationError} When Claude declined, its reply was cut off, or the reply was not a valid plan (see `refineActionPlan`)
 * @throws Anything else the screenshot read, the Anthropic API call, or a query rejects with
 */
export async function performRefinement(
  actionScriptDirectory: string,
  source: RefinableRun,
  note: string | null,
): Promise<ActionScriptWithPlan> {
  const { website, action, script, run, failedRun, sourceModelId } = source;
  if (isLoginAction(action)) {
    throw new ActionScriptRequestProblem(409, LOGIN_ACTION_HAS_NO_STEPS_MESSAGE);
  }
  const model = await findScriptModel(sourceModelId);
  if (model === null) {
    throw new ActionScriptRequestProblem(
      409,
      `The model that wrote this version (${sourceModelId}) is no longer offered, so it cannot refine it; convert the action again`,
    );
  }
  const effort = chooseRefinementEffort(model, script.effort);
  const planThatRan = await planWithRunValues(website.id, action, script, run);

  const allowedOrigins = allowedOriginsFor(website, await findLoginActionForWebsite(website.id));
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
