import { type Express } from "express";
import {
  findWebsiteById,
  listActionsForWebsite,
  findActionForWebsite,
  createActionForWebsite,
  updateActionForWebsite,
  softDeleteActionForWebsite,
  findCredentialForWebsite,
} from "../services/dbService.js";
import { loadActionRole, syncActionParametersQuietly } from "../services/actionParameterService.js";
import { describeError } from "../utils/describeError.js";
import { validateActionInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const CREDENTIAL_NOT_ON_WEBSITE_MESSAGE =
  "That credential does not exist on this website; pick one of the website's credentials or none";

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
   * the action's script passes.
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
      res.json(actions);
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
   * @param body - JSON `{ title, description, credentialId, userActionKind, userObjectTypeKey, userNameParameterKey, userDeletesObject }`; title and description required; `credentialId` an active credential of this website, or null / left out to run logged out; `userActionKind` `parameters`, `object`, `create`, or null / `detect`; `userObjectTypeKey` a web object's key or null; `userNameParameterKey` a parameter key or null; `userDeletesObject` true, false, or null
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
      const objectRole = await loadActionRole(website.id, created);
      res.status(201).json({ ...created, objectRole });
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active action of a website, with `credential: { id, name }`
   * (the credential it logs in as) or null, and `objectRole`: what the
   * action does with an object - its kind, object type, and whether it
   * deletes - with the user's choices applied and the detections (and how
   * sure they are) for the ones left on "detect".
   * @route GET /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @returns 200 with the action and its `objectRole`; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` when a query fails
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
      const objectRole = await loadActionRole(website.id, action);
      res.json({ ...action, objectRole });
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
   * @param body - JSON `{ title, description, credentialId, userActionKind, userObjectTypeKey, userNameParameterKey, userDeletesObject }`, as for creating an action
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
      const objectRole = await loadActionRole(website.id, updated);
      res.json({ ...updated, objectRole });
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
