import { type Express } from "express";
import {
  listWebsitesWithSummaries,
  findWebsiteById,
  createWebsite,
  updateWebsite,
  softDeleteWebsite,
  isUniqueConstraintViolation,
  type Website,
} from "../services/dbService.js";
import { checkWebsiteForLoginForm, type LoginCheck } from "../services/loginFormCheckService.js";
import { describeError } from "../utils/describeError.js";
import { validateWebsiteInput } from "../utils/validateRequestBodies.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const DUPLICATE_URL_MESSAGE = "Another website already uses this URL";
export const WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE =
  "This website already has its login action, so there is no login form to look for";

/**
 * Runs a just-created website's login-form check (see
 * `checkWebsiteForLoginForm`) without letting it fail the create: a check
 * that throws (a query failed) becomes a `failed` check.
 * @param website - The website that was just created
 * @returns What the check did
 */
async function checkNewWebsiteForLoginForm(website: Website): Promise<LoginCheck> {
  try {
    return await checkWebsiteForLoginForm(website);
  } catch (error: unknown) {
    return { outcome: "failed", loginUrl: null, loginActionId: null, message: describeError(error) };
  }
}

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
   * Lists every active website, newest first, each with the summary the
   * dashboard shows: `summary: { actionCount, passedActionCount,
   * failedActionCount, notRunActionCount, latestRunAt, latestCrawlRun }`. An
   * action counts as passed, failed, or not run by its newest version's
   * latest run; `latestRunAt` is when any of the website's scripts last ran
   * (null when none has); `latestCrawlRun` is the newest crawl's `{ id,
   * status, visitedPageCount, pageLimit, createdAt, finishedAt }`, or null
   * when the website has never been crawled.
   * @route GET /api/websites
   * @returns 200 with an array of websites, each with its `summary`; 500 with `{ error }` when the query fails
   */
  app.get("/api/websites", async (_req, res) => {
    try {
      const websites = await listWebsitesWithSummaries();
      res.json(websites);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Creates a website, then looks for a login form on it (the login-form
   * check, see `checkWebsiteForLoginForm`): first on its login page URL when
   * one was given, otherwise on its URL, following one "Log in" / "Sign in"
   * link when that page has no password field. When a form is found the
   * website gets its Login action ("Log in") and - when it had no login page
   * URL - learns the form's page. The request waits for the check (at most
   * about 20 seconds); a check that fails or runs out of time never fails
   * the create. The URL is normalized (lowercased host, root slash added)
   * before it is stored, and must not match another ACTIVE website.
   * @route POST /api/websites
   * @param body - JSON `{ url, name, description?, networkIdleTimeoutMs?, screenshotMinimumWaitMs?, loginUrl? }`; `url` must be http/https; the two settings are whole milliseconds 0-30000 (defaults 5000 and 1) and the cap may not be lower than the minimum; `loginUrl` is the website's default login page, used by its Login action when it has none of its own (http/https, normalized like `url`) - left out, null, or blank means it has none
   * @returns 201 with the created website (as it is after the check) plus `loginCheck: { outcome, loginUrl, loginActionId, message }` - `outcome` is `found`, `notFound`, or `failed`; 400 with `{ error }` for an invalid body; 409 with `{ error }` when another active website has the URL; 500 with `{ error }` otherwise
   */
  app.post("/api/websites", async (req, res) => {
    const validation = validateWebsiteInput(req.body);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const created = await createWebsite(validation.input);
      const loginCheck = await checkNewWebsiteForLoginForm(created);
      const websiteAfterTheCheck = (await findWebsiteById(created.id)) ?? created;
      res.status(201).json({ ...websiteAfterTheCheck, loginCheck });
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
   * Replaces an active website's URL, name, description, screenshot timing
   * settings, and login page URL.
   * @route PUT /api/websites/:websiteId
   * @param websiteId - Path parameter: the website's cuid
   * @param body - JSON `{ url, name, description?, networkIdleTimeoutMs?, screenshotMinimumWaitMs?, loginUrl? }`; same rules as POST (an omitted setting goes back to its default, and an omitted `loginUrl` clears it - the website then has no default login page)
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
   * Looks for a login form on an existing website, on demand (the same
   * login-form check website create runs - see `checkWebsiteForLoginForm`):
   * for websites made before the check existed, or whose URL has changed.
   * When a form is found the website gets its Login action ("Log in"). The
   * request waits for the check (at most about 20 seconds).
   * @route POST /api/websites/:websiteId/login-check
   * @param websiteId - Path parameter: the website's cuid
   * @returns 200 with `{ loginCheck: { outcome, loginUrl, loginActionId, message } }` - `outcome` is `found`, `notFound`, or `failed`; 404 with `{ error }` when the website does not exist or was deleted; 409 with `{ error }` when the website already has its Login action; 500 with `{ error }` when a query fails
   */
  app.post("/api/websites/:websiteId/login-check", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const loginCheck = await checkWebsiteForLoginForm(website);
      const websiteAlreadyHadALoginAction = loginCheck.outcome === "alreadyHasLoginAction";
      if (websiteAlreadyHadALoginAction) {
        res.status(409).json({ error: WEBSITE_ALREADY_HAS_A_LOGIN_ACTION_MESSAGE });
        return;
      }
      res.json({ loginCheck });
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Soft deletes an active website together with its active use cases,
   * actions, screenshot runs, action scripts, action script runs, crawl runs,
   * and crawled pages (one transaction, one shared `deletedAt`).
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
