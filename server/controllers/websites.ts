import { type Express } from "express";
import {
  listWebsites,
  findWebsiteById,
  createWebsite,
  updateWebsite,
  softDeleteWebsite,
  isUniqueConstraintViolation,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";
import { validateWebsiteInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const DUPLICATE_URL_MESSAGE = "Another website already uses this URL";

/**
 * Registers the website CRUD routes on the given express app.
 *
 * Deletes are SOFT: `DELETE` stamps `deletedAt` on the website and on its
 * active use cases and actions, and every read here ignores soft-deleted rows,
 * so a deleted website answers 404 from then on.
 *
 * Handlers leave `req`/`res` unannotated on purpose: express infers
 * `req.params.websiteId` as `string` from the literal path, whereas an explicit
 * `Request` annotation widens it to `string | string[]`.
 * @param app - The express application to attach the routes to
 */
export function registerWebsiteRoutes(app: Express): void {
  /**
   * Lists every active website, newest first.
   * @route GET /api/websites
   * @returns 200 with an array of websites; 500 with `{ error }` when the query fails
   */
  app.get("/api/websites", async (_req, res) => {
    try {
      const websites = await listWebsites();
      res.json(websites);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Creates a website. The URL is normalized (lowercased host, root slash
   * added) before it is stored, and must not match another ACTIVE website.
   * @route POST /api/websites
   * @param body - JSON `{ url, name, description? }`; `url` must be http/https
   * @returns 201 with the created website; 400 with `{ error }` for an invalid body; 409 with `{ error }` when another active website has the URL; 500 with `{ error }` otherwise
   */
  app.post("/api/websites", async (req, res) => {
    const validation = validateWebsiteInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const created = await createWebsite(validation.input);
      res.status(201).json(created);
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: DUPLICATE_URL_MESSAGE });
        return;
      }
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active website.
   * @route GET /api/websites/:websiteId
   * @param websiteId - Path parameter: the website's cuid
   * @returns 200 with the website; 404 with `{ error }` when it does not exist or was deleted; 500 with `{ error }` when the query fails
   */
  app.get("/api/websites/:websiteId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(website);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Replaces an active website's URL, name, and description.
   * @route PUT /api/websites/:websiteId
   * @param websiteId - Path parameter: the website's cuid
   * @param body - JSON `{ url, name, description? }`; same rules as POST
   * @returns 200 with the updated website; 400 with `{ error }` for an invalid body; 404 with `{ error }` when it does not exist or was deleted; 409 with `{ error }` when another active website has the URL; 500 with `{ error }` otherwise
   */
  app.put("/api/websites/:websiteId", async (req, res) => {
    const validation = validateWebsiteInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const updated = await updateWebsite(req.params.websiteId, validation.input);
      if (updated === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(updated);
    } catch (error: unknown) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: DUPLICATE_URL_MESSAGE });
        return;
      }
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Soft deletes an active website together with its active use cases and
   * actions (one transaction, one shared `deletedAt`).
   * @route DELETE /api/websites/:websiteId
   * @param websiteId - Path parameter: the website's cuid
   * @returns 204 with no body; 404 with `{ error }` when it does not exist or was already deleted; 500 with `{ error }` when the update fails
   */
  app.delete("/api/websites/:websiteId", async (req, res) => {
    try {
      const websiteWasDeleted = await softDeleteWebsite(req.params.websiteId);
      if (!websiteWasDeleted) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
