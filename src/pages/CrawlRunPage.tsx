import { type ReactElement, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import CrawledPageDetails from "../components/CrawledPageDetails";
import CrawlProgressCard from "../components/CrawlProgressCard";
import CrawlSiteMap from "../components/CrawlSiteMap";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import StatusDot from "../components/StatusDot";
import StatusTag, { type StatusTagTone } from "../components/StatusTag";
import { useCrawledPage } from "../hooks/useCrawledPage";
import { type CrawledPageSummaryRecord, useCrawlRunProgress } from "../hooks/useCrawlRunProgress";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useNow } from "../hooks/useNow";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useWebsite } from "../hooks/useWebsites";
import { crawlSeverityColors, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import {
  CRAWL_TIME_LIMIT_MS,
  type CrawlRunSeverity,
  crawlRunLoginSeverity,
  crawlRunSeverity,
  describeCrawlRunLogin,
  describeCrawlRunProgress,
  describeCrawlRunStatus,
  identifyCrawledUrl,
} from "../utils/describeCrawlRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import { formatDayAndTime, formatElapsed, formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
import {
  WEBSITE_LIST_PATH,
  crawlRunLoginFailureScreenshotApiUrl,
  websiteDetailPath,
} from "../utils/routePaths";

/** The tint of the crawl's login tag for each login severity. */
const LOGIN_TAG_TONES: Record<CrawlRunSeverity, StatusTagTone> = {
  success: "loggedIn",
  info: "neutral",
  warning: "stale",
  error: "failed",
};

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
 * One crawl of a website (`/websites/:websiteId/crawl-runs/:crawlRunId`), as
 * the mockups draw it:
 * - "Crawl", with a tag saying who it viewed the site as (logged out, or
 *   logged in as a credential - the same for every page, because a logged-in
 *   crawl records nothing until its login works - or that the login failed);
 * - a status line: while running, a glowing dot, "12 of up to 50 pages · 8
 *   waiting", a progress bar, "2:14 of 10:00 max", and when it was last
 *   refreshed; once it ended, how it ended and how long it took (and why it
 *   failed, when it did);
 * - a screenshot of the login page when the login failed;
 * - the "Site map" of every page it found (a tree: each page under the page
 *   whose link first led to it) beside the selected page in full, aria
 *   snapshot included. On a phone the map comes first and the selected page
 *   follows below it.
 *
 * While the crawl runs, the run is re-fetched every 2 seconds (see
 * `useCrawlRunProgress`), so the status line and the site map grow live; if
 * the server briefly cannot be reached, the last good data stays and a
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
  const isPhoneLayout = useIsNarrowerThan("md");
  const crawlIsRunning = crawlRun?.status === "running";
  const now = useNow(crawlIsRunning);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // Every successful poll hands back a new run object: note when, for
  // "Updated just now".
  useEffect(() => {
    if (crawlRun !== null) {
      setLastRefreshedAt(new Date());
    }
  }, [crawlRun]);

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

  const breadcrumbs = (
    <PageBreadcrumbs
      crumbs={[
        { label: "Websites", to: WEBSITE_LIST_PATH },
        { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
        { label: crawlRun === null ? "Crawl" : `Crawl · ${formatDayAndTime(crawlRun.createdAt, now)}` },
      ]}
    />
  );

  if (crawlRun === null) {
    return (
      <PageContainer>
        {breadcrumbs}
        <LoadStatusNotice
          isLoading={crawlRunResource.isLoading}
          errorMessage={crawlRunResource.errorMessage}
          loadingLabel="Loading crawl"
        />
      </PageContainer>
    );
  }

  const startedAtText = formatFullDateTime(crawlRun.createdAt);
  const elapsedMs = now.getTime() - new Date(crawlRun.createdAt).getTime();
  const crawlHasErrorMessage = crawlRun.errorMessage !== null;
  const pollFailed = crawlRunResource.pollErrorMessage !== null;
  const crawlHasLoginFailureScreenshot = crawlRun.loginFailureScreenshotFileName !== null;
  const visitedPercent = Math.min(100, (crawlRun.visitedPageCount / Math.max(1, crawlRun.pageLimit)) * 100);
  const durationText = crawlRun.durationMs === null ? null : formatRunDuration(crawlRun.durationMs);

  const runningStatusLine = (
    <Box
      role="status"
      sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 3, fontSize: 13.5 }}
    >
      <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <StatusDot color={statusColors.running} isGlowing />
        Running
      </Box>
      <Box component="span" sx={{ color: nocturneTokens.neutral[300] }}>
        {describeCrawlRunProgress(crawlRun)}
      </Box>
      <LinearProgress
        variant="determinate"
        value={visitedPercent}
        aria-label="Pages crawled"
        sx={{ flex: 1, maxWidth: 320, backgroundColor: nocturneTokens.neutral[800] }}
      />
      <Box component="span" sx={{ color: nocturneTokens.neutral[400], fontVariantNumeric: "tabular-nums" }}>
        {formatElapsed(elapsedMs)} of {formatElapsed(CRAWL_TIME_LIMIT_MS)} max
      </Box>
      {lastRefreshedAt !== null && (
        <Box component="span" sx={{ ml: "auto", fontSize: 12, color: nocturneTokens.neutral[500] }}>
          Updated {formatRelativeTime(lastRefreshedAt.toISOString(), now)}
        </Box>
      )}
    </Box>
  );

  const endedStatusLine = (
    <Box role="status" sx={{ mb: 3, fontSize: 13.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <StatusDot color={crawlSeverityColors[crawlRunSeverity(crawlRun.status)]} />
        <span>
          {describeCrawlRunStatus(crawlRun)}
          {durationText === null ? "" : ` · ${durationText}`}
        </span>
      </Box>
      {crawlHasErrorMessage && (
        <Typography sx={{ fontSize: 13, color: statusColors.failedStepNote, mt: "6px", overflowWrap: "anywhere" }}>
          {crawlRun.errorMessage}
        </Typography>
      )}
    </Box>
  );

  let statusArea = endedStatusLine;
  if (crawlIsRunning) {
    statusArea = isPhoneLayout ? (
      <Box sx={{ mb: "18px" }}>
        <CrawlProgressCard run={crawlRun} title="Running" now={now} />
      </Box>
    ) : (
      runningStatusLine
    );
  }

  const siteMap = (
    <CrawlSiteMap
      pages={pages}
      selectedPageId={selectedPage?.id ?? null}
      onSelectPage={selectPage}
      isPhoneLayout={isPhoneLayout}
    />
  );
  const pageDetails = selectedPage !== null && (
    <CrawledPageDetails
      page={selectedPage}
      pageResource={selectedPageResource}
      visitedPagesByUrl={visitedPagesByUrl}
      visitedPagesById={visitedPagesById}
      onSelectPage={selectPage}
    />
  );

  return (
    <PageContainer>
      {breadcrumbs}

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: isPhoneLayout ? "10px" : "14px",
          mt: isPhoneLayout ? "6px" : 0,
          mb: isPhoneLayout ? "12px" : 1,
        }}
      >
        <Typography variant={isPhoneLayout ? "h3" : "h2"} component="h1" sx={{ m: 0, mr: "auto" }}>
          Crawl
        </Typography>
        <StatusTag label={describeCrawlRunLogin(crawlRun)} tone={LOGIN_TAG_TONES[crawlRunLoginSeverity(crawlRun)]} />
      </Box>

      {statusArea}

      {pollFailed && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not refresh the crawl ({crawlRunResource.pollErrorMessage}); still trying.
        </Alert>
      )}

      {crawlHasLoginFailureScreenshot && (
        <Box component="section" aria-labelledby="login-failure-screenshot-heading" sx={{ mb: 3 }}>
          <Typography id="login-failure-screenshot-heading" variant="h5" component="h2" sx={{ mb: 1 }}>
            Login failure screenshot
          </Typography>
          <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[400], mb: 1 }}>
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
              borderRadius: `${String(nocturneTokens.radius.medium)}px`,
              boxShadow: nocturneTokens.shadow.small,
            }}
          />
        </Box>
      )}

      {isPhoneLayout ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {siteMap}
          {pageDetails}
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "400px minmax(0,1fr)", gap: "28px", alignItems: "start" }}>
          {siteMap}
          <Box sx={{ minWidth: 0 }}>{pageDetails}</Box>
        </Box>
      )}
    </PageContainer>
  );
}
