import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { ActionPlanRunRequest } from "../../../server/services/actionPlanRunnerService.js";
import type {
  Action,
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
  findActionCleanupForCreateAction: vi.fn(),
  findActionForWebsite: vi.fn(),
  findNewestActionScriptForAction: vi.fn(),
  recordActionScriptRunCleanup: vi.fn(),
  /** The website's one Login action; answers null - the website has none - unless a test says otherwise. */
  findLoginActionForWebsite: vi.fn(),
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
/** Only the password decryption (`buildLoginDetails`) is replaced; the login page and message helpers stay real. */
const mockCrawlerLoginService = vi.hoisted(() => ({ buildLoginDetails: vi.fn() }));
const mockCredentialEncryption = vi.hoisted(() => ({
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE: "CREDENTIAL_ENCRYPTION_KEY is not set (test message)",
  credentialEncryptionIsConfigured: vi.fn(),
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/scriptGenerationService.js", () => mockScriptGenerationService);
vi.mock("../../../server/services/scriptModelService.js", () => mockScriptModelService);
vi.mock("../../../server/services/actionPlanRunnerService.js", () => mockActionPlanRunnerService);
vi.mock("../../../server/services/crawlerLoginService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/crawlerLoginService.js")>()),
  ...mockCrawlerLoginService,
}));
vi.mock("../../../server/utils/credentialEncryption.js", () => mockCredentialEncryption);
vi.mock("../../../server/services/actionParameterService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/actionParameterService.js")>()),
  ...mockActionParameterService,
}));

import {
  ACTION_CREDENTIAL_MISSING_MESSAGE,
  ActionScriptRequestProblem,
  type RefinableRun,
  CLEANUP_DELETE_ACTION_BUSY_MESSAGE,
  CLEANUP_DELETE_ACTION_GONE_MESSAGE,
  CLEANUP_NO_DELETE_ACTION_MESSAGE,
  CLEANUP_NO_DELETE_VERSION_MESSAGE,
  LOGIN_ACTION_HAS_NO_STEPS_MESSAGE,
  PLAN_NEEDS_A_CREDENTIAL_MESSAGE,
  UPLOADS_FOLDER_NAME,
  allowedOriginsFor,
  buildStepScreenshotInputs,
  claimActionRun,
  claimRunRefinement,
  describeFailedRun,
  findActionCredential,
  isActionScriptRequestProblem,
  performActionScriptRun,
  performRefinement,
  pickCleanupValues,
  releaseActionRun,
  releaseRunRefinement,
  runFailedOnlyInItsCleanup,
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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  credential: null,
};

