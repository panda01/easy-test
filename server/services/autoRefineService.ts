import {
  appendAutoRefineJobRun,
  appendAutoRefineJobScript,
  createAutoRefineJob,
  findAutoRefineJobForAction,
  finishAutoRefineJob,
  markAutoRefineJobPhase,
  markRunningAutoRefineJobsInterrupted,
  type ActionScriptWithPlan,
  type AutoRefineJob,
  type AutoRefineJobFinish,
} from "./dbService.js";
import {
  claimActionRun,
  claimRunRefinement,
  describeFailedRun,
  performActionScriptRun,
  performRefinement,
  releaseActionRun,
  releaseRunRefinement,
  type WebsiteActionAndScript,
} from "./actionScriptExecutionService.js";
import { loadVersionParameters } from "./actionParameterService.js";
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
