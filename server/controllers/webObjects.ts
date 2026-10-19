import { type Express } from "express";
import {
  findWebsiteById,
  listWebObjectsForWebsite,
  renameWebObject,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";
import { validateWebObjectRenameInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const WEB_OBJECT_NOT_FOUND_MESSAGE = "Web object not found";

/**
 * Registers the web object routes: reading the kinds of things a website's
 * latest crawl found (Website, Action, ... - each with the URL patterns of
 * its pages), and renaming one.
 *
 * Web objects are written only by a crawl's end, which REPLACES the
 * website's previous ones - a rename lasts until the next crawl. Every path
 * is nested under `/api/websites/:websiteId`, and every route first confirms
 * that website is active: a deleted or unknown website answers 404 "Website
 * not found" before anything else happens.
 * @param app - The express application to attach the routes to
 */
export function registerWebObjectRoutes(app: Express): void {
  /**
   * Lists a website's web objects - the ones its latest crawl with pages
   * found - each parent before its children. Each object carries its active
   * `pagePatterns` (in order) and `crawlRun: { id, createdAt }`, the crawl
   * that found it.
   * @route GET /api/websites/:websiteId/web-objects
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of web objects (empty when no crawl found any); 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/web-objects", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const webObjects = await listWebObjectsForWebsite(website.id);
      res.json(webObjects);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Renames one of a website's web objects, until the next crawl replaces
   * it. A blank or null name shows the detected name again.
   * @route PUT /api/websites/:websiteId/web-objects/:webObjectId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param webObjectId - Path parameter: the web object's cuid
   * @param body - JSON `{ name }`: text of at most 100 characters, or null to use the detected name
   * @returns 200 with the renamed web object (with its patterns and crawl); 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website does not exist or was deleted, or the web object does not exist or was replaced by a newer crawl; 500 with `{ error }` when a query fails
   */
  app.put("/api/websites/:websiteId/web-objects/:webObjectId", async (req, res) => {
    const validation = validateWebObjectRenameInput(req.body);
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
      const renamed = await renameWebObject(
        website.id,
        req.params.webObjectId,
        validation.input.name,
      );
      if (renamed === null) {
        res.status(404).json({ error: WEB_OBJECT_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(renamed);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
