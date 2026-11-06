import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { ActionPlanRunRequest } from "../../../server/services/actionPlanRunnerService.js";
import type {
  ActionScriptRun,
  ActionScriptWithPlan,
  ActionWithCredential,
  Credential,
  Website,
} from "../../../server/services/dbService.js";
import type { ActionPlan } from "../../../server/utils/actionPlanSchema.js";
import type { FailedRunDetails } from "../../../server/services/scriptGenerationService.js";

/**
 * The database, the runner, Claude, the model catalog, the login helper, and
 * the key check are all replaced, like the action script API spec does: this
 * spec is about what the run and refine work checks, throws, and returns, not
 * about a browser or Postgres. The parameter service's pure run preparation
 * (`prepareParameterRun`) stays real.
 */
const mockDbService = vi.hoisted(() => ({
  findCredentialForWebsite: vi.fn(),
  findCredentialWithPasswordForWebsite: vi.fn(),
  findLatestCrawledPagesForWebsite: vi.fn(),
  createRefinedActionScriptForAction: vi.fn(),
  createActionScriptRunForScript: vi.fn(),
  findActionScriptRunWithObjects: vi.fn(),
}));

const mockActionParameterService = vi.hoisted(() => ({
  loadVersionParameters: vi.fn(),
  followUpRecordedRun: vi.fn(),
  syncActionParametersQuietly: vi.fn(),
}));

const mockScriptGenerationService = vi.hoisted(() => ({ refineActionPlan: vi.fn() }));
const mockScriptModelService = vi.hoisted(() => ({ findScriptModel: vi.fn(), chooseEffortForModel: vi.fn() }));
const mockActionPlanRunnerService = vi.hoisted(() => ({
  FAILURE_SCREENSHOT_FILE_NAME: "failure.png",
  runActionPlan: vi.fn(),
}));
const mockCrawlerLoginService = vi.hoisted(() => ({ buildCrawlLoginDetails: vi.fn() }));
const mockCredentialEncryption = vi.hoisted(() => ({
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE: "CREDENTIAL_ENCRYPTION_KEY is not set (test message)",
  credentialEncryptionIsConfigured: vi.fn(),
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/scriptGenerationService.js", () => mockScriptGenerationService);
vi.mock("../../../server/services/scriptModelService.js", () => mockScriptModelService);
vi.mock("../../../server/services/actionPlanRunnerService.js", () => mockActionPlanRunnerService);
vi.mock("../../../server/services/crawlerLoginService.js", () => mockCrawlerLoginService);
vi.mock("../../../server/utils/credentialEncryption.js", () => mockCredentialEncryption);
vi.mock("../../../server/services/actionParameterService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/actionParameterService.js")>()),
  ...mockActionParameterService,
}));

import {
  ACTION_CREDENTIAL_MISSING_MESSAGE,
  ActionScriptRequestProblem,
  type RefinableRun,
  PLAN_NEEDS_A_CREDENTIAL_MESSAGE,
  UPLOADS_FOLDER_NAME,
  claimActionRun,
  claimRunRefinement,
  describeFailedRun,
  isActionScriptRequestProblem,
  performActionScriptRun,
  performRefinement,
  releaseActionRun,
  releaseRunRefinement,
} from "../../../server/services/actionScriptExecutionService.js";

const ACTION_SCRIPT_DIRECTORY = path.join(process.cwd(), "tests", "backend", "fixtures", "action-script-files");

/** A valid plan that needs no credential. */
const CLICK_SIGN_IN_PLAN: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    { action: "expectVisible", target: { text: "Welcome back" }, value: null },
  ],
};

/** A valid plan that types the credential's username and password through the placeholders. */
const CREDENTIAL_PLAN: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "fill", target: { label: "Email" }, value: "{{credential.username}}" },
    { action: "fill", target: { label: "Password" }, value: "{{credential.password}}" },
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
  ],
};

/** A version's parameters view with no parameters: a run changes nothing. */
const EMPTY_PARAMETERS_VIEW = {
  role: { kind: "parameters" },
  parameters: [],
  objectChoices: [],
  confirmStepNumber: null,
  nameParameterKey: null,
  bindableTexts: [],
  warnings: [],
};

