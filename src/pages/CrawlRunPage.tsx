import { type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CrawledPageDetails from "../components/CrawledPageDetails";
import CrawlSiteMap from "../components/CrawlSiteMap";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { useCrawledPage } from "../hooks/useCrawledPage";
import { type CrawledPageSummaryRecord, useCrawlRunProgress } from "../hooks/useCrawlRunProgress";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useWebsite } from "../hooks/useWebsites";
import {
  crawlRunLoginSeverity,
  crawlRunSeverity,
  describeCrawlRunLogin,
  describeCrawlRunProgress,
  describeCrawlRunStatus,
  formatCrawlButtonModeSuffix,
  identifyCrawledUrl,
} from "../utils/describeCrawlRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import {
  WEBSITE_LIST_PATH,
  crawlRunLoginFailureScreenshotApiUrl,
  websiteDetailPath,
} from "../utils/routePaths";

/** The query parameter naming the selected page. */
const PAGE_QUERY_PARAMETER = "page";

/**
 * Finds the selected page, falling back to the start page (the first one
 * visited) when the id is missing or unknown - e.g. an old link, or a crawl
 * that has not reached that page yet.
 * @param pages - The crawl's pages, in visiting order
 * @param crawledPageId - The id from the query string, or null
 * @returns The page to show, or null when there are no pages yet
 */
function findSelectedPage(
  pages: CrawledPageSummaryRecord[],
  crawledPageId: string | null,
): CrawledPageSummaryRecord | null {
  const pickedPage = pages.find((page) => page.id === crawledPageId);
  return pickedPage ?? pages.at(0) ?? null;
}

/**
 * Maps every URL a link can name to the visited page it leads to: each
 * page's recorded identity, and - for a page recorded where a redirect
 * landed - the identity it was requested at too, so a link to "/" selects the
 * page recorded as "/calendar". A recorded identity always wins over a
 * requested one.
 * @param pages - The crawl's pages
 * @returns The pages, keyed by every identity that leads to them
 */
function mapVisitedPagesByUrl(
  pages: CrawledPageSummaryRecord[],
): Map<string, CrawledPageSummaryRecord> {
  const visitedPagesByUrl = new Map(pages.map((page) => [page.url, page]));
  for (const page of pages) {
    const requestedIdentityUrl = identifyCrawledUrl(page.requestedUrl);
    const requestedIdentityLeadsNowhereYet = !visitedPagesByUrl.has(requestedIdentityUrl);
    if (requestedIdentityLeadsNowhereYet) {
      visitedPagesByUrl.set(requestedIdentityUrl, page);
    }
  }
  return visitedPagesByUrl;
}

/**
 * One crawl of a website (`/websites/:websiteId/crawl-runs/:crawlRunId`):
 * when and where it started (and which buttons it clicked, unless it only
 * followed links), how it is going or how it ended, who it viewed the site as (logged out, or
 * logged in as a credential - the same for every page, because a logged-in
 * crawl records nothing until its login works), a screenshot of the login
 * page when the login failed, the "Site map" of every page
 * it found (a tree: each page under the page whose link first led to it),
 * and the selected page in full, aria snapshot included.
 *
 * While the crawl runs, the run is re-fetched every 2 seconds (see
 * `useCrawlRunProgress`), so the progress line and the site map grow live;
 * if the server briefly cannot be reached, the last good data stays and a
 * warning says it is retrying. The selected page lives in the query string
 * (`?page=<crawledPageId>`, replaced rather than pushed) and defaults to the
 * start page, so a selection survives a reload.
 *
 * The website is fetched for the breadcrumbs; the run request decides
 * loading / not-found.
 * @returns The rendered crawl run page
 */
