import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ActionScriptWithPlan,
  ActionWithCredential,
  AutoRefineJob,
  Website,
} from "../../../server/services/dbService.js";
import type { ActionPlan } from "../../../server/utils/actionPlanSchema.js";

/**
 * The database, the run and refine work, and the parameter view are all
 * replaced: this spec is about how a job is started, guarded, stepped through,
 * and finished. `plansAreIdentical` stays real - it is pure.
 */
const { mockDbService, mockExecutionService, mockActionParameterService } = vi.hoisted(() => ({
  mockDbService: {
    createAutoRefineJob: vi.fn(),
    findAutoRefineJobForAction: vi.fn(),
    markAutoRefineJobPhase: vi.fn(),
    appendAutoRefineJobRun: vi.fn(),
    appendAutoRefineJobScript: vi.fn(),
    appendAutoRefineJobCleanupRun: vi.fn(),
    appendAutoRefineJobCleanupScript: vi.fn(),
    findActionForWebsite: vi.fn(),
    findActionScriptForAction: vi.fn(),
    findActionScriptRunWithObjects: vi.fn(),
    finishAutoRefineJob: vi.fn(),
    markRunningAutoRefineJobsInterrupted: vi.fn(),
  },
  mockExecutionService: {
    CLEANUP_DELETE_ACTION_BUSY_MESSAGE: "Its delete action is already running",
    claimActionRun: vi.fn(),
    releaseActionRun: vi.fn(),
    claimRunRefinement: vi.fn(),
    releaseRunRefinement: vi.fn(),
    describeFailedRun: vi.fn(),
    performActionScriptRun: vi.fn(),
    performRefinement: vi.fn(),
    runFailedOnlyInItsCleanup: vi.fn(),
    /** The real pure helper: the Create run's values whose keys the Delete version has. */
    pickCleanupValues: (usedValues: { key: string; value: string }[], deleteParameters: { key: string }[]) => {
      const deleteKeys = new Set(deleteParameters.map((parameter) => parameter.key));
      return Object.fromEntries(usedValues.filter((usedValue) => deleteKeys.has(usedValue.key)).map((usedValue) => [usedValue.key, usedValue.value]));
    },
  },
  /** The parameters view is replaced: its own spec covers the detection and the object choices. */
  mockActionParameterService: { loadVersionParameters: vi.fn() },
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/actionScriptExecutionService.js", () => mockExecutionService);
vi.mock("../../../server/services/actionParameterService.js", () => mockActionParameterService);

import {
  MAX_AUTO_REFINEMENTS,
  markUnfinishedAutoRefineJobsInterrupted,
  startAutoRefineJob,
} from "../../../server/services/autoRefineService.js";

const ACTION_SCRIPT_DIRECTORY = "/tmp/action-scripts";

const website: Website = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 4000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
};

const action: ActionWithCredential = {
  id: "action-1",
  websiteId: "website-1",
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Click Sign in and log in",
  userActionKind: null,
  userObjectTypeKey: null,
  userNameParameterKey: null,
  parametersSyncedAt: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
  credential: null,
};

/** The plan the shown version runs. */
const SIGN_IN_PLAN: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    { action: "expectVisible", target: { text: "Welcome back" }, value: null },
  ],
};

/**
 * Builds a version of the action with the given id and plan, written by
 * Claude unless `modelId` says otherwise.
 * @param id - The version's cuid
 * @param plan - Its step plan
 * @param modelId - The model that wrote it, or null for a version saved from the step editor
 * @returns The version as dbService returns it
 */
