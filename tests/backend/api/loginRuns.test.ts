import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the login run controller (and its shared lookups) imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  findActionForWebsite: vi.fn(),
  listLoginRunsForAction: vi.fn(),
  findLoginRunForAction: vi.fn(),
}));

/** Running a login is replaced outright: no spec ever launches Chromium or decrypts a password. */
const mockLoginRunService = vi.hoisted(() => ({
  performLoginRun: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced. The
// one-run-per-action claim (`claimActionRun`, shared with plan runs) stays
// real, so a test can prove a login waits for a run of the same action.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/loginRunService.js", () => mockLoginRunService);

import { registerLoginRunRoutes } from "../../../server/controllers/loginRuns.js";
import {
  ActionScriptRequestProblem,
  claimActionRun,
  releaseActionRun,
} from "../../../server/services/actionScriptExecutionService.js";

/**
 * The committed directory standing in for ACTION_SCRIPT_DIR (shared with the
 * action script route spec). It holds one real PNG at
 * `website-id-from-db/existing-run/failure.png`, so the screenshot route is
 * exercised through the real `res.sendFile`.
 */
const FIXTURE_ACTION_SCRIPT_DIRECTORY = path.join(
  process.cwd(),
  "tests",
  "backend",
  "fixtures",
  "action-script-files",
);
const EXISTING_SCREENSHOT_NAME = "website-id-from-db/existing-run/failure.png";
const EXISTING_SCREENSHOT_BYTES = readFileSync(path.join(FIXTURE_ACTION_SCRIPT_DIRECTORY, EXISTING_SCREENSHOT_NAME));

/**
 * Builds a minimal app carrying only the login run routes, mounted the same
 * way server.ts mounts them, with the fixture directory as the action script
 * directory.
 * @returns An app with JSON body parsing and the login run routes registered
 */
function createLoginRunsApp(): Express {
  const app = express();
  app.use(express.json());
  registerLoginRunRoutes(app, FIXTURE_ACTION_SCRIPT_DIRECTORY);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const ACTION_ALREADY_RUNNING_MESSAGE =
  "This action is already running; wait for that run to finish before starting another";
const LOGIN_RUN_NOT_FOUND_MESSAGE = "Login run not found";
const LOGIN_RUN_HAS_NO_SCREENSHOT_MESSAGE = "This login run could not take a screenshot";
const LOGIN_RUN_SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Login run screenshot file not found";

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove later queries use the FOUND
// rows' ids, not the raw path parameters.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const REQUESTED_ACTION_ID = "action-id-from-path";
const REQUESTED_LOGIN_RUN_ID = "login-run-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 7000,
  screenshotMinimumWaitMs: 250,
  loginUrl: "https://example.com/login",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
/** The website's Login action, logging in on the website's login page as whichever credential is picked. */
const foundLoginAction = {
  id: "login-action-id-from-db",
  websiteId: foundWebsite.id,
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Signs in with the picked account",
  userActionKind: "login",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
  credential: null,
};
/** The credential a "Run login" request picks. */
const PICKED_CREDENTIAL_ID = "credential-id-from-db";
/** The body of a "Run login" request: the credential to log in as. */
const LOGIN_RUN_BODY = { credentialId: PICKED_CREDENTIAL_ID };
/** One recorded login run of it, with the fixture PNG as its screenshot. */
const sampleLoginRun = {
  id: "login-run-id-from-db",
  websiteId: foundWebsite.id,
  actionId: foundLoginAction.id,
  credentialName: "Admin",
  loginUrl: "https://example.com/login",
  succeeded: true,
  errorMessage: null,
  screenshotFileName: EXISTING_SCREENSHOT_NAME,
  finalPageUrl: "https://example.com/dashboard",
  output: 'Log in with "Log in" as "Admin" on https://example.com/login\n✔ Logged in',
  durationMs: 2100,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
};

const LOGIN_RUNS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/actions/${REQUESTED_ACTION_ID}/login-runs`;
const SCREENSHOT_PATH = `${LOGIN_RUNS_PATH}/${REQUESTED_LOGIN_RUN_ID}/screenshot`;

/** A value whose promise the test settles by hand. */
interface Deferred<TValue> {
  /** The pending promise. */
  promise: Promise<TValue>;
  /** Settles the promise with a value. */
  resolve: (value: TValue) => void;
}

/**
 * Builds a promise that stays pending until the test resolves it - for a
 * login that is still running while a second request arrives.
 * @returns The promise and its resolver
 */
function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: (value: TValue) => void = () => undefined;
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("Login run routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Every route checks its parents first; they exist unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(foundLoginAction);
    mockDbService.findLoginRunForAction.mockResolvedValue(sampleLoginRun);
  });

  describe("GET /api/websites/:websiteId/actions/:actionId/login-runs", () => {
    it("returns 200 with the Login action's login runs, looked up under the found website and action", async () => {
      mockDbService.listLoginRunsForAction.mockResolvedValue([sampleLoginRun]);

      const res = await request(createLoginRunsApp()).get(LOGIN_RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleLoginRun]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, REQUESTED_ACTION_ID);
      expect(mockDbService.listLoginRunsForAction).toHaveBeenCalledWith(foundWebsite.id, foundLoginAction.id);
    });

    it("returns 200 with no runs for an action that has none (any other action)", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue({ ...foundLoginAction, userActionKind: "create" });
      mockDbService.listLoginRunsForAction.mockResolvedValue([]);

      const res = await request(createLoginRunsApp()).get(LOGIN_RUNS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 Website not found and looks up no action when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).get(LOGIN_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.listLoginRunsForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when the action does not exist or was deleted", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).get(LOGIN_RUNS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockDbService.listLoginRunsForAction).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listLoginRunsForAction.mockRejectedValue(new Error("connection lost"));

      const res = await request(createLoginRunsApp()).get(LOGIN_RUNS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });

  describe("POST /api/websites/:websiteId/actions/:actionId/login-runs", () => {
    it("runs the found Login action's login as the picked credential, with the action script directory, and answers 201 with the recorded run", async () => {
      mockLoginRunService.performLoginRun.mockResolvedValue(sampleLoginRun);

      const res = await request(createLoginRunsApp())
        .post(LOGIN_RUNS_PATH)
        .send({ credentialId: `  ${PICKED_CREDENTIAL_ID} ` });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleLoginRun);
      expect(mockLoginRunService.performLoginRun).toHaveBeenCalledWith(
        FIXTURE_ACTION_SCRIPT_DIRECTORY,
        foundWebsite,
        foundLoginAction,
        PICKED_CREDENTIAL_ID,
      );
    });

    it.each([
      ["no body at all", undefined, "The request body must be a JSON object with the credential to log in as"],
      ["a body that is an array", [PICKED_CREDENTIAL_ID], "The request body must be a JSON object with the credential to log in as"],
      ["an empty object", {}, "Pick the credential to log in as"],
      ["a null credential id", { credentialId: null }, "Pick the credential to log in as"],
      ["a blank credential id", { credentialId: "   " }, "The credential id must be a non-blank string"],
      ["a credential id that is a number", { credentialId: 42 }, "The credential id must be a non-blank string"],
    ])("returns 400 and looks nothing up for %s", async (_label, body, errorMessage) => {
      const pendingRequest = request(createLoginRunsApp()).post(LOGIN_RUNS_PATH);
      const res = body === undefined ? await pendingRequest : await pendingRequest.send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: errorMessage });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
      expect(mockLoginRunService.performLoginRun).not.toHaveBeenCalled();
    });

    it("still answers 201 for a login that failed, with succeeded false", async () => {
      const failedLoginRun = {
        ...sampleLoginRun,
        succeeded: false,
        errorMessage: "Still on the login form after submitting - check the username and password",
      };
      mockLoginRunService.performLoginRun.mockResolvedValue(failedLoginRun);

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(failedLoginRun);
    });

    it.each([
      [409, "Only a login action can run a login on its own; this action's kind is not Login"],
      [400, "That credential is not one of this website's; pick one of its credentials to log in as"],
      [400, 'The login action "Log in" has no login page URL, and neither does its website; add one to log in'],
      [503, "CREDENTIAL_ENCRYPTION_KEY is not set"],
    ] as const)("answers %i with the reason when the login cannot be started (%s)", async (httpStatus, message) => {
      mockLoginRunService.performLoginRun.mockRejectedValue(new ActionScriptRequestProblem(httpStatus, message));

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(httpStatus);
      expect(res.body).toEqual({ error: message });
    });

    it("returns 500 with the error message when the login cannot be run or recorded", async () => {
      mockLoginRunService.performLoginRun.mockRejectedValue(new Error("browserType.launch: Executable doesn't exist"));

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "browserType.launch: Executable doesn't exist" });
    });

    it("returns 409 for a second login of the same action while the first is still running, then accepts logins again once it ends", async () => {
      const firstLogin = createDeferred<typeof sampleLoginRun>();
      mockLoginRunService.performLoginRun.mockReturnValueOnce(firstLogin.promise).mockResolvedValue(sampleLoginRun);
      const app = createLoginRunsApp();

      const firstResponsePromise = request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY).then((response) => response);
      await vi.waitFor(() => {
        expect(mockLoginRunService.performLoginRun).toHaveBeenCalledTimes(1);
      });
      const secondResponse = await request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);
      firstLogin.resolve(sampleLoginRun);
      const firstResponse = await firstResponsePromise;
      const thirdResponse = await request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toEqual({ error: ACTION_ALREADY_RUNNING_MESSAGE });
      expect(firstResponse.status).toBe(201);
      expect(thirdResponse.status).toBe(201);
      expect(mockLoginRunService.performLoginRun).toHaveBeenCalledTimes(2);
    });

    it("returns 409 and logs nothing in while a plan run of the same action holds it", async () => {
      const planRunClaimedTheAction = claimActionRun(foundLoginAction.id);

      try {
        const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

        expect(planRunClaimedTheAction).toBe(true);
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: ACTION_ALREADY_RUNNING_MESSAGE });
        expect(mockLoginRunService.performLoginRun).not.toHaveBeenCalled();
      } finally {
        releaseActionRun(foundLoginAction.id);
      }
    });

    it("accepts the next login after one was refused or failed", async () => {
      mockLoginRunService.performLoginRun
        .mockRejectedValueOnce(new ActionScriptRequestProblem(400, "no login page"))
        .mockRejectedValueOnce(new Error("insert failed"))
        .mockResolvedValue(sampleLoginRun);
      const app = createLoginRunsApp();

      const refusedResponse = await request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);
      const failedResponse = await request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);
      const nextResponse = await request(app).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(refusedResponse.status).toBe(400);
      expect(failedResponse.status).toBe(500);
      expect(nextResponse.status).toBe(201);
    });

    it("returns 404 Website not found and runs nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockLoginRunService.performLoginRun).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and runs nothing when the action does not exist or was deleted", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockLoginRunService.performLoginRun).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection lost"));

      const res = await request(createLoginRunsApp()).post(LOGIN_RUNS_PATH).send(LOGIN_RUN_BODY);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
      expect(mockLoginRunService.performLoginRun).not.toHaveBeenCalled();
    });
  });

  describe("GET .../login-runs/:loginRunId/screenshot", () => {
    it("returns 200 with the PNG bytes, looking the run up under the found rows", async () => {
      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(res.body as Buffer, EXISTING_SCREENSHOT_BYTES)).toBe(0);
      expect(mockDbService.findLoginRunForAction).toHaveBeenCalledWith(
        foundWebsite.id,
        foundLoginAction.id,
        REQUESTED_LOGIN_RUN_ID,
      );
    });

    it("returns 404 Website not found and looks up no run when the website does not exist", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findLoginRunForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found and looks up no run when the action does not exist", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
      expect(mockDbService.findLoginRunForAction).not.toHaveBeenCalled();
    });

    it("returns 404 Login run not found when the run does not exist, was deleted, or is another action's", async () => {
      mockDbService.findLoginRunForAction.mockResolvedValue(null);

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: LOGIN_RUN_NOT_FOUND_MESSAGE });
    });

    it("returns 404 when the run could not take a screenshot", async () => {
      mockDbService.findLoginRunForAction.mockResolvedValue({ ...sampleLoginRun, screenshotFileName: null });

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: LOGIN_RUN_HAS_NO_SCREENSHOT_MESSAGE });
    });

    it("returns 404 Login run screenshot file not found when the file is gone from disk", async () => {
      mockDbService.findLoginRunForAction.mockResolvedValue({
        ...sampleLoginRun,
        screenshotFileName: "website-id-from-db/deleted-run/logged-in.png",
      });

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: LOGIN_RUN_SCREENSHOT_FILE_NOT_FOUND_MESSAGE });
    });

    it("refuses a stored name that climbs out of the action script directory, serving no file", async () => {
      mockDbService.findLoginRunForAction.mockResolvedValue({
        ...sampleLoginRun,
        screenshotFileName: "../action-script-files/website-id-from-db/existing-run/failure.png",
      });

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 500 with the error message when the run lookup fails", async () => {
      mockDbService.findLoginRunForAction.mockRejectedValue(new Error("connection lost"));

      const res = await request(createLoginRunsApp()).get(SCREENSHOT_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });
});
