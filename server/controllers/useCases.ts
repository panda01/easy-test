import { type Express } from "express";
import {
  findWebsiteById,
  listUseCasesForWebsite,
  findUseCaseForWebsite,
  createUseCaseForWebsite,
  updateUseCaseForWebsite,
  softDeleteUseCaseForWebsite,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";
import { validateTitleDescriptionInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const USE_CASE_NOT_FOUND_MESSAGE = "Use case not found";

/**
 * Registers the use case CRUD routes on the given express app. Every use case
 * belongs to one website, so every path is nested under
 * `/api/websites/:websiteId`, and every route first confirms that website is
 * active - a deleted or unknown website answers 404 "Website not found" before
 * the use case is even looked up.
 *
 * Deletes are SOFT: `DELETE` stamps `deletedAt` and reads ignore such rows.
 * @param app - The express application to attach the routes to
 */
export function registerUseCaseRoutes(app: Express): void {
  /**
   * Lists a website's active use cases, newest first.
   * @route GET /api/websites/:websiteId/use-cases
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of use cases; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/use-cases", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const useCases = await listUseCasesForWebsite(website.id);
      res.json(useCases);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Creates a use case on a website.
   * @route POST /api/websites/:websiteId/use-cases
   * @param websiteId - Path parameter: the owning website's cuid
   * @param body - JSON `{ title, description }`; both required
   * @returns 201 with the created use case; 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/use-cases", async (req, res) => {
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
      const created = await createUseCaseForWebsite(website.id, validation.input);
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active use case of a website.
   * @route GET /api/websites/:websiteId/use-cases/:useCaseId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param useCaseId - Path parameter: the use case's cuid
   * @returns 200 with the use case; 404 with `{ error }` when the website or the use case does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/use-cases/:useCaseId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const useCase = await findUseCaseForWebsite(website.id, req.params.useCaseId);
      if (useCase === null) {
        res.status(404).json({ error: USE_CASE_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(useCase);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Replaces an active use case's title and description.
   * @route PUT /api/websites/:websiteId/use-cases/:useCaseId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param useCaseId - Path parameter: the use case's cuid
   * @param body - JSON `{ title, description }`; both required
   * @returns 200 with the updated use case; 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website or the use case does not exist or was deleted; 500 with `{ error }` otherwise
   */
  app.put("/api/websites/:websiteId/use-cases/:useCaseId", async (req, res) => {
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
      const updated = await updateUseCaseForWebsite(
        website.id,
        req.params.useCaseId,
        validation.input,
      );
      if (updated === null) {
        res.status(404).json({ error: USE_CASE_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Soft deletes one active use case of a website.
   * @route DELETE /api/websites/:websiteId/use-cases/:useCaseId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param useCaseId - Path parameter: the use case's cuid
   * @returns 204 with no body; 404 with `{ error }` when the website or the use case does not exist or was already deleted; 500 with `{ error }` when a query fails
   */
  app.delete("/api/websites/:websiteId/use-cases/:useCaseId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const useCaseWasDeleted = await softDeleteUseCaseForWebsite(
        website.id,
        req.params.useCaseId,
      );
      if (!useCaseWasDeleted) {
        res.status(404).json({ error: USE_CASE_NOT_FOUND_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
