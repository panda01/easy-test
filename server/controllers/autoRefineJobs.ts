import { type Express } from "express";
import {
  listAutoRefineJobsForAction,
  findAutoRefineJobForAction,
  requestAutoRefineJobStop,
} from "../services/dbService.js";
import { startAutoRefineJob } from "../services/autoRefineService.js";
import {
  ACTION_ALREADY_RUNNING_MESSAGE,
  EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE,
} from "../services/actionScriptExecutionService.js";
import { describeError } from "../utils/describeError.js";
import { validateRunParameterValuesInput } from "../utils/validateRequestBodies.js";
import { findWebsiteAndAction, findWebsiteActionAndScript } from "./actionLookups.js";

const AUTO_REFINE_JOB_NOT_FOUND_MESSAGE = "Auto-refine job not found";
const AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE =
  "This auto-refine job is not running, so it cannot be stopped";

/**
 * Registers the auto-refine job routes: starting a background job that runs a
 * version and, on failure, refines it and runs the refined version until a
 * run passes (or the job gives up), and reading back and stopping those jobs.
 *
 * Every path is nested under `/api/websites/:websiteId/actions/:actionId`, and
 * every route first confirms the website and then the action are active,
 * answering 404 for the first one missing; later lookups use the FOUND rows'
 * ids. Jobs are create-only: there are no PUT or DELETE routes, and they are
 * soft deleted together with their action or website. The loop itself lives
 * in `../services/autoRefineService.ts`.
 *
 * Like the action script routes, this registrar takes the action script
 * directory (resolved once at boot from `ACTION_SCRIPT_DIR`): every run the
 * job records writes its folder there.
 * @param app - The express application to attach the routes to
 * @param actionScriptDirectory - Absolute path run folders are written to and the `uploads` folder lives in
 */
