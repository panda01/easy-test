import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

/** One mock per dbService function the parameter controller imports. */
const mockDbService = vi.hoisted(() => ({
  addUserActionParameter: vi.fn(),
  findActionForWebsite: vi.fn(),
  findActionScriptForAction: vi.fn(),
  findWebsiteById: vi.fn(),
  listActionParametersForAction: vi.fn(),
  removeUserActionParameter: vi.fn(),
  setActionParameterChoices: vi.fn(),
}));

/** The parameter service is replaced: its own spec covers the view it builds and the sync. */
const mockActionParameterService = vi.hoisted(() => ({
  ensureActionParametersSynced: vi.fn(),
  loadVersionParameters: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced.
vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/actionParameterService.js", () => mockActionParameterService);

import { registerActionParameterRoutes } from "../../../server/controllers/actionParameters.js";

/**
 * Builds a minimal app carrying only the parameter routes, mounted the same
 * way server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the parameter routes registered
 */
function createParametersApp(): Express {
  const app = express();
  app.use(express.json());
  registerActionParameterRoutes(app);
  return app;
}

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove the child queries are
// scoped by the FOUND rows' ids rather than by the raw path parameters.
const foundWebsite = { id: "website-id-from-db", url: "https://example.com/", name: "Example" };
const foundAction = { id: "action-id-from-db", websiteId: foundWebsite.id, title: "Create a project", credential: null };
const foundScript = { id: "script-id-from-db", actionId: foundAction.id, plan: { name: "x", startUrl: "https://example.com/", steps: [] } };

const ACTION_PATH = "/api/websites/website-from-path/actions/action-from-path";
const PARAMETERS_PATH = `${ACTION_PATH}/scripts/script-from-path/parameters`;

/** A version's parameters view, as the service builds it (shape only). */
const SAMPLE_VIEW = {
  role: { kind: "create", warnings: [] },
  parameters: [{ key: "projectName", label: "Project name" }],
  objectChoices: [],
  confirmStepNumber: 2,
  nameParameterKey: "projectName",
  bindableTexts: [
    { text: "Apollo 7", fields: ["value", "targetName"] },
    { text: "Create project", fields: ["targetName"] },
  ],
  warnings: [],
};

/** A valid "a value in the steps" body. */
const VALUE_BODY = {
  addKind: "value",
  label: "Mission",
  requiredChoice: "optional",
  valueKind: "text",
  objectTypeKey: null,
  matchText: "Apollo 7",
};

/** A valid "a field the steps don't fill" body. */
const FIELD_BODY = {
  addKind: "field",
  label: "Notes",
  requiredChoice: "optional",
  fieldTarget: { label: "Notes" },
  stepAction: "fill",
  fillAfterKey: "projectName",
};

/** The detected "Project name" row, as the list returns it (the fields the routes read). */
const PROJECT_NAME_ROW = { id: "parameter-1", key: "projectName", kind: "text", source: "steps" };

describe("action parameter routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
    mockDbService.findActionForWebsite.mockResolvedValue(foundAction);
    mockDbService.findActionScriptForAction.mockResolvedValue(foundScript);
    mockActionParameterService.loadVersionParameters.mockResolvedValue(SAMPLE_VIEW);
  });

  describe("GET .../scripts/:actionScriptId/parameters", () => {
    it("answers the version's parameters view, looking each row up under the one found before it", async () => {
      const response = await request(createParametersApp()).get(PARAMETERS_PATH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(SAMPLE_VIEW);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith("website-from-path");
      expect(mockDbService.findActionForWebsite).toHaveBeenCalledWith(foundWebsite.id, "action-from-path");
      expect(mockDbService.findActionScriptForAction).toHaveBeenCalledWith(foundWebsite.id, foundAction.id, "script-from-path");
      expect(mockActionParameterService.loadVersionParameters).toHaveBeenCalledWith(foundWebsite.id, foundAction, foundScript);
    });

    it.each([
      ["website", "findWebsiteById", "Website not found"],
      ["action", "findActionForWebsite", "Action not found"],
      ["version", "findActionScriptForAction", "Script not found"],
    ] as const)("answers 404 when the %s is missing", async (_rowName, lookupName, errorMessage) => {
      mockDbService[lookupName].mockResolvedValue(null);

      const response = await request(createParametersApp()).get(PARAMETERS_PATH);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: errorMessage });
      expect(mockActionParameterService.loadVersionParameters).not.toHaveBeenCalled();
    });

    it("answers 500 when building the view fails", async () => {
      mockActionParameterService.loadVersionParameters.mockRejectedValue(new Error("database down"));

      const response = await request(createParametersApp()).get(PARAMETERS_PATH);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "database down" });
    });
  });

  describe("POST .../scripts/:actionScriptId/parameters", () => {
    it("adds a value in the steps with the fields it appears in, and answers the new view", async () => {
      const viewAfter = { ...SAMPLE_VIEW, parameters: [{ key: "mission", label: "Mission" }] };
      mockActionParameterService.loadVersionParameters.mockResolvedValueOnce(SAMPLE_VIEW).mockResolvedValueOnce(viewAfter);

      const response = await request(createParametersApp()).post(PARAMETERS_PATH).send(VALUE_BODY);

      expect(response.status).toBe(201);
      expect(response.body).toEqual(viewAfter);
      expect(mockDbService.addUserActionParameter).toHaveBeenCalledWith(foundWebsite.id, foundAction.id, {
        ...VALUE_BODY,
        matchFields: ["value", "targetName"],
      });
    });

    it("adds a field the steps don't fill, anchored to one of the version's parameters", async () => {
      const response = await request(createParametersApp()).post(PARAMETERS_PATH).send(FIELD_BODY);

      expect(response.status).toBe(201);
      expect(mockDbService.addUserActionParameter).toHaveBeenCalledWith(foundWebsite.id, foundAction.id, FIELD_BODY);
    });

    it("answers 400 for a value that is not in the version's steps, or a field anchored to no parameter", async () => {
      const valueResponse = await request(createParametersApp())
        .post(PARAMETERS_PATH)
        .send({ ...VALUE_BODY, matchText: "Gemini" });
      const fieldResponse = await request(createParametersApp())
        .post(PARAMETERS_PATH)
        .send({ ...FIELD_BODY, fillAfterKey: "code" });

      expect(valueResponse.status).toBe(400);
      expect(valueResponse.body).toEqual({ error: "That value is not in this version's steps" });
      expect(fieldResponse.status).toBe(400);
      expect(fieldResponse.body).toEqual({ error: "Pick one of this version's parameters to fill the field in after" });
      expect(mockDbService.addUserActionParameter).not.toHaveBeenCalled();
    });

    it("answers 400 for an invalid body before looking anything up", async () => {
      const response = await request(createParametersApp()).post(PARAMETERS_PATH).send({ ...VALUE_BODY, label: "" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "A label is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
    });

    it("answers 404 when the version is missing, and 500 when saving fails", async () => {
      mockDbService.findActionScriptForAction.mockResolvedValueOnce(null);
      const missingResponse = await request(createParametersApp()).post(PARAMETERS_PATH).send(VALUE_BODY);
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.body).toEqual({ error: "Script not found" });

      mockDbService.addUserActionParameter.mockRejectedValue(new Error("duplicate key"));
      const failedResponse = await request(createParametersApp()).post(PARAMETERS_PATH).send(VALUE_BODY);
      expect(failedResponse.status).toBe(500);
      expect(failedResponse.body).toEqual({ error: "duplicate key" });
    });
  });

  describe("PUT .../parameters/:parameterKey", () => {
    const PARAMETER_PATH = `${ACTION_PATH}/parameters/projectName`;

    beforeEach(() => {
      mockDbService.listActionParametersForAction.mockResolvedValue([
        PROJECT_NAME_ROW,
        { id: "parameter-object", key: "object", kind: "object", source: "steps" },
      ]);
    });

    it("syncs a never-synced action, then saves the label and required choice", async () => {
      const updatedRow = { ...PROJECT_NAME_ROW, userLabel: "Name", userRequiredChoice: "optional" };
      mockDbService.setActionParameterChoices.mockResolvedValue(updatedRow);

      const response = await request(createParametersApp())
        .put(PARAMETER_PATH)
        .send({ userLabel: "Name", userRequiredChoice: "optional" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedRow);
      expect(mockActionParameterService.ensureActionParametersSynced).toHaveBeenCalledWith(foundWebsite.id, foundAction);
      expect(mockDbService.setActionParameterChoices).toHaveBeenCalledWith(foundWebsite.id, foundAction.id, "projectName", {
        userLabel: "Name",
        userRequiredChoice: "optional",
      });
    });

    it("answers 400 for making the object optional, but lets it be required or left to the page", async () => {
      const optionalResponse = await request(createParametersApp())
        .put(`${ACTION_PATH}/parameters/object`)
        .send({ userLabel: null, userRequiredChoice: "optional" });
      expect(optionalResponse.status).toBe(400);
      expect(optionalResponse.body).toEqual({ error: "The object is always required, so it cannot be made optional" });

      mockDbService.setActionParameterChoices.mockResolvedValue({ key: "object" });
      const requiredResponse = await request(createParametersApp())
        .put(`${ACTION_PATH}/parameters/object`)
        .send({ userLabel: "Project", userRequiredChoice: null });
      expect(requiredResponse.status).toBe(200);
    });

    it("answers 400 for an invalid body", async () => {
      const response = await request(createParametersApp()).put(PARAMETER_PATH).send({ userLabel: null, userRequiredChoice: "maybe" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Required must be one of: required, optional, or null to let the page decide" });
    });

    it("answers 404 for an unknown parameter, one gone before saving, or a missing action", async () => {
      const unknownResponse = await request(createParametersApp())
        .put(`${ACTION_PATH}/parameters/code`)
        .send({ userLabel: null, userRequiredChoice: null });
      expect(unknownResponse.status).toBe(404);
      expect(unknownResponse.body).toEqual({ error: "Parameter not found" });

      mockDbService.setActionParameterChoices.mockResolvedValue(null);
      const goneResponse = await request(createParametersApp()).put(PARAMETER_PATH).send({ userLabel: null, userRequiredChoice: null });
      expect(goneResponse.status).toBe(404);

      mockDbService.findActionForWebsite.mockResolvedValue(null);
      const missingActionResponse = await request(createParametersApp())
        .put(PARAMETER_PATH)
        .send({ userLabel: null, userRequiredChoice: null });
      expect(missingActionResponse.status).toBe(404);
      expect(missingActionResponse.body).toEqual({ error: "Action not found" });
    });

    it("answers 500 when a query fails", async () => {
      mockDbService.listActionParametersForAction.mockRejectedValue(new Error("database down"));

      const response = await request(createParametersApp()).put(PARAMETER_PATH).send({ userLabel: null, userRequiredChoice: null });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "database down" });
    });
  });

  describe("DELETE .../parameters/:parameterKey", () => {
    const PARAMETER_PATH = `${ACTION_PATH}/parameters/mission`;

    it("removes one of the user's own parameters", async () => {
      mockDbService.removeUserActionParameter.mockResolvedValue("removed");

      const response = await request(createParametersApp()).delete(PARAMETER_PATH);

      expect(response.status).toBe(204);
      expect(mockDbService.removeUserActionParameter).toHaveBeenCalledWith(foundWebsite.id, foundAction.id, "mission");
    });

    it("answers 409 for a detected parameter and 404 for an unknown one", async () => {
      mockDbService.removeUserActionParameter.mockResolvedValueOnce("notYours").mockResolvedValueOnce("notFound");

      const detectedResponse = await request(createParametersApp()).delete(PARAMETER_PATH);
      const unknownResponse = await request(createParametersApp()).delete(PARAMETER_PATH);

      expect(detectedResponse.status).toBe(409);
      expect(detectedResponse.body).toEqual({
        error: "Only a parameter you added can be removed; a detected one can only be changed",
      });
      expect(unknownResponse.status).toBe(404);
      expect(unknownResponse.body).toEqual({ error: "Parameter not found" });
    });

    it("answers 404 for a missing website and 500 when the removal fails", async () => {
      mockDbService.findWebsiteById.mockResolvedValueOnce(null);
      const missingResponse = await request(createParametersApp()).delete(PARAMETER_PATH);
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.body).toEqual({ error: "Website not found" });

      mockDbService.removeUserActionParameter.mockRejectedValue(new Error("database down"));
      const failedResponse = await request(createParametersApp()).delete(PARAMETER_PATH);
      expect(failedResponse.status).toBe(500);
      expect(failedResponse.body).toEqual({ error: "database down" });
    });
  });
});
