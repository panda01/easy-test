import { type Express } from "express";
import {
  findWebsiteById,
  listCrawlRunsForWebsite,
  findCrawlRunForWebsite,
  listCrawledPageSummariesForRun,
  findCrawledPageForRun,
} from "../services/dbService.js";
import { startCrawlRun } from "../services/crawlRunService.js";
import { describeError } from "../utils/describeError.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CRAWL_RUN_NOT_FOUND_MESSAGE = "Crawl run not found";
const CRAWLED_PAGE_NOT_FOUND_MESSAGE = "Crawled page not found";
const CRAWL_ALREADY_RUNNING_MESSAGE = "A crawl is already running for this website";

/**
 * Registers the crawl routes: starting a background crawl of a website with a
 * headless browser on this machine, and reading back its runs, their page
 * trees, and each page's aria snapshot.
 *
 * Every path is nested under `/api/websites/:websiteId`, and every route first
 * confirms that website is active - a deleted or unknown website answers 404
 * "Website not found" before anything else happens. Runs and pages are soft
 * deleted together with their website.
 * @param app - The express application to attach the routes to
 */
export function registerCrawlRunRoutes(app: Express): void {
  /**
   * Lists a website's active crawl runs, newest first, without their pages.
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
   * from the website's URL (links only - it never clicks anything), up to 50
   * pages and 10 minutes, recording each page's aria snapshot as it goes;
   * poll `GET .../crawl-runs/:crawlRunId` for progress.
   *
   * Only one crawl of a website runs at a time: a second POST while one is
   * running answers 409 and starts nothing.
   * @route POST /api/websites/:websiteId/crawl-runs
   * @param websiteId - Path parameter: the website's cuid
   * @returns 201 with the new crawl run; 404 with `{ error }` when the website does not exist or was deleted; 409 with `{ error }` when a crawl of it is already running; 500 with `{ error }` when a query fails
   */
  app.post("/api/websites/:websiteId/crawl-runs", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const crawlRunStart = await startCrawlRun(website);
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
   * UI can poll it while the crawl runs.
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
}
