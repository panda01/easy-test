import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the action controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listActionsForWebsite: vi.fn(),
  findActionForWebsite: vi.fn(),
  createActionForWebsite: vi.fn(),
  updateActionForWebsite: vi.fn(),
  softDeleteActionForWebsite: vi.fn(),
  findCredentialForWebsite: vi.fn(),
  findActionCleanupForCreateAction: vi.fn(),
  linkActionCleanup: vi.fn(),
  listActionCleanupsForWebsite: vi.fn(),
  /** The website's one Login action; answers null - the website has none - unless a test says otherwise. */
  findLoginActionForWebsite: vi.fn(),
}));

/** The parameter service is replaced: its own spec covers what it reads and syncs. */
const mockActionParameterService = vi.hoisted(() => ({
  loadActionRole: vi.fn(),
  syncActionParametersQuietly: vi.fn(),
}));

/** Claude's delete-action proposal is replaced: its own spec covers the call. */
const mockDeleteActionGenerationService = vi.hoisted(() => ({ proposeDeleteAction: vi.fn() }));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/actionParameterService.js", () => mockActionParameterService);
vi.mock("../../../server/services/deleteActionGenerationService.js", () => mockDeleteActionGenerationService);

import { registerActionRoutes, describeWebsiteAlreadyHasALoginAction } from "../../../server/controllers/actions.js";

/**
 * Builds a minimal app carrying only the action routes, mounted the same way
 * server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the action routes registered
 */
