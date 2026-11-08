import {
  appendAutoRefineJobCleanupRun,
  appendAutoRefineJobCleanupScript,
  appendAutoRefineJobRun,
  appendAutoRefineJobScript,
  createAutoRefineJob,
  findActionForWebsite,
  findActionScriptForAction,
  findActionScriptRunWithObjects,
  findAutoRefineJobForAction,
  finishAutoRefineJob,
  markAutoRefineJobPhase,
  markRunningAutoRefineJobsInterrupted,
  type ActionScriptRun,
  type ActionScriptWithPlan,
  type AutoRefineJob,
  type AutoRefineJobFinish,
} from "./dbService.js";
import {
  CLEANUP_DELETE_ACTION_BUSY_MESSAGE,
  claimActionRun,
  claimRunRefinement,
  describeFailedRun,
  performActionScriptRun,
  performRefinement,
  releaseActionRun,
  releaseRunRefinement,
  runFailedOnlyInItsCleanup,
  type WebsiteActionAndScript,
} from "./actionScriptExecutionService.js";
import { loadVersionParameters } from "./actionParameterService.js";
import { OBJECT_PARAMETER_KEY } from "../utils/actionParameters.js";
import { describeError } from "../utils/describeError.js";
import { plansAreIdentical } from "../utils/plansAreIdentical.js";

/**
 * The most refinements one auto-refine job makes before it gives up: at most
 * `MAX_AUTO_REFINEMENTS + 1` versions are run.
 */
export const MAX_AUTO_REFINEMENTS = 5;

/** The job's error when a failed run recorded no error message, so there is nothing to show Claude. */
const FAILED_RUN_HAS_NO_ERROR_MESSAGE =
  "The run failed but recorded no error message, so there is nothing to refine from";

/** The job's error when the version to refine was saved from the step editor (no model wrote it). */
const VERSION_HAS_NO_MODEL_MESSAGE =
  "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined";

/** The `unchanged` ending's message when it was the DELETE action's refinement that changed nothing (the job's own version passed). */
export const DELETE_REFINEMENT_CHANGED_NOTHING_MESSAGE =
  "its delete action's refinement came back identical to the version it refined, so refining again would go nowhere";

/** The job's error when a cleanup failed but the Delete run, its version, or the created object could not be read back. */
const CLEANUP_FAILURE_COULD_NOT_BE_READ_MESSAGE =
  "The cleanup failed, but its delete run, version, or the created object could not be read, so it cannot be refined";

/** The created object a failed cleanup left on the site, which the refined Delete version is run on. */
interface LeftoverCreatedObject {
  /** The created object's cuid. */
  id: string;
  /** Its name, typed as the Delete version's `object` value. */
  name: string;
}

/**
 * Reads the created object a Create run recorded, when the run was read with
 * its objects.
 * @param run - The Create run as `performActionScriptRun` returned it
 * @returns The object's id and name, or null when the run carries none
 */
function readLeftoverCreatedObject(run: ActionScriptRun | { createdObject: { id: string; name: string } | null }): LeftoverCreatedObject | null {
  const runCarriesObjects = "createdObject" in run;
  if (!runCarriesObjects || run.createdObject === null) return null;
  return { id: run.createdObject.id, name: run.createdObject.name };
}

/** The outcome of asking to start an auto-refine job. */
export type AutoRefineStart =
  | {
      /** Nothing was started. */
      started: false;
      /** Why: a run of the action (or another job) is already in progress in this process. */
      reason: "actionIsRunning";
    }
  | {
      /** The job was created and its loop is running in the background. */
      started: true;
      /** The job row, created `running`. */
      job: AutoRefineJob;
      /** Resolves once the loop has ended and been recorded (for tests - production ignores it). */
      completion: Promise<void>;
    };

/**
 * Drops the stored run-form values whose keys the version being run does not
 * know: a refinement can rename or remove a parameter, and `prepareParameterRun`
 * refuses a key that is not one of the version's parameters.
 * @param found - The website, action, and version about to run
 * @param parameterValues - The values stored on the job, by parameter key
 * @returns Only the values whose key is one of the version's parameters
 */
async function dropValuesUnknownToVersion(
  found: WebsiteActionAndScript,
  parameterValues: Record<string, string>,
): Promise<Record<string, string>> {
  const parametersView = await loadVersionParameters(found.website.id, found.action, found.script);
  const knownKeys = new Set(parametersView.parameters.map((parameter) => parameter.key));
  const knownValues = Object.fromEntries(
    Object.entries(parameterValues).filter(([parameterKey]) => knownKeys.has(parameterKey)),
  );
  return knownValues;
}

