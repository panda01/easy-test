import { type Express } from "express";
import {
  findWebsiteById,
  listActionsForWebsite,
  findActionForWebsite,
  createActionForWebsite,
  updateActionForWebsite,
  softDeleteActionForWebsite,
  findCredentialForWebsite,
  findActionCleanupForCreateAction,
  linkActionCleanup,
  listActionCleanupsForWebsite,
  type ActionCleanupLink,
  type ActionWithCredential,
  type LinkedActionSummary,
} from "../services/dbService.js";
import { loadActionRole, syncActionParametersQuietly } from "../services/actionParameterService.js";
import { proposeDeleteAction } from "../services/deleteActionGenerationService.js";
import { describeError } from "../utils/describeError.js";
import { statusForScriptGenerationFailure } from "../utils/statusForScriptGenerationFailure.js";
import { validateActionInput, validateTitleDescriptionInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const CREDENTIAL_NOT_ON_WEBSITE_MESSAGE =
  "That credential does not exist on this website; pick one of the website's credentials or none";
export const ONLY_A_CREATE_ACTION_GETS_A_DELETE_ACTION_MESSAGE =
  "Only a Create action gets a delete action; this action's kind is not Create";
export const ACTION_ALREADY_HAS_A_DELETE_ACTION_MESSAGE = "This action already has a delete action";

/** What an action's read says about its cleanup links (see `describeActionLinks`). */
export interface ActionLinks {
  /** For a Create action: the Delete action that cleans up after it, or null. */
  deleteAction: LinkedActionSummary | null;
  /** For a Delete action: the Create actions it cleans up after (empty when none). */
  createActions: LinkedActionSummary[];
}

/**
 * Reads one action's cleanup links out of the website's active links: the
 * Delete action that cleans up after it (when it is a Create action) and the
 * Create actions it cleans up after (when it is a Delete action).
 * @param actionId - The action's cuid
 * @param links - The website's active cleanup links
 * @returns The action's links
 */
export function describeActionLinks(actionId: string, links: ActionCleanupLink[]): ActionLinks {
  const linkAsCreate = links.find((link) => link.createActionId === actionId);
  const linksAsDelete = links.filter((link) => link.deleteActionId === actionId);
  return {
    deleteAction: linkAsCreate?.deleteAction ?? null,
    createActions: linksAsDelete.map((link) => link.createAction),
  };
}

/**
 * Answers one action the way GET, POST, and PUT do: the row, its credential,
 * its `objectRole`, and its cleanup links.
 * @param websiteId - The owning website's cuid
 * @param action - The action row with its credential
 * @returns The action with `objectRole`, `deleteAction`, and `createActions`
 */
async function describeActionForResponse(
  websiteId: string,
  action: ActionWithCredential,
): Promise<ActionWithCredential & ActionLinks & { objectRole: Awaited<ReturnType<typeof loadActionRole>> }> {
  const objectRole = await loadActionRole(websiteId, action);
  const links = await listActionCleanupsForWebsite(websiteId);
  return { ...action, objectRole, ...describeActionLinks(action.id, links) };
}

/**
 * Checks that the credential an action should run as is an active credential
 * of the same website. Null (run logged out) always passes.
 * @param websiteId - The cuid of the website row (never a raw path parameter)
 * @param credentialId - The validated `credentialId` from the body, or null
 * @returns True when the action may use it
 */
async function credentialBelongsToWebsite(
  websiteId: string,
  credentialId: string | null,
): Promise<boolean> {
  const actionRunsLoggedOut = credentialId === null;
  if (actionRunsLoggedOut) return true;
  const credential = await findCredentialForWebsite(websiteId, credentialId);
  return credential !== null;
}

/**
 * Registers the action CRUD routes on the given express app. Every action
 * belongs to one website, so every path is nested under
 * `/api/websites/:websiteId`, and every route first confirms that website is
 * active - a deleted or unknown website answers 404 "Website not found" before
 * the action is even looked up.
 *
 * Deletes are SOFT: `DELETE` stamps `deletedAt` and reads ignore such rows.
 * @param app - The express application to attach the routes to
 */
export function registerActionRoutes(app: Express): void {
  /**
   * Lists a website's active actions, newest first. Each action carries
   * `credential: { id, name }` (the credential it logs in as) or null, and
   * `newestScript: { id, latestRun }` - its newest version and that version's
   * newest run (`{ id, succeeded, createdAt }`, or null when it has not been
   * run) - or null when it has no versions yet, so the list can show whether
   * the action's script passes. Each also carries its cleanup links,
   * `deleteAction` and `createActions` (see the single-action route), read
   * from the website's links in one query.
   * @route GET /api/websites/:websiteId/actions
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of actions; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/actions", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const actions = await listActionsForWebsite(website.id);
      const links = await listActionCleanupsForWebsite(website.id);
      res.json(actions.map((action) => ({ ...action, ...describeActionLinks(action.id, links) })));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Creates an action on a website, optionally linked to one of the
   * website's credentials (the action then logs in as it before each run),
   * with its object role choices (each null / left out to detect it).
   * @route POST /api/websites/:websiteId/actions
   * @param websiteId - Path parameter: the owning website's cuid
   * @param body - JSON `{ title, description, credentialId, userActionKind, userObjectTypeKey, userNameParameterKey }`; title and description required; `credentialId` an active credential of this website, or null / left out to run logged out; `userActionKind` `parameters`, `create`, `read`, `update`, `delete`, or null / `detect`; `userObjectTypeKey` a web object's key or null; `userNameParameterKey` a parameter key or null
   * @returns 201 with the created action (with `credential` and `objectRole`); 400 with `{ error }` for an invalid body or a credential that is not this website's; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/actions", async (req, res) => {
    const validation = validateActionInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const credentialIsUsable = await credentialBelongsToWebsite(
        website.id,
        validation.input.credentialId,
      );
      if (!credentialIsUsable) {
        res.status(400).json({ error: CREDENTIAL_NOT_ON_WEBSITE_MESSAGE });
        return;
      }
      const created = await createActionForWebsite(website.id, validation.input);
      res.status(201).json(await describeActionForResponse(website.id, created));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active action of a website, with `credential: { id, name }`
   * (the credential it logs in as) or null, `objectRole`: what the action
   * does with an object - its kind (Parameters, Create, Read, Update, or
   * Delete) and object type - with the user's choices applied and the
   * detections (and how sure they are) for the ones left on "detect", and
   * its cleanup links: `deleteAction` (the Delete action that cleans up after
   * a Create action, or null) and `createActions` (the Create actions a
   * Delete action cleans up after).
   * @route GET /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @returns 200 with the action, its `objectRole`, `deleteAction`, and `createActions`; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/actions/:actionId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const action = await findActionForWebsite(website.id, req.params.actionId);
      if (action === null) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(await describeActionForResponse(website.id, action));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Replaces an active action's title, description, credential, and object
   * role choices. A PUT replaces the whole action, so leaving `credentialId`
   * out unlinks it, and leaving a role choice out goes back to detecting it.
   * The action's parameters are synced afterwards (its kind or type may have
   * changed).
   * @route PUT /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @param body - JSON `{ title, description, credentialId, userActionKind, userObjectTypeKey, userNameParameterKey }`, as for creating an action
   * @returns 200 with the updated action (with `credential` and `objectRole`); 400 with `{ error }` for an invalid body or a credential that is not this website's; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.put("/api/websites/:websiteId/actions/:actionId", async (req, res) => {
    const validation = validateActionInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const credentialIsUsable = await credentialBelongsToWebsite(
        website.id,
        validation.input.credentialId,
      );
      if (!credentialIsUsable) {
        res.status(400).json({ error: CREDENTIAL_NOT_ON_WEBSITE_MESSAGE });
        return;
      }
      const updated = await updateActionForWebsite(
        website.id,
        req.params.actionId,
        validation.input,
      );
      if (updated === null) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      await syncActionParametersQuietly(website.id, updated);
      res.json(await describeActionForResponse(website.id, updated));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Proposes the Delete action that would clean up after a Create action:
   * Claude writes the inverse of the action's title and description, with
   * the same names and values and a confirmation of the deletion (see
   * `proposeDeleteAction`). Nothing is saved - the user reviews and edits the
   * proposal, then posts it to the create route below.
   * @route POST /api/websites/:websiteId/actions/:actionId/delete-action/proposal
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the Create action's cuid
   * @returns 200 with `{ title, description, modelId }`; 404 with `{ error }` when the website or action does not exist or was deleted; 409 with `{ error }` when the action's kind is not Create or it already has a delete action; 502 with `{ error }` when Claude declined, its reply was cut off, or the reply was unusable; 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/actions/:actionId/delete-action/proposal", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const action = await findActionForWebsite(website.id, req.params.actionId);
      if (action === null) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      const role = await loadActionRole(website.id, action);
      if (role.kind !== "create") {
        res.status(409).json({ error: ONLY_A_CREATE_ACTION_GETS_A_DELETE_ACTION_MESSAGE });
        return;
      }
      const existingLink = await findActionCleanupForCreateAction(website.id, action.id);
      if (existingLink !== null) {
        res.status(409).json({ error: ACTION_ALREADY_HAS_A_DELETE_ACTION_MESSAGE });
        return;
      }
      const proposal = await proposeDeleteAction({
        websiteName: website.name,
        createTitle: action.title,
        createDescription: action.description,
        objectTypeName: role.objectTypeName,
        credentialName: action.credential?.name ?? null,
      });
      res.json(proposal);
    } catch (error: unknown) {
      res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
    }
  });

  /**
   * Creates the Delete action that cleans up after a Create action and links
   * the two. The new action is an ordinary action of the website with
   * `userActionKind: "delete"`, the Create action's credential, and the
   * Create action's resolved object type (so both name the same kind of
   * object); its parameters are synced once it is saved. From then on every
   * run of the Create action runs this action on the object it made.
   * @route POST /api/websites/:websiteId/actions/:actionId/delete-action
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the Create action's cuid
   * @param body - JSON `{ title, description }`, both required, as proposed by the route above and edited by the user
   * @returns 201 with the new Delete action (with `credential`, `objectRole`, `deleteAction: null`, and `createActions` naming the Create action); 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website or action does not exist or was deleted; 409 with `{ error }` when the action's kind is not Create or it already has a delete action; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/actions/:actionId/delete-action", async (req, res) => {
    const validation = validateTitleDescriptionInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const createAction = await findActionForWebsite(website.id, req.params.actionId);
      if (createAction === null) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      const createRole = await loadActionRole(website.id, createAction);
      if (createRole.kind !== "create") {
        res.status(409).json({ error: ONLY_A_CREATE_ACTION_GETS_A_DELETE_ACTION_MESSAGE });
        return;
      }
      const existingLink = await findActionCleanupForCreateAction(website.id, createAction.id);
      if (existingLink !== null) {
        res.status(409).json({ error: ACTION_ALREADY_HAS_A_DELETE_ACTION_MESSAGE });
        return;
      }
      const deleteAction = await createActionForWebsite(website.id, {
        title: validation.input.title,
        description: validation.input.description,
        credentialId: createAction.credentialId,
        userActionKind: "delete",
        userObjectTypeKey: createRole.objectTypeKey,
        userNameParameterKey: null,
      });
      await linkActionCleanup(website.id, createAction.id, deleteAction.id);
      await syncActionParametersQuietly(website.id, deleteAction);
      res.status(201).json(await describeActionForResponse(website.id, deleteAction));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Soft deletes one active action of a website.
   * @route DELETE /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @returns 204 with no body; 404 with `{ error }` when the website or the action does not exist or was already deleted; 500 with `{ error }` when a query fails
   */
  app.delete("/api/websites/:websiteId/actions/:actionId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const actionWasDeleted = await softDeleteActionForWebsite(
        website.id,
        req.params.actionId,
      );
      if (!actionWasDeleted) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