function createActionsApp(): Express {
  const app = express();
  app.use(express.json());
  registerActionRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const CREDENTIAL_NOT_ON_WEBSITE_MESSAGE =
  "That credential does not exist on this website; pick one of the website's credentials";
const LOGIN_ACTION_NEEDS_A_LOGIN_PAGE_MESSAGE =
  "This login action has no login page URL, and neither does the website; add one to either";
const CREDENTIAL_ID_INVALID_MESSAGE =
  "The credential id must be a non-blank string, or null to run logged out";
const LOGIN_ACTION_HAS_NO_CREDENTIAL_MESSAGE =
  "A login action logs in as whichever credential the action or crawl picks, so it has no credential of its own";

// The id in the request path and the id on the row the lookup returns are
// deliberately different, so each test can prove the child query is scoped by
// the FOUND website's id rather than by the raw path parameter.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  /** No default login page: a Login action here must bring its own. */
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

/** What the single-action routes add: the action's object role (shape only; see `scoreActionObjectRole`). */
const SAMPLE_OBJECT_ROLE = { kind: "parameters", kindSource: "detected", warnings: [] };

/** What an action body leaves as "detect" when it names no object role choice. */
const DETECT_EVERY_ROLE_CHOICE = {
  userActionKind: null,
  userObjectTypeKey: null,
  userNameParameterKey: null,
};

/** The login fields of an action body that runs logged out and is not the Login action, as the validator hands them on. */
const NO_LOGIN_CHOICES = {
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
};

const ACTIONS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/actions`;
const ACTION_PATH = `${ACTIONS_PATH}/action-1`;

// Dates are ISO strings because that is how they cross the wire.
const sampleAction = {
  id: "action-1",
  websiteId: foundWebsite.id,
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  title: "Log in",
  description: "Enter credentials and submit the form",
  userActionKind: null,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  deletedAt: null,
  credential: null,
};

/** One of the found website's credentials, as the password-free lookup returns it. */
const foundCredential = {
  id: "credential-id-from-db",
  websiteId: foundWebsite.id,
  name: "Admin",
  description: null,
  username: "admin@example.com",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

/** The found website's one Login action: it logs in on its own login page, as whichever credential is picked. */
const foundLoginAction = {
  ...sampleAction,
  id: "login-action-id-from-db",
  title: "Log in",
  description: "Signs in with the picked account",
  userActionKind: "login",
  loginUrl: "https://example.com/login",
};

/** The same action running as `foundCredential` (it logs in through the website's Login action first). */
const sampleActionRunningAsCredential = {
  ...sampleAction,
  credentialId: foundCredential.id,
  credential: { id: foundCredential.id, name: foundCredential.name },
};

/** A Login action body: its own login page and one selector, and no credential. */
const loginActionBody = {
  title: " Log in ",
  description: "Signs in with the picked account",
  userActionKind: "login",
  loginUrl: " https://example.com/login ",
  usernameSelector: " #email ",
};

/** What the validator hands on for `loginActionBody`. */
const loginActionInput = {
  title: "Log in",
  description: "Signs in with the picked account",
  ...DETECT_EVERY_ROLE_CHOICE,
  ...NO_LOGIN_CHOICES,
  userActionKind: "login",
  loginUrl: "https://example.com/login",
  usernameSelector: "#email",
};

/** Why a second Login action is refused while `foundLoginAction` exists. */
const WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE = `This website already has a login action: "${foundLoginAction.title}"`;

describe("action routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockActionParameterService.loadActionRole.mockResolvedValue(SAMPLE_OBJECT_ROLE);
    mockActionParameterService.syncActionParametersQuietly.mockResolvedValue(undefined);
    // Every route checks the website first; it exists unless a test says not.
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    // No action is linked to another unless a test says so.
    mockDbService.listActionCleanupsForWebsite.mockResolvedValue([]);
    mockDbService.findActionCleanupForCreateAction.mockResolvedValue(null);
    // The website has no Login action unless a test says so.
    mockDbService.findLoginActionForWebsite.mockResolvedValue(null);
  });

  describe("GET /api/websites/:websiteId/actions", () => {
    it("returns 200 with the website's actions, listed by the found website's id", async () => {
      mockDbService.listActionsForWebsite.mockResolvedValue([sampleAction]);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ ...sampleAction, deleteAction: null, createActions: [] }]);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listActionsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("answers each action with its newestScript - the newest version's number, the text it was generated from, and its latest run, or null without versions", async () => {
      const passedLatestRun = {
        id: "run-1",
        succeeded: true,
        failedStepNumber: null,
        timedOut: false,
        createdAt: "2026-01-05T00:00:00.000Z",
      };
      const generatedFromText = {
        actionTitle: sampleAction.title,
        actionDescription: sampleAction.description,
        credentialId: null,
      };
      const actionsWithNewestScripts = [
        {
          ...sampleAction,
          id: "action-passing",
          newestScript: { id: "script-a", versionNumber: 3, ...generatedFromText, latestRun: passedLatestRun },
        },
        {
          ...sampleAction,
          id: "action-not-run",
          newestScript: { id: "script-b", versionNumber: 1, ...generatedFromText, latestRun: null },
        },
        { ...sampleAction, id: "action-without-versions", newestScript: null },
      ];
      mockDbService.listActionsForWebsite.mockResolvedValue(actionsWithNewestScripts);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        actionsWithNewestScripts.map((action) => ({ ...action, deleteAction: null, createActions: [] })),
      );
    });

    it("names each action's cleanup links from the website's links, read once", async () => {
      const createAction = { ...sampleAction, id: "action-create", title: "Create a project" };
      const deleteAction = { ...sampleAction, id: "action-delete", title: "Delete the project" };
      mockDbService.listActionsForWebsite.mockResolvedValue([createAction, deleteAction, sampleAction]);
      mockDbService.listActionCleanupsForWebsite.mockResolvedValue([
        {
          id: "cleanup-1",
          createActionId: "action-create",
          deleteActionId: "action-delete",
          createAction: { id: "action-create", title: "Create a project" },
          deleteAction: { id: "action-delete", title: "Delete the project" },
        },
      ]);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { ...createAction, deleteAction: { id: "action-delete", title: "Delete the project" }, createActions: [] },
        { ...deleteAction, deleteAction: null, createActions: [{ id: "action-create", title: "Create a project" }] },
        { ...sampleAction, deleteAction: null, createActions: [] },
      ]);
      expect(mockDbService.listActionCleanupsForWebsite).toHaveBeenCalledTimes(1);
      expect(mockDbService.listActionCleanupsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("returns 404 Website not found and lists nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listActionsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website lookup fails", async () => {
      mockDbService.findWebsiteById.mockRejectedValue(new Error("connection refused"));

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });

    it("returns 500 with the stringified value when the list query rejects with a non-Error", async () => {
      mockDbService.listActionsForWebsite.mockRejectedValue(503);

      const res = await request(createActionsApp()).get(ACTIONS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "503" });
    });
  });

  describe("POST /api/websites/:websiteId/actions", () => {
    it("returns 201 with the created action, created under the found website with trimmed input", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: " Log in  ", description: "  Enter credentials and submit the form " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...sampleAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Log in",
        description: "Enter credentials and submit the form",
        ...NO_LOGIN_CHOICES,
        ...DETECT_EVERY_ROLE_CHOICE,
      });
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      // Only a Login action is checked against the website's Login action.
      expect(mockDbService.findLoginActionForWebsite).not.toHaveBeenCalled();
    });

    it("creates an action that runs as one of the found website's credentials, trimming the credential id", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(foundCredential);
      mockDbService.createActionForWebsite.mockResolvedValue(sampleActionRunningAsCredential);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({
          title: "Log in",
          description: "Enter credentials and submit the form",
          credentialId: `  ${foundCredential.id} `,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ...sampleActionRunningAsCredential,
        objectRole: SAMPLE_OBJECT_ROLE,
        deleteAction: null,
        createActions: [],
      });
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(foundWebsite.id, foundCredential.id);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Log in",
        description: "Enter credentials and submit the form",
        ...NO_LOGIN_CHOICES,
        credentialId: foundCredential.id,
        ...DETECT_EVERY_ROLE_CHOICE,
      });
      expect(mockDbService.findLoginActionForWebsite).not.toHaveBeenCalled();
    });

    it("creates an action that runs logged out when the credential id is null", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials", credentialId: null });

      expect(res.status).toBe(201);
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Log in",
        description: "Enter credentials",
        ...NO_LOGIN_CHOICES,
        ...DETECT_EVERY_ROLE_CHOICE,
      });
    });

    it("returns 400 and creates nothing when the credential is not an active credential of the found website", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({
          title: "Log in",
          description: "Enter credentials",
          credentialId: "credential-of-another-website",
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_ON_WEBSITE_MESSAGE });
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "credential-of-another-website",
      );
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it.each([
      ["a number", 42],
      ["blank", "   "],
      ["an object", { id: "credential-1" }],
    ])(
      "returns 400 and does not touch the database when the credential id is %s",
      async (_label, credentialId) => {
        const res = await request(createActionsApp())
          .post(ACTIONS_PATH)
          .send({ title: "Log in", description: "Enter credentials", credentialId });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: CREDENTIAL_ID_INVALID_MESSAGE });
        expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
        expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
        expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
      },
    );

    it("returns 400 and does not touch the database when an action that is not a Login action has a login page URL", async () => {
      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials", loginUrl: "https://example.com/login" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Only a login action has a login page URL or login form selectors" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the credential lookup fails", async () => {
      mockDbService.findCredentialForWebsite.mockRejectedValue(new Error("credential lookup failed"));

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials", credentialId: foundCredential.id });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "credential lookup failed" });
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("creates the website's Login action on its own login page, with its selectors and no credential, when the website has none", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(foundLoginAction);

      const res = await request(createActionsApp()).post(ACTIONS_PATH).send(loginActionBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ...foundLoginAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith(foundWebsite.id);
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, loginActionInput);
    });

    it("creates a Login action with no login page of its own on a website that has one (it uses the website's)", async () => {
      const websiteWithLoginUrl = { ...foundWebsite, loginUrl: "https://example.com/sign-in" };
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);
      mockDbService.createActionForWebsite.mockResolvedValue({ ...foundLoginAction, loginUrl: null });

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ ...loginActionBody, loginUrl: "   " });

      expect(res.status).toBe(201);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        ...loginActionInput,
        loginUrl: null,
      });
    });

    it("returns 409 and creates nothing when the website already has a Login action, naming it", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(foundLoginAction);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ ...loginActionBody, title: "Log in again" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE });
      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith(foundWebsite.id);
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("describeWebsiteAlreadyHasALoginAction names the website's Login action in plain words", () => {
      expect(describeWebsiteAlreadyHasALoginAction("Sign in")).toBe('This website already has a login action: "Sign in"');
    });

    it("returns 400 and creates nothing when neither the Login action nor the website has a login page URL", async () => {
      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ ...loginActionBody, loginUrl: null });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: LOGIN_ACTION_NEEDS_A_LOGIN_PAGE_MESSAGE });
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 and does not touch the database when a Login action names a credential", async () => {
      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ ...loginActionBody, credentialId: foundCredential.id });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: LOGIN_ACTION_HAS_NO_CREDENTIAL_MESSAGE });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.findLoginActionForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website's Login action lookup fails", async () => {
      mockDbService.findLoginActionForWebsite.mockRejectedValue(new Error("login action lookup failed"));

      const res = await request(createActionsApp()).post(ACTIONS_PATH).send(loginActionBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "login action lookup failed" });
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send([{ title: "Log in", description: "Enter credentials" }]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body must be a JSON object" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and creates nothing when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the insert fails", async () => {
      mockDbService.createActionForWebsite.mockRejectedValue(new Error("insert failed"));

      const res = await request(createActionsApp())
        .post(ACTIONS_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "insert failed" });
    });
  });

  describe("GET /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 200 with the action looked up by the found website's id and the path action id", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...sampleAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
      );
    });

    it("returns 404 Website not found without looking up the action when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when the website has no such active action", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the action lookup fails", async () => {
      mockDbService.findActionForWebsite.mockRejectedValue(new Error("query timed out"));

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "query timed out" });
    });
  });

  describe("PUT /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 200 with the updated action and passes the found website's id, path action id, and trimmed input", async () => {
      const updatedAction = { ...sampleAction, title: "Log out" };
      mockDbService.updateActionForWebsite.mockResolvedValue(updatedAction);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "  Log out", description: "Open the menu and log out  " });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...updatedAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
        { title: "Log out", description: "Open the menu and log out", ...NO_LOGIN_CHOICES, ...DETECT_EVERY_ROLE_CHOICE },
      );
      expect(mockDbService.findLoginActionForWebsite).not.toHaveBeenCalled();
    });

    it("links the action to one of the found website's credentials to run as", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(foundCredential);
      mockDbService.updateActionForWebsite.mockResolvedValue(sampleActionRunningAsCredential);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials", credentialId: foundCredential.id });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...sampleActionRunningAsCredential,
        objectRole: SAMPLE_OBJECT_ROLE,
        deleteAction: null,
        createActions: [],
      });
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(foundWebsite.id, foundCredential.id);
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
        {
          title: "Log in",
          description: "Enter credentials",
          ...NO_LOGIN_CHOICES,
          credentialId: foundCredential.id,
          ...DETECT_EVERY_ROLE_CHOICE,
        },
      );
    });

    it("unlinks the credential when the replacement leaves the credential id out (a PUT replaces the whole action)", async () => {
      mockDbService.updateActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...sampleAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
        { title: "Log in", description: "Enter credentials", ...NO_LOGIN_CHOICES, ...DETECT_EVERY_ROLE_CHOICE },
      );
    });

    it("returns 400 and updates nothing when the credential is not an active credential of the found website", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials", credentialId: "deleted-credential" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_ON_WEBSITE_MESSAGE });
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "deleted-credential",
      );
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 and does not touch the database when the credential id is not a string", async () => {
      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials", credentialId: true });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: CREDENTIAL_ID_INVALID_MESSAGE });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 409 and updates nothing when another action would become a second Login action", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(foundLoginAction);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ ...loginActionBody, title: "Log in again" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE });
      expect(mockDbService.findLoginActionForWebsite).toHaveBeenCalledWith(foundWebsite.id);
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("replaces the website's Login action itself, since it is not a second one", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(foundLoginAction);
      mockDbService.updateActionForWebsite.mockResolvedValue(foundLoginAction);

      const res = await request(createActionsApp())
        .put(`${ACTIONS_PATH}/${foundLoginAction.id}`)
        .send(loginActionBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...foundLoginAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundLoginAction.id,
        loginActionInput,
      );
    });

    it("lets the Login action become another kind, checking no Login action and no credential", async () => {
      const formerLoginAction = { ...foundLoginAction, userActionKind: "parameters", loginUrl: null };
      mockDbService.updateActionForWebsite.mockResolvedValue(formerLoginAction);

      const res = await request(createActionsApp())
        .put(`${ACTIONS_PATH}/${foundLoginAction.id}`)
        .send({ title: "Log in", description: "Signs in", userActionKind: "parameters" });

      expect(res.status).toBe(200);
      expect(mockDbService.findLoginActionForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, foundLoginAction.id, {
        title: "Log in",
        description: "Signs in",
        ...NO_LOGIN_CHOICES,
        ...DETECT_EVERY_ROLE_CHOICE,
        userActionKind: "parameters",
      });
    });

    it("clears a Login action's own login URL and selectors, so it uses the website's page and finds the fields itself, when the body leaves them blank", async () => {
      const websiteWithLoginUrl = { ...foundWebsite, loginUrl: "https://example.com/sign-in" };
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);
      mockDbService.findLoginActionForWebsite.mockResolvedValue(foundLoginAction);
      const inheritingLoginAction = { ...foundLoginAction, loginUrl: null };
      mockDbService.updateActionForWebsite.mockResolvedValue(inheritingLoginAction);

      const res = await request(createActionsApp())
        .put(`${ACTIONS_PATH}/${foundLoginAction.id}`)
        .send({ ...loginActionBody, loginUrl: "", usernameSelector: "" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...inheritingLoginAction, objectRole: SAMPLE_OBJECT_ROLE, deleteAction: null, createActions: [] });
      expect(mockDbService.updateActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        foundLoginAction.id,
        { ...loginActionInput, loginUrl: null, usernameSelector: null },
      );
    });

    it("returns 400 and updates nothing when a Login action would have no login page because the body clears it and the website has none", async () => {
      mockDbService.findLoginActionForWebsite.mockResolvedValue(foundLoginAction);

      const res = await request(createActionsApp())
        .put(`${ACTIONS_PATH}/${foundLoginAction.id}`)
        .send({ ...loginActionBody, loginUrl: "" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: LOGIN_ACTION_NEEDS_A_LOGIN_PAGE_MESSAGE });
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the website's Login action lookup fails", async () => {
      mockDbService.findLoginActionForWebsite.mockRejectedValue(new Error("login action lookup failed"));

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send(loginActionBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "login action lookup failed" });
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 with the validation message and does not touch the database for an invalid body", async () => {
      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log out", description: 42 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A description is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found and updates nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when the update matched no active action", async () => {
      mockDbService.updateActionForWebsite.mockResolvedValue(null);

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the update fails", async () => {
      mockDbService.updateActionForWebsite.mockRejectedValue(new Error("update failed"));

      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "update failed" });
    });
  });

  describe("DELETE /api/websites/:websiteId/actions/:actionId", () => {
    it("returns 204 with no body after soft deleting by the found website's id and the path action id", async () => {
      mockDbService.softDeleteActionForWebsite.mockResolvedValue(true);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.softDeleteActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        "action-1",
      );
    });

    it("returns 404 Website not found and deletes nothing when the website is missing", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.softDeleteActionForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Action not found when no active action was deleted", async () => {
      mockDbService.softDeleteActionForWebsite.mockResolvedValue(false);

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the stringified value when the soft delete rejects with a non-Error", async () => {
      mockDbService.softDeleteActionForWebsite.mockRejectedValue("database offline");

      const res = await request(createActionsApp()).delete(ACTION_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "database offline" });
    });
  });

  describe("object role", () => {
    it("saves the role choices a body names, and answers with the action's role", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(sampleAction);

      const res = await request(createActionsApp()).post(ACTIONS_PATH).send({
        title: "Create a project",
        description: "Adds one",
        userActionKind: "create",
        userObjectTypeKey: "/projects/{project}",
        userNameParameterKey: "projectName",
      });

      expect(res.status).toBe(201);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: "Create a project",
        description: "Adds one",
        ...NO_LOGIN_CHOICES,
        userActionKind: "create",
        userObjectTypeKey: "/projects/{project}",
        userNameParameterKey: "projectName",
      });
      expect(mockActionParameterService.loadActionRole).toHaveBeenCalledWith(foundWebsite.id, sampleAction);
    });

    it("refuses an unknown kind before touching anything", async () => {
      const res = await request(createActionsApp())
        .put(ACTION_PATH)
        .send({ title: "Log in", description: "Enter credentials", userActionKind: "destroy" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The action kind must be one of: detect, parameters, create, read, update, delete, login" });
      expect(mockDbService.updateActionForWebsite).not.toHaveBeenCalled();
    });

    it("syncs the action's parameters after a replace, since its kind or type may have changed", async () => {
      mockDbService.updateActionForWebsite.mockResolvedValue(sampleAction);

      await request(createActionsApp()).put(ACTION_PATH).send({ title: "Log in", description: "Enter credentials" });

      expect(mockActionParameterService.syncActionParametersQuietly).toHaveBeenCalledWith(foundWebsite.id, sampleAction);
    });

    it("answers 500 when the role cannot be worked out", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(sampleAction);
      mockActionParameterService.loadActionRole.mockRejectedValue(new Error("web objects unavailable"));

      const res = await request(createActionsApp()).get(ACTION_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "web objects unavailable" });
    });
  });
});

describe("delete-action routes", () => {
  const PROPOSAL_PATH = `${ACTION_PATH}/delete-action/proposal`;
  const DELETE_ACTION_PATH = `${ACTION_PATH}/delete-action`;
  const NOT_A_CREATE_ACTION_MESSAGE = "Only a Create action gets a delete action; this action's kind is not Create";
  const ALREADY_LINKED_MESSAGE = "This action already has a delete action";

  /** The found action's role: a Create action that makes Projects. */
  const createRole = {
    ...SAMPLE_OBJECT_ROLE,
    kind: "create",
    objectTypeKey: "/projects/{project}",
    objectTypeName: "Project",
  };
  /** The Create action, found under the path's id; it runs as the found website's credential. */
  const sampleCreateAction = {
    ...sampleActionRunningAsCredential,
    id: "action-create",
    title: "Create a project",
    description: "Adds a project called Apollo 7",
  };
  /** What Claude proposes. */
  const proposal = { title: "Delete the project Apollo 7", description: "Open Projects…", modelId: "claude-opus-5-5" };
  /** The Delete action the create route saves. */
  const createdDeleteAction = { ...sampleAction, id: "action-delete", title: proposal.title, description: proposal.description };
  /** The link the create route writes. */
  const link = {
    id: "cleanup-1",
    createActionId: "action-create",
    deleteActionId: "action-delete",
    createAction: { id: "action-create", title: "Create a project" },
    deleteAction: { id: "action-delete", title: proposal.title },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(sampleCreateAction);
    mockDbService.findActionCleanupForCreateAction.mockResolvedValue(null);
    mockDbService.listActionCleanupsForWebsite.mockResolvedValue([]);
    mockActionParameterService.loadActionRole.mockResolvedValue(createRole);
    mockActionParameterService.syncActionParametersQuietly.mockResolvedValue(undefined);
    mockDeleteActionGenerationService.proposeDeleteAction.mockResolvedValue(proposal);
  });

  describe("POST .../delete-action/proposal", () => {
    it("answers Claude's proposal for a Create action, built from the website, the action, its type, and the name of the credential it runs as", async () => {
      const res = await request(createActionsApp()).post(PROPOSAL_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(proposal);
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, "action-1");
      expect(mockDeleteActionGenerationService.proposeDeleteAction).toHaveBeenCalledWith({
        websiteName: foundWebsite.name,
        createTitle: "Create a project",
        createDescription: "Adds a project called Apollo 7",
        objectTypeName: "Project",
        credentialName: "Admin",
      });
    });

    it("proposes with no credential name for a Create action that runs logged out", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue({ ...sampleCreateAction, credentialId: null, credential: null });

      const res = await request(createActionsApp()).post(PROPOSAL_PATH);

      expect(res.status).toBe(200);
      expect(mockDeleteActionGenerationService.proposeDeleteAction).toHaveBeenCalledWith(
        expect.objectContaining({ credentialName: null }),
      );
    });

    it("refuses an action whose kind is not Create, asking Claude nothing", async () => {
      mockActionParameterService.loadActionRole.mockResolvedValue(SAMPLE_OBJECT_ROLE);

      const res = await request(createActionsApp()).post(PROPOSAL_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: NOT_A_CREATE_ACTION_MESSAGE });
      expect(mockDeleteActionGenerationService.proposeDeleteAction).not.toHaveBeenCalled();
    });

    it("refuses a Create action that already has a delete action", async () => {
      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(link);

      const res = await request(createActionsApp()).post(PROPOSAL_PATH);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: ALREADY_LINKED_MESSAGE });
    });

    it("answers 404 for a missing website or action", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);
      expect((await request(createActionsApp()).post(PROPOSAL_PATH)).status).toBe(404);

      mockDbService.findWebsiteById.mockResolvedValue(null);
      expect((await request(createActionsApp()).post(PROPOSAL_PATH)).status).toBe(404);
    });

    it("maps Claude's known failures to their statuses, and anything else to 500", async () => {
      mockDeleteActionGenerationService.proposeDeleteAction.mockRejectedValue(
        Object.assign(new Error("Claude declined to write the delete action (harmful)"), {
          name: "ScriptGenerationError",
          reason: "refused",
        }),
      );
      const refused = await request(createActionsApp()).post(PROPOSAL_PATH);
      expect(refused.status).toBe(502);
      expect(refused.body).toEqual({ error: "Claude declined to write the delete action (harmful)" });

      mockDeleteActionGenerationService.proposeDeleteAction.mockRejectedValue(new Error("network down"));
      const failed = await request(createActionsApp()).post(PROPOSAL_PATH);
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: "network down" });
    });
  });

  describe("POST .../delete-action", () => {
    it("creates the Delete action with the Create action's credential and type, links the two, syncs it, and answers 201 naming the Create action", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(createdDeleteAction);
      mockDbService.linkActionCleanup.mockResolvedValue(link);
      mockDbService.listActionCleanupsForWebsite.mockResolvedValue([link]);

      const res = await request(createActionsApp())
        .post(DELETE_ACTION_PATH)
        .send({ title: ` ${proposal.title} `, description: proposal.description });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        ...createdDeleteAction,
        objectRole: createRole,
        deleteAction: null,
        createActions: [{ id: "action-create", title: "Create a project" }],
      });
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, {
        title: proposal.title,
        description: proposal.description,
        ...NO_LOGIN_CHOICES,
        credentialId: foundCredential.id,
        userActionKind: "delete",
        userObjectTypeKey: "/projects/{project}",
        userNameParameterKey: null,
      });
      expect(mockDbService.linkActionCleanup).toHaveBeenCalledWith(foundWebsite.id, "action-create", "action-delete");
      expect(mockActionParameterService.syncActionParametersQuietly).toHaveBeenCalledWith(foundWebsite.id, createdDeleteAction);
    });

    it("creates a logged-out Delete action for a Create action that runs logged out", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue({ ...sampleCreateAction, credentialId: null, credential: null });
      mockDbService.createActionForWebsite.mockResolvedValue(createdDeleteAction);
      mockDbService.linkActionCleanup.mockResolvedValue(link);

      const res = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });

      expect(res.status).toBe(201);
      expect(mockDbService.createActionForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        expect.objectContaining({ credentialId: null, userActionKind: "delete" }),
      );
    });

    it("refuses an invalid body before touching anything", async () => {
      const res = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "  ", description: "x" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A title is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
    });

    it("refuses a non-Create action and an already linked one, creating nothing", async () => {
      mockActionParameterService.loadActionRole.mockResolvedValue(SAMPLE_OBJECT_ROLE);
      const notCreate = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });
      expect(notCreate.status).toBe(409);
      expect(notCreate.body).toEqual({ error: NOT_A_CREATE_ACTION_MESSAGE });

      mockActionParameterService.loadActionRole.mockResolvedValue(createRole);
      mockDbService.findActionCleanupForCreateAction.mockResolvedValue(link);
      const linked = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });
      expect(linked.status).toBe(409);
      expect(linked.body).toEqual({ error: ALREADY_LINKED_MESSAGE });

      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
      expect(mockDbService.linkActionCleanup).not.toHaveBeenCalled();
    });

    it("answers 404 for a missing website or action, creating nothing", async () => {
      mockDbService.findActionForWebsite.mockResolvedValue(null);
      const missingAction = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });
      expect(missingAction.status).toBe(404);
      expect(missingAction.body).toEqual({ error: ACTION_NOT_FOUND_MESSAGE });

      mockDbService.findWebsiteById.mockResolvedValue(null);
      const missingWebsite = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });
      expect(missingWebsite.status).toBe(404);
      expect(missingWebsite.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });

      expect(mockDbService.createActionForWebsite).not.toHaveBeenCalled();
    });

    it("answers 500 when the link cannot be written", async () => {
      mockDbService.createActionForWebsite.mockResolvedValue(createdDeleteAction);
      mockDbService.linkActionCleanup.mockRejectedValue(new Error("db down"));

      const res = await request(createActionsApp()).post(DELETE_ACTION_PATH).send({ title: "T", description: "D" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "db down" });
    });
  });
});
