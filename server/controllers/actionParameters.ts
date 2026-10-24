import { type Express } from "express";
import {
  addUserActionParameter,
  findActionForWebsite,
  findActionScriptForAction,
  findWebsiteById,
  listActionParametersForAction,
  removeUserActionParameter,
  setActionParameterChoices,
  type ActionScriptWithPlan,
  type ActionWithCredential,
  type UserActionParameterInput,
  type Website,
} from "../services/dbService.js";
import { ensureActionParametersSynced, loadVersionParameters } from "../services/actionParameterService.js";
import { OBJECT_PARAMETER_KEY, type ParameterUseField } from "../utils/actionParameters.js";
import { describeError } from "../utils/describeError.js";
import {
  validateActionParameterChoicesInput,
  validateNewActionParameterInput,
  type NewActionParameterRequestInput,
} from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";
const PARAMETER_NOT_FOUND_MESSAGE = "Parameter not found";
const DETECTED_PARAMETER_CANNOT_BE_REMOVED_MESSAGE =
  "Only a parameter you added can be removed; a detected one can only be changed";
const OBJECT_IS_ALWAYS_REQUIRED_MESSAGE = "The object is always required, so it cannot be made optional";

/** The outcome of looking up a website, an action, and (optionally) a version. */
type ParameterLookup<TFound> =
  | { allWereFound: true; found: TFound }
  | { allWereFound: false; notFoundMessage: string };

/** The active website and action a parameter route works under. */
interface WebsiteAndAction {
  website: Website;
  action: ActionWithCredential;
}

/**
 * Looks up the active website, then the active action under it.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @returns Both rows, or the 404 message for the first one missing
 */
async function findWebsiteAndAction(
  websiteId: string,
  actionId: string,
): Promise<ParameterLookup<WebsiteAndAction>> {
  const website = await findWebsiteById(websiteId);
  if (website === null) return { allWereFound: false, notFoundMessage: WEBSITE_NOT_FOUND_MESSAGE };
  const action = await findActionForWebsite(website.id, actionId);
  if (action === null) return { allWereFound: false, notFoundMessage: ACTION_NOT_FOUND_MESSAGE };
  return { allWereFound: true, found: { website, action } };
}

/**
 * Looks up the active website, action, and version, in that order.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @param actionScriptId - Path parameter: the version's cuid
 * @returns All three rows, or the 404 message for the first one missing
 */
async function findWebsiteActionAndScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ParameterLookup<WebsiteAndAction & { script: ActionScriptWithPlan }>> {
  const lookup = await findWebsiteAndAction(websiteId, actionId);
  if (!lookup.allWereFound) return lookup;
  const { website, action } = lookup.found;
  const script = await findActionScriptForAction(website.id, action.id, actionScriptId);
  if (script === null) return { allWereFound: false, notFoundMessage: SCRIPT_NOT_FOUND_MESSAGE };
  return { allWereFound: true, found: { website, action, script } };
}

/**
 * Turns an "add a parameter" request into what is stored, checking it
 * against the version: a value must appear in the version's steps (its
 * fields are where it appears), and a field must be filled in after one of
 * the version's parameters.
 * @param request - The validated request
 * @param bindableTexts - The texts of the version's steps, with their fields
 * @param parameterKeys - The keys of the version's parameters
 * @returns The input to store, or why it does not fit the version
 */
function buildUserParameterInput(
  request: NewActionParameterRequestInput,
  bindableTexts: { text: string; fields: ParameterUseField[] }[],
  parameterKeys: string[],
): { isValid: true; input: UserActionParameterInput } | { isValid: false; errorMessage: string } {
  if (request.addKind === "value") {
    const bindableText = bindableTexts.find((candidate) => candidate.text === request.matchText);
    if (bindableText === undefined) {
      return { isValid: false, errorMessage: "That value is not in this version's steps" };
    }
    return { isValid: true, input: { ...request, matchFields: bindableText.fields } };
  }
  const anchorIsAParameter = parameterKeys.includes(request.fillAfterKey);
  if (!anchorIsAParameter) {
    return { isValid: false, errorMessage: "Pick one of this version's parameters to fill the field in after" };
  }
  return { isValid: true, input: request };
}

/**
 * Registers the parameter routes: reading a version's parameters (with the
 * action's object role, the object choices, and a Create action's confirm
 * step and name parameter), adding one of the user's own, changing one's
 * label or required choice, and removing one of the user's own.
 *
 * An action's parameters are stored in ONE place, its `ActionParameter`
 * rows (kept up to date by a sync - see `syncActionParameters`); which steps
 * of a version use each, and the value the version types, are read from the
 * version's plan. Every path is nested under
 * `/api/websites/:websiteId/actions/:actionId`, and every route first
 * confirms the website and then the action are active, answering 404 for the
 * first one missing.
 * @param app - The express application to attach the routes to
 */