const website: Website = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/** An action that runs logged out. */
const action: ActionWithCredential = {
  id: "action-1",
  websiteId: "website-1",
  credentialId: null,
  title: "Log in",
  description: "Click Sign in and log in",
  userActionKind: null,
  userObjectTypeKey: null,
  userNameParameterKey: null,
  userDeletesObject: null,
  parametersSyncedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  credential: null,
};

const credential: Credential = {
  id: "credential-1",
  websiteId: "website-1",
  name: "Admin",
  description: null,
  username: "admin@example.com",
  encryptedPassword: "iv.tag.ciphertext",
  loginUrl: "https://auth.example.com/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/** The same action, running as the credential. */
const linkedAction: ActionWithCredential = {
  ...action,
  credentialId: credential.id,
  credential: { id: credential.id, name: credential.name },
};

const script: ActionScriptWithPlan = {
  id: "script-1",
  websiteId: "website-1",
  actionId: "action-1",
  websiteName: "Example",
  startUrl: "https://example.com/",
  actionTitle: "Log in",
  actionDescription: "Click Sign in and log in",
  credentialId: null,
  credentialName: null,
  summary: "Clicks Sign in",
  assumptions: ["The button is called Sign in"],
  plan: CLICK_SIGN_IN_PLAN,
  contextPageUrls: ["https://example.com/"],
  modelId: "claude-opus-5-5",
  effort: "high",
  editedFromActionScriptId: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  deletedAt: null,
  refinement: null,
  latestRun: null,
};

/** What `runActionPlan` reports for a passing run. */
const passingRunResult = {
  succeeded: true,
  timedOut: false,
  errorMessage: null,
  failedStepNumber: null,
  output: "✔ Step 1: click\n✔ Step 2: expectVisible\n",
  outputWasTruncated: false,
  failureScreenshotWasCaptured: false,
  failingPageUrl: null,
  failingPageAriaSnapshot: null,
  durationMs: 3100,
  fieldReadings: [],
  confirmStepSucceeded: null,
  pageUrlAfterConfirm: null,
  finalPageUrl: "https://example.com/welcome",
};

const recordedRun: ActionScriptRun = {
  id: "run-1",
  websiteId: "website-1",
  actionId: "action-1",
  actionScriptId: "script-1",
  succeeded: false,
  timedOut: false,
  errorMessage: 'Step 2 (expectVisible): text "Welcome back" was not visible within 10 seconds',
  failedStepNumber: 2,
  credentialName: null,
  output: "✔ Step 1: click\n✘ Step 2: expectVisible",
  outputWasTruncated: false,
  failureScreenshotFileName: null,
  failingPageUrl: "https://example.com/",
  failingPageAriaSnapshot: '- button "Log in"',
  durationMs: 4200,
  parameterValues: [],
  finalPageUrl: null,
  confirmStepNumber: null,
  confirmStepSucceeded: null,
  createdAt: new Date("2026-01-03T00:00:00.000Z"),
  updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  deletedAt: null,
};

/** How `recordedRun` failed, as Claude is shown it. */
const failedRun: FailedRunDetails = {
  errorMessage: 'Step 2 (expectVisible): text "Welcome back" was not visible within 10 seconds',
  failedStepNumber: 2,
  timedOut: false,
  output: recordedRun.output,
  failingPageUrl: recordedRun.failingPageUrl,
  failingPageAriaSnapshot: recordedRun.failingPageAriaSnapshot,
};

const opusModel = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: true,
  fallbackModel: null,
};

/** The plan Claude answers with: the renamed button. */
const REFINED_PLAN: ActionPlan = {
  ...CLICK_SIGN_IN_PLAN,
  steps: [{ action: "click", target: { role: "button", name: "Log in" }, value: null }, CLICK_SIGN_IN_PLAN.steps[1]],
};

const cleanRefinement = {
  summary: "Clicks Log in",
  assumptions: ["Refined: the button is called Log in now"],
  plan: REFINED_PLAN,
  modelId: "claude-opus-5-5",
  effort: "high",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  screenshotWasSent: false,
};