function buildVersion(id: string, plan: ActionPlan, modelId: string | null = "claude-opus-5-5"): ActionScriptWithPlan {
  return {
    id,
    websiteId: "website-1",
    actionId: "action-1",
    websiteName: "Example",
    startUrl: "https://example.com/",
    actionTitle: "Log in",
    actionDescription: "Click Sign in and log in",
    credentialId: null,
    credentialName: null,
    summary: "Clicks Sign in",
    assumptions: [],
    plan,
    contextPageUrls: [],
    modelId,
    effort: modelId === null ? null : "high",
    editedFromActionScriptId: null,
    createdAt: new Date("2026-03-02T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    deletedAt: null,
    refinement: null,
    latestRun: null,
  };
}

/**
 * Builds a plan whose Sign in step clicks a differently named button, so each
 * refinement in a test changes the plan.
 * @param buttonName - The button the refined plan clicks
 * @returns A plan that differs from `SIGN_IN_PLAN` in one step
 */
function buildPlanClicking(buttonName: string): ActionPlan {
  return {
    ...SIGN_IN_PLAN,
    steps: [
      { action: "click", target: { role: "button", name: buttonName }, value: null },
      SIGN_IN_PLAN.steps[1],
    ],
  };
}

const startVersion = buildVersion("script-1", SIGN_IN_PLAN);
const found = { website, action, script: startVersion };
const parameterValues = { projectName: "Nightly build" };

/** The job row `createAutoRefineJob` answers with. */
const createdJob: AutoRefineJob = {
  id: "job-1",
  websiteId: "website-1",
  actionId: "action-1",
  startActionScriptId: "script-1",
  currentActionScriptId: "script-1",
  status: "running",
  phase: "running",
  refinementsDone: 0,
  maxRefinements: 5,
  parameterValues,
  createdActionScriptIds: [],
  actionScriptRunIds: [],
  cleanupActionScriptIds: [],
  cleanupActionScriptRunIds: [],
  stopRequestedAt: null,
  errorMessage: null,
  createdAt: new Date("2026-03-03T00:00:00.000Z"),
  updatedAt: new Date("2026-03-03T00:00:00.000Z"),
  finishedAt: null,
  deletedAt: null,
};

/** The same job once the user has clicked Stop. */
const jobWithStopRequested: AutoRefineJob = {
  ...createdJob,
  stopRequestedAt: new Date("2026-03-03T00:01:00.000Z"),
};

/**
 * Builds a recorded run, as `performActionScriptRun` answers with.
 * @param id - The run's cuid
 * @param succeeded - Whether it passed
 * @returns The run row (the fields the job reads)
 */
function buildRun(id: string, succeeded: boolean) {
  return {
    id,
    succeeded,
    timedOut: false,
    errorMessage: succeeded ? null : 'Step 2 (expectVisible): text "Welcome back" was not visible within 10 seconds',
    failedStepNumber: succeeded ? null : 2,
    output: "✔ Step 1: click\n✘ Step 2: expectVisible",
    failingPageUrl: succeeded ? null : "https://example.com/",
    failingPageAriaSnapshot: succeeded ? null : '- button "Log in"',
  };
}

/** How a failed run is shown to Claude (what the mocked `describeFailedRun` answers). */
const failedRunDetails = {
  errorMessage: 'Step 2 (expectVisible): text "Welcome back" was not visible within 10 seconds',
  failedStepNumber: 2,
  timedOut: false,
  output: "✔ Step 1: click\n✘ Step 2: expectVisible",
  failingPageUrl: "https://example.com/",
  failingPageAriaSnapshot: '- button "Log in"',
};

/** A parameters view whose one parameter is `projectName`. */
const parametersViewWithProjectName = {
  parameters: [{ key: "projectName" }],
};

/**
 * Starts a job that must start, so each test can await its completion.
 * @returns The created job and the promise for the loop's end
 */
async function startJobThatMustStart(): Promise<{ job: AutoRefineJob; completion: Promise<void> }> {
  const start = await startAutoRefineJob(ACTION_SCRIPT_DIRECTORY, found, parameterValues);
  if (!start.started) {
    throw new Error("Expected the job to start");
  }
  return start;
}

/**
 * Reads every `finishAutoRefineJob` call's ending.
 * @returns The endings written, in order
 */
function readFinishes(): unknown[] {
  return mockDbService.finishAutoRefineJob.mock.calls.map((finishCall: unknown[]) => finishCall[3]);
}

describe("startAutoRefineJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecutionService.claimActionRun.mockReturnValue(true);
    mockExecutionService.claimRunRefinement.mockReturnValue(true);
    mockExecutionService.describeFailedRun.mockReturnValue(failedRunDetails);
    mockExecutionService.runFailedOnlyInItsCleanup.mockReturnValue(false);
    mockDbService.appendAutoRefineJobCleanupRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobCleanupScript.mockResolvedValue(true);
    mockDbService.createAutoRefineJob.mockResolvedValue(createdJob);
    mockDbService.findAutoRefineJobForAction.mockResolvedValue(createdJob);
    mockDbService.markAutoRefineJobPhase.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobScript.mockResolvedValue(true);
    mockDbService.finishAutoRefineJob.mockResolvedValue(true);
    mockActionParameterService.loadVersionParameters.mockResolvedValue(parametersViewWithProjectName);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims the action, creates a running job with the version, cap, and values, and returns before the loop ends", async () => {
    let finishRun: (run: unknown) => void = () => undefined;
    mockExecutionService.performActionScriptRun.mockReturnValue(
      new Promise((resolve) => {
        finishRun = resolve;
      }),
    );

    const { job, completion } = await startJobThatMustStart();

    expect(job).toBe(createdJob);
    expect(mockExecutionService.claimActionRun).toHaveBeenCalledWith("action-1");
    expect(mockDbService.createAutoRefineJob).toHaveBeenCalledWith("website-1", "action-1", {
      startActionScriptId: "script-1",
      maxRefinements: MAX_AUTO_REFINEMENTS,
      parameterValues,
    });
    expect(MAX_AUTO_REFINEMENTS).toBe(5);
    // The loop reaches its first run a few awaits after the start answers.
    await vi.waitFor(() => {
      expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(1);
    });
    expect(mockDbService.markAutoRefineJobPhase).toHaveBeenCalledWith("website-1", "action-1", "job-1", {
      phase: "running",
      currentActionScriptId: "script-1",
    });
    expect(mockDbService.finishAutoRefineJob).not.toHaveBeenCalled();
    expect(mockExecutionService.releaseActionRun).not.toHaveBeenCalled();

    finishRun(buildRun("run-1", true));
    await completion;
    expect(mockDbService.finishAutoRefineJob).toHaveBeenCalledTimes(1);
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-1");
  });

  it("ends passed after the first run when it passes, without refining", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", true));

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledWith(
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: startVersion },
      parameterValues,
    );
    expect(mockDbService.appendAutoRefineJobRun).toHaveBeenCalledWith("website-1", "action-1", "job-1", "run-1");
    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(mockDbService.appendAutoRefineJobScript).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([{ status: "passed", errorMessage: null, currentActionScriptId: "script-1" }]);
  });

  it("refines a failed run with no note, runs the refined version, and ends passed once a run passes", async () => {
    const secondVersion = buildVersion("script-2", buildPlanClicking("Log in"));
    const thirdVersion = buildVersion("script-3", buildPlanClicking("Continue"));
    const firstRun = buildRun("run-1", false);
    const secondRun = buildRun("run-2", false);
    mockExecutionService.performActionScriptRun
      .mockResolvedValueOnce(firstRun)
      .mockResolvedValueOnce(secondRun)
      .mockResolvedValueOnce(buildRun("run-3", true));
    mockExecutionService.performRefinement
      .mockResolvedValueOnce(secondVersion)
      .mockResolvedValueOnce(thirdVersion);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(2);
    expect(mockExecutionService.performRefinement).toHaveBeenNthCalledWith(
      1,
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: startVersion, run: firstRun, failedRun: failedRunDetails, sourceModelId: "claude-opus-5-5" },
      null,
    );
    expect(mockExecutionService.performRefinement).toHaveBeenNthCalledWith(
      2,
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: secondVersion, run: secondRun, failedRun: failedRunDetails, sourceModelId: "claude-opus-5-5" },
      null,
    );
    expect(mockExecutionService.performActionScriptRun).toHaveBeenNthCalledWith(
      3,
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: thirdVersion },
      parameterValues,
    );
    expect(mockDbService.markAutoRefineJobPhase).toHaveBeenCalledWith("website-1", "action-1", "job-1", {
      phase: "refining",
      currentActionScriptId: "script-1",
    });
    expect(mockDbService.markAutoRefineJobPhase).toHaveBeenCalledWith("website-1", "action-1", "job-1", {
      phase: "running",
      currentActionScriptId: "script-3",
    });
    expect(mockDbService.appendAutoRefineJobScript).toHaveBeenNthCalledWith(1, "website-1", "action-1", "job-1", "script-2", 1);
    expect(mockDbService.appendAutoRefineJobScript).toHaveBeenNthCalledWith(2, "website-1", "action-1", "job-1", "script-3", 2);
    expect(mockDbService.appendAutoRefineJobRun).toHaveBeenCalledTimes(3);
    expect(mockExecutionService.claimRunRefinement).toHaveBeenCalledWith("run-1");
    expect(mockExecutionService.releaseRunRefinement).toHaveBeenCalledWith("run-1");
    expect(mockExecutionService.claimRunRefinement).toHaveBeenCalledWith("run-2");
    expect(mockExecutionService.releaseRunRefinement).toHaveBeenCalledWith("run-2");
    expect(readFinishes()).toEqual([{ status: "passed", errorMessage: null, currentActionScriptId: "script-3" }]);
  });

  it("gives up after five refinements when the sixth run still fails", async () => {
    const buttonNames = ["Log in", "Continue", "Submit", "Enter", "Go"];
    const refinedVersions = buttonNames.map((buttonName, index) =>
      buildVersion(`script-${String(index + 2)}`, buildPlanClicking(buttonName)),
    );
    for (const refinedVersion of refinedVersions) {
      mockExecutionService.performRefinement.mockResolvedValueOnce(refinedVersion);
    }
    let runCount = 0;
    mockExecutionService.performActionScriptRun.mockImplementation(() => {
      runCount += 1;
      return Promise.resolve(buildRun(`run-${String(runCount)}`, false));
    });

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(6);
    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(5);
    expect(mockDbService.appendAutoRefineJobScript).toHaveBeenLastCalledWith("website-1", "action-1", "job-1", "script-6", 5);
    expect(readFinishes()).toEqual([{ status: "gaveUp", errorMessage: null, currentActionScriptId: "script-6" }]);
  });

  it("ends unchanged, without running the copy, when a refinement comes back with the plan it refined (keys in another order)", async () => {
    const samePlanReordered: ActionPlan = {
      steps: SIGN_IN_PLAN.steps.map((step) => ({ value: step.value, target: step.target, action: step.action })),
      startUrl: SIGN_IN_PLAN.startUrl,
      name: SIGN_IN_PLAN.name,
    };
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));
    mockExecutionService.performRefinement.mockResolvedValue(buildVersion("script-2", samePlanReordered));

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(1);
    expect(mockDbService.appendAutoRefineJobScript).toHaveBeenCalledWith("website-1", "action-1", "job-1", "script-2", 1);
    expect(readFinishes()).toEqual([{ status: "unchanged", errorMessage: null, currentActionScriptId: "script-2" }]);
  });

  it("ends stopped after the run in flight when a stop was requested, and refines nothing more", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));
    mockDbService.findAutoRefineJobForAction
      .mockResolvedValueOnce(createdJob)
      .mockResolvedValueOnce(jobWithStopRequested);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(1);
    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([{ status: "stopped", errorMessage: null, currentActionScriptId: "script-1" }]);
  });

  it("ends stopped before running the refined version when a stop was requested during the refinement", async () => {
    const secondVersion = buildVersion("script-2", buildPlanClicking("Log in"));
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));
    mockExecutionService.performRefinement.mockResolvedValue(secondVersion);
    mockDbService.findAutoRefineJobForAction
      .mockResolvedValueOnce(createdJob)
      .mockResolvedValueOnce(createdJob)
      .mockResolvedValueOnce(jobWithStopRequested);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(1);
    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(1);
    expect(readFinishes()).toEqual([{ status: "stopped", errorMessage: null, currentActionScriptId: "script-2" }]);
  });

  it("ends failed with the error's message when a run cannot be started, and the completion still resolves", async () => {
    mockExecutionService.performActionScriptRun.mockRejectedValue(
      new Error("browserType.launch: Executable doesn't exist"),
    );

    const { completion } = await startJobThatMustStart();
    await expect(completion).resolves.toBeUndefined();

    expect(readFinishes()).toEqual([
      {
        status: "failed",
        errorMessage: "browserType.launch: Executable doesn't exist",
        currentActionScriptId: "script-1",
      },
    ]);
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-1");
  });

  it("ends failed with a request problem's message when the refinement refuses, naming the version being refined", async () => {
    const requestProblem = Object.assign(
      new Error("The model that wrote this version (claude-opus-5-5) is no longer offered, so it cannot refine it; convert the action again"),
      { name: "ActionScriptRequestProblem", httpStatus: 409 },
    );
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));
    mockExecutionService.performRefinement.mockRejectedValue(requestProblem);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.releaseRunRefinement).toHaveBeenCalledWith("run-1");
    expect(readFinishes()).toEqual([
      { status: "failed", errorMessage: requestProblem.message, currentActionScriptId: "script-1" },
    ]);
  });

  it("logs instead of rejecting when even marking the job failed fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockExecutionService.performActionScriptRun.mockRejectedValue(new Error("run broke"));
    mockDbService.finishAutoRefineJob.mockRejectedValue(new Error("database is down"));

    const { completion } = await startJobThatMustStart();
    await expect(completion).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[auto-refine] job job-1 failed (run broke) and could not be marked failed: database is down",
    );
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-1");
  });

  it("ends failed when a failed run recorded no error message", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));
    mockExecutionService.describeFailedRun.mockReturnValue(null);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([
      {
        status: "failed",
        errorMessage: "The run failed but recorded no error message, so there is nothing to refine from",
        currentActionScriptId: "script-1",
      },
    ]);
  });

  it("ends failed when the version to refine was saved from the step editor", async () => {
    const editedVersion = buildVersion("script-edited", SIGN_IN_PLAN, null);
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", false));

    const start = await startAutoRefineJob(ACTION_SCRIPT_DIRECTORY, { website, action, script: editedVersion }, {});
    if (!start.started) throw new Error("Expected the job to start");
    await start.completion;

    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([
      {
        status: "failed",
        errorMessage:
          "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined",
        currentActionScriptId: "script-edited",
      },
    ]);
  });

  it("starts nothing and creates no job when a run of the action is already in progress", async () => {
    mockExecutionService.claimActionRun.mockReturnValue(false);

    const start = await startAutoRefineJob(ACTION_SCRIPT_DIRECTORY, found, parameterValues);

    expect(start).toEqual({ started: false, reason: "actionIsRunning" });
    expect(mockDbService.createAutoRefineJob).not.toHaveBeenCalled();
    expect(mockExecutionService.releaseActionRun).not.toHaveBeenCalled();
  });

  it("rejects, runs nothing, and releases the action when the job cannot be created", async () => {
    const createError = new Error("connection refused");
    mockDbService.createAutoRefineJob.mockRejectedValue(createError);

    await expect(startAutoRefineJob(ACTION_SCRIPT_DIRECTORY, found, parameterValues)).rejects.toBe(createError);

    expect(mockExecutionService.performActionScriptRun).not.toHaveBeenCalled();
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-1");
  });

  it("stops quietly, running nothing, when the job was deleted before its step (the phase write matched no row)", async () => {
    mockDbService.markAutoRefineJobPhase.mockResolvedValue(false);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).not.toHaveBeenCalled();
    expect(mockDbService.finishAutoRefineJob).not.toHaveBeenCalled();
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-1");
  });

  it("drops stored values whose keys the version being run does not know", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValue(buildRun("run-1", true));
    mockActionParameterService.loadVersionParameters.mockResolvedValue({ parameters: [{ key: "notes" }] });

    const start = await startAutoRefineJob(ACTION_SCRIPT_DIRECTORY, found, {
      projectName: "Nightly build",
      notes: "Keep",
    });
    if (!start.started) throw new Error("Expected the job to start");
    await start.completion;

    expect(mockActionParameterService.loadVersionParameters).toHaveBeenCalledWith("website-1", action, startVersion);
    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledWith(
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: startVersion },
      { notes: "Keep" },
    );
  });
});