/**
 * The run-then-refine loop of one job. Runs the current version; on a pass,
 * the refinement cap, or a stop request it ends the job; otherwise it refines
 * the version (the same refine as the "Refine" button, with no note), saves
 * the new version on the job, and - unless the refined plan is identical to
 * the one it refined - runs the new version.
 *
 * CLEANUP (Create actions): a run whose own steps passed but whose cleanup
 * failed is not refined here - its plan is fine. The job then works on the
 * Delete side (`refineCleanupUntilItPasses`) until a Delete run passes, and
 * only then runs the Create action again; a cleanup that could not start
 * (no Delete action, or no version of it) ends the job `failed`.
 *
 * Never rejects: any error (an `ActionScriptRequestProblem`, a
 * `ScriptGenerationError`, a query failure) ends the job `failed` with the
 * error's message, logging instead if even that write fails. The action's
 * run claim is released in a `finally`. A job whose action or website was
 * deleted meanwhile is noticed when its phase write matches no row, and the
 * loop then ends quietly.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The website, action, and version the job started from
 * @param job - The job row, created `running`
 * @param parameterValues - The run-form values stored on the job, by parameter key
 * @returns Resolves once the job has ended and been recorded
 */
async function runAutoRefineInBackground(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  job: AutoRefineJob,
  parameterValues: Record<string, string>,
): Promise<void> {
  const { website, action } = found;
  let version: ActionScriptWithPlan = found.script;
  let refinementsDone = 0;

  /**
   * Records how the job ended, unless it was deleted meanwhile.
   * @param ending - The final status, error message, and last version
   * @returns Resolves once the ending is written (or found to match no row)
   */
  const finish = async (ending: AutoRefineJobFinish): Promise<void> => {
    await finishAutoRefineJob(website.id, action.id, job.id, ending);
  };

  /**
   * Re-reads the job row to see whether the user asked it to stop.
   * @returns True when `stopRequestedAt` is set
   */
  const stopWasRequested = async (): Promise<boolean> => {
    const currentJob = await findAutoRefineJobForAction(website.id, action.id, job.id);
    return currentJob !== null && currentJob.stopRequestedAt !== null;
  };

  /**
   * The Delete side of the loop, after a Create run whose own steps passed
   * but whose cleanup (the Delete action's run) failed: refines the Delete
   * action's version from that failed run and runs the refined version ALONE
   * on the object the failed cleanup left behind, repeating until a Delete
   * run passes - the job then goes back to running the Create action - or the
   * refinement cap is reached, a stop is requested, or a refinement changes
   * nothing. The Delete refinements count toward the same cap.
   * @param createRun - The Create run whose cleanup failed, as recorded
   * @returns Whether the job was ended (finished and recorded) in here
   */
  const refineCleanupUntilItPasses = async (
    createRun: Awaited<ReturnType<typeof performActionScriptRun>>,
  ): Promise<{ jobEnded: boolean }> => {
    const leftover = readLeftoverCreatedObject(createRun);
    const cleanupRunId = createRun.cleanupActionScriptRunId;
    const deleteRunRecord =
      cleanupRunId === null ? null : await findActionScriptRunWithObjects(website.id, cleanupRunId);
    const deleteAction =
      deleteRunRecord === null ? null : await findActionForWebsite(website.id, deleteRunRecord.actionId);
    const deleteVersionRecord =
      deleteAction === null || deleteRunRecord === null
        ? null
        : await findActionScriptForAction(website.id, deleteAction.id, deleteRunRecord.actionScriptId);
    const cleanupFailureCannotBeRefined =
      leftover === null || deleteRunRecord === null || deleteAction === null || deleteVersionRecord === null;
    if (cleanupFailureCannotBeRefined) {
      await finish({
        status: "failed",
        errorMessage: createRun.cleanupErrorMessage ?? CLEANUP_FAILURE_COULD_NOT_BE_READ_MESSAGE,
        currentActionScriptId: version.id,
      });
      return { jobEnded: true };
    }

    let deleteRun: ActionScriptRun = deleteRunRecord;
    let deleteVersion: ActionScriptWithPlan = deleteVersionRecord;
    for (;;) {
      const refinementCapWasReached = refinementsDone === MAX_AUTO_REFINEMENTS;
      if (refinementCapWasReached) {
        await finish({ status: "gaveUp", errorMessage: null, currentActionScriptId: version.id });
        return { jobEnded: true };
      }
      if (await stopWasRequested()) {
        await finish({ status: "stopped", errorMessage: null, currentActionScriptId: version.id });
        return { jobEnded: true };
      }
      const jobIsStillActive = await markAutoRefineJobPhase(website.id, action.id, job.id, {
        phase: "refiningCleanup",
        currentActionScriptId: version.id,
      });
      if (!jobIsStillActive) {
        return { jobEnded: true };
      }
      const failedDeleteRun = describeFailedRun(deleteRun);
      if (failedDeleteRun === null) {
        await finish({ status: "failed", errorMessage: FAILED_RUN_HAS_NO_ERROR_MESSAGE, currentActionScriptId: version.id });
        return { jobEnded: true };
      }
      const deleteModelId = deleteVersion.modelId;
      if (deleteModelId === null) {
        await finish({ status: "failed", errorMessage: VERSION_HAS_NO_MODEL_MESSAGE, currentActionScriptId: version.id });
        return { jobEnded: true };
      }

      claimRunRefinement(deleteRun.id);
      let refinedDeleteVersion: ActionScriptWithPlan;
      try {
        refinedDeleteVersion = await performRefinement(
          actionScriptDirectory,
          {
            website,
            action: deleteAction,
            script: deleteVersion,
            run: deleteRun,
            failedRun: failedDeleteRun,
            sourceModelId: deleteModelId,
          },
          null,
        );
      } finally {
        releaseRunRefinement(deleteRun.id);
      }
      refinementsDone += 1;
      await appendAutoRefineJobCleanupScript(website.id, action.id, job.id, refinedDeleteVersion.id, refinementsDone);

      const refinementChangedNothing = plansAreIdentical(deleteVersion.plan, refinedDeleteVersion.plan);
      if (refinementChangedNothing) {
        // The job's own version is fine; the message says which plan came back identical.
        await finish({
          status: "unchanged",
          errorMessage: DELETE_REFINEMENT_CHANGED_NOTHING_MESSAGE,
          currentActionScriptId: version.id,
        });
        return { jobEnded: true };
      }
      deleteVersion = refinedDeleteVersion;

      if (await stopWasRequested()) {
        await finish({ status: "stopped", errorMessage: null, currentActionScriptId: version.id });
        return { jobEnded: true };
      }
      await markAutoRefineJobPhase(website.id, action.id, job.id, {
        phase: "runningCleanup",
        currentActionScriptId: version.id,
      });
      const deleteActionWasClaimed = claimActionRun(deleteAction.id);
      if (!deleteActionWasClaimed) {
        await finish({ status: "failed", errorMessage: CLEANUP_DELETE_ACTION_BUSY_MESSAGE, currentActionScriptId: version.id });
        return { jobEnded: true };
      }
      try {
        deleteRun = await performActionScriptRun(
          actionScriptDirectory,
          { website, action: deleteAction, script: deleteVersion },
          { [OBJECT_PARAMETER_KEY]: leftover.name },
          { cleanUpAfterwards: false, isCleanupRun: true, markDeletedCreatedObjectId: leftover.id },
        );
      } finally {
        releaseActionRun(deleteAction.id);
      }
      await appendAutoRefineJobCleanupRun(website.id, action.id, job.id, deleteRun.id);
      const deleteNowWorks = deleteRun.succeeded;
      if (deleteNowWorks) {
        return { jobEnded: false };
      }
    }
  };

  try {
    // One iteration per version: a run, then (on failure) a refinement.
    for (;;) {
      if (await stopWasRequested()) {
        await finish({ status: "stopped", errorMessage: null, currentActionScriptId: version.id });
        return;
      }
      const jobIsStillActive = await markAutoRefineJobPhase(website.id, action.id, job.id, {
        phase: "running",
        currentActionScriptId: version.id,
      });
      if (!jobIsStillActive) {
        return;
      }

      const versionToRun: WebsiteActionAndScript = { website, action, script: version };
      const valuesForThisVersion = await dropValuesUnknownToVersion(versionToRun, parameterValues);
      const run = await performActionScriptRun(actionScriptDirectory, versionToRun, valuesForThisVersion);
      await appendAutoRefineJobRun(website.id, action.id, job.id, run.id);

      if (run.succeeded) {
        await finish({ status: "passed", errorMessage: null, currentActionScriptId: version.id });
        return;
      }
      // The Create steps passed; only the cleanup went wrong. A missing
      // Delete action (or version) is nothing a refinement can fix; a failed
      // Delete run is refined on the Delete side until it passes, and only
      // then is the Create action run again.
      if (runFailedOnlyInItsCleanup(run)) {
        const cleanupIsMissing = run.cleanupOutcome === "missing";
        if (cleanupIsMissing) {
          await finish({
            status: "failed",
            errorMessage: run.cleanupErrorMessage ?? CLEANUP_FAILURE_COULD_NOT_BE_READ_MESSAGE,
            currentActionScriptId: version.id,
          });
          return;
        }
        const cleanupEnding = await refineCleanupUntilItPasses(run);
        if (cleanupEnding.jobEnded) {
          return;
        }
        continue;
      }
      const refinementCapWasReached = refinementsDone === MAX_AUTO_REFINEMENTS;
      if (refinementCapWasReached) {
        await finish({ status: "gaveUp", errorMessage: null, currentActionScriptId: version.id });
        return;
      }
      if (await stopWasRequested()) {
        await finish({ status: "stopped", errorMessage: null, currentActionScriptId: version.id });
        return;
      }

      await markAutoRefineJobPhase(website.id, action.id, job.id, {
        phase: "refining",
        currentActionScriptId: version.id,
      });
      const failedRun = describeFailedRun(run);
      if (failedRun === null) {
        await finish({
          status: "failed",
          errorMessage: FAILED_RUN_HAS_NO_ERROR_MESSAGE,
          currentActionScriptId: version.id,
        });
        return;
      }
      const sourceModelId = version.modelId;
      const versionWasSavedFromTheEditor = sourceModelId === null;
      if (versionWasSavedFromTheEditor) {
        await finish({
          status: "failed",
          errorMessage: VERSION_HAS_NO_MODEL_MESSAGE,
          currentActionScriptId: version.id,
        });
        return;
      }

      claimRunRefinement(run.id);
      let refined: ActionScriptWithPlan;
      try {
        refined = await performRefinement(
          actionScriptDirectory,
          { website, action, script: version, run, failedRun, sourceModelId },
          null,
        );
      } finally {
        releaseRunRefinement(run.id);
      }
      refinementsDone += 1;
      await appendAutoRefineJobScript(website.id, action.id, job.id, refined.id, refinementsDone);

      const refinementChangedNothing = plansAreIdentical(version.plan, refined.plan);
      if (refinementChangedNothing) {
        await finish({ status: "unchanged", errorMessage: null, currentActionScriptId: refined.id });
        return;
      }
      version = refined;
    }
  } catch (error: unknown) {
    const errorMessage = describeError(error);
    try {
      await finish({ status: "failed", errorMessage, currentActionScriptId: version.id });
    } catch (finishError: unknown) {
      console.error(
        `[auto-refine] job ${job.id} failed (${errorMessage}) and could not be marked failed: ${describeError(finishError)}`,
      );
    }
  } finally {
    releaseActionRun(action.id);
  }
}

