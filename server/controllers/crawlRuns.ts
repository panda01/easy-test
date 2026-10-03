import { type Express } from "express";
import {
  findWebsiteById,
  listCrawlRunsForWebsite,
  findCrawlRunForWebsite,
  listCrawledPageSummariesForRun,
  findCrawledPageForRun,
  findCredentialWithPasswordForWebsite,
  type Credential,
} from "../services/dbService.js";
import { startCrawlRun } from "../services/crawlRunService.js";
import { describeError } from "../utils/describeError.js";
import { readSendErrorStatus } from "../utils/readSendErrorStatus.js";
import { validateCrawlRunStartInput } from "../utils/validateRequestBodies.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
} from "../utils/credentialEncryption.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CRAWL_RUN_NOT_FOUND_MESSAGE = "Crawl run not found";
const CRAWLED_PAGE_NOT_FOUND_MESSAGE = "Crawled page not found";
const CREDENTIAL_NOT_FOUND_MESSAGE = "Credential not found";
const CRAWL_ALREADY_RUNNING_MESSAGE = "A crawl is already running for this website";
const CREDENTIAL_HAS_NO_EFFECTIVE_LOGIN_URL_MESSAGE =
  "This credential has no login page URL, and neither does the website";
const RUN_HAS_NO_LOGIN_FAILURE_SCREENSHOT_MESSAGE =
  "This crawl has no login failure screenshot";
const SCREENSHOT_FILE_NOT_FOUND_MESSAGE = "Screenshot file not found";

/**
 * Registers the crawl routes: starting a background crawl of a website with a
 * headless browser on this machine, and reading back its runs, their page
 * trees, and each page's aria snapshot.
 *
 * Every path is nested under `/api/websites/:websiteId`, and every route first
 * confirms that website is active - a deleted or unknown website answers 404
 * "Website not found" before anything else happens. Runs and pages are soft
 * deleted together with their website.
 *
 * Like the Playwright routes, this registrar takes the screenshot directory
 * (resolved once at boot from `SCREENSHOT_DIR`): a crawl whose login fails
 * writes a screenshot there, and a route here serves it back.
 * @param app - The express application to attach the routes to
 * @param screenshotDirectory - Absolute path login failure screenshots are written to and served from
 */