describe("startAutoRefineJob: the Delete side", () => {
  /** The linked Delete action and its versions. */
  const deleteAction: ActionWithCredential = { ...action, id: "action-delete", title: "Delete the project" };
  const deleteVersion1 = { ...buildVersion("delete-script-1", buildPlanClicking("Delete")), actionId: "action-delete" };
  const deleteVersion2 = { ...buildVersion("delete-script-2", buildPlanClicking("Yes, delete")), actionId: "action-delete" };
  const deleteVersion3 = { ...buildVersion("delete-script-3", buildPlanClicking("Confirm")), actionId: "action-delete" };

  /**
   * Builds a Create run whose own steps passed but whose cleanup went wrong.
   * @param id - The run's cuid
   * @param cleanupOutcome - `failed` or `missing`
   * @param cleanupRunId - The Delete run, when one ran
   * @returns The run, with the object it made
   */
  function buildCreateRunWithCleanupProblem(id: string, cleanupOutcome: "failed" | "missing", cleanupRunId: string | null) {
    const cleanupErrorMessage = cleanupOutcome === "failed" ? "Step 1 (click): button not found" : "This action has no delete action yet";
    return {
      ...buildRun(id, true),
      succeeded: false,
      errorMessage: `Cleanup ${cleanupOutcome}: ${cleanupErrorMessage}`,
      cleanupOutcome,
      cleanupActionScriptRunId: cleanupRunId,
      cleanupErrorMessage,
      parameterValues: [{ key: "projectName", label: "Project name", value: "Apollo 7" }],
      createdObject: { id: "created-1", name: "Apollo 7", url: null, objectTypeName: "Project" },
    };
  }

  /**
   * Builds a Delete run as `findActionScriptRunWithObjects` or a cleanup run answers it.
   * @param id - The run's cuid
   * @param succeeded - Whether it passed
   * @param actionScriptId - The Delete version it ran
   * @returns The run row
   */
  function buildDeleteRun(id: string, succeeded: boolean, actionScriptId: string) {
    return { ...buildRun(id, succeeded), actionId: "action-delete", actionScriptId, cleanupOutcome: null };
  }

  const CLEANUP_RUN_OPTIONS = { cleanUpAfterwards: false, isCleanupRun: true, markDeletedCreatedObjectId: "created-1" };

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecutionService.claimActionRun.mockReturnValue(true);
    mockExecutionService.claimRunRefinement.mockReturnValue(true);
    mockExecutionService.describeFailedRun.mockReturnValue(failedRunDetails);
    mockExecutionService.runFailedOnlyInItsCleanup.mockImplementation(
      (run: { cleanupOutcome?: string | null }) => run.cleanupOutcome === "failed" || run.cleanupOutcome === "missing",
    );
    mockDbService.createAutoRefineJob.mockResolvedValue(createdJob);
    mockDbService.findAutoRefineJobForAction.mockResolvedValue(createdJob);
    mockDbService.markAutoRefineJobPhase.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobScript.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobCleanupRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobCleanupScript.mockResolvedValue(true);
    mockDbService.finishAutoRefineJob.mockResolvedValue(true);
    mockDbService.findActionScriptRunWithObjects.mockResolvedValue(buildDeleteRun("delete-run-1", false, "delete-script-1"));
    mockDbService.findActionForWebsite.mockResolvedValue(deleteAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(deleteVersion1);
    mockActionParameterService.loadVersionParameters.mockResolvedValue(parametersViewWithProjectName);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refines the delete action from its failed cleanup run, runs that version alone with the Create run's values for its mirrored parameters, then runs the Create action again", async () => {
    mockExecutionService.performActionScriptRun
      .mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "failed", "delete-run-1"))
      .mockResolvedValueOnce(buildDeleteRun("delete-run-2", true, "delete-script-2"))
      .mockResolvedValueOnce(buildRun("run-2", true));
    mockExecutionService.performRefinement.mockResolvedValueOnce(deleteVersion2);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(1);
    expect(mockExecutionService.performRefinement).toHaveBeenCalledWith(
      ACTION_SCRIPT_DIRECTORY,
      {
        website,
        action: deleteAction,
        script: deleteVersion1,
        run: buildDeleteRun("delete-run-1", false, "delete-script-1"),
        failedRun: failedRunDetails,
        sourceModelId: "claude-opus-5-5",
      },
      null,
    );
    expect(mockDbService.appendAutoRefineJobCleanupScript).toHaveBeenCalledWith("website-1", "action-1", "job-1", "delete-script-2", 1);
    expect(mockExecutionService.performActionScriptRun).toHaveBeenNthCalledWith(
      2,
      ACTION_SCRIPT_DIRECTORY,
      { website, action: deleteAction, script: deleteVersion2 },
      { projectName: "Apollo 7" },
      CLEANUP_RUN_OPTIONS,
    );
    expect(mockDbService.appendAutoRefineJobCleanupRun).toHaveBeenCalledWith("website-1", "action-1", "job-1", "delete-run-2");
    expect(mockExecutionService.claimActionRun).toHaveBeenCalledWith("action-delete");
    expect(mockExecutionService.releaseActionRun).toHaveBeenCalledWith("action-delete");
    expect(mockDbService.markAutoRefineJobPhase).toHaveBeenCalledWith("website-1", "action-1", "job-1", {
      phase: "refiningCleanup",
      currentActionScriptId: "script-1",
    });
    expect(mockDbService.markAutoRefineJobPhase).toHaveBeenCalledWith("website-1", "action-1", "job-1", {
      phase: "runningCleanup",
      currentActionScriptId: "script-1",
    });
    // The Create action is run again only once the Delete run passed, with the job's values.
    expect(mockExecutionService.performActionScriptRun).toHaveBeenNthCalledWith(
      3,
      ACTION_SCRIPT_DIRECTORY,
      { website, action, script: startVersion },
      parameterValues,
    );
    expect(mockDbService.appendAutoRefineJobScript).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([{ status: "passed", errorMessage: null, currentActionScriptId: "script-1" }]);
  });

  it("keeps refining the delete action while its own run still fails, counting against the same cap", async () => {
    mockExecutionService.performActionScriptRun
      .mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "failed", "delete-run-1"))
      .mockResolvedValueOnce(buildDeleteRun("delete-run-2", false, "delete-script-2"))
      .mockResolvedValueOnce(buildDeleteRun("delete-run-3", true, "delete-script-3"))
      .mockResolvedValueOnce(buildRun("run-2", true));
    mockExecutionService.performRefinement.mockResolvedValueOnce(deleteVersion2).mockResolvedValueOnce(deleteVersion3);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(2);
    expect(mockExecutionService.performRefinement).toHaveBeenLastCalledWith(
      ACTION_SCRIPT_DIRECTORY,
      expect.objectContaining({ script: deleteVersion2, run: buildDeleteRun("delete-run-2", false, "delete-script-2") }),
      null,
    );
    expect(mockDbService.appendAutoRefineJobCleanupScript).toHaveBeenLastCalledWith("website-1", "action-1", "job-1", "delete-script-3", 2);
    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(4);
    expect(readFinishes()).toEqual([{ status: "passed", errorMessage: null, currentActionScriptId: "script-1" }]);
  });

  it("ends failed with the reason when the cleanup could not start (no delete action or version)", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "missing", null));

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([
      { status: "failed", errorMessage: "This action has no delete action yet", currentActionScriptId: "script-1" },
    ]);
  });

  it("ends failed when the delete run cannot be read back, naming the cleanup's error", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "failed", null));

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockDbService.findActionScriptRunWithObjects).not.toHaveBeenCalled();
    expect(mockExecutionService.performRefinement).not.toHaveBeenCalled();
    expect(readFinishes()).toEqual([
      { status: "failed", errorMessage: "Step 1 (click): button not found", currentActionScriptId: "script-1" },
    ]);
  });

  it("ends failed when the delete action is already running, refining nothing more", async () => {
    mockExecutionService.claimActionRun.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockExecutionService.performActionScriptRun.mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "failed", "delete-run-1"));
    mockExecutionService.performRefinement.mockResolvedValueOnce(deleteVersion2);

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(mockExecutionService.performActionScriptRun).toHaveBeenCalledTimes(1);
    expect(readFinishes()).toEqual([
      { status: "failed", errorMessage: "Its delete action is already running", currentActionScriptId: "script-1" },
    ]);
  });

  it("gives up when the delete refinements reach the cap, and ends unchanged when a delete refinement changes nothing", async () => {
    mockExecutionService.performActionScriptRun.mockResolvedValueOnce(buildCreateRunWithCleanupProblem("run-1", "failed", "delete-run-1"));
    mockExecutionService.performRefinement.mockResolvedValueOnce({ ...deleteVersion1, id: "delete-script-copy" });

    const { completion } = await startJobThatMustStart();
    await completion;

    expect(readFinishes()).toEqual([
      {
        status: "unchanged",
        errorMessage: "its delete action's refinement came back identical to the version it refined, so refining again would go nowhere",
        currentActionScriptId: "script-1",
      },
    ]);

    vi.clearAllMocks();
    mockExecutionService.claimActionRun.mockReturnValue(true);
    mockExecutionService.claimRunRefinement.mockReturnValue(true);
    mockExecutionService.describeFailedRun.mockReturnValue(failedRunDetails);
    mockDbService.createAutoRefineJob.mockResolvedValue(createdJob);
    mockDbService.findAutoRefineJobForAction.mockResolvedValue(createdJob);
    mockDbService.markAutoRefineJobPhase.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobCleanupRun.mockResolvedValue(true);
    mockDbService.appendAutoRefineJobCleanupScript.mockResolvedValue(true);
    mockDbService.finishAutoRefineJob.mockResolvedValue(true);
    mockDbService.findActionScriptRunWithObjects.mockResolvedValue(buildDeleteRun("delete-run-1", false, "delete-script-1"));
    mockDbService.findActionForWebsite.mockResolvedValue(deleteAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(deleteVersion1);
    mockActionParameterService.loadVersionParameters.mockResolvedValue(parametersViewWithProjectName);
    let deleteRefinementCount = 0;
    mockExecutionService.performRefinement.mockImplementation(() => {
      deleteRefinementCount += 1;
      return Promise.resolve({ ...buildVersion(`delete-script-${String(deleteRefinementCount + 1)}`, buildPlanClicking(`Delete ${String(deleteRefinementCount)}`)), actionId: "action-delete" });
    });
    let deleteRunCount = 1;
    mockExecutionService.performActionScriptRun.mockImplementation((_directory: string, found: { action: { id: string } }) => {
      if (found.action.id === "action-1") return Promise.resolve(buildCreateRunWithCleanupProblem("run-1", "failed", "delete-run-1"));
      deleteRunCount += 1;
      return Promise.resolve(buildDeleteRun(`delete-run-${String(deleteRunCount)}`, false, `delete-script-${String(deleteRunCount)}`));
    });

    const second = await startJobThatMustStart();
    await second.completion;

    expect(mockExecutionService.performRefinement).toHaveBeenCalledTimes(MAX_AUTO_REFINEMENTS);
    expect(readFinishes()).toEqual([{ status: "gaveUp", errorMessage: null, currentActionScriptId: "script-1" }]);
  });
});

describe("markUnfinishedAutoRefineJobsInterrupted", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the jobs a restart left running and logs how many", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningAutoRefineJobsInterrupted.mockResolvedValue(2);

    await markUnfinishedAutoRefineJobsInterrupted();

    expect(mockDbService.markRunningAutoRefineJobsInterrupted).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("[auto-refine] marked 2 unfinished auto-refine job(s) interrupted");
  });

  it("logs nothing when no job was left running", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningAutoRefineJobsInterrupted.mockResolvedValue(0);

    await markUnfinishedAutoRefineJobsInterrupted();

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("logs the failure instead of rejecting when the sweep fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.markRunningAutoRefineJobsInterrupted.mockRejectedValue(new Error("database is down"));

    await expect(markUnfinishedAutoRefineJobsInterrupted()).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[auto-refine] could not mark unfinished auto-refine jobs interrupted: database is down",
    );
  });
});
