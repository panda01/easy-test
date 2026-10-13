import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import express, { type Express } from "express";
import type { ActionPlanRunRequest } from "../../../server/services/actionPlanRunnerService.js";

/** One mock per dbService function the action script controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  findActionForWebsite: vi.fn(),
  findCredentialForWebsite: vi.fn(),
  findCredentialWithPasswordForWebsite: vi.fn(),
  findLatestCrawledPagesForWebsite: vi.fn(),
  listActionScriptsForAction: vi.fn(),
  findActionScriptForAction: vi.fn(),
  createActionScriptForAction: vi.fn(),
  createRefinedActionScriptForAction: vi.fn(),
  listActionScriptRunsForScript: vi.fn(),
  findActionScriptRunForScript: vi.fn(),
  createActionScriptRunForScript: vi.fn(),
}));

/** Claude is replaced outright: no spec ever calls the Anthropic API. */
const mockScriptGenerationService = vi.hoisted(() => ({
  convertActionToPlan: vi.fn(),
  refineActionPlan: vi.fn(),
}));

/** The live model catalog is replaced outright: no spec ever calls the Models API. */
const mockScriptModelService = vi.hoisted(() => ({
  findScriptModel: vi.fn(),
  chooseEffortForModel: vi.fn(),
}));

/** Running is replaced outright: no spec ever launches a browser. */
const mockActionPlanRunnerService = vi.hoisted(() => ({
  FAILURE_SCREENSHOT_FILE_NAME: "failure.png",
  runActionPlan: vi.fn(),
}));

/** The login helper is replaced so no spec ever decrypts a password. */
const mockCrawlerLoginService = vi.hoisted(() => ({
  buildCrawlLoginDetails: vi.fn(),
}));

/** The key check is replaced so each spec decides whether a key is configured. */
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

import { registerActionScriptRoutes } from "../../../server/controllers/actionScripts.js";

/**
 * A committed directory standing in for ACTION_SCRIPT_DIR. It holds one real
 * PNG at `website-id-from-db/existing-run/failure.png`, so the failure
 * screenshot route is exercised through the real `res.sendFile`.
 */
const FIXTURE_ACTION_SCRIPT_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "action-script-files",
);
const EXISTING_FAILURE_SCREENSHOT_NAME = "website-id-from-db/existing-run/failure.png";
const EXISTING_FAILURE_SCREENSHOT_BYTES = readFileSync(
  path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, EXISTING_FAILURE_SCREENSHOT_NAME),
);
/** That PNG as the refine route sends it to Claude. */
const EXISTING_FAILURE_SCREENSHOT_BASE64 = EXISTING_FAILURE_SCREENSHOT_BYTES.toString("base64");
/**
 * A real, readable PNG OUTSIDE the action script directory (the screenshot
 * fixtures sit next to it), for proving a stored name cannot reach it.
 */
const PNG_OUTSIDE_THE_ACTION_SCRIPT_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "screenshot-files",
  "website-id-from-db",
  "existing-run.png",
);

/**
 * Builds a minimal app carrying only the action script routes, mounted the
 * same way server.ts mounts them, with the fixture directory as the action
 * script directory.
 * @returns An app with JSON body parsing and the action script routes registered
 */
function createActionScriptsApp(): Express {
  const app = express();
  app.use(express.json());
  registerActionScriptRoutes(app, FIXTURE_ACTION_SCRIPT_DIRECTORY);
  return app;
}

const ACTION_ALREADY_RUNNING_MESSAGE =
  "This action is already running; wait for that run to finish before starting another";
const ACTION_CREDENTIAL_MISSING_MESSAGE =
  "This action's credential no longer exists; edit the action to pick another one";
const PLAN_NEEDS_A_CREDENTIAL_MESSAGE =
  "This plan types the credential's username or password, but the action runs logged out; edit the action to pick a credential";

/** A valid plan that needs no credential: open the site, click Sign in, check the result. */
const CLICK_SIGN_IN_PLAN = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    { action: "expectVisible", target: { text: "Welcome back" }, value: null },
  ],
};

