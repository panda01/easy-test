import { type Express } from "express";
import {
  findWebsiteById,
  listActionsForWebsite,
  findActionForWebsite,
  createActionForWebsite,
  updateActionForWebsite,
  softDeleteActionForWebsite,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";
import { validateTitleDescriptionInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";

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
   * Lists a website's active actions, newest first.
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
   * Creates an action on a website.
   * @route POST /api/websites/:websiteId/actions
   * @param websiteId - Path parameter: the owning website's cuid
   * @param body - JSON `{ title, description }`; both required
   * @returns 201 with the created action; 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/actions", async (req, res) => {
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
      const created = await createActionForWebsite(website.id, validation.input);
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active action of a website.
   * @route GET /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @returns 200 with the action; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` when a query fails
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
      res.json(action);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Replaces an active action's title and description.
   * @route PUT /api/websites/:websiteId/actions/:actionId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param actionId - Path parameter: the action's cuid
   * @param body - JSON `{ title, description }`; both required
   * @returns 200 with the updated action; 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website or the action does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.put("/api/websites/:websiteId/actions/:actionId", async (req, res) => {
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
      const updated = await updateActionForWebsite(
        website.id,
        req.params.actionId,
        validation.input,
      );
      if (updated === null) {
        res.status(404).json({ error: ACTION_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(updated);
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