/**
 * Starts auto-refining a version in the background, unless a run of its
 * action is already in progress in this process.
 *
 * The action is claimed with `claimActionRun` synchronously, before anything
 * is awaited, so two simultaneous requests cannot both start a job - and a
 * manual "Run" during the job gets the usual "already running" answer. The
 * job row is then created (`status: "running"`, the version as its start,
 * `MAX_AUTO_REFINEMENTS` as its cap, the given values) and the loop starts
 * WITHOUT being awaited: the caller answers at once, and the page polls the
 * job for progress.
 * @param actionScriptDirectory - Absolute path of the action script directory
 * @param found - The active website, action, and version to start from
 * @param parameterValues - The run-form values the user had changed, by parameter key; sent to every run
 * @returns Whether a job was started; when it was, the new job and a promise for the loop's end (for tests - production ignores it)
 * @throws When the job row cannot be created (the claim is released first)
 */
export async function startAutoRefineJob(
  actionScriptDirectory: string,
  found: WebsiteActionAndScript,
  parameterValues: Record<string, string>,
): Promise<AutoRefineStart> {
  const { website, action, script } = found;
  const actionWasClaimed = claimActionRun(action.id);
  if (!actionWasClaimed) {
    return { started: false, reason: "actionIsRunning" };
  }

  let job: AutoRefineJob;
  try {
    job = await createAutoRefineJob(website.id, action.id, {
      startActionScriptId: script.id,
      maxRefinements: MAX_AUTO_REFINEMENTS,
      parameterValues,
    });
  } catch (error: unknown) {
    releaseActionRun(action.id);
    throw error;
  }

  const completion = runAutoRefineInBackground(actionScriptDirectory, found, job, parameterValues);
  return { started: true, job, completion };
}

/**
 * Marks every job left `running` by a previous server process as
 * `interrupted`. A job only runs inside the server process, so at boot every
 * `running` job was cut off by a restart.
 *
 * `server.ts` awaits this BEFORE it starts listening, next to the crawl
 * sweep, so it can never flip a job this process just started. Never
 * rejects: a failure is logged, and the server still starts.
 * @returns Resolves once the jobs are marked or the failure is logged
 */
export async function markUnfinishedAutoRefineJobsInterrupted(): Promise<void> {
  try {
    const interruptedJobCount = await markRunningAutoRefineJobsInterrupted();
    const someJobsWereInterrupted = interruptedJobCount > 0;
    if (someJobsWereInterrupted) {
      console.log(`[auto-refine] marked ${interruptedJobCount} unfinished auto-refine job(s) interrupted`);
    }
  } catch (error: unknown) {
    console.error(
      `[auto-refine] could not mark unfinished auto-refine jobs interrupted: ${describeError(error)}`,
    );
  }
}
