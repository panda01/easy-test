import { type Express } from "express";
import { findWebsiteById, listCreatedObjectsForWebsite, removeCreatedObject } from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CREATED_OBJECT_NOT_FOUND_MESSAGE = "Created object not found";

/**
 * Registers the created object routes: reading the record of the objects a
 * website's Create actions made - so they can be cleaned up or used again -
 * and removing one from the record.
 *
 * A row is written by a Create run whose confirm step succeeded; a crawl
 * marks it seen or Not seen, and a passed deleting Object run marks it
 * deleted - none of them ever removes it. Every path is nested under
 * `/api/websites/:websiteId`, and every route first confirms that website is
 * active: a deleted or unknown website answers 404 "Website not found".
 * @param app - The express application to attach the routes to
 */
export function registerCreatedObjectRoutes(app: Express): void {
  /**
   * Lists a website's created objects still in the record, newest first.
   * Each carries its type (`objectTypeKey`, `objectTypeName`), name, and
   * address, `lastSeenAt` / `notSeenSince` (what the latest crawls found),
   * `deletedOnSiteAt` with `deletedByActionScriptRun` (the run that deleted
   * it: `{ id, actionId, actionScriptId, createdAt, action: { title } }`, or
   * null), and `action: { id, title, deletedAt }` - the action that made it,
   * which may since have been deleted.
   * @route GET /api/websites/:websiteId/created-objects
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of created objects; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/created-objects", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const createdObjects = await listCreatedObjectsForWebsite(website.id);
      res.json(createdObjects);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Removes one created object from the record (a soft delete). The object
   * itself stays on the website - this only stops the app tracking it and
   * offering it as a choice.
   * @route DELETE /api/websites/:websiteId/created-objects/:createdObjectId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param createdObjectId - Path parameter: the created object's cuid
   * @returns 204 with no body; 404 with `{ error }` when the website or the created object does not exist or was already removed; 500 with `{ error }` when a query fails
   */
  app.delete("/api/websites/:websiteId/created-objects/:createdObjectId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const createdObjectWasRemoved = await removeCreatedObject(website.id, req.params.createdObjectId);
      if (!createdObjectWasRemoved) {
        res.status(404).json({ error: CREATED_OBJECT_NOT_FOUND_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