/** A valid plan that types the credential's username and password through the placeholders. */
const CREDENTIAL_PLAN = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "fill", target: { label: "Email" }, value: "{{credential.username}}" },
    { action: "fill", target: { label: "Password" }, value: "{{credential.password}}" },
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
  ],
};

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove later queries use the FOUND
// rows' ids, not the raw path parameters.
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
/** An action that runs logged out. */
const foundAction = {
  id: "action-id-from-db",
  websiteId: foundWebsite.id,
  credentialId: null,
  title: "Log in",
  description: "Click Sign in and log in",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  credential: null,
};
/** The website's credential, without its password, as `findCredentialForWebsite` returns it. Its login page is on another host. */
const foundCredential = {
  id: "credential-id-from-db",
  websiteId: foundWebsite.id,
  name: "Admin",
  description: null,
  username: "admin@example.com",
  loginUrl: "https://auth.example.com/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
/** The same credential with its encrypted password, as only the run route reads it. */
const foundCredentialWithPassword = { ...foundCredential, encryptedPassword: "iv.tag.ciphertext" };
/** The same action, linked to that credential. */
const foundLinkedAction = {
  ...foundAction,
  credentialId: foundCredential.id,
  credential: { id: foundCredential.id, name: foundCredential.name },
};
/** What `buildCrawlLoginDetails` hands back for the credential (password decrypted). */
const loginDetails = {
  loginUrl: foundCredential.loginUrl,
  username: foundCredential.username,
  password: "decrypted-password",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
};
/** A generated version of the logged-out action. */
const foundScript = {
  id: "script-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  websiteName: foundWebsite.name,
  startUrl: foundWebsite.url,
  actionTitle: foundAction.title,
  actionDescription: foundAction.description,
  credentialId: null,
  credentialName: null,
  summary: "Clicks Sign in",
  assumptions: ["The button is called Sign in"],
  plan: CLICK_SIGN_IN_PLAN,
  contextPageUrls: ["https://example.com/"],
  modelId: "claude-opus-5-5",
  effort: "high",
  editedFromActionScriptId: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
  refinement: null,
  latestRun: null,
};
const sampleRun = {
  id: "run-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundAction.id,
  actionScriptId: foundScript.id,
  succeeded: false,
  timedOut: false,
  errorMessage: 'Step 2 (expectVisible): text "Welcome back" was not visible within 10 seconds',
  failedStepNumber: 2,
  credentialName: null,
  output: "✔ Step 1: click\n✘ Step 2: expectVisible",
  outputWasTruncated: false,
  failureScreenshotFileName: EXISTING_FAILURE_SCREENSHOT_NAME,
  failingPageUrl: "https://example.com/",
  failingPageAriaSnapshot: '- button "Log in"\n- text "Welcome"',
  durationMs: 4200,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
};

const SCRIPTS_PATH = "/api/websites/website-id-from-path/actions/action-id-from-path/scripts";
const EDITS_PATH = `${SCRIPTS_PATH}/script-id-from-path/edits`;
const RUNS_PATH = `${SCRIPTS_PATH}/script-id-from-path/runs`;
const FAILURE_SCREENSHOT_PATH = `${RUNS_PATH}/run-id-from-path/failure-screenshot`;
const REFINEMENTS_PATH = `${RUNS_PATH}/run-id-from-path/refinements`;

/** A run folder is `<found website id>/<uuid>`. */
const RUN_FOLDER_NAME_PATTERN = /^website-id-from-db\/[0-9a-f-]{36}$/;

/** What `convertActionToPlan` returns for a successful conversion. */
const cleanConversion = {
  summary: "Clicks Sign in",
  assumptions: ["The button is called Sign in"],
  plan: CLICK_SIGN_IN_PLAN,
  modelId: "claude-opus-5-5",
  effort: "high",
};

/** A catalog model with effort levels (what `findScriptModel` finds by default). */
const opusModel = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  supportsAdaptiveThinking: true,
  fallbackModel: { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
};

/** A catalog model with no effort setting ("Standard"). */
const haikuModel = {
  id: "claude-haiku-4-5-20251001",
  displayName: "Claude Haiku 4.5",
  effortLevels: [],
  supportsAdaptiveThinking: false,
  fallbackModel: null,
};

/** The body the action page sends with "Convert to script". */
const OPUS_HIGH_CHOICE = { modelId: "claude-opus-5-5", effort: "high" };

// Three crawled pages: the start page, a page about logging in, and a page
// that has nothing to do with the action (it scores 0 and is left out).
const crawledStartPage = {
  url: "https://example.com/",
  title: "Example",
  depth: 0,
  ariaSnapshot: '- link "Log in"',
};
const crawledLoginPage = {
  url: "https://example.com/login",
  title: "Log in",
  depth: 1,
  ariaSnapshot: '- textbox "Email"\n- button "Sign in"',
};
const crawledCareersPage = {
  url: "https://example.com/careers",
  title: "Careers",
  depth: 1,
  ariaSnapshot: '- heading "Open roles" [level=1]',
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
};

/**
 * Builds the error `convertActionToPlan` throws for a known failure, shaped
 * like `ScriptGenerationError` (the controller recognizes it structurally).
 * @param reason - The failure reason
 * @param message - The human-readable message
 * @returns An Error carrying `name` and `reason`
 */
function buildScriptGenerationError(reason: string, message: string): Error {
  return Object.assign(new Error(message), { name: "ScriptGenerationError", reason });
}

/**
 * Reads the request the controller handed `runActionPlan`.
 * @param callIndex - Which recorded call to read; the first by default
 * @returns The run request of that call
 */
function readRunRequest(callIndex = 0): ActionPlanRunRequest {
  const [runRequest] = mockActionPlanRunnerService.runActionPlan.mock.calls[callIndex] as [
    ActionPlanRunRequest,
  ];
  return runRequest;
}

/**
 * Reads the request the controller handed `runActionPlan`, minus its run
 * folder - the folder name is random, so it is checked on its own with
 * `readRequestedRunFolderName`.
 * @param callIndex - Which recorded call to read; the first by default
 * @returns Every field of that call's run request except `runDirectory`
 */
function readRunRequestWithoutRunDirectory(callIndex = 0): Partial<ActionPlanRunRequest> {
  const runRequestCopy: Partial<ActionPlanRunRequest> = { ...readRunRequest(callIndex) };
  delete runRequestCopy.runDirectory;
  return runRequestCopy;
}

/**
 * Reads the run folder the controller asked the runner to use, relative to
 * the fixture directory and with `/` separators.
 * @param callIndex - Which recorded run to read; the first by default
 * @returns The run folder name
 */
function readRequestedRunFolderName(callIndex = 0): string {
  const { runDirectory } = readRunRequest(callIndex);
  return path.relative(FIXTURE_ACTION_SCRIPT_DIRECTORY, runDirectory).split(path.sep).join("/");
}

/** A promise a test settles by hand, so a run can be held "in progress". */
interface Deferred<TValue> {
  /** The promise handed to the code under test. */
  promise: Promise<TValue>;
  /** Fulfils the promise. */
  resolve: (value: TValue) => void;
}

/**
 * Creates a promise that stays pending until the test resolves it, to keep a
 * run going while a second request arrives.
 * @returns The pending promise and its resolve function
 */
function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: (value: TValue) => void = () => undefined;
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("Action script routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks its parents first; they exist unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(foundAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(foundScript);
    mockDbService.findCredentialForWebsite.mockResolvedValue(foundCredential);
    mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(
      foundCredentialWithPassword,
    );
    // The website was never crawled unless a test says otherwise.
    mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([]);
    mockScriptModelService.findScriptModel.mockResolvedValue(opusModel);
    mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(true);
    mockCrawlerLoginService.buildCrawlLoginDetails.mockReturnValue(loginDetails);
  });

  describe("GET /api/websites/:websiteId/actions/:actionId/scripts", () => {
    it("returns 200 with the action's scripts, looked up under the found website and action", async () => {
      mockDbService.listActionScriptsForAction.mockResolvedValue([foundScript]);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([foundScript]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-id-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-id-from-path",
      );
      expect(mockDbService.listActionScriptsForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
      );
    });

    it("answers each version with its latestRun - passed, failed, or null when not run - and no runs list", async () => {
      const passedLatestRun = { id: "run-passed", succeeded: true, createdAt: "2026-01-04T00:00:00.000Z" };
      const failedLatestRun = { id: "run-failed", succeeded: false, createdAt: "2026-01-03T00:00:00.000Z" };
      mockDbService.listActionScriptsForAction.mockResolvedValue([
        { ...foundScript, id: "script-3", latestRun: null },
        { ...foundScript, id: "script-2", latestRun: failedLatestRun },
        { ...foundScript, id: "script-1", latestRun: passedLatestRun },
      ]);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(200);
      const answeredScripts = res.body as Array<Record<string, unknown>>;
      expect(answeredScripts.map((answeredScript) => answeredScript.latestRun)).toEqual([
        null,
        failedLatestRun,
        passedLatestRun,
      ]);
      for (const answeredScript of answeredScripts) {
        expect(answeredScript).not.toHaveProperty("runs");
      }
    });

    it("returns 404 Website not found and looks up no action when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and lists nothing when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.listActionScriptsForAction).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listActionScriptsForAction.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).get(SCRIPTS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/scripts", () => {
    it("converts the found logged-out action with the chosen model and effort, the site's origins, and the relevant crawled pages, then saves the plan and returns 201", async () => {
      mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([
        crawledStartPage,
        crawledCareersPage,
        crawledLoginPage,
      ]);
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue(cleanConversion);
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(foundScript);
      expect(mockScriptModelService.findScriptModel).toHaveBeenCalledWith("claude-opus-5-5");
      // A logged-out action has no credential to look up, and reads the pages of a logged-out crawl.
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.findLatestCrawledPagesForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        null,
      );
      // The start page always comes first; the careers page mentions nothing
      // the action talks about, so it is left out.
      const expectedContextPages = [
        { url: crawledStartPage.url, title: crawledStartPage.title, ariaSnapshot: crawledStartPage.ariaSnapshot },
        { url: crawledLoginPage.url, title: crawledLoginPage.title, ariaSnapshot: crawledLoginPage.ariaSnapshot },
      ];
      expect(mockScriptGenerationService.convertActionToPlan).toHaveBeenCalledWith(
        {
          websiteName: foundWebsite.name,
          startUrl: foundWebsite.url,
          actionTitle: foundAction.title,
          actionDescription: foundAction.description,
          credentialId: null,
          credentialName: null,
          allowedOrigins: ["https://example.com"],
          contextPages: expectedContextPages,
        },
        { model: opusModel, effort: "high" },
      );
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        {
          websiteName: foundWebsite.name,
          startUrl: foundWebsite.url,
          actionTitle: foundAction.title,
          actionDescription: foundAction.description,
          credentialId: null,
          credentialName: null,
          summary: cleanConversion.summary,
          assumptions: cleanConversion.assumptions,
          plan: cleanConversion.plan,
          contextPageUrls: [crawledStartPage.url, crawledLoginPage.url],
          modelId: cleanConversion.modelId,
          effort: "high",
          editedFromActionScriptId: null,
        },
      );
    });

    it("converts a logged-in action with its credential's name, the login pages' origins, and a crawl done as that credential", async () => {
      const websiteWithLoginPage = { ...foundWebsite, loginUrl: "https://sso.example.org/sign-in" };
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginPage);
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([crawledStartPage]);
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue(cleanConversion);
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(201);
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.findLatestCrawledPagesForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      expect(mockScriptGenerationService.convertActionToPlan).toHaveBeenCalledWith(
        {
          websiteName: foundWebsite.name,
          startUrl: foundWebsite.url,
          actionTitle: foundAction.title,
          actionDescription: foundAction.description,
          credentialId: foundCredential.id,
          credentialName: foundCredential.name,
          allowedOrigins: [
            "https://example.com",
            "https://sso.example.org",
            "https://auth.example.com",
          ],
          contextPages: [
            { url: crawledStartPage.url, title: crawledStartPage.title, ariaSnapshot: crawledStartPage.ariaSnapshot },
          ],
        },
        { model: opusModel, effort: "high" },
      );
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({
          credentialId: foundCredential.id,
          credentialName: foundCredential.name,
          contextPageUrls: [crawledStartPage.url],
        }),
      );
    });

    it("converts logged out when the action's credential no longer exists", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findCredentialForWebsite.mockResolvedValue(null);
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue(cleanConversion);
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(201);
      expect(mockDbService.findLatestCrawledPagesForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        null,
      );
      expect(mockScriptGenerationService.convertActionToPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: null,
          credentialName: null,
          allowedOrigins: ["https://example.com"],
        }),
        { model: opusModel, effort: "high" },
      );
    });

    it("converts with no context pages, and saves none, when the website was never crawled", async () => {
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue(cleanConversion);
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(201);
      expect(mockScriptGenerationService.convertActionToPlan).toHaveBeenCalledWith(
        expect.objectContaining({ contextPages: [] }),
        expect.any(Object),
      );
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ contextPageUrls: [] }),
      );
    });

    it("converts with a model that has no effort setting when the effort is null", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue(haikuModel);
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue({
        ...cleanConversion,
        modelId: haikuModel.id,
        effort: null,
      });
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send({ modelId: haikuModel.id, effort: null });

      expect(res.status).toBe(201);
      expect(mockScriptGenerationService.convertActionToPlan).toHaveBeenCalledWith(
        expect.any(Object),
        { model: haikuModel, effort: null },
      );
      const [, , savedScript] = mockDbService.createActionScriptForAction.mock.calls[0] as [
        string,
        string,
        { modelId: string; effort: string | null },
      ];
      expect(savedScript).toMatchObject({ modelId: haikuModel.id, effort: null });
    });

    it("saves the model that actually answered, which can be the fallback model", async () => {
      mockScriptGenerationService.convertActionToPlan.mockResolvedValue({
        ...cleanConversion,
        modelId: opusModel.fallbackModel.id,
      });
      mockDbService.createActionScriptForAction.mockResolvedValue(foundScript);

      await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ modelId: "claude-opus-4-8", effort: "high" }),
      );
    });

    it("returns 400 and looks nothing up when the body names no model", async () => {
      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send({ effort: "high" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A model is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
    });

    it("returns 400 and looks nothing up when the body is not a JSON object", async () => {
      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send(["claude-opus-5-5"]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
    });

    it("returns 400 and converts nothing for a model that is not in the catalog", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue(null);

      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send({ modelId: "claude-nope", effort: "high" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Unknown model "claude-nope"; pick one from the model list' });
      expect(mockDbService.findLatestCrawledPagesForWebsite).not.toHaveBeenCalled();
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 400 for an effort level the model does not offer", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue({
        ...opusModel,
        effortLevels: ["low", "medium", "high", "max"],
        displayName: "Claude Opus 4.6",
      });

      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send({ modelId: "claude-opus-4-6", effort: "xhigh" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Claude Opus 4.6 does not offer the "xhigh" effort level; it offers low, medium, high, max',
      });
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 400 when a model with effort levels is sent no level", async () => {
      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send({ modelId: "claude-opus-5-5" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "Claude Opus 5.5 needs an effort level: low, medium, high, xhigh, max",
      });
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 400 when a model with no effort setting is sent a level", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue(haikuModel);

      const res = await request(createActionScriptsApp())
        .post(SCRIPTS_PATH)
        .send({ modelId: haikuModel.id, effort: "low" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "Claude Haiku 4.5 has no effort setting, so no effort level can be chosen for it",
      });
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 503 when the model catalog cannot be read without an API key", async () => {
      mockScriptModelService.findScriptModel.mockRejectedValue(
        buildScriptGenerationError("missingApiKey", "ANTHROPIC_API_KEY is not set"),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(503);
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and converts nothing when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and converts nothing when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("returns 503 and saves nothing when the API key is not configured", async () => {
      mockScriptGenerationService.convertActionToPlan.mockRejectedValue(
        buildScriptGenerationError("missingApiKey", "ANTHROPIC_API_KEY is not set"),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "ANTHROPIC_API_KEY is not set" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it.each(["refused", "truncated", "unparseable"])(
      "returns 502 and saves nothing when Claude's reply is unusable (%s)",
      async (reason) => {
        mockScriptGenerationService.convertActionToPlan.mockRejectedValue(
          buildScriptGenerationError(reason, `Claude failed: ${reason}`),
        );

        const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error: `Claude failed: ${reason}` });
        expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
      },
    );

    it("returns 500 for an error with an unknown reason", async () => {
      mockScriptGenerationService.convertActionToPlan.mockRejectedValue(
        buildScriptGenerationError("somethingNew", "odd failure"),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "odd failure" });
    });

    it("returns 500 for an API error that only happens to carry a reason", async () => {
      mockScriptGenerationService.convertActionToPlan.mockRejectedValue(
        Object.assign(new Error("rate limited"), { reason: "refused" }),
      );

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "rate limited" });
    });

    it("returns 500 with the stringified value when the conversion rejects with a non-Error", async () => {
      mockScriptGenerationService.convertActionToPlan.mockRejectedValue("socket hang up");

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "socket hang up" });
    });

    it("returns 500 and converts nothing when the crawled pages cannot be read", async () => {
      mockDbService.findLatestCrawledPagesForWebsite.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).post(SCRIPTS_PATH).send(OPUS_HIGH_CHOICE);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/edits", () => {
    /** The version being edited: its snapshots differ from the current website and action rows. */
    const sourceScript = {
      ...foundScript,
      websiteName: "Example (old name)",
      actionTitle: "Sign in (old title)",
      actionDescription: "Press the old Sign in button",
      credentialId: foundCredential.id,
      credentialName: foundCredential.name,
      summary: "Signs in the old way",
      assumptions: ["The old button is called Sign in"],
      contextPageUrls: ["https://example.com/", "https://example.com/login"],
    };

    /** A valid edit of the source's plan: renamed, one step added. */
    const editedPlan = {
      name: "Log in (edited)",
      startUrl: "https://example.com/",
      steps: [
        { action: "click", target: { role: "button", name: "Sign in" }, value: null },
        { action: "press", target: null, value: "Enter" },
      ],
    };

    /** What `createActionScriptForAction` answers with: the new version. */
    const editedVersion = {
      ...sourceScript,
      id: "edited-script-id-from-db",
      plan: editedPlan,
      modelId: null,
      effort: null,
      editedFromActionScriptId: sourceScript.id,
    };

    beforeEach(() => {
      mockDbService.findActionScriptForAction.mockResolvedValue(sourceScript);
    });

    it("saves the edited plan as a new version that copies its source's snapshots, and returns 201", async () => {
      mockDbService.createActionScriptForAction.mockResolvedValue(editedVersion);

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(editedVersion);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-id-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-id-from-path",
      );
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "script-id-from-path",
      );
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        {
          websiteName: sourceScript.websiteName,
          startUrl: sourceScript.startUrl,
          actionTitle: sourceScript.actionTitle,
          actionDescription: sourceScript.actionDescription,
          credentialId: sourceScript.credentialId,
          credentialName: sourceScript.credentialName,
          summary: sourceScript.summary,
          assumptions: sourceScript.assumptions,
          plan: editedPlan,
          contextPageUrls: sourceScript.contextPageUrls,
          modelId: null,
          effort: null,
          editedFromActionScriptId: sourceScript.id,
        },
      );
      expect(mockScriptGenerationService.convertActionToPlan).not.toHaveBeenCalled();
    });

    it("lets a logged-in action's edited plan open its credential's login page", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.createActionScriptForAction.mockResolvedValue(editedVersion);
      const planThatOpensTheLoginPage = {
        ...editedPlan,
        steps: [{ action: "goto", target: null, value: "https://auth.example.com/login" }],
      };

      const res = await request(createActionScriptsApp())
        .post(EDITS_PATH)
        .send({ plan: planThatOpensTheLoginPage });

      expect(res.status).toBe(201);
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      expect(mockDbService.createActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ plan: planThatOpensTheLoginPage }),
      );
    });

    it("returns 400 for a logged-out action's plan that opens the credential's login host", async () => {
      const planThatOpensTheLoginPage = {
        ...editedPlan,
        steps: [{ action: "goto", target: null, value: "https://auth.example.com/login" }],
      };

      const res = await request(createActionScriptsApp())
        .post(EDITS_PATH)
        .send({ plan: planThatOpensTheLoginPage });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error:
          "Step 1 (goto): must be on this website (https://example.com), not https://auth.example.com",
      });
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 400 and saves nothing when the body is an array", async () => {
      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send([editedPlan]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 400 and saves nothing when no JSON body was sent", async () => {
      const res = await request(createActionScriptsApp())
        .post(EDITS_PATH)
        .set("Content-Type", "text/plain")
        .send("click Sign in");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it.each([
      ["left out", {}],
      ["null", { plan: null }],
    ])("returns 400 and saves nothing when the plan is %s", async (_label, body) => {
      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A plan is required" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 400 naming the step when a step's action is not an allowed one", async () => {
      const planWithCode = {
        ...editedPlan,
        steps: [{ action: "evaluate", target: null, value: "document.cookie" }],
      };

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: planWithCode });

      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toMatch(
        /^The plan does not have the expected shape - steps\.0\.action: /,
      );
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 400 listing every problem when the plan leaves the website and a step lacks its target", async () => {
      const planThatLeavesTheSite = {
        name: "Log in",
        startUrl: "https://evil.example/",
        steps: [
          { action: "goto", target: null, value: "https://evil.example/steal" },
          { action: "click", target: null, value: null },
        ],
      };

      const res = await request(createActionScriptsApp())
        .post(EDITS_PATH)
        .send({ plan: planThatLeavesTheSite });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: [
          "Start URL: must be on this website (https://example.com), not https://evil.example",
          "Step 1 (goto): must be on this website (https://example.com), not https://evil.example",
          "Step 2 (click): needs a target",
        ].join("; "),
      });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and looks up no action when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and looks up no version when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Script not found and saves nothing when the source version does not exist", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script not found" });
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when saving the new version fails", async () => {
      mockDbService.createActionScriptForAction.mockRejectedValue(new Error("insert failed"));

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "insert failed" });
    });

    it("returns 500 with the error message when a lookup fails", async () => {
      mockDbService.findActionScriptForAction.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).post(EDITS_PATH).send({ plan: editedPlan });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });

  describe("GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs", () => {
    it("returns 200 with the script's runs, looked up under the found rows", async () => {
      mockDbService.listActionScriptRunsForScript.mockResolvedValue([sampleRun]);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleRun]);
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "script-id-from-path",
      );
      expect(mockDbService.listActionScriptRunsForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
      );
    });

    it("returns 404 Website not found before looking up the action or script", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Script not found when the script does not exist or belongs to another action", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script not found" });
      expect(mockDbService.listActionScriptRunsForScript).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.findActionScriptForAction.mockRejectedValue(new Error("db down"));

      const res = await request(createActionScriptsApp()).get(RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs", () => {
    it("runs a logged-out action's stored plan in a new folder under the found website and returns 201 with the run", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleRun);
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      expect(readRunRequestWithoutRunDirectory()).toEqual({
        plan: CLICK_SIGN_IN_PLAN,
        login: null,
        timingSettings: { networkIdleTimeoutMs: 7000, screenshotMinimumWaitMs: 250 },
        allowedOrigins: ["https://example.com"],
        uploadsDirectory: path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, "uploads"),
      });
      expect(readRequestedRunFolderName()).toMatch(RUN_FOLDER_NAME_PATTERN);
      // Logging out needs no credential, so neither the key nor the password is touched.
      expect(mockCredentialEncryption.credentialEncryptionIsConfigured).not.toHaveBeenCalled();
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockCrawlerLoginService.buildCrawlLoginDetails).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        {
          succeeded: true,
          timedOut: false,
          errorMessage: null,
          failedStepNumber: null,
          credentialName: null,
          output: passingRunResult.output,
          outputWasTruncated: false,
          failureScreenshotFileName: null,
          failingPageUrl: null,
          failingPageAriaSnapshot: null,
          durationMs: 3100,
        },
      );
    });

    it("runs a logged-out action even when no credential key is configured", async () => {
      mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
    });

    it("logs a logged-in action in as its credential first, and records the credential's name", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...foundScript,
        plan: CREDENTIAL_PLAN,
      });
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        credentialName: foundCredential.name,
      });

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(mockDbService.findCredentialWithPasswordForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      expect(mockCrawlerLoginService.buildCrawlLoginDetails).toHaveBeenCalledWith(
        foundCredentialWithPassword,
        foundWebsite,
      );
      expect(readRunRequestWithoutRunDirectory()).toEqual({
        plan: CREDENTIAL_PLAN,
        login: { credentialName: foundCredential.name, details: loginDetails },
        timingSettings: { networkIdleTimeoutMs: 7000, screenshotMinimumWaitMs: 250 },
        allowedOrigins: ["https://example.com", "https://auth.example.com"],
        uploadsDirectory: path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, "uploads"),
      });
      expect(readRequestedRunFolderName()).toMatch(RUN_FOLDER_NAME_PATTERN);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        expect.objectContaining({ succeeded: true, credentialName: foundCredential.name }),
      );
    });

    it("logs in through the website's login page when the credential has none of its own", async () => {
      const websiteWithLoginPage = { ...foundWebsite, loginUrl: "https://example.com/login" };
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginPage);
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue({
        ...foundCredentialWithPassword,
        loginUrl: null,
      });
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(readRunRequest().allowedOrigins).toEqual(["https://example.com"]);
      expect(mockCrawlerLoginService.buildCrawlLoginDetails).toHaveBeenCalledWith(
        { ...foundCredentialWithPassword, loginUrl: null },
        websiteWithLoginPage,
      );
    });

    it("returns 503 and runs nothing when a logged-in action runs without a configured credential key", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockCredentialEncryption.credentialEncryptionIsConfigured.mockReturnValue(false);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: mockCredentialEncryption.CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
      });
      expect(mockDbService.findCredentialWithPasswordForWebsite).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptRunForScript).not.toHaveBeenCalled();
    });

    it("returns 409 and runs nothing when the action's credential no longer exists", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: ACTION_CREDENTIAL_MISSING_MESSAGE });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("returns 400 and runs nothing when neither the credential nor its website has a login page URL", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockDbService.findCredentialWithPasswordForWebsite.mockResolvedValue({
        ...foundCredentialWithPassword,
        loginUrl: null,
      });

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error:
          'The credential "Admin" has no login page URL, and neither does its website; add one to log in',
      });
      expect(mockCrawlerLoginService.buildCrawlLoginDetails).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("returns 409 and runs nothing when the stored plan no longer passes the rules (the website moved to another origin)", async () => {
      mockDbService.findWebsiteById.mockResolvedValue({
        ...foundWebsite,
        url: "https://new-example.com/",
      });

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error:
          "This version's plan can no longer run: Start URL: must be on this website (https://new-example.com), not https://example.com",
      });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
      expect(mockDbService.createActionScriptRunForScript).not.toHaveBeenCalled();
    });

    it("returns 409 and runs nothing when the stored plan is not a plan at all", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...foundScript,
        plan: { name: "Hand-edited", steps: "click everything" },
      });

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toMatch(
        /^This version's plan can no longer run: The plan does not have the expected shape - /,
      );
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("returns 409 and runs nothing when the plan types a credential but the action runs logged out", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...foundScript,
        plan: CREDENTIAL_PLAN,
      });

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: PLAN_NEEDS_A_CREDENTIAL_MESSAGE });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("records a failed run's step, message, and screenshot relative to the action script directory, and still answers 201", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue({
        ...passingRunResult,
        succeeded: false,
        errorMessage: sampleRun.errorMessage,
        failedStepNumber: 2,
        failureScreenshotWasCaptured: true,
      });
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleRun);
      const [, , , recordedRun] = mockDbService.createActionScriptRunForScript.mock.calls[0] as [
        string,
        string,
        string,
        {
          succeeded: boolean;
          errorMessage: string | null;
          failedStepNumber: number | null;
          failureScreenshotFileName: string;
        },
      ];
      expect(recordedRun).toMatchObject({
        succeeded: false,
        errorMessage: sampleRun.errorMessage,
        failedStepNumber: 2,
      });
      expect(recordedRun.failureScreenshotFileName).toBe(
        `${readRequestedRunFolderName()}/failure.png`,
      );
    });

    it("records the address and aria snapshot of the page a failed run stopped on", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue({
        ...passingRunResult,
        succeeded: false,
        errorMessage: sampleRun.errorMessage,
        failedStepNumber: 2,
        failingPageUrl: "https://example.com/account",
        failingPageAriaSnapshot: '- link "Profile"',
      });
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      expect(mockDbService.createActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        expect.objectContaining({
          succeeded: false,
          failingPageUrl: "https://example.com/account",
          failingPageAriaSnapshot: '- link "Profile"',
        }),
      );
    });

    it("records a run that hit the time limit, and still answers 201", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue({
        ...passingRunResult,
        succeeded: false,
        timedOut: true,
        errorMessage: "The run hit the 5 minute time limit and was stopped",
        failedStepNumber: 4,
        outputWasTruncated: true,
      });
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(201);
      const [, , , recordedRun] = mockDbService.createActionScriptRunForScript.mock.calls[0] as [
        string,
        string,
        string,
        Record<string, unknown>,
      ];
      expect(recordedRun).toMatchObject({
        succeeded: false,
        timedOut: true,
        failedStepNumber: 4,
        outputWasTruncated: true,
        failureScreenshotFileName: null,
      });
    });

    it("gives every run its own folder", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);

      await request(createActionScriptsApp()).post(RUNS_PATH);
      await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(readRequestedRunFolderName(0)).toMatch(RUN_FOLDER_NAME_PATTERN);
      expect(readRequestedRunFolderName(1)).toMatch(RUN_FOLDER_NAME_PATTERN);
      expect(readRequestedRunFolderName(0)).not.toBe(readRequestedRunFolderName(1));
    });

    it("returns 409 for a second run of the same action while the first is still going, then accepts runs again once it ends", async () => {
      const firstRunResult = createDeferred<typeof passingRunResult>();
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockActionPlanRunnerService.runActionPlan.mockReturnValueOnce(firstRunResult.promise);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);
      const app = createActionScriptsApp();

      const firstRunResponse = request(app)
        .post(RUNS_PATH)
        .then((response) => response);
      await vi.waitFor(() => {
        expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      });

      const secondRunResponse = await request(app).post(RUNS_PATH);

      expect(secondRunResponse.status).toBe(409);
      expect(secondRunResponse.body).toEqual({ error: ACTION_ALREADY_RUNNING_MESSAGE });
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);

      firstRunResult.resolve(passingRunResult);
      expect((await firstRunResponse).status).toBe(201);

      const runAfterTheFirstEnded = await request(app).post(RUNS_PATH);
      expect(runAfterTheFirstEnded.status).toBe(201);
      expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(2);
    });

    it("runs another action while one action is still going", async () => {
      const firstRunResult = createDeferred<typeof passingRunResult>();
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockActionPlanRunnerService.runActionPlan.mockReturnValueOnce(firstRunResult.promise);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);
      const app = createActionScriptsApp();

      const firstRunResponse = request(app)
        .post(RUNS_PATH)
        .then((response) => response);
      await vi.waitFor(() => {
        expect(mockActionPlanRunnerService.runActionPlan).toHaveBeenCalledTimes(1);
      });
      mockDbService.findActionForWebsite.mockResolvedValueOnce({
        ...foundAction,
        id: "another-action-id-from-db",
      });

      const otherActionRunResponse = await request(app).post(RUNS_PATH);

      expect(otherActionRunResponse.status).toBe(201);
      firstRunResult.resolve(passingRunResult);
      expect((await firstRunResponse).status).toBe(201);
    });

    it("returns 500, records nothing, and accepts the next run when the runner fails to start", async () => {
      mockActionPlanRunnerService.runActionPlan.mockRejectedValueOnce(
        new Error("browserType.launch: Executable doesn't exist"),
      );
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);
      const app = createActionScriptsApp();

      const failedRunResponse = await request(app).post(RUNS_PATH);

      expect(failedRunResponse.status).toBe(500);
      expect(failedRunResponse.body).toEqual({
        error: "browserType.launch: Executable doesn't exist",
      });
      expect(mockDbService.createActionScriptRunForScript).not.toHaveBeenCalled();

      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      const nextRunResponse = await request(app).post(RUNS_PATH);
      expect(nextRunResponse.status).toBe(201);
    });

    it("accepts the next run after one was refused before it started", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValueOnce({
        ...foundScript,
        plan: CREDENTIAL_PLAN,
      });
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);
      const app = createActionScriptsApp();

      const refusedRunResponse = await request(app).post(RUNS_PATH);
      const nextRunResponse = await request(app).post(RUNS_PATH);

      expect(refusedRunResponse.status).toBe(409);
      expect(nextRunResponse.status).toBe(201);
    });

    it("returns 500, runs nothing, and accepts the next run when the password cannot be decrypted", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);
      mockCrawlerLoginService.buildCrawlLoginDetails.mockImplementationOnce(() => {
        throw new Error("Unsupported state or unable to authenticate data");
      });
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockResolvedValue(sampleRun);
      const app = createActionScriptsApp();

      const failedRunResponse = await request(app).post(RUNS_PATH);

      expect(failedRunResponse.status).toBe(500);
      expect(failedRunResponse.body).toEqual({
        error: "Unsupported state or unable to authenticate data",
      });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();

      const nextRunResponse = await request(app).post(RUNS_PATH);
      expect(nextRunResponse.status).toBe(201);
    });

    it("returns 500 with the error message when the run cannot be recorded", async () => {
      mockActionPlanRunnerService.runActionPlan.mockResolvedValue(passingRunResult);
      mockDbService.createActionScriptRunForScript.mockRejectedValue(new Error("insert failed"));

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "insert failed" });
    });

    it("returns 404 Website not found and runs nothing when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Website not found" });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and runs nothing when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });

    it("returns 404 Script not found and runs nothing when the script does not exist", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).post(RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script not found" });
      expect(mockActionPlanRunnerService.runActionPlan).not.toHaveBeenCalled();
    });
  });

  describe("GET .../runs/:actionScriptRunId/failure-screenshot", () => {
    it("returns 200 with the PNG bytes, looking the run up under the found rows", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue(sampleRun);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(res.body as Buffer, EXISTING_FAILURE_SCREENSHOT_BYTES)).toBe(0);
      expect(mockDbService.findActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        foundScript.id,
        "run-id-from-path",
      );
    });

    it("returns 404 Action not found and looks up no run when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Action not found" });
      expect(mockDbService.findActionScriptRunForScript).not.toHaveBeenCalled();
    });

    it("returns 404 Script run not found when the run does not exist", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue(null);

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Script run not found" });
    });

    it("returns 404 when the run wrote no failure screenshot", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: null,
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "This run did not capture a failure screenshot" });
    });

    it("returns 404 Failure screenshot file not found when the file is gone from disk", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "website-id-from-db/deleted-run/failure.png",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Failure screenshot file not found" });
    });

    it("refuses a stored name that climbs out of the action script directory, serving no file", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "../action-script-files/website-id-from-db/existing-run/failure.png",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 500 with the send error when the stored name is not a readable file", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        failureScreenshotFileName: "website-id-from-db",
      });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "EISDIR, read" });
    });

    it("returns 500 with the stringified value when the run lookup rejects with a non-Error", async () => {
      mockDbService.findActionScriptRunForScript.mockRejectedValue({ code: "P1001" });

      const res = await request(createActionScriptsApp()).get(FAILURE_SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "[object Object]" });
    });
  });

  describe("POST .../runs/:actionScriptRunId/refinements", () => {
    const ONLY_A_FAILED_RUN_MESSAGE = "Only a failed run can be refined; this run passed";
    const EDITED_VERSION_MESSAGE =
      "This version was saved from the step editor, so no model wrote it; only a version Claude wrote can be refined";
    const ALREADY_BEING_REFINED_MESSAGE = "This run is already being refined; wait for that to finish";
    const NOTE = "The Sign in button is called Log in now";

    /**
     * The version whose run failed. Its snapshots differ from the CURRENT
     * website and action rows (and it ran as a credential the action no longer
     * uses), so each test can prove Claude is shown the version's snapshots.
     * Its context pages are listed login page first.
     */
    const refinableScript = {
      ...foundScript,
      websiteName: "Example (old name)",
      actionTitle: "Log in (old title)",
      actionDescription: "Press the old Sign in button",
      credentialId: foundCredential.id,
      credentialName: foundCredential.name,
      summary: "Clicks Sign in, then checks the welcome text",
      assumptions: ["The button is called Sign in"],
      contextPageUrls: [crawledLoginPage.url, crawledStartPage.url],
      modelId: "claude-opus-5-5",
      effort: "medium",
    };

    /** The plan Claude answers with: the renamed button. */
    const REFINED_PLAN = {
      name: "Log in",
      startUrl: "https://example.com/",
      steps: [
        { action: "click", target: { role: "button", name: "Log in" }, value: null },
        { action: "expectVisible", target: { text: "Welcome back" }, value: null },
      ],
    };

    /** What `refineActionPlan` returns for a successful refinement. */
    const cleanRefinement = {
      summary: "Clicks Log in, then checks the welcome text",
      assumptions: ["Refined: the button is called Log in now"],
      plan: REFINED_PLAN,
      modelId: "claude-opus-5-5",
      effort: "medium",
      usage: {
        inputTokens: 2408,
        outputTokens: 989,
        cacheReadInputTokens: 9519,
        cacheCreationInputTokens: 1292,
      },
      screenshotWasSent: true,
    };

    /** What `createRefinedActionScriptForAction` answers with: the new version and its refinement. */
    const refinedVersion = {
      ...refinableScript,
      id: "refined-script-id-from-db",
      summary: cleanRefinement.summary,
      assumptions: cleanRefinement.assumptions,
      plan: REFINED_PLAN,
      refinement: {
        id: "refinement-id-from-db",
        websiteId: foundWebsite.id,
        actionId: foundAction.id,
        sourceActionScriptId: refinableScript.id,
        actionScriptRunId: sampleRun.id,
        refinedActionScriptId: "refined-script-id-from-db",
        note: NOTE,
        ...cleanRefinement.usage,
        screenshotWasSent: true,
        createdAt: "2026-01-04T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
        deletedAt: null,
        actionScriptRun: {
          id: sampleRun.id,
          errorMessage: sampleRun.errorMessage,
          failedStepNumber: 2,
          timedOut: false,
          failingPageAriaSnapshot: sampleRun.failingPageAriaSnapshot,
        },
      },
    };

    /** How `sampleRun` failed, as Claude is shown it. */
    const expectedFailedRun = {
      errorMessage: sampleRun.errorMessage,
      failedStepNumber: 2,
      timedOut: false,
      output: sampleRun.output,
      failingPageUrl: sampleRun.failingPageUrl,
      failingPageAriaSnapshot: sampleRun.failingPageAriaSnapshot,
    };

    /** The source version's pages as the latest crawl has them, in its `contextPageUrls` order. */
    const expectedSourceContextPages = [
      { url: crawledLoginPage.url, title: crawledLoginPage.title, ariaSnapshot: crawledLoginPage.ariaSnapshot },
      { url: crawledStartPage.url, title: crawledStartPage.title, ariaSnapshot: crawledStartPage.ariaSnapshot },
    ];

    /**
     * Reads the request the controller handed `refineActionPlan`.
     * @param callIndex - Which recorded call to read; the first by default
     * @returns The refinement request of that call
     */
    function readRefinementRequest(callIndex = 0): Record<string, unknown> {
      const [refinementRequest] = mockScriptGenerationService.refineActionPlan.mock.calls[callIndex] as [
        Record<string, unknown>,
      ];
      return refinementRequest;
    }

    beforeEach(() => {
      mockDbService.findActionScriptForAction.mockResolvedValue(refinableScript);
      mockDbService.findActionScriptRunForScript.mockResolvedValue(sampleRun);
      mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([
        crawledStartPage,
        crawledCareersPage,
        crawledLoginPage,
      ]);
      mockScriptGenerationService.refineActionPlan.mockResolvedValue(cleanRefinement);
      mockDbService.createRefinedActionScriptForAction.mockResolvedValue(refinedVersion);
    });

    it("asks the model that wrote the version to fix it from the failed run, then saves the reply as a refined version and returns 201", async () => {
      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(refinedVersion);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-id-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-id-from-path",
      );
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        "script-id-from-path",
      );
      expect(mockDbService.findActionScriptRunForScript).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        refinableScript.id,
        "run-id-from-path",
      );
      expect(mockScriptModelService.findScriptModel).toHaveBeenCalledWith("claude-opus-5-5");
      // The model still offers the version's effort, so it is kept.
      expect(mockScriptModelService.chooseEffortForModel).not.toHaveBeenCalled();
      // The pages come from the newest crawl done the way the VERSION ran (as its credential).
      expect(mockDbService.findLatestCrawledPagesForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      // The action itself now runs logged out: no credential to look up, only the site's origin.
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      // Exact: the version's snapshots (no credential id), the failure, the screenshot, and the note.
      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(
        {
          websiteName: refinableScript.websiteName,
          startUrl: refinableScript.startUrl,
          actionTitle: refinableScript.actionTitle,
          actionDescription: refinableScript.actionDescription,
          credentialName: refinableScript.credentialName,
          allowedOrigins: ["https://example.com"],
          contextPages: expectedSourceContextPages,
          previousSummary: refinableScript.summary,
          previousAssumptions: refinableScript.assumptions,
          previousPlan: refinableScript.plan,
          failedRun: expectedFailedRun,
          failureScreenshotPngBase64: EXISTING_FAILURE_SCREENSHOT_BASE64,
          note: NOTE,
        },
        { model: opusModel, effort: "medium" },
      );
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        {
          websiteName: refinableScript.websiteName,
          startUrl: refinableScript.startUrl,
          actionTitle: refinableScript.actionTitle,
          actionDescription: refinableScript.actionDescription,
          credentialName: refinableScript.credentialName,
          credentialId: refinableScript.credentialId,
          summary: cleanRefinement.summary,
          assumptions: cleanRefinement.assumptions,
          plan: REFINED_PLAN,
          contextPageUrls: [crawledLoginPage.url, crawledStartPage.url],
          modelId: cleanRefinement.modelId,
          effort: cleanRefinement.effort,
          editedFromActionScriptId: null,
        },
        {
          sourceActionScriptId: refinableScript.id,
          actionScriptRunId: sampleRun.id,
          note: NOTE,
          inputTokens: 2408,
          outputTokens: 989,
          cacheReadInputTokens: 9519,
          cacheCreationInputTokens: 1292,
          screenshotWasSent: true,
        },
      );
      expect(mockDbService.createActionScriptForAction).not.toHaveBeenCalled();
    });

    it("refines without a note when no body was sent", async () => {
      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH);

      expect(res.status).toBe(201);
      expect(readRefinementRequest().note).toBeNull();
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.any(Object),
        expect.objectContaining({ note: null }),
      );
    });

    it("sends a trimmed note, and a blank one as no note", async () => {
      const app = createActionScriptsApp();

      await request(app).post(REFINEMENTS_PATH).send({ note: `  ${NOTE}  ` });
      await request(app).post(REFINEMENTS_PATH).send({ note: "   " });

      expect(readRefinementRequest(0).note).toBe(NOTE);
      expect(readRefinementRequest(1).note).toBeNull();
    });

    it("allows the origins of the action's CURRENT credential's login page", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(foundLinkedAction);

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundCredential.id,
      );
      expect(readRefinementRequest().allowedOrigins).toEqual([
        "https://example.com",
        "https://auth.example.com",
      ]);
    });

    it("reads the pages of a logged-out crawl for a version that ran logged out", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...refinableScript,
        credentialId: null,
        credentialName: null,
      });

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(mockDbService.findLatestCrawledPagesForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        null,
      );
      expect(readRefinementRequest().credentialName).toBeNull();
    });

    it("picks the pages afresh from the version's own title and description when the latest crawl has none of its pages", async () => {
      // The version is about the careers page, which the CURRENT action ("Log in") would never pick.
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...refinableScript,
        actionTitle: "See the open roles",
        actionDescription: "Open the careers page and read the open roles",
        contextPageUrls: ["https://example.com/removed-page"],
      });

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(readRefinementRequest().contextPages).toEqual([
        { url: crawledStartPage.url, title: crawledStartPage.title, ariaSnapshot: crawledStartPage.ariaSnapshot },
        { url: crawledCareersPage.url, title: crawledCareersPage.title, ariaSnapshot: crawledCareersPage.ariaSnapshot },
      ]);
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ contextPageUrls: [crawledStartPage.url, crawledCareersPage.url] }),
        expect.any(Object),
      );
    });

    it("sends no pages, and saves none, when the website was never crawled", async () => {
      mockDbService.findLatestCrawledPagesForWebsite.mockResolvedValue([]);

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(readRefinementRequest().contextPages).toEqual([]);
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ contextPageUrls: [] }),
        expect.any(Object),
      );
    });

    it("falls back to the model's default effort when the model no longer offers the version's effort", async () => {
      const opusWithoutXhigh = { ...opusModel, effortLevels: ["low", "medium", "high", "max"] };
      mockScriptModelService.findScriptModel.mockResolvedValue(opusWithoutXhigh);
      mockScriptModelService.chooseEffortForModel.mockReturnValue("high");
      mockDbService.findActionScriptForAction.mockResolvedValue({ ...refinableScript, effort: "xhigh" });

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(mockScriptModelService.chooseEffortForModel).toHaveBeenCalledWith(opusWithoutXhigh, null);
      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(expect.any(Object), {
        model: opusWithoutXhigh,
        effort: "high",
      });
    });

    it("keeps no effort level for a model with no effort setting that wrote the version at Standard", async () => {
      mockScriptModelService.findScriptModel.mockResolvedValue(haikuModel);
      mockDbService.findActionScriptForAction.mockResolvedValue({
        ...refinableScript,
        modelId: haikuModel.id,
        effort: null,
      });
      mockScriptGenerationService.refineActionPlan.mockResolvedValue({
        ...cleanRefinement,
        modelId: haikuModel.id,
        effort: null,
      });

      const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(res.status).toBe(201);
      expect(mockScriptModelService.findScriptModel).toHaveBeenCalledWith(haikuModel.id);
      expect(mockScriptModelService.chooseEffortForModel).not.toHaveBeenCalled();
      expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledWith(expect.any(Object), {
        model: haikuModel,
        effort: null,
      });
      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.objectContaining({ modelId: haikuModel.id, effort: null }),
        expect.any(Object),
      );
    });

    it("records the token usage and screenshot flag the refinement reports", async () => {
      mockScriptGenerationService.refineActionPlan.mockResolvedValue({
        ...cleanRefinement,
        usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        screenshotWasSent: false,
      });

      await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(mockDbService.createRefinedActionScriptForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundAction.id,
        expect.any(Object),
        expect.objectContaining({
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          screenshotWasSent: false,
        }),
      );
    });

    it("sends a run that timed out before its first step as such", async () => {
      mockDbService.findActionScriptRunForScript.mockResolvedValue({
        ...sampleRun,
        timedOut: true,
        errorMessage: "The run hit the 5 minute time limit and was stopped",
        failedStepNumber: null,
        failingPageUrl: null,
        failingPageAriaSnapshot: null,
      });

      await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

      expect(readRefinementRequest().failedRun).toEqual({
        errorMessage: "The run hit the 5 minute time limit and was stopped",
        failedStepNumber: null,
        timedOut: true,
        output: sampleRun.output,
        failingPageUrl: null,
        failingPageAriaSnapshot: null,
      });
    });

    describe("the failure screenshot", () => {
      it("sends no screenshot when the run captured none", async () => {
        mockDbService.findActionScriptRunForScript.mockResolvedValue({
          ...sampleRun,
          failureScreenshotFileName: null,
        });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(201);
        expect(readRefinementRequest().failureScreenshotPngBase64).toBeNull();
      });

      it("refines without the screenshot when its file is gone from disk", async () => {
        mockDbService.findActionScriptRunForScript.mockResolvedValue({
          ...sampleRun,
          failureScreenshotFileName: "website-id-from-db/deleted-run/failure.png",
        });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(201);
        expect(readRefinementRequest().failureScreenshotPngBase64).toBeNull();
      });

      it.each([
        ["climbs out of the directory with ..", "../screenshot-files/website-id-from-db/existing-run.png"],
        ["is an absolute path", PNG_OUTSIDE_THE_ACTION_SCRIPT_DIRECTORY],
      ])(
        "never reads a stored name that %s, and refines without it",
        async (_label, failureScreenshotFileName) => {
          mockDbService.findActionScriptRunForScript.mockResolvedValue({
            ...sampleRun,
            failureScreenshotFileName,
          });

          const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

          expect(res.status).toBe(201);
          expect(readRefinementRequest().failureScreenshotPngBase64).toBeNull();
        },
      );

      it("reads a stored name whose .. segments still resolve inside the directory", async () => {
        mockDbService.findActionScriptRunForScript.mockResolvedValue({
          ...sampleRun,
          failureScreenshotFileName: `website-id-from-db/../${EXISTING_FAILURE_SCREENSHOT_NAME}`,
        });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(201);
        expect(readRefinementRequest().failureScreenshotPngBase64).toBe(
          EXISTING_FAILURE_SCREENSHOT_BASE64,
        );
      });

      it("reads the screenshot when the action script directory is the filesystem root, whose path already ends in a separator", async () => {
        const filesystemRoot = path.parse(FIXTURE_ACTION_SCRIPT_DIRECTORY).root;
        const appOnTheFilesystemRoot = express();
        appOnTheFilesystemRoot.use(express.json());
        registerActionScriptRoutes(appOnTheFilesystemRoot, filesystemRoot);
        mockDbService.findActionScriptRunForScript.mockResolvedValue({
          ...sampleRun,
          failureScreenshotFileName: path.relative(
            filesystemRoot,
            path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, EXISTING_FAILURE_SCREENSHOT_NAME),
          ),
        });

        const res = await request(appOnTheFilesystemRoot).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(201);
        expect(readRefinementRequest().failureScreenshotPngBase64).toBe(
          EXISTING_FAILURE_SCREENSHOT_BASE64,
        );
      });

      it("returns 500, refines nothing, and accepts the next refine when the stored name cannot be read for another reason", async () => {
        mockDbService.findActionScriptRunForScript.mockResolvedValueOnce({
          ...sampleRun,
          failureScreenshotFileName: "website-id-from-db",
        });
        const app = createActionScriptsApp();

        const res = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(500);
        expect((res.body as { error: string }).error).toMatch(/^EISDIR/);
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
        expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();

        const nextRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });
        expect(nextRefineResponse.status).toBe(201);
      });
    });

    describe("400 for a bad body, before any lookup", () => {
      it.each([
        ["the body is an array", ["Try again"], "The request body must be a JSON object"],
        ["the note is a number", { note: 42 }, "The note must be text"],
        ["the note is over 2000 characters", { note: "n".repeat(2001) }, "The note must be at most 2000 characters"],
      ])("returns 400 when %s", async (_label, body, expectedMessage) => {
        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send(body);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: expectedMessage });
        expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });

      it("accepts a note of exactly 2000 characters", async () => {
        const longestNote = "n".repeat(2000);

        const res = await request(createActionScriptsApp())
          .post(REFINEMENTS_PATH)
          .send({ note: longestNote });

        expect(res.status).toBe(201);
        expect(readRefinementRequest().note).toBe(longestNote);
      });
    });

    describe("404 for a missing parent, in lookup order", () => {
      it("returns 404 Website not found and looks up no action", async () => {
        mockDbService.findWebsiteById.mockResolvedValue(null);

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Website not found" });
        expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });

      it("returns 404 Action not found and looks up no version", async () => {
        mockDbService.findActionForWebsite.mockResolvedValue(null);

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Action not found" });
        expect(mockDbService.findActionScriptForAction).not.toHaveBeenCalled();
      });

      it("returns 404 Script not found and looks up no run", async () => {
        mockDbService.findActionScriptForAction.mockResolvedValue(null);

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Script not found" });
        expect(mockDbService.findActionScriptRunForScript).not.toHaveBeenCalled();
      });

      it("returns 404 Script run not found and asks no model", async () => {
        mockDbService.findActionScriptRunForScript.mockResolvedValue(null);

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Script run not found" });
        expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });
    });

    describe("409 when the run cannot be refined", () => {
      it.each([
        ["passed", { succeeded: true, errorMessage: null, failedStepNumber: null }],
        ["failed but recorded no error", { succeeded: false, errorMessage: null }],
        ["passed yet carries an error", { succeeded: true }],
      ])("returns 409 and asks no model when the run %s", async (_label, runOverrides) => {
        mockDbService.findActionScriptRunForScript.mockResolvedValue({ ...sampleRun, ...runOverrides });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: ONLY_A_FAILED_RUN_MESSAGE });
        expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });

      it("returns 409 and asks no model when the version was saved from the step editor", async () => {
        mockDbService.findActionScriptForAction.mockResolvedValue({
          ...refinableScript,
          modelId: null,
          effort: null,
          editedFromActionScriptId: "source-script-id",
        });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: EDITED_VERSION_MESSAGE });
        expect(mockScriptModelService.findScriptModel).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });

      it("checks that the run failed before checking who wrote the version", async () => {
        mockDbService.findActionScriptForAction.mockResolvedValue({ ...refinableScript, modelId: null });
        mockDbService.findActionScriptRunForScript.mockResolvedValue({
          ...sampleRun,
          succeeded: true,
          errorMessage: null,
        });

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: ONLY_A_FAILED_RUN_MESSAGE });
      });

      it("returns 409, reads nothing more, and accepts the next refine when the model that wrote the version is no longer offered", async () => {
        mockScriptModelService.findScriptModel.mockResolvedValueOnce(null);
        const app = createActionScriptsApp();

        const res = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error:
            "The model that wrote this version (claude-opus-5-5) is no longer offered, so it cannot refine it; convert the action again",
        });
        expect(mockDbService.findLatestCrawledPagesForWebsite).not.toHaveBeenCalled();
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
        expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();

        const nextRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });
        expect(nextRefineResponse.status).toBe(201);
      });

      it("returns 409 for a second refine of the same run while the first is still going, then accepts refines again once it ends", async () => {
        const firstRefinement = createDeferred<typeof cleanRefinement>();
        mockScriptGenerationService.refineActionPlan.mockReturnValueOnce(firstRefinement.promise);
        const app = createActionScriptsApp();

        const firstRefineResponse = request(app)
          .post(REFINEMENTS_PATH)
          .send({ note: NOTE })
          .then((response) => response);
        await vi.waitFor(() => {
          expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledTimes(1);
        });

        const secondRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(secondRefineResponse.status).toBe(409);
        expect(secondRefineResponse.body).toEqual({ error: ALREADY_BEING_REFINED_MESSAGE });
        expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledTimes(1);

        firstRefinement.resolve(cleanRefinement);
        expect((await firstRefineResponse).status).toBe(201);

        const refineAfterTheFirstEnded = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });
        expect(refineAfterTheFirstEnded.status).toBe(201);
        expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledTimes(2);
      });

      it("refines another run while one run is still being refined", async () => {
        const firstRefinement = createDeferred<typeof cleanRefinement>();
        mockScriptGenerationService.refineActionPlan.mockReturnValueOnce(firstRefinement.promise);
        const app = createActionScriptsApp();

        const firstRefineResponse = request(app)
          .post(REFINEMENTS_PATH)
          .send({ note: NOTE })
          .then((response) => response);
        await vi.waitFor(() => {
          expect(mockScriptGenerationService.refineActionPlan).toHaveBeenCalledTimes(1);
        });
        mockDbService.findActionScriptRunForScript.mockResolvedValueOnce({
          ...sampleRun,
          id: "another-run-id-from-db",
        });

        const otherRunRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(otherRunRefineResponse.status).toBe(201);
        firstRefinement.resolve(cleanRefinement);
        expect((await firstRefineResponse).status).toBe(201);
      });

      it("accepts the next refine of a run after Claude failed to refine it", async () => {
        mockScriptGenerationService.refineActionPlan.mockRejectedValueOnce(
          buildScriptGenerationError("refused", "Claude declined"),
        );
        const app = createActionScriptsApp();

        const failedRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });
        const nextRefineResponse = await request(app).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(failedRefineResponse.status).toBe(502);
        expect(nextRefineResponse.status).toBe(201);
      });
    });

    describe("Claude and database failures", () => {
      it("returns 503 and saves nothing when the API key is not configured", async () => {
        mockScriptGenerationService.refineActionPlan.mockRejectedValue(
          buildScriptGenerationError("missingApiKey", "ANTHROPIC_API_KEY is not set"),
        );

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: "ANTHROPIC_API_KEY is not set" });
        expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
      });

      it("returns 503 when the model catalog cannot be read without an API key", async () => {
        mockScriptModelService.findScriptModel.mockRejectedValue(
          buildScriptGenerationError("missingApiKey", "ANTHROPIC_API_KEY is not set"),
        );

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(503);
        expect(mockScriptGenerationService.refineActionPlan).not.toHaveBeenCalled();
      });

      it.each(["refused", "truncated", "unparseable"])(
        "returns 502 and saves nothing when Claude's reply is unusable (%s)",
        async (reason) => {
          mockScriptGenerationService.refineActionPlan.mockRejectedValue(
            buildScriptGenerationError(reason, `Claude failed: ${reason}`),
          );

          const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

          expect(res.status).toBe(502);
          expect(res.body).toEqual({ error: `Claude failed: ${reason}` });
          expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
        },
      );

      it("returns 500 and saves nothing for an Anthropic API error", async () => {
        mockScriptGenerationService.refineActionPlan.mockRejectedValue(new Error("rate limited"));

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "rate limited" });
        expect(mockDbService.createRefinedActionScriptForAction).not.toHaveBeenCalled();
      });

      it("returns 500 with the error message when the refined version cannot be saved", async () => {
        mockDbService.createRefinedActionScriptForAction.mockRejectedValue(new Error("insert failed"));

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "insert failed" });
      });

      it("returns 500 with the error message when the run lookup fails", async () => {
        mockDbService.findActionScriptRunForScript.mockRejectedValue(new Error("db down"));

        const res = await request(createActionScriptsApp()).post(REFINEMENTS_PATH).send({ note: NOTE });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "db down" });
      });
    });
  });
});