export default function CrawlRunPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const crawlRunId = useRequiredRouteParam("crawlRunId");
  const website = useWebsite(websiteId).data;
  const crawlRunResource = useCrawlRunProgress(websiteId, crawlRunId);
  const crawlRun = crawlRunResource.data;
  const [searchParams, setSearchParams] = useSearchParams();

  const pages = crawlRun?.pages ?? [];
  const selectedPage = findSelectedPage(pages, searchParams.get(PAGE_QUERY_PARAMETER));
  const selectedPageResource = useCrawledPage(websiteId, crawlRunId, selectedPage?.id ?? null);
  const visitedPagesByUrl = mapVisitedPagesByUrl(pages);
  const visitedPagesById = new Map(pages.map((page) => [page.id, page]));

  /**
   * Shows the picked page in full, replacing the query string entry.
   * @param crawledPageId - The picked page's id
   */
  const selectPage = (crawledPageId: string): void => {
    setSearchParams({ [PAGE_QUERY_PARAMETER]: crawledPageId }, { replace: true });
  };

  const startedAtText = crawlRun === null ? "" : new Date(crawlRun.createdAt).toLocaleString();
  const crawlIsRunning = crawlRun?.status === "running";
  const crawlDurationMs = crawlRun?.durationMs ?? null;
  const crawlDurationText =
    crawlDurationMs === null ? "" : ` · ${formatRunDuration(crawlDurationMs)}`;
  const crawlHasErrorMessage = crawlRun !== null && crawlRun.errorMessage !== null;
  const pollFailed = crawlRunResource.pollErrorMessage !== null;
  const crawlHasLoginFailureScreenshot =
    crawlRun !== null && crawlRun.loginFailureScreenshotFileName !== null;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: crawlRun === null ? "Crawl" : `Crawl ${startedAtText}` },
        ]}
      />

      <LoadStatusNotice
        isLoading={crawlRunResource.isLoading}
        errorMessage={crawlRunResource.errorMessage}
        loadingLabel="Loading crawl"
      />

      {crawlRun !== null && (
        <>
          <Typography variant="h4" component="h1">
            Site crawl
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, wordBreak: "break-all" }}>
            Started {startedAtText} at {crawlRun.startUrl}
            {formatCrawlButtonModeSuffix(crawlRun.buttonMode)}
          </Typography>

          {/* A standing fact about the run, not an urgent message: "note", not MUI's default "alert". */}
          <Alert role="note" severity={crawlRunLoginSeverity(crawlRun)} sx={{ mb: 1 }}>
            {describeCrawlRunLogin(crawlRun)}
          </Alert>
          <Alert role="status" severity={crawlRunSeverity(crawlRun.status)}>
            {describeCrawlRunStatus(crawlRun)}
            {crawlDurationText}
            {crawlIsRunning && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2">{describeCrawlRunProgress(crawlRun)}</Typography>
                <LinearProgress aria-label="Crawling" sx={{ mt: 1 }} />
              </Box>
            )}
            {crawlHasErrorMessage && (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {crawlRun.errorMessage}
              </Typography>
            )}
          </Alert>
          {pollFailed && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Could not refresh the crawl ({crawlRunResource.pollErrorMessage}); still trying.
            </Alert>
          )}

          {crawlHasLoginFailureScreenshot && (
            <Box component="section" aria-labelledby="login-failure-screenshot-heading" sx={{ mt: 3 }}>
              <Typography
                id="login-failure-screenshot-heading"
                variant="h6"
                component="h2"
                sx={{ mb: 1 }}
              >
                Login failure screenshot
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                What the browser showed when the login stopped.
              </Typography>
              <Box
                component="img"
                src={crawlRunLoginFailureScreenshotApiUrl(websiteId, crawlRunId)}
                alt={`Login failure screenshot of the crawl started ${startedAtText}`}
                sx={{
                  display: "block",
                  width: "100%",
                  maxWidth: 960,
                  height: "auto",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              />
            </Box>
          )}

          <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ mt: 3 }}>
            <Box sx={{ flex: { md: "0 0 38%" }, minWidth: 0 }}>
              <CrawlSiteMap
                pages={pages}
                selectedPageId={selectedPage?.id ?? null}
                onSelectPage={selectPage}
              />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {selectedPage !== null && (
                <CrawledPageDetails
                  page={selectedPage}
                  pageResource={selectedPageResource}
                  visitedPagesByUrl={visitedPagesByUrl}
                  visitedPagesById={visitedPagesById}
                  onSelectPage={selectPage}
                />
              )}
            </Box>
          </Stack>
        </>
      )}
    </Container>
  );
}