export function registerActionParameterRoutes(app: Express): void {
  /**
   * Reads one version's parameters: the action's object role (`role`), the
   * parameters in step order - each with its label, kind, source, whether
   * it is required and why, the value the version types, the step fields it
   * writes, and for a field the steps don't fill the step a value adds -
   * the objects an Object action can be run on (`objectChoices`, created
   * ones first), a Create action's confirm step and name parameter, the
   * texts of the steps a parameter can be made of (`bindableTexts`), and the
   * warnings. An action whose parameters were never synced is synced first.
   * @route GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version's cuid
   * @returns 200 with `{ role, parameters, objectChoices, confirmStepNumber, nameParameterKey, bindableTexts, warnings }`; 404 with `{ error }` when the website, action, or version does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters",
    async (req, res) => {
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
        const { website, action, script } = lookup.found;
        const view = await loadVersionParameters(website.id, action, script);
        res.json(view);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Adds one of the user's own parameters, for when detection missed one. It
   * belongs to the action, so it applies to every version it fits:
   * - "a value in the steps" (`addKind: "value"`): a literal of this
   *   version's steps (it must appear in them), made a text or object
   *   parameter - it applies to every version whose steps hold that text,
   *   and takes over from a detected parameter on the same text;
   * - "a field the steps don't fill" (`addKind: "field"`): how to find the
   *   field, whether it is typed or picked, and which of this version's
   *   parameters it is filled in after - it applies to every version that
   *   has that parameter.
   * @route POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param actionScriptId - Path parameter: the version the parameter was picked in
   * @param body - JSON `{ addKind: "value", label, requiredChoice, valueKind, objectTypeKey, matchText }` or `{ addKind: "field", label, requiredChoice, fieldTarget, stepAction, fillAfterKey }`
   * @returns 201 with the version's parameters view (as the GET route answers); 400 with `{ error }` for an invalid body, a value that is not in the version's steps, or a field anchored to something that is not one of its parameters; 404 with `{ error }` when the website, action, or version does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.post(
    "/api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters",
    async (req, res) => {
      const validation = validateNewActionParameterInput(req.body);
      if (!validation.isValid) {
        res.status(400).json({ error: validation.errorMessage });
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
        const { website, action, script } = lookup.found;
        const viewBefore = await loadVersionParameters(website.id, action, script);
        const userParameter = buildUserParameterInput(
          validation.input,
          viewBefore.bindableTexts,
          viewBefore.parameters.map((parameter) => parameter.key),
        );
        if (!userParameter.isValid) {
          res.status(400).json({ error: userParameter.errorMessage });
          return;
        }
        await addUserActionParameter(website.id, action.id, userParameter.input);
        const viewAfter = await loadVersionParameters(website.id, action, script);
        res.status(201).json(viewAfter);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Changes one parameter's label and required choice - any parameter,
   * detected or the user's own. The change belongs to the action, so it
   * applies to every version that has the parameter, and a sync never
   * overwrites it. Null clears each (the worked-out label; "let the page
   * decide"). The object of an Object action is always required.
   * @route PUT /api/websites/:websiteId/actions/:actionId/parameters/:parameterKey
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param parameterKey - Path parameter: the parameter's key
   * @param body - JSON `{ userLabel, userRequiredChoice }`: a label of at most 100 characters or null; `required`, `optional`, or null
   * @returns 200 with the parameter's row; 400 with `{ error }` for an invalid body or making the object optional; 404 with `{ error }` when the website, action, or parameter does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.put("/api/websites/:websiteId/actions/:actionId/parameters/:parameterKey", async (req, res) => {
    const validation = validateActionParameterChoicesInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      await ensureActionParametersSynced(website.id, action);
      const parameter = (await listActionParametersForAction(website.id, action.id)).find(
        (candidate) => candidate.key === req.params.parameterKey,
      );
      if (parameter === undefined) {
        res.status(404).json({ error: PARAMETER_NOT_FOUND_MESSAGE });
        return;
      }
      const objectWouldBeOptional =
        (parameter.kind === "object" || parameter.key === OBJECT_PARAMETER_KEY) &&
        validation.input.userRequiredChoice === "optional";
      if (objectWouldBeOptional) {
        res.status(400).json({ error: OBJECT_IS_ALWAYS_REQUIRED_MESSAGE });
        return;
      }
      const updated = await setActionParameterChoices(website.id, action.id, parameter.key, validation.input);
      if (updated === null) {
        res.status(404).json({ error: PARAMETER_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Removes one of the user's own parameters. A detected parameter cannot be
   * removed - clear its changes with the PUT route instead.
   * @route DELETE /api/websites/:websiteId/actions/:actionId/parameters/:parameterKey
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the owning action's cuid
   * @param parameterKey - Path parameter: the parameter's key
   * @returns 204 with no body; 404 with `{ error }` when the website, action, or parameter does not exist or was deleted; 409 with `{ error }` when the parameter was detected, not added; 500 with `{ error }` when a query fails
   */
  app.delete("/api/websites/:websiteId/actions/:actionId/parameters/:parameterKey", async (req, res) => {
    try {
      const lookup = await findWebsiteAndAction(req.params.websiteId, req.params.actionId);
      if (!lookup.allWereFound) {
        res.status(404).json({ error: lookup.notFoundMessage });
        return;
      }
      const { website, action } = lookup.found;
      const removal = await removeUserActionParameter(website.id, action.id, req.params.parameterKey);
      if (removal === "notFound") {
        res.status(404).json({ error: PARAMETER_NOT_FOUND_MESSAGE });
        return;
      }
      if (removal === "notYours") {
        res.status(409).json({ error: DETECTED_PARAMETER_CANNOT_BE_REMOVED_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
