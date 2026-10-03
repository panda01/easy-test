import { type CrawledPageSummaryRecord } from "./useCrawlRunProgress";
import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { crawledPageApiUrl } from "../utils/routePaths";

/** One crawled page in full: the summary plus its aria snapshot and links. */
export interface CrawledPageRecord extends CrawledPageSummaryRecord {
  /** Playwright's YAML aria snapshot of the page's `<body>`, or null when it could not be taken. */
  ariaSnapshot: string | null;
  /** Every same-origin link found on the page (identity URLs), in page order. */
  linkedUrls: string[];
  /** The same-site pages (identities) this page's buttons led to, in click order. */
  buttonUrls: string[];
}

/**
 * Fetches one crawled page in full
 * (`GET /api/websites/:websiteId/crawl-runs/:crawlRunId/pages/:crawledPageId`).
 * Pages never change once recorded, so it is fetched once per page.
 *
 * `crawledPageId` may be null - the crawl has no pages yet - in which case
 * nothing is fetched, so the page can call this hook unconditionally.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param crawledPageId - The page to fetch, or null for none
 * @returns The loading / error / data state of that page
 */
export function useCrawledPage(
  websiteId: string,
  crawlRunId: string,
  crawledPageId: string | null,
): JsonResourceState<CrawledPageRecord> {
  const thereIsNoPage = crawledPageId === null;
  const crawledPageUrl = thereIsNoPage
    ? null
    : crawledPageApiUrl(websiteId, crawlRunId, crawledPageId);
  const crawledPageResource = useJsonResource(crawledPageUrl);
  return crawledPageResource as JsonResourceState<CrawledPageRecord>;
}