/** The credential `actionRunningAsCredential` runs as. */
const credential: Credential = {
  id: "credential-1",
  websiteId: "website-1",
  name: "Admin",
  description: null,
  username: "admin@example.com",
  encryptedPassword: "iv.tag.ciphertext",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/** The website's one Login action, as `findLoginActionForWebsite` reads it: its own login page, no credential. */
const websiteLoginAction: Action = {
  id: "login-action-1",
  websiteId: "website-1",
  credentialId: null,
  loginUrl: "https://auth.example.com/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Signs in with the picked account",
  userActionKind: "login",
  userObjectTypeKey: null,
  userNameParameterKey: null,
  parametersSyncedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

/** The same action, running as `credential` (it logs in through the website's Login action first). */
const actionRunningAsCredential: ActionWithCredential = {
  ...action,
  credentialId: credential.id,
  credential: { id: credential.id, name: credential.name },
};

/** The Login action itself, as an action read returns it: it logs in by itself and has no steps to run or refine. */
const loginAction: ActionWithCredential = { ...websiteLoginAction, credential: null };

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
  stepScreenshots: [],
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
  cleanupOutcome: null,
  cleanupActionScriptRunId: null,
  cleanupErrorMessage: null,
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
    mockActionParameterService.followUpRecordedRun.mockResolvedValue({ createdObjectId: null, createdObjectName: null });
    mockDbService.recordActionScriptRunCleanup.mockResolvedValue(true);
    mockActionParameterService.syncActionParametersQuietly.mockResolvedValue(undefined);
    mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
    mockDbService.createActionScriptRunForScript.mockResolvedValue(recordedRun);
    mockDbService.findActionScriptRunWithObjects.mockResolvedValue(null);
    mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(credential);
    mockDbService.findCredentialForWebsite.mockResolvedValue(null);
    mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([]);
    mockDbService.findLoginActionForWebsite.mockResolvedValue(null);
    mockCrawlerLoginService.buildLoginDetails.mockReturnValue({
      loginUrl: websiteLoginAction.loginUrl,
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

  describe("buildStepScreenshotInputs", () => {
    it("numbers the screenshots 1, 2, 3 in the order taken and prefixes each file with the run folder", () => {
      const inputs = buildStepScreenshotInputs("website-1/run-uuid", [
        { moment: "loggedIn", stepNumber: null, fileName: "logged-in.png", errorMessage: null, pageUrl: "https://example.com/home" },
        { moment: "step", stepNumber: 4, fileName: "step-004.png", errorMessage: null, pageUrl: null },
      ]);

      expect(inputs).toEqual([
        {
          position: 1,
          moment: "loggedIn",
          stepNumber: null,
          fileName: "website-1/run-uuid/logged-in.png",
          errorMessage: null,
          pageUrl: "https://example.com/home",
        },
        { position: 2, moment: "step", stepNumber: 4, fileName: "website-1/run-uuid/step-004.png", errorMessage: null, pageUrl: null },
      ]);
    });

    it("keeps a screenshot that could not be taken without a file, with its error", () => {
      const [input] = buildStepScreenshotInputs("website-1/run-uuid", [
        { moment: "step", stepNumber: 2, fileName: null, errorMessage: "Target closed", pageUrl: null },
      ]);

      expect(input).toEqual({ position: 1, moment: "step", stepNumber: 2, fileName: null, errorMessage: "Target closed", pageUrl: null });
    });

    it("records nothing for a run that took no screenshots", () => {
      expect(buildStepScreenshotInputs("website-1/run-uuid", [])).toEqual([]);
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

    it("records the step screenshots with the run, numbered in order, each file under the run's own folder", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue({
        ...passingRunResult,
        stepScreenshots: [
          { moment: "startPage", stepNumber: null, fileName: "start-page.png", errorMessage: null, pageUrl: "https://example.com/" },
          { moment: "step", stepNumber: 1, fileName: null, errorMessage: "Timeout 10000ms exceeded", pageUrl: null },
        ],
      });

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      const runFolderName = path.relative(ACTION_SCRIPT_DIRECTORY, readRunRequest().runDirectory).split(path.sep).join("/");
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        "website-1",
        "action-1",
        "script-1",
        expect.objectContaining({
          stepScreenshots: [
            {
              position: 1,
              moment: "startPage",
              stepNumber: null,
              fileName: `${runFolderName}/start-page.png`,
              errorMessage: null,
              pageUrl: "https://example.com/",
            },
            {
              position: 2,
              moment: "step",
              stepNumber: 1,
              fileName: null,
              errorMessage: "Timeout 10000ms exceeded",
              pageUrl: null,
            },
          ],
        }),
      );
    });

    it("returns the run with its objects when they can be read", async () => {
      const runWithObjects = { ...recordedRun, createdObject: null, deletedObjects: [] };
      mockDbService.findActionScriptRunWithObjects.mockResolvedValue(runWithObjects);

      const run = await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(run).toBe(runWithObjects);
      expect(mockDbService.findActionScriptRunWithObjects).toHaveBeenCalledWith("website-1", "run-1");
    });

    it("logs an action in through the website's Login action, as the credential it runs as, and records the credential's name", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(websiteLoginAction);

      const run = await performActionScriptRun(
        ACTION_SCRIPT_DIRECTORY,
        { website, action: actionRunningAsCredential, script: { ...script, plan: CREDENTIAL_PLAN } },
        {},
      );

      expect(run).toBe(recordedRun);
      expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith("website-1", "credential-1");
      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith("website-1");
      expect(mockCrawlerLoginService.buildLoginDetails).toHaveBeenCalledWith(websiteLoginAction, credential, website);
      const runRequest = readRunRequest();
      expect(runRequest.login).toEqual({
        loginActionTitle: "Log in",
        credentialName: "Admin",
        details: expect.objectContaining({ password: "decrypted-password" }),
      });
      // The plan may open the Login action's own login page, too.
      expect(runRequest.allowedOrigins).toEqual(["https://example.com", "https://auth.example.com"]);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        "website-1",
        "action-1",
        "script-1",
        expect.objectContaining({ credentialName: "Admin" }),
      );
    });

    it("logs in on the website's login page when the Login action has none of its own", async () => {
      const websiteWithLoginUrl: Website = { ...website, loginUrl: "https://example.com/sign-in" };
      mockDbService.findLoginActionForWebsite.mockResolvedValue({ ...websiteLoginAction, loginUrl: null });

      await performActionScriptRun(
        ACTION_SCRIPT_DIRECTORY,
        { website: websiteWithLoginUrl, action: actionRunningAsCredential, script },
        {},
      );

      expect(readRunRequest().login).toMatchObject({ loginActionTitle: "Log in", credentialName: "Admin" });
      expect(readRunRequest().allowedOrigins).toEqual(["https://example.com"]);
    });

    it("lets a logged-out action's plan open the website's Login action's page too, without logging in", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(websiteLoginAction);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(readRunRequest().login).toBeNull();
      expect(readRunRequest().allowedOrigins).toEqual(["https://example.com", "https://auth.example.com"]);
      expect(mockCrawlerLoginService.buildLoginDetails).not.toHaveBeenCalled();
    });

    it("throws 409 and looks nothing up for a Login action itself, which has no steps to run", async () => {
      const thrown = await catchRunProblem(loginAction, script);

      expectRequestProblem(thrown, 409, LOGIN_ACTION_HAS_NO_STEPS_MESSAGE);
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 503 and runs nothing when an action that logs in runs without a configured credential key", async () => {
      mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);

      const thrown = await catchRunProblem(actionRunningAsCredential, script);

      expectRequestProblem(thrown, 503, "CREDENTIAL_ENCRYPTION_KEY is not set (test message)");
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("runs a logged-out action without needing the credential key", async () => {
      mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(readRunRequest().login).toBeNull();
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
    });

    it("throws 409 and runs nothing when the action runs as a credential but the website has no Login action", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(null);

      const thrown = await catchRunProblem(actionRunningAsCredential, script);

      expectRequestProblem(
        thrown,
        409,
        "This website has no login action yet - look for a login form on its Credentials tab, or add an action with the kind Login",
      );
      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith("website-1");
      expect(mockCrawlerLoginService.buildLoginDetails).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 409 and runs nothing when the credential it names is no longer an active credential of the website", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(websiteLoginAction);
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(null);

      const thrown = await catchRunProblem(actionRunningAsCredential, script);

      expectRequestProblem(thrown, 409, ACTION_CREDENTIAL_MISSING_MESSAGE);
      expect(ACTION_CREDENTIAL_MISSING_MESSAGE).toBe(
        "This action's credential no longer exists; edit the action to pick another one",
      );
      expect(mockCrawlerLoginService.buildLoginDetails).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("throws 400 when neither the website's Login action nor the website has a login page URL", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue({ ...websiteLoginAction, loginUrl: null });

      const thrown = await catchRunProblem(actionRunningAsCredential, script);

      expectRequestProblem(
        thrown,
        400,
        'The login action "Log in" has no login page URL, and neither does its website; add one to log in',
      );
      expect(mockCrawlerLoginService.buildLoginDetails).not.toHaveBeenCalled();
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
      expect(PLAN_NEEDS_A_CREDENTIAL_MESSAGE).toBe(
        "This plan types the credential's username or password, but the action runs logged out; edit the action to pick a credential to log in as",
      );
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

  describe("cleanup after a Create run", () => {
    /** A text parameter bound to step 1's button name (the fixture plan has no fill step), default "Sign in". */
    const projectNameParameter = {
      id: "parameter-project-name",
      key: "projectName",
      label: "Project name",
      detectedLabel: "Project name",
      userLabel: null,
      kind: "text",
      source: "steps",
      foundBy: ["plan"],
      isSecret: false,
      isRequired: true,
      requiredReason: "default",
      userRequiredChoice: null,
      defaultValue: "Sign in",
      uses: [{ stepNumber: 1, field: "targetName" }],
      addedField: null,
      objectTypeKey: null,
      containerName: null,
    };
    /** The parameters view of a Create action that makes Projects, named by `projectName`. */
    const createView = {
      ...EMPTY_PARAMETERS_VIEW,
      role: { kind: "create", objectTypeKey: "/projects/{project}", objectTypeName: "Project" },
      parameters: [projectNameParameter],
      nameParameterKey: "projectName",
    };
    /** The linked Delete action and its newest version. */
    const deleteAction: ActionWithCredential = { ...action, id: "action-delete", title: "Delete the project" };
    const deleteScript: ActionScriptWithPlan = { ...script, id: "script-delete", actionId: "action-delete" };
    /** The Delete version's parameters view: it mirrors the Create action's `projectName`, bound to step 1's button name. */
    const deleteView = {
      ...EMPTY_PARAMETERS_VIEW,
      role: { kind: "delete", objectTypeKey: "/projects/{project}", objectTypeName: "Project" },
      parameters: [{ ...projectNameParameter, id: "parameter-mirrored", source: "create", foundBy: ["create"] }],
    };
    const link = {
      id: "cleanup-1",
      createActionId: "action-1",
      deleteActionId: "action-delete",
      createAction: { id: "action-1", title: "Log in" },
      deleteAction: { id: "action-delete", title: "Delete the project" },
    };
    /** The Create run as recorded: its own steps passed. */
    const passingRun: ActionScriptRun = { ...recordedRun, succeeded: true, errorMessage: null, failedStepNumber: null };
    /** The Delete run as recorded. */
    const passingDeleteRun: ActionScriptRun = { ...passingRun, id: "run-delete-1", actionId: "action-delete", actionScriptId: "script-delete" };
    const failingDeleteRun: ActionScriptRun = { ...recordedRun, id: "run-delete-1", actionId: "action-delete", actionScriptId: "script-delete" };

    /**
     * Reads what was written as the Create run's cleanup outcome.
     * @returns The cleanup record of the last write
     */
    function readRecordedCleanup(): unknown {
      const lastCall = mockDbService.recordActionScriptRunCleanup.mock.calls.at(-1) as unknown[] | undefined;
      return lastCall?.[2];
    }

    beforeEach(() => {
      mockActionParameterService.loadVersionParameters.mockResolvedValue(createView);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(passingRun);
      mockActionParameterService.followUpRecordedRun.mockResolvedValue({ createdObjectId: "created-1", createdObjectName: "Apollo 7" });
      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(link);
      mockDbService.findActionForWebsite.mockResolvedValue(deleteAction);
      mockDbService.findNewestActionScriptForAction.mockResolvedValue(deleteScript);
    });

    it("records off, running nothing more, when the user turned cleanup off for the run", async () => {
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {}, {
        cleanUpAfterwards: false,
        isCleanupRun: false,
        markDeletedCreatedObjectId: null,
      });

      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      expect(mockDbService.recordActionScriptRunCleanup).toHaveBeenCalledWith("website-1", "run-1", {
        cleanupOutcome: "off",
        cleanupActionScriptRunId: null,
        cleanupErrorMessage: null,
        succeeded: true,
        errorMessage: null,
      });
      expect(mockDbService.findActionCleanupForCreateAction).not.toHaveBeenCalled();
    });

    it("records missing and fails the run when there is no delete action, it is gone, or it has no version", async () => {
      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(null);
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});
      expect(readRecordedCleanup()).toEqual({
        cleanupOutcome: "missing",
        cleanupActionScriptRunId: null,
        cleanupErrorMessage: CLEANUP_NO_DELETE_ACTION_MESSAGE,
        succeeded: false,
        errorMessage: `Cleanup missing: ${CLEANUP_NO_DELETE_ACTION_MESSAGE}`,
      });

      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(link);
      mockDbService.findActionForWebsite.mockResolvedValue(null);
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});
      expect(readRecordedCleanup()).toMatchObject({ cleanupOutcome: "missing", cleanupErrorMessage: CLEANUP_DELETE_ACTION_GONE_MESSAGE });

      mockDbService.findActionForWebsite.mockResolvedValue(deleteAction);
      mockDbService.findNewestActionScriptForAction.mockResolvedValue(null);
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});
      expect(readRecordedCleanup()).toMatchObject({ cleanupOutcome: "missing", cleanupErrorMessage: CLEANUP_NO_DELETE_VERSION_MESSAGE });
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(3);
    });

    it("records notReached, keeping the run's own outcome, when the run made no object", async () => {
      mockActionParameterService.followUpRecordedRun.mockResolvedValue({ createdObjectId: null, createdObjectName: null });

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(readRecordedCleanup()).toEqual({
        cleanupOutcome: "notReached",
        cleanupActionScriptRunId: null,
        cleanupErrorMessage: null,
        succeeded: true,
        errorMessage: null,
      });
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
    });

    it("runs the delete action's newest version as a cleanup run with the Create run's values for the parameters it mirrors, marks the object by id, and records passed", async () => {
      mockActionParameterService.loadVersionParameters
        .mockResolvedValueOnce(createView)
        .mockResolvedValueOnce(deleteView)
        .mockResolvedValueOnce(deleteView);
      mockDbService.createActionScriptRunForScript.mockResolvedValueOnce(passingRun).mockResolvedValueOnce(passingDeleteRun);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, { projectName: "Apollo 7" });

      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(2);
      // The Delete version's mirrored parameter gets the value the Create run typed.
      expect(readRunRequest(1).plan.steps[0]).toMatchObject({ target: { role: "button", name: "Apollo 7" } });
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenLastCalledWith(
        "website-1",
        "action-delete",
        "script-delete",
        expect.objectContaining({ parameterValues: [{ key: "projectName", label: "Project name", value: "Apollo 7" }] }),
      );
      expect(mockActionParameterService.followUpRecordedRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: deleteAction, actionScriptRunId: "run-delete-1", markDeletedCreatedObjectId: "created-1" }),
      );
      expect(mockDbService.recordActionScriptRunCleanup).toHaveBeenCalledTimes(1);
      expect(mockDbService.recordActionScriptRunCleanup).toHaveBeenCalledWith("website-1", "run-1", {
        cleanupOutcome: "passed",
        cleanupActionScriptRunId: "run-delete-1",
        cleanupErrorMessage: null,
        succeeded: true,
        errorMessage: null,
      });
      // The delete action was claimed for the cleanup run and released again.
      expect(claimActionRun("action-delete")).toBe(true);
      releaseActionRun("action-delete");
    });

    it("records failed, failing the run with the cleanup's error, when the delete run fails", async () => {
      mockActionParameterService.loadVersionParameters
        .mockResolvedValueOnce(createView)
        .mockResolvedValueOnce(deleteView)
        .mockResolvedValueOnce(deleteView);
      mockDbService.createActionScriptRunForScript.mockResolvedValueOnce(passingRun).mockResolvedValueOnce(failingDeleteRun);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(readRecordedCleanup()).toEqual({
        cleanupOutcome: "failed",
        cleanupActionScriptRunId: "run-delete-1",
        cleanupErrorMessage: failingDeleteRun.errorMessage,
        succeeded: false,
        errorMessage: `Cleanup failed: ${failingDeleteRun.errorMessage ?? ""}`,
      });
    });

    it("runs a Delete version that has no object parameter (no type resolved yet) with its own names instead of refusing it", async () => {
      mockActionParameterService.loadVersionParameters
        .mockResolvedValueOnce(createView)
        .mockResolvedValueOnce(EMPTY_PARAMETERS_VIEW)
        .mockResolvedValueOnce(EMPTY_PARAMETERS_VIEW);
      mockDbService.createActionScriptRunForScript.mockResolvedValueOnce(passingRun).mockResolvedValueOnce(passingDeleteRun);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(2);
      expect(readRunRequest(1).plan).toEqual(deleteScript.plan);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenLastCalledWith(
        "website-1",
        "action-delete",
        "script-delete",
        expect.objectContaining({ parameterValues: [] }),
      );
      expect(readRecordedCleanup()).toMatchObject({ cleanupOutcome: "passed", cleanupActionScriptRunId: "run-delete-1" });
    });

    it("records failed with the problem, running nothing, when the cleanup run cannot start", async () => {
      // The Create run left its optional name blank, so the Delete version's mirrored (required) value is blank too.
      const createViewWithOptionalName = {
        ...createView,
        parameters: [{ ...projectNameParameter, isRequired: false, requiredReason: "you", userRequiredChoice: "optional" }],
      };
      mockActionParameterService.loadVersionParameters
        .mockResolvedValueOnce(createViewWithOptionalName)
        .mockResolvedValueOnce(deleteView)
        .mockResolvedValueOnce(deleteView);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, { projectName: "" });

      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      const recordedCleanup = readRecordedCleanup() as { cleanupErrorMessage: string };
      expect(recordedCleanup).toMatchObject({ cleanupOutcome: "failed", cleanupActionScriptRunId: null, succeeded: false });
      expect(recordedCleanup.cleanupErrorMessage).toContain('"Project name" is required');
    });

    it("pickCleanupValues keeps only the Create run's values whose keys the Delete version has", () => {
      expect(
        pickCleanupValues(
          [
            { key: "projectName", label: "Project name", value: "Voyager" },
            { key: "size", label: "Size", value: "Large" },
          ],
          [{ key: "projectName" }],
        ),
      ).toEqual({ projectName: "Voyager" });
      expect(pickCleanupValues([{ key: "projectName", label: "Project name", value: "Voyager" }], [])).toEqual({});
    });

    it("records failed with the busy message when the delete action is already running", async () => {
      expect(claimActionRun("action-delete")).toBe(true);
      try {
        await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});
      } finally {
        releaseActionRun("action-delete");
      }

      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      expect(readRecordedCleanup()).toMatchObject({ cleanupOutcome: "failed", cleanupErrorMessage: CLEANUP_DELETE_ACTION_BUSY_MESSAGE });
    });

    it("keeps the run's own error when its steps failed and the cleanup failed too", async () => {
      mockDbService.createActionScriptRunForScript.mockResolvedValue(recordedRun);
      mockActionParameterService.loadVersionParameters.mockResolvedValueOnce(createView).mockResolvedValue(deleteView);

      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(readRecordedCleanup()).toMatchObject({
        cleanupOutcome: "failed",
        succeeded: false,
        errorMessage: recordedRun.errorMessage,
      });
    });

    it("never cleans up after a cleanup run, nor after a non-Create action", async () => {
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {}, {
        cleanUpAfterwards: true,
        isCleanupRun: true,
        markDeletedCreatedObjectId: "created-9",
      });
      expect(mockActionParameterService.followUpRecordedRun).toHaveBeenCalledWith(
        expect.objectContaining({ markDeletedCreatedObjectId: "created-9" }),
      );

      mockActionParameterService.loadVersionParameters.mockResolvedValue(EMPTY_PARAMETERS_VIEW);
      await performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {});

      expect(mockDbService.recordActionScriptRunCleanup).not.toHaveBeenCalled();
    });

    it("logs instead of rejecting when the cleanup outcome cannot be written", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockDbService.recordActionScriptRunCleanup.mockRejectedValue(new Error("db down"));
      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(null);

      await expect(performActionScriptRun(ACTION_SCRIPT_DIRECTORY, { website, action, script }, {})).resolves.toBe(passingRun);
      expect(console.error).toHaveBeenCalledWith("[cleanup] run run-1 could not record its cleanup: db down");
    });

    it("runFailedOnlyInItsCleanup is true only for a failed run whose own steps passed and whose cleanup failed or was missing", () => {
      const cleanupFailure: ActionScriptRun = {
        ...passingRun,
        succeeded: false,
        errorMessage: "Cleanup failed: Step 2 failed",
        cleanupOutcome: "failed",
      };
      expect(runFailedOnlyInItsCleanup(cleanupFailure)).toBe(true);
      expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, cleanupOutcome: "missing", errorMessage: "Cleanup missing: no delete action" })).toBe(true);
      expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, succeeded: true })).toBe(false);
      expect(runFailedOnlyInItsCleanup({ ...cleanupFailure, cleanupOutcome: "off" })).toBe(false);
      expect(runFailedOnlyInItsCleanup({ ...recordedRun, cleanupOutcome: "failed" })).toBe(false);
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

    it("lets the refined plan open the login page of the website's Login action", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(websiteLoginAction);

      await performRefinement(ACTION_SCRIPT_DIRECTORY, { ...source, action: actionRunningAsCredential }, null);

      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith("website-1");
      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(
        expect.objectContaining({ allowedOrigins: ["https://example.com", "https://auth.example.com"] }),
        expect.anything(),
      );
    });

    it("throws 409 and asks no model for a Login action, which has no steps to refine", async () => {
      let thrown: unknown = null;
      try {
        await performRefinement(ACTION_SCRIPT_DIRECTORY, { ...source, action: loginAction }, null);
      } catch (error: unknown) {
        thrown = error;
      }

      expectRequestProblem(thrown, 409, LOGIN_ACTION_HAS_NO_STEPS_MESSAGE);
      expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
      expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
    });
  });

  describe("allowedOriginsFor", () => {
    it("allows the website's own origin, and its login page's, when the action runs logged out", () => {
      expect(allowedOriginsFor(website, null)).toEqual(["https://example.com"]);
      expect(allowedOriginsFor({ ...website, loginUrl: "https://sso.example.org/login" }, null)).toEqual([
        "https://example.com",
        "https://sso.example.org",
      ]);
    });

    it("adds the origin of the Login action's own login page", () => {
      expect(allowedOriginsFor(website, { loginUrl: "https://auth.example.com/login" })).toEqual([
        "https://example.com",
        "https://auth.example.com",
      ]);
      expect(allowedOriginsFor(website, { loginUrl: null })).toEqual(["https://example.com"]);
    });
  });

  describe("findActionCredential", () => {
    it("answers null, looking nothing up, for an action that runs logged out", async () => {
      expect(await findActionCredential(website, action)).toBeNull();
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("looks up the credential the action runs as, without its password", async () => {
      const foundCredentialSummary = { id: credential.id, websiteId: credential.websiteId, name: credential.name };
      mockDbService.findCredentialForWebsite.mockResolvedValue(foundCredentialSummary);

      expect(await findActionCredential(website, actionRunningAsCredential)).toBe(foundCredentialSummary);
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith("website-1", "credential-1");
    });
  });
});