const refinedVersion: ActionScriptWithPlan = { ...script, id: "script-2", plan: cleanRefinement.plan };

/**
 * Reads the request the work handed `runActionPlan`.
 * @param callIndex - Which recorded call to read; the first by default
 * @returns The run request of that call
 */
function readRunRequest(callIndex = 0): ActionPlanRunRequest {
  const [runRequest] = mockActionPlanRunnerService.runActionPlan.mock.calls[callIndex] as [ActionPlanRunRequest];
  return runRequest;
}

/**
 * Runs `performActionScriptRun` and returns what it threw, failing the test
 * when it did not throw.
 * @param runAction - The action to run as
 * @param runScript - The version to run
 * @returns The thrown value
 */
async function catchRunProblem(runAction: ActionWithCredential, runScript: ActionScriptWithPlan): Promise<unknown> {
  try {
    await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action: runAction, script: runScript }, {});
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected performActionScriptRun to throw");
}

/**
 * Checks that a thrown value is an `ActionScriptRequestProblem` with the given
 * status and message.
 * @param thrown - What the work threw
 * @param httpStatus - The status it should carry
 * @param message - The message it should carry
 */
function expectRequestProblem(thrown: unknown, httpStatus: number, message: string): void {
  expect(thrown).toBeInstanceOf(ActionScriptRequestProblem);
  expect(isActionScriptRequestProblem(thrown)).toBe(true);
  expect(thrown).toMatchObject({ name: "ActionScriptRequestProblem", httpStatus, message });
}

