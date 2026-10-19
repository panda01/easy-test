import { type ReactElement, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import CrawledPageDetails from "../components/CrawledPageDetails";
import CrawlProgressCard from "../components/CrawlProgressCard";
import CrawlSiteMap, { type CrawlSiteMapView } from "../components/CrawlSiteMap";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import RenameWebObjectDialog from "../components/RenameWebObjectDialog";
import StatusDot from "../components/StatusDot";
import StatusTag, { type StatusTagTone } from "../components/StatusTag";
import { useCrawledPage } from "../hooks/useCrawledPage";
import {
  type CrawlPageGroupingRecord,
  type CrawlPageGroupingWebObjectRecord,
  type CrawledPageSummaryRecord,
  useCrawlRunProgress,
} from "../hooks/useCrawlRunProgress";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useNow } from "../hooks/useNow";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useWebObjectRenaming } from "../hooks/useWebObjects";
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
import { chooseWebObjectName } from "../utils/describeWebObject";
import { formatCount } from "../utils/formatCount";
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

/** The query parameter naming the site map's view; `objects` for the Objects view, absent for the tree. */
const VIEW_QUERY_PARAMETER = "view";

/** No pages grouped yet: what the Objects view shows before the run has loaded. */
const EMPTY_PAGE_GROUPING: CrawlPageGroupingRecord = { webObjects: [], standalonePageIds: [] };

/**
 * Reads the site map's view from the query string: `?view=objects` is the
 * Objects view, anything else the tree.
 * @param requestedView - The `?view=` value, or null
 * @returns The view to show
 */
function chooseSiteMapView(requestedView: string | null): CrawlSiteMapView {
  return requestedView === "objects" ? "objects" : "tree";
}

/**
 * Applies the renames saved on this visit to a run's grouping, so a new
 * name shows at once.
 * @param pageGrouping - The run's grouping, as fetched
 * @param renamedNamesById - The names saved on this visit, by web object id
 * @returns The grouping with each renamed object's `displayName` replaced
 */
function applyRenames(
  pageGrouping: CrawlPageGroupingRecord,
  renamedNamesById: ReadonlyMap<string, string | null>,
): CrawlPageGroupingRecord {
  const webObjects = pageGrouping.webObjects.map((webObject) => ({
    ...webObject,
    displayName: chooseWebObjectName(
      webObject.webObjectId,
      webObject.displayName,
      webObject.detectedName,
      renamedNamesById,
    ),
  }));
  return { ...pageGrouping, webObjects };
}

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
 * - the "Site map" of every page it found beside the selected page in full,
 *   aria snapshot included - drawn as a tree (each page under the page whose
 *   link first led to it) or, with its Tree / Objects switch, grouped into
 *   web objects by URL pattern, where a saved object can be renamed (see
 *   `RenameWebObjectDialog`). On a phone the map comes first and the
 *   selected page follows below it. When the crawl skipped links because it
 *   already had 3 pages of their pattern, the ended status line says how
 *   many.
 *
 * While the crawl runs, the run is re-fetched every 2 seconds (see
 * `useCrawlRunProgress`), so the status line and the site map grow live; if
 * the server briefly cannot be reached, the last good data stays and a
 * warning says it is retrying. The selected page and the site map's view
 * live in the query string (`?page=<crawledPageId>&view=objects`, replaced
 * rather than pushed); the page defaults to the start page and the view to
 * the tree, so both survive a reload.
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
  const { renamedNamesById, renameWebObject, isRenaming, renameErrorMessage } =
    useWebObjectRenaming(websiteId);
  const [webObjectBeingRenamed, setWebObjectBeingRenamed] =
    useState<CrawlPageGroupingWebObjectRecord | null>(null);

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
  const siteMapView = chooseSiteMapView(searchParams.get(VIEW_QUERY_PARAMETER));
  const pageGrouping = applyRenames(crawlRun?.pageGrouping ?? EMPTY_PAGE_GROUPING, renamedNamesById);

  /**
   * Shows the picked page in full, replacing the query string entry and
   * keeping the site map's view.
   * @param crawledPageId - The picked page's id
   */
  const selectPage = (crawledPageId: string): void => {
    setSearchParams(
      (previousParams) => {
        const nextParams = new URLSearchParams(previousParams);
        nextParams.set(PAGE_QUERY_PARAMETER, crawledPageId);
        return nextParams;
      },
      { replace: true },
    );
  };

  /**
   * Switches the site map's view, replacing the query string entry and
   * keeping the selected page. The tree is the default, so it leaves
   * `view` out.
   * @param pickedView - The view to show
   */
  const changeSiteMapView = (pickedView: CrawlSiteMapView): void => {
    setSearchParams(
      (previousParams) => {
        const nextParams = new URLSearchParams(previousParams);
        if (pickedView === "objects") {
          nextParams.set(VIEW_QUERY_PARAMETER, pickedView);
        } else {
          nextParams.delete(VIEW_QUERY_PARAMETER);
        }
        return nextParams;
      },
      { replace: true },
    );
  };

  /**
   * Saves the dialog's name for the object being renamed, closing the
   * dialog when the server saved it.
   * @param name - The new name, or null for the detected name
   * @returns Resolves once the request is done
   */
  const saveRename = async (name: string | null): Promise<void> => {
    const webObjectId = webObjectBeingRenamed?.webObjectId ?? null;
    if (webObjectId === null) return;
    const renameWasSaved = await renameWebObject(webObjectId, name);
    if (renameWasSaved) {
      setWebObjectBeingRenamed(null);
    }
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
  const crawlSkippedSimilarLinks = crawlRun.skippedSimilarUrlCount > 0;
  const skippedLinksText = crawlSkippedSimilarLinks
    ? ` · ${formatCount(crawlRun.skippedSimilarUrlCount, "similar page", "similar pages")} skipped`
    : "";

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
          {skippedLinksText}
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
      objectsView={{
        siteMapView,
        onSiteMapViewChange: changeSiteMapView,
        pageGrouping,
        onRenameWebObject: setWebObjectBeingRenamed,
      }}
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

      <RenameWebObjectDialog
        webObject={
          webObjectBeingRenamed === null
            ? null
            : {
                currentName: chooseWebObjectName(
                  webObjectBeingRenamed.webObjectId,
                  webObjectBeingRenamed.displayName,
                  webObjectBeingRenamed.detectedName,
                  renamedNamesById,
                ),
                detectedName: webObjectBeingRenamed.detectedName,
              }
        }
        isSaving={isRenaming}
        errorMessage={renameErrorMessage}
        onSave={(name) => {
          void saveRename(name);
        }}
        onCancel={() => {
          setWebObjectBeingRenamed(null);
        }}
      />
    </PageContainer>
  );
}