export function registerAutoRefineJobRoutes(app: Express, actionScriptDirectory: string): void {
  /**
   * Starts auto-refining a version in the BACKGROUND and answers at once with
   * the new job (`status: "running"`, `phase: "running"`). The job runs the
   * version as it is; when the run fails it refines the version with Claude
   * (the same refine as the "Refine" button, with no note), saves the reply
   * as a new version, and runs that - until a run passes, `maxRefinements`
   * (5) refinements have been made, a refinement comes back with the very
   * plan it refined, a stop is requested, or a step breaks. Poll
   * `GET .../auto-refine-jobs/:autoRefineJobId` for progress.
   *
   * PARAMETERS: the body may give the run-form values the user had changed,
   * by parameter key. They are stored on the job and sent to every run; a key
   * a later version no longer has is dropped before that run.
   *
   * Only one run of an action happens at a time: while the job runs, a manual
   * run of the action (or a second job) answers 409 "already running".
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/auto-refine-jobs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version to start from
   * @param body - Optional JSON `{ parameterValues }`: the values by parameter key, each text of at most 1000 characters without `{{`
   * @returns 201 with the new job; 400 with `{ error }` when the body is invalid; 404 with `{ error }` when the website, action, or version does not exist or was deleted; 409 with `{ error }` when the version was saved from the step editor (no model wrote it, so Claude cannot refine it) or the action is already running; 500 with `{ error }` when the job cannot be created or a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/auto-refine-jobs",
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
        const { script } = lookup.found;
        const versionWasSavedFromTheEditor = script.modelId === null;
        if (versionWasSavedFromTheEditor) {
          res.status(409).json({ error: EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE });
          return;
        }

        const autoRefineStart = await startAutoRefineJob(
          actionScriptDirectory,
          lookup.found,
          valuesValidation.input.parameterValues,
        );
        if (!autoRefineStart.started) {
          res.status(409).json({ error: ACTION_ALREADY_RUNNING_MESSAGE });
          return;
        }
        // `autoRefineStart.completion` is deliberately not awaited: the loop
        // runs in the background and the page polls the job for progress.
        res.status(201).json(autoRefineStart.job);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Lists an action's active auto-refine jobs, newest first. The action page
   * reads it on load to find a job that is still running and pick up
   * following it.
   * @route GET /api/websites/:websiteId/actions/:actionId/auto-refine-jobs
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @returns 200 with an array of jobs; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/actions/:actionId/auto-refine-jobs", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      const autoRefineJobs = await listAutoRefineJobsForAction(website.id, action.id);
      res.json(autoRefineJobs);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Reads one auto-refine job: its `status` and `phase`, the version it is
   * on (`currentActionScriptId`), the versions it created and the runs it
   * recorded (`createdActionScriptIds`, `actionScriptRunIds`, oldest first),
   * `refinementsDone` of `maxRefinements`, `stopRequestedAt`, and - once it
   * has ended - `finishedAt` and `errorMessage`. The page polls it every 2
   * seconds while the job runs, so the job is answered on its own, with no
   * joined versions or runs.
   * @route GET /api/websites/:websiteId/actions/:actionId/auto-refine-jobs/:autoRefineJobId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param autoRefineJobId - Path parameter: the job's cuid
   * @returns 200 with the job; 404 with `{ error }` when the website, the action, or the job does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/auto-refine-jobs/:autoRefineJobId",
    async (req, res) => {
      try {
        const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
        if (!lookup.allWereFound) {
          res.status(404).json({ error: lookup.notFoundMessage });
          return;
        }
        const { website, action } = lookup.found;
        const autoRefineJob = await findAutoRefineJobForAction(
          website.id,
          action.id,
          req.params.autoRefineJobId,
        );
        if (autoRefineJob === null) {
          res.status(404).json({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
          return;
        }
        res.json(autoRefineJob);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Asks a running auto-refine job to stop. The job checks for the request
   * between steps, so it ends `stopped` after the run or refinement in flight
   * - a run or a Claude call cannot be cut short. The job is answered at once
   * with `stopRequestedAt` set and `status` still `running`; poll it to see it
   * end.
   *
   * Only a job that is still `running` can be stopped: one that has already
   * ended answers 409, as does one that ended between the read and the write.
   * @route POST /api/websites/:websiteId/actions/:actionId/auto-refine-jobs/:autoRefineJobId/stop
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param autoRefineJobId - Path parameter: the job's cuid
   * @returns 200 with the job (its `stopRequestedAt` set); 404 with `{ error }` when the website, the action, or the job does not exist or was deleted; 409 with `{ error }` when the job is not running; 500 with `{ error }` when a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/auto-refine-jobs/:autoRefineJobId/stop",
    async (req, res) => {
      try {
        const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
        if (!lookup.allWereFound) {
          res.status(404).json({ error: lookup.notFoundMessage });
          return;
        }
        const { website, action } = lookup.found;
        const autoRefineJob = await findAutoRefineJobForAction(
          website.id,
          action.id,
          req.params.autoRefineJobId,
        );
        if (autoRefineJob === null) {
          res.status(404).json({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
          return;
        }
        const jobIsNotRunning = autoRefineJob.status !== "running";
        if (jobIsNotRunning) {
          res.status(409).json({ error: AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE });
          return;
        }

        const stopWasRequested = await requestAutoRefineJobStop(
          website.id,
          action.id,
          autoRefineJob.id,
        );
        // The job can end between the read above and this write; the
        // conditional write then matches no row.
        if (!stopWasRequested) {
          res.status(409).json({ error: AUTO_REFINE_JOB_NOT_RUNNING_MESSAGE });
          return;
        }
        const stoppingAutoRefineJob = await findAutoRefineJobForAction(
          website.id,
          action.id,
          autoRefineJob.id,
        );
        const jobWasDeletedMeanwhile = stoppingAutoRefineJob === null;
        if (jobWasDeletedMeanwhile) {
          res.status(404).json({ error: AUTO_REFINE_JOB_NOT_FOUND_MESSAGE });
          return;
        }
        res.json(stoppingAutoRefineJob);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );
}