describe("actionScriptExecutionService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(true);
    mockActionParameterService.loadVersionParameters.mockResolvedValue(EMPTY_PARAMETERS_VIEW);
    mockActionParameterService.followUpRecordedRun.mockResolvedValue(undefined);
    mockActionParameterService.syncActionParametersQuietly.mockResolvedValue(undefined);
    mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
    mockDbService.createActionScriptRunForScript.mockResolvedValue(recordedRun);
    mockDbService.findActionScriptRunWithObjects.mockResolvedValue(null);
    mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(credential);
    mockDbService.findCredentialForWebsite.mockResolvedValue(null);
    mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([]);
    mockCrawlerLoginService.buildCrawlLoginDetails.mockReturnValue({
      loginUrl: credential.loginUrl,
      username: credential.username,
      password: "decrypted-password",
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    });
    mockScriptModelService.findScriptModel.mockResolvedValue(opusModel);
    mockScriptGenerationService.refineActionPlan.mockResolvedValue(cleanRefinement);
    mockDbService.createRefinedActionScriptForAction.mockResolvedValue(refinedVersion);
  });

  describe("ActionScriptRequestProblem", () => {
    it("carries its status and message under its own name", () => {
      const problem = new ActionScriptRequestProblem(409, "already running");

      expect(problem).toBeInstanceOf(Error);
      expect(problem.name).toBe("ActionScriptRequestProblem");
      expect(problem.httpStatus).toBe(409);
      expect(problem.message).toBe("already running");
    });

    it("isActionScriptRequestProblem recognizes the problem structurally and rejects everything else", () => {
      expect(isActionScriptRequestProblem(new ActionScriptRequestProblem(400, "bad"))).toBe(true);
      expect(
        isActionScriptRequestProblem(Object.assign(new Error("plain"), { name: "ActionScriptRequestProblem", httpStatus: 503 })),
      ).toBe(true);
      expect(isActionScriptRequestProblem(new Error("plain"))).toBe(false);
      expect(isActionScriptRequestProblem(Object.assign(new Error("no status"), { name: "ActionScriptRequestProblem" }))).toBe(false);
      expect(isActionScriptRequestProblem({ name: "ActionScriptRequestProblem", httpStatus: "409" })).toBe(false);
      expect(isActionScriptRequestProblem(null)).toBe(false);
      expect(isActionScriptRequestProblem("ActionScriptRequestProblem")).toBe(false);
    });
  });

  describe("the run and refine claims", () => {
    it("claimActionRun claims a free action once and refuses it until it is released", () => {
      expect(claimActionRun("claim-action-1")).toBe(true);
      expect(claimActionRun("claim-action-1")).toBe(false);
      expect(claimActionRun("claim-action-2")).toBe(true);

      releaseActionRun("claim-action-1");

      expect(claimActionRun("claim-action-1")).toBe(true);
      releaseActionRun("claim-action-1");
      releaseActionRun("claim-action-2");
    });

    it("claimRunRefinement claims a free run once and refuses it until it is released", () => {
      expect(claimRunRefinement("claim-run-1")).toBe(true);
      expect(claimRunRefinement("claim-run-1")).toBe(false);

      releaseRunRefinement("claim-run-1");

      expect(claimRunRefinement("claim-run-1")).toBe(true);
      releaseRunRefinement("claim-run-1");
    });

    it("releasing an unclaimed id is harmless", () => {
      expect(() => {
        releaseActionRun("never-claimed");
        releaseRunRefinement("never-claimed");
      }).not.toThrow();
    });
  });

  describe("performActionScriptRun", () => {
    it("runs the plan in a run folder under the website and returns the recorded run when the objects cannot be read", async () => {
      const run = await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(run).toBe(recordedRun);
      const runRequest = readRunRequest();
      expect(runRequest.plan).toEqual(CLICK_SIGN_IN_PLAN);
      expect(runRequest.login).toBeNull();
      expect(runRequest.allowedOrigins).toEqual(["https://example.com"]);
      expect(runRequest.uploadsDirectory).toBe(path.join(ACTION_SCRIPT_DIRECTORY, UPLOADS_FOLDER_NAME));
      expect(path.relative(ACTION_SCRIPT_DIRECTORY, runRequest.runDirectory)).toMatch(/^website-1\/[0-9a-f-]{36}$/);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        "website-1",
        "action-1",
        "script-1",
        expect.objectContaining({ succeeded: true, credentialName: null, failureScreenshotFileName: null }),
      );
      expect(mockActionParameterService.followUpRecordedRun).toHaveBeenCalledWith(
        expect.objectContaining({ websiteId: "website-1", actionScriptRunId: "run-1", runResult: passingRunResult }),
      );
    });

    it("returns the run with its objects when they can be read", async () => {
      const runWithObjects = { ...recordedRun, createdObject: null, deletedObjects: [] };
      mockDbService.findActionScriptRunWithObjects.mockResolvedValue(runWithObjects);

      const run = await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(run).toBe(runWithObjects);
      expect(mockDbService.findActionScriptRunWithObjects).toHaveBeenCalledWith("website-1", "run-1");
    });

    it("logs a linked action in as its credential and records the credential's name", async () => {
      const run = await performActionScriptRun(
        ACTION_SCRIPT_DIRECTORY,
        { website, action: linkedAction, script: { ...script, plan: CREDENTIAL_PLAN } },
        {},
      );

      expect(run).toBe(recordedRun);
      expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith("website-1", "credential-1");
      const runRequest = readRunRequest();
      expect(runRequest.login).toEqual({
        credentialName: "Admin",
        details: expect.objectContaining({ password: "decrypted-password" }),
      });
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        "website-1",
        "action-1",
        "script-1",
        expect.objectContaining({ credentialName: "Admin" }),
      );
    });

    it("throws 503 and runs nothing when a linked action runs without a configured credential key", async () => {
      mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);

      const thrown = await catchRunProblem(linkedAction, script);

      expectRequestProblem(thrown, 503, "CREDENTIAL_ENCRYPTION_KEY is not set (test message)");
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 409 when the action's credential no longer exists", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(null);

      const thrown = await catchRunProblem(linkedAction, script);

      expectRequestProblem(thrown, 409, ACTION_CREDENTIAL_MISSING_MESSAGE);
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 400 when neither the credential nor its website has a login page URL", async () => {
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue({ ...credential, loginUrl: null });

      const thrown = await catchRunProblem(linkedAction, script);

      expectRequestProblem(
        thrown,
        400,
        'The credential "Admin" has no login page URL, and neither does its website; add one to log in',
      );
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 409 when the stored plan no longer passes the rules", async () => {
      const thrown = await catchRunProblem(action, {
        ...script,
        plan: { ...CLICK_SIGN_IN_PLAN, startUrl: "https://elsewhere.example/" },
      });

      expect(thrown).toBeInstanceOf(ActionScriptRequestProblem);
      expect(thrown).toMatchObject({ httpStatus: 409 });
      expect((thrown as Error).message).toMatch(/^This version's plan can no longer run: /);
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 409 when the plan types a credential but the action runs logged out", async () => {
      const thrown = await catchRunProblem(action, { ...script, plan: CREDENTIAL_PLAN });

      expectRequestProblem(thrown, 409, PLAN_NEEDS_A_CREDENTIAL_MESSAGE);
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 400 when a value is not one of the version's parameters", async () => {
      let thrown: unknown = null;
      try {
        await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, { unknownKey: "value" });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ActionScriptRequestProblem);
      expect(thrown).toMatchObject({ httpStatus: 400 });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("lets a runner failure reject as it is, recording nothing", async () => {
      const launchError = new Error("browserType.launch: Executable doesn't exist");
      mockActionPlanRunnerService.runActionPlan.mockRejectedValue(launchError);

      await expect(performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {})).rejects.toBe(
        launchError,
      );
      expect(isActionScriptRequestProblem(launchError)).toBe(false);
      expect(mockDbService.createActionScriptRunForScript).not.toHaveBeenCalled();
    });
  });

  describe("describeFailedRun", () => {
    it("copies a failed run's fields for Claude", () => {
      expect(describeFailedRun(recordedRun)).toEqual(failedRun);
    });

    it("returns null for a run that passed, or recorded no error", () => {
      expect(describeFailedRun({ ...recordedRun, succeeded: true, errorMessage: null })).toBeNull();
      expect(describeFailedRun({ ...recordedRun, errorMessage: null })).toBeNull();
    });
  });

  describe("performRefinement", () => {
    const source: RefinableRun = { website, action, script, run: recordedRun, failedRun, sourceModelId: "claude-opus-5-5" };

    it("asks the version's model to fix the plan with the given note, saves the reply as a refined version, syncs the parameters, and returns it", async () => {
      const refined = await performRefinement(ACTION_SCRIPT_DIRECTORY, source, "Try Log in");

      expect(refined).toBe(refinedVersion);
      expect(mockScriptModelService.findScriptModel).toHaveBeenCalledWith("claude-opus-5-5");
      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          previousPlan: CLICK_SIGN_IN_PLAN,
          failedRun,
          failureScreenshotPngBase64: null,
          note: "Try Log in",
          allowedOrigins: ["https://example.com"],
        }),
        { model: opusModel, effort: "high" },
      );
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        "website-1",
        "action-1",
        expect.objectContaining({ plan: cleanRefinement.plan, modelId: "claude-opus-5-5", editedFromActionScriptId: null }),
        expect.objectContaining({ sourceActionScriptId: "script-1", actionScriptRunId: "run-1", note: "Try Log in" }),
      );
      expect(mockActionParameterService.syncActionParametersQuietly).toHaveBeenCalledWith("website-1", action);
    });

    it("sends a null note as no note", async () => {
      await performRefinement(ACTION_SCRIPT_DIRECTORY, source, null);

      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(
        expect.objectContaining({ note: null }),
        expect.anything(),
      );
    });

    it("throws 409 and asks no model when the model that wrote the version is no longer offered", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue(null);

      let thrown: unknown = null;
      try {
        await performRefinement(ACTION_SCRIPT_DIRECTORY, source, null);
      } catch (error: unknown) {
        thrown = error;
      }

      expectRequestProblem(
        thrown,
        409,
        "The model that wrote this version (claude-opus-5-5) is no longer offered, so it cannot refine it; convert the action again",
      );
      expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
    });

    it("lets Claude's failure reject as it is, saving nothing", async () => {
      const refusal = Object.assign(new Error("Claude declined"), { name: "ScriptGenerationError", reason: "refused" });
      mockScriptGenerationService.refineActionPlan.mockRejectedValue(refusal);

      await expect(performRefinement(ACTION_SCRIPT_DIRECTORY, source, null)).rejects.toBe(refusal);
      expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
    });
  });
});