export function registerCrawlRunRoutes(app: Express, screenshotDirectory: string): void {
  /**
   * Lists a website's active crawl runs, newest first, without their pages.
   * Each run carries `credential: { id, name }` (null for a logged-out crawl)
   * and `isLoggedIn`.
   * @route GET /api/websites/:websiteId/crawl-runs
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of crawl runs; 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/crawl-runs", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const crawlRuns = await listCrawlRunsForWebsite(website.id);
      res.json(crawlRuns);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Starts crawling the website in the BACKGROUND and answers at once with
   * the new run (`status: "running"`). The crawl follows same-origin links
   * from the website's URL, up to 50 pages and 10 minutes, recording each
   * page's aria snapshot as it goes; poll `GET .../crawl-runs/:crawlRunId`
   * for progress.
   *
   * `buttonMode` picks which buttons the crawl also clicks on each page
   * (stored on the run): `linksOnly` (the default) clicks none,
   * `allButRisky` clicks every labelled button except risky ones (create,
   * delete, update, logout, pay, confirm, ...), and `openOnly` clicks only
   * buttons that say "open".
   *
   * With a `credentialId`, the crawler first logs in as that credential - on
   * its EFFECTIVE login URL: its own `loginUrl`, or else the website's - and
   * records no page until the login succeeds; the run's `isLoggedIn` then
   * turns true. A failed login ends the run `failed`, with no pages, and with
   * a screenshot of what the browser showed (see
   * `GET .../login-failure-screenshot`). Without one (or with no body at all)
   * it crawls as a logged-out visitor.
   *
   * Only one crawl of a website runs at a time: a second POST while one is
   * running answers 409 and starts nothing.
   * @route POST /api/websites/:websiteId/crawl-runs
   * @param websiteId - Path parameter: the website's cuid
   * @param body - Optional JSON `{ credentialId?, buttonMode? }`: `credentialId` is the cuid of one of the website's credentials to log in as, or null / left out to crawl logged out; `buttonMode` is `linksOnly`, `allButRisky`, or `openOnly`, or null / left out for `linksOnly`
   * @returns 201 with the new crawl run; 400 with `{ error }` for an invalid body (including an unknown `buttonMode`), or when the chosen credential has no login URL and the website has none either; 404 with `{ error }` when the website or the credential does not exist or was deleted; 409 with `{ error }` when a crawl of it is already running; 503 with `{ error }` when a credential was chosen but CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` when a query fails or the credential's password cannot be decrypted
   */
  app.post("/api/websites/:websiteId/crawl-runs", async (req, res) => {
    const validation = validateCrawlRunStartInput(req.body);
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

      const { credentialId, buttonMode } = validation.input;
      let credential: Credential | null = null;
      const crawlIsLoggedIn = credentialId !== null;
      if (crawlIsLoggedIn) {
        if (!credentialEncryptionIsConfigured()) {
          res.status(503).json({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
          return;
        }
        credential = await findCredentialWithPasswordForWebsite(website.id, credentialId);
        if (credential === null) {
          res.status(404).json({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
          return;
        }
        const credentialHasNoLoginUrl = credential.loginUrl === null;
        const websiteHasNoLoginUrl = website.loginUrl === null;
        const credentialHasNoEffectiveLoginUrl = credentialHasNoLoginUrl && websiteHasNoLoginUrl;
        if (credentialHasNoEffectiveLoginUrl) {
          res.status(400).json({ error: CREDENTIAL_HAS_NO_EFFECTIVE_LOGIN_URL_MESSAGE });
          return;
        }
      }

      const crawlRunStart = await startCrawlRun(
        website,
        credential,
        screenshotDirectory,
        buttonMode,
      );
      if (!crawlRunStart.crawlStarted) {
        res.status(409).json({ error: CRAWL_ALREADY_RUNNING_MESSAGE });
        return;
      }
      res.status(201).json(crawlRunStart.crawlRun);
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Reads one crawl run with its pages in visiting order - the page tree
   * (`parentPageId`) without each page's aria snapshot or link list, so the
   * UI can poll it while the crawl runs. The run carries
   * `credential: { id, name }` (null for a logged-out crawl) and
   * `isLoggedIn`; every page of a logged-in run was viewed logged in.
   * @route GET /api/websites/:websiteId/crawl-runs/:crawlRunId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param crawlRunId - Path parameter: the crawl run's cuid
   * @returns 200 with the crawl run plus `pages` (page summaries); 404 with `{ error }` when the website or the run does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/crawl-runs/:crawlRunId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const crawlRun = await findCrawlRunForWebsite(website.id, req.params.crawlRunId);
      if (crawlRun === null) {
        res.status(404).json({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
        return;
      }
      const pages = await listCrawledPageSummariesForRun(website.id, crawlRun.id);
      res.json({ ...crawlRun, pages });
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Reads one crawled page in full, including its aria snapshot and the
   * same-origin links found on it.
   * @route GET /api/websites/:websiteId/crawl-runs/:crawlRunId/pages/:crawledPageId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param crawlRunId - Path parameter: the crawl run's cuid
   * @param crawledPageId - Path parameter: the page's cuid
   * @returns 200 with the crawled page; 404 with `{ error }` when the website, the run, or the page does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get(
    "/api/websites/:websiteId/crawl-runs/:crawlRunId/pages/:crawledPageId",
    async (req, res) => {
      try {
        const website = await findWebsiteById(req.params.websiteId);
        if (website === null) {
          res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
          return;
        }
        const crawlRun = await findCrawlRunForWebsite(website.id, req.params.crawlRunId);
        if (crawlRun === null) {
          res.status(404).json({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
          return;
        }
        const crawledPage = await findCrawledPageForRun(
          website.id,
          crawlRun.id,
          req.params.crawledPageId,
        );
        if (crawledPage === null) {
          res.status(404).json({ error: CRAWLED_PAGE_NOT_FOUND_MESSAGE });
          return;
        }
        res.json(crawledPage);
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );

  /**
   * Serves the screenshot taken when a crawl's login failed, as a PNG - what
   * the browser showed right after submitting the login form (or wherever the
   * login stopped).
   *
   * The file is sent with `root` set to the screenshot directory, so the
   * stored relative name is resolved inside it: a name that tries to climb
   * out with `..` is refused rather than served.
   * @route GET /api/websites/:websiteId/crawl-runs/:crawlRunId/login-failure-screenshot
   * @param websiteId - Path parameter: the owning website's cuid
   * @param crawlRunId - Path parameter: the crawl run's cuid
   * @returns 200 with the `image/png` bytes; 404 with `{ error }` when the website or the run does not exist or was deleted, the run has no login failure screenshot, or the file is gone from disk; 500 with `{ error }` when a query fails or the file cannot be read
   */
  app.get(
    "/api/websites/:websiteId/crawl-runs/:crawlRunId/login-failure-screenshot",
    async (req, res) => {
      try {
        const website = await findWebsiteById(req.params.websiteId);
        if (website === null) {
          res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
          return;
        }
        const crawlRun = await findCrawlRunForWebsite(website.id, req.params.crawlRunId);
        if (crawlRun === null) {
          res.status(404).json({ error: CRAWL_RUN_NOT_FOUND_MESSAGE });
          return;
        }
        const { loginFailureScreenshotFileName } = crawlRun;
        const runHasNoLoginFailureScreenshot = loginFailureScreenshotFileName === null;
        if (runHasNoLoginFailureScreenshot) {
          res.status(404).json({ error: RUN_HAS_NO_LOGIN_FAILURE_SCREENSHOT_MESSAGE });
          return;
        }

        /**
         * Answers the request when the file could not be sent. This callback
         * owns every send outcome: it runs after this async handler has
         * returned, so the surrounding try/catch never sees send errors.
         * @param sendError - Undefined when the file was sent; otherwise why it could not be
         */
        const handleScreenshotFileSent = (sendError?: Error): void => {
          const fileWasSent = sendError === undefined;
          if (fileWasSent) return;
          // The client went away mid-stream: the headers are already out, and
          // writing a JSON error now would throw ERR_HTTP_HEADERS_SENT.
          const responseAlreadyStarted = res.headersSent;
          if (responseAlreadyStarted) return;
          const fileIsMissing = readSendErrorStatus(sendError) === 404;
          if (fileIsMissing) {
            res.status(404).json({ error: SCREENSHOT_FILE_NOT_FOUND_MESSAGE });
            return;
          }
          res.status(500).json({ error: describeError(sendError) });
        };

        res.sendFile(
          loginFailureScreenshotFileName,
          { root: screenshotDirectory },
          handleScreenshotFileSent,
        );
      } catch (error: unknown) {
        res.status(500).json({ error: describeError(error) });
      }
    },
  );
}
