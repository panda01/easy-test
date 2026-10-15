import { type ReactElement, type ReactNode, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import CrawlRunsSection, { CRAWL_LOGGED_OUT_VALUE } from "../components/CrawlRunsSection";
import CredentialsSection from "../components/CredentialsSection";
import LoadStatusNotice from "../components/LoadStatusNotice";
import MoreActionsMenu from "../components/MoreActionsMenu";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import ScreenshotRunsSection from "../components/ScreenshotRunsSection";
import StatusDot from "../components/StatusDot";
import WebsiteItemListSection from "../components/WebsiteItemListSection";
import { type CrawlRunRecord, useCrawlRuns } from "../hooks/useCrawlRuns";
import { useCredentials } from "../hooks/useCredentials";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useNow } from "../hooks/useNow";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation, useReturnToHereState } from "../hooks/useReturnNavigation";
import { type ScreenshotRunRecord, useScreenshotRuns } from "../hooks/useScreenshotRuns";
import { useWebsiteItems } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { formatCount } from "../utils/formatCount";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
import {
  WEBSITE_LIST_PATH,
  crawlRunDetailPath,
  crawlRunsApiUrl,
  screenshotRunsApiUrl,
  websiteApiUrl,
  websiteEditPath,
} from "../utils/routePaths";
import { ACTION_KIND, USE_CASE_KIND } from "../utils/websiteItemKinds";

/** The query parameter naming the open tab. */
const TAB_QUERY_PARAMETER = "tab";

/** Every tab the page can open: the side panel's three, plus Actions and Use cases on a phone. */
type WebsiteTab = "actions" | "crawls" | "use-cases" | "screenshots" | "credentials";

/** The text each tab shows (Credentials adds its count, Crawls a dot while one runs). */
const TAB_LABELS: Record<WebsiteTab, string> = {
  actions: "Actions",
  crawls: "Crawls",
  "use-cases": "Use cases",
  screenshots: "Screenshots",
  credentials: "Credentials",
};

/**
 * Picks the open tab from the query string: the requested one when this
 * layout offers it, otherwise the layout's first tab (an old link, a tab the
 * other layout has, or Credentials on a site that cannot log in).
 * @param requestedTab - The `?tab=` value, or null
 * @param availableTabs - The tabs this layout shows, in order
 * @returns The tab to show
 */
function chooseOpenTab(requestedTab: string | null, availableTabs: WebsiteTab[]): WebsiteTab {
  const requestedTabIsAvailable = availableTabs.some((tab) => tab === requestedTab);
  return requestedTabIsAvailable ? (requestedTab as WebsiteTab) : availableTabs[0];
}

/**
 * Shows a website's login page the short way the header does: its path when
 * it is on the website's own site ("/login"), or the full URL when it is not.
 * @param loginUrl - The login page URL
 * @param websiteUrl - The website's URL
 * @returns The path, or the full URL
 */
function formatLoginPage(loginUrl: string, websiteUrl: string): string {
  try {
    const parsedLoginUrl = new URL(loginUrl);
    const loginPageIsOnTheSameSite = parsedLoginUrl.origin === new URL(websiteUrl).origin;
    return loginPageIsOnTheSameSite ? parsedLoginUrl.pathname : loginUrl;
  } catch {
    return loginUrl;
  }
}

/**
 * A website's own page (`/websites/:websiteId`), laid out as the mockups do:
 * - a header with the name, the URL, the login page (or that it doesn't
 *   require login), when it was last updated, and Edit / Delete (behind a
 *   "⋯" menu on a phone);
 * - the website's Actions first (each with its run status, version, and
 *   whether it is out of date), then its Use cases as cards;
 * - a side panel with tabs for Crawls, Screenshots, and Credentials. On a
 *   phone the panel's tabs and the Actions and Use cases share one row of
 *   tabs instead. The open tab lives in the query string (`?tab=crawls`,
 *   replaced rather than pushed), so it survives a reload.
 *
 * "Take screenshot" (Screenshots tab) POSTs to the Playwright controller,
 * which visits the website's URL with a headless browser on the server's
 * machine and records the run. The request lasts as long as the visit (up to
 * 30 seconds), so the button is disabled and a progress bar shows meanwhile.
 * The recorded run is added to the top of the run list and selected.
 *
 * "Crawl website" (Crawls tab) POSTs a new crawl run - logged out, or logged
 * in as the credential picked in "Crawl as" - which the server crawls in the
 * background; the request answers at once, and the page then navigates to
 * the new run's own page to watch it grow. While a crawl runs, the crawl list
 * is re-fetched (see `useCrawlRuns`) so its progress card counts pages live.
 *
 * The login features - the Credentials tab and the "Crawl as" picker - show
 * only when the website or one of its credentials has a login page URL.
 * Otherwise nothing can log in, so both are hidden and every crawl is logged
 * out.
 *
 * The page fetches the website, both item lists, the screenshot runs, the
 * crawl runs, AND the credentials itself (rather than letting each section
 * fetch), so the delete dialog can say exactly how many of each will be
 * deleted along with the website, the login features can be shown or hidden
 * by the credentials' login page URLs, and the crawl tab can offer the same
 * credentials the Credentials tab lists.
 *
 * After a delete it returns to the dashboard history-aware (see
 * `useReturnNavigation`); a later Forward onto this deleted website shows the
 * server's "Website not found".
 * @returns The rendered website detail page
 */
export default function WebsiteDetailPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const websiteResource = useWebsite(websiteId);
  const useCasesResource = useWebsiteItems(USE_CASE_KIND, websiteId);
  const actionsResource = useWebsiteItems(ACTION_KIND, websiteId);
  const screenshotRuns = useScreenshotRuns(websiteId);
  const { addTakenRun } = screenshotRuns;
  const crawlRunsResource = useCrawlRuns(websiteId);
  const crawlRuns = crawlRunsResource.data ?? [];
  const credentialsResource = useCredentials(websiteId);
  const credentials = credentialsResource.data ?? [];
  const website = websiteResource.data;
  const navigate = useNavigate();
  const isPhoneLayout = useIsNarrowerThan("md");
  const [searchParams, setSearchParams] = useSearchParams();
  const aCrawlIsRunning = crawlRuns.some((run) => run.status === "running");
  const now = useNow(aCrawlIsRunning);

  const returnToHereState = useReturnToHereState();
  const { returnTo } = useReturnNavigation();
  const { sendJsonRequest, isSubmitting, errorMessage: deleteErrorMessage } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);
  const {
    sendJsonRequest: sendScreenshotRequest,
    isSubmitting: screenshotIsInFlight,
    errorMessage: screenshotErrorMessage,
  } = useJsonMutation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const {
    sendJsonRequest: sendCrawlRequest,
    isSubmitting: crawlStartIsInFlight,
    errorMessage: crawlStartErrorMessage,
  } = useJsonMutation();
  const [selectedCredentialId, setSelectedCredentialId] = useState(CRAWL_LOGGED_OUT_VALUE);

  const websiteLoginUrl = website?.loginUrl ?? null;
  const websiteRequiresLogin = websiteLoginUrl !== null;
  const aCredentialHasItsOwnLoginUrl = credentials.some(
    (credential) => credential.loginUrl !== null,
  );
  const loginFeaturesAreShown = websiteRequiresLogin || aCredentialHasItsOwnLoginUrl;

  const panelTabs: WebsiteTab[] = loginFeaturesAreShown
    ? ["crawls", "screenshots", "credentials"]
    : ["crawls", "screenshots"];
  const availableTabs: WebsiteTab[] = isPhoneLayout
    ? ["actions", "crawls", "use-cases", "screenshots", ...panelTabs.slice(2)]
    : panelTabs;
  const openTab = chooseOpenTab(searchParams.get(TAB_QUERY_PARAMETER), availableTabs);

  const useCaseCount = useCasesResource.data?.length ?? 0;
  const actionCount = actionsResource.data?.length ?? 0;
  const useCaseCountText = formatCount(
    useCaseCount,
    USE_CASE_KIND.singularLabel,
    USE_CASE_KIND.pluralLabel,
  );
  const actionCountText = formatCount(
    actionCount,
    ACTION_KIND.singularLabel,
    ACTION_KIND.pluralLabel,
  );
  const screenshotRunCountText = formatCount(
    screenshotRuns.runs.length,
    "screenshot run",
    "screenshot runs",
  );
  const crawlRunCountText = formatCount(crawlRuns.length, "crawl run", "crawl runs");
  const credentialCountText = formatCount(credentials.length, "credential", "credentials");

  /**
   * Opens another tab, replacing the query string entry so tab switches do
   * not pile up in history.
   * @param _event - The tab change event (unused)
   * @param tab - The picked tab
   */
  const handleTabChange = (_event: unknown, tab: WebsiteTab): void => {
    setSearchParams({ [TAB_QUERY_PARAMETER]: tab }, { replace: true });
  };

  /**
   * POSTs a new screenshot run for this website and, when the server recorded
   * it, puts it at the top of the run list and selects it. A failed VISIT
   * (e.g. HTTP 404, connection refused) is still a recorded run; only a
   * request failure shows the error alert in the Screenshots tab.
   * @returns Resolves once the request is done
   */
  const takeScreenshot = async (): Promise<void> => {
    const result = await sendScreenshotRequest("POST", screenshotRunsApiUrl(websiteId));
    if (!result.succeeded) return;
    // The API is the contract for this shape, as in the typed resource hooks.
    const takenRun = result.data as ScreenshotRunRecord;
    addTakenRun(takenRun);
    setSelectedRunId(takenRun.id);
  };

  /**
   * Starts a screenshot run without returning its promise, because a button's
   * `onClick` expects a plain void callback.
   */
  const handleTakeScreenshotClick = (): void => {
    void takeScreenshot();
  };

  /**
   * POSTs a new crawl run for this website - with the credential picked in
   * "Crawl as", or `credentialId: null` to crawl logged out (always, while the
   * login features are hidden) - and, when the server started it, opens the
   * run's own page to watch it. The crawl follows links only: the request
   * leaves `buttonMode` out, which the server reads as `linksOnly`. A refused
   * start (e.g. a crawl is already running) shows the error alert in the
   * Crawls tab.
   * @returns Resolves once the request (and any navigation) is done
   */
  const startCrawl = async (): Promise<void> => {
    const loggedOutIsPicked = selectedCredentialId === CRAWL_LOGGED_OUT_VALUE;
    const crawlIsLoggedOut = loggedOutIsPicked || !loginFeaturesAreShown;
    const credentialId = crawlIsLoggedOut ? null : selectedCredentialId;
    const result = await sendCrawlRequest("POST", crawlRunsApiUrl(websiteId), { credentialId });
    if (!result.succeeded) return;
    // The API is the contract for this shape, as in the typed resource hooks.
    const startedRun = result.data as CrawlRunRecord;
    void navigate(crawlRunDetailPath(websiteId, startedRun.id));
  };

  /**
   * Starts a crawl without returning its promise, because a button's
   * `onClick` expects a plain void callback.
   */
  const handleCrawlClick = (): void => {
    void startCrawl();
  };

  /** Opens the delete confirmation dialog. */
  const handleDeleteClick = (): void => {
    setDeleteDialogIsOpen(true);
  };

  /** Closes the delete confirmation dialog without deleting. */
  const handleDeleteCancel = (): void => {
    setDeleteDialogIsOpen(false);
  };

  /**
   * DELETEs the website (the server soft deletes its use cases, actions,
   * screenshot runs, scripts, crawls, and credentials with it) and, when that
   * succeeds, returns to the dashboard. On failure the dialog stays open and
   * shows the server's reason.
   * @returns Resolves once the request (and any navigation) is done
   */
  const deleteWebsite = async (): Promise<void> => {
    const result = await sendJsonRequest("DELETE", websiteApiUrl(websiteId));
    if (!result.succeeded) return;
    setDeleteDialogIsOpen(false);
    returnTo(WEBSITE_LIST_PATH);
  };

  /**
   * Starts the delete without returning its promise, because the dialog's
   * `onConfirm` prop expects a plain void callback.
   */
  const handleDeleteConfirm = (): void => {
    void deleteWebsite();
  };

  /**
   * Builds one tab of the tab row: its text (Credentials with its count,
   * Crawls with a glowing dot while one runs) and the ids that tie it to its
   * panel.
   * @param tab - Which tab
   * @returns The tab
   */
  const renderTab = (tab: WebsiteTab): ReactElement => {
    const credentialsTabHasACount = tab === "credentials" && credentialsResource.data !== null;
    const crawlsTabShowsTheRunningDot = tab === "crawls" && aCrawlIsRunning && isPhoneLayout;
    const tabText = credentialsTabHasACount
      ? `${TAB_LABELS[tab]} · ${String(credentials.length)}`
      : TAB_LABELS[tab];
    return (
      <Tab
        key={tab}
        value={tab}
        id={`website-tab-${tab}`}
        aria-controls={`website-tabpanel-${tab}`}
        label={
          <Box component="span" sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {tabText}
            {crawlsTabShowsTheRunningDot && <StatusDot color={statusColors.running} size={6} />}
          </Box>
        }
      />
    );
  };

  if (website === null) {
    return (
      <PageContainer>
        <PageBreadcrumbs crumbs={[{ label: "Websites", to: WEBSITE_LIST_PATH }, { label: "Website" }]} />
        <LoadStatusNotice
          isLoading={websiteResource.isLoading}
          errorMessage={websiteResource.errorMessage}
          loadingLabel="Loading website"
        />
      </PageContainer>
    );
  }

  const actionsSection = (
    <WebsiteItemListSection
      itemKind={ACTION_KIND}
      websiteId={website.id}
      itemsResource={actionsResource}
      returnToHereState={returnToHereState}
      isPhoneLayout={isPhoneLayout}
    />
  );
  const useCasesSection = (
    <WebsiteItemListSection
      itemKind={USE_CASE_KIND}
      websiteId={website.id}
      itemsResource={useCasesResource}
      returnToHereState={returnToHereState}
      isPhoneLayout={isPhoneLayout}
    />
  );

  const tabContent: Record<WebsiteTab, ReactNode> = {
    actions: actionsSection,
    "use-cases": useCasesSection,
    crawls: (
      <CrawlRunsSection
        websiteId={website.id}
        runs={crawlRuns}
        isLoading={crawlRunsResource.isLoading}
        errorMessage={crawlRunsResource.errorMessage}
        isStartingCrawl={crawlStartIsInFlight}
        startCrawlErrorMessage={crawlStartErrorMessage}
        onCrawlClick={handleCrawlClick}
        crawlAsPickerIsShown={loginFeaturesAreShown}
        credentials={credentials}
        selectedCredentialId={selectedCredentialId}
        onSelectedCredentialChange={setSelectedCredentialId}
        now={now}
      />
    ),
    screenshots: (
      <ScreenshotRunsSection
        websiteId={website.id}
        networkIdleTimeoutMs={website.networkIdleTimeoutMs}
        screenshotMinimumWaitMs={website.screenshotMinimumWaitMs}
        runs={screenshotRuns.runs}
        isLoading={screenshotRuns.isLoading}
        errorMessage={screenshotRuns.errorMessage}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
        isTakingScreenshot={screenshotIsInFlight}
        takeScreenshotErrorMessage={screenshotErrorMessage}
        onTakeScreenshotClick={handleTakeScreenshotClick}
      />
    ),
    credentials: (
      <CredentialsSection
        websiteId={website.id}
        credentialsResource={credentialsResource}
        returnToHereState={returnToHereState}
      />
    ),
  };

  const tabRow = (
    <Tabs
      value={openTab}
      onChange={handleTabChange}
      aria-label="Website sections"
      variant={isPhoneLayout ? "scrollable" : "standard"}
      scrollButtons={false}
      sx={{ mb: isPhoneLayout ? "14px" : "18px", ...(isPhoneLayout ? { "& .MuiTabs-list": { gap: "18px" } } : {}) }}
    >
      {availableTabs.map(renderTab)}
    </Tabs>
  );
  const openTabPanel = (
    <Box role="tabpanel" id={`website-tabpanel-${openTab}`} aria-labelledby={`website-tab-${openTab}`}>
      {tabContent[openTab]}
    </Box>
  );

  const loginPageText = websiteRequiresLogin
    ? `Login page ${formatLoginPage(websiteLoginUrl, website.url)}`
    : "Doesn't require login";

  return (
    <PageContainer>
      <PageBreadcrumbs crumbs={[{ label: "Websites", to: WEBSITE_LIST_PATH }, { label: website.name }]} />

      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: isPhoneLayout ? 1 : 2,
          mt: isPhoneLayout ? "6px" : 0,
          mb: isPhoneLayout ? "18px" : "28px",
        }}
      >
        <Box sx={{ mr: "auto", minWidth: 0 }}>
          <Typography variant={isPhoneLayout ? "h3" : "h2"} component="h1" sx={{ mb: isPhoneLayout ? "4px" : "6px" }}>
            {website.name}
          </Typography>
          <Box
            sx={{
              display: "flex",
              gap: 2,
              flexWrap: "wrap",
              fontSize: 13,
              color: nocturneTokens.neutral[400],
            }}
          >
            <Link
              href={website.url}
              target="_blank"
              rel="noopener noreferrer"
              color="inherit"
              sx={{
                fontFamily: MONOSPACE_FONT_FAMILY,
                fontSize: isPhoneLayout ? 12 : 13,
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {website.url}
            </Link>
            {!isPhoneLayout && (
              <>
                <Box component="span" title={websiteLoginUrl ?? undefined}>
                  {loginPageText}
                </Box>
                <Box component="span" title={formatFullDateTime(website.updatedAt)}>
                  Updated {formatRelativeTime(website.updatedAt, now)}
                </Box>
              </>
            )}
          </Box>
        </Box>
        {isPhoneLayout ? (
          <MoreActionsMenu
            editPath={websiteEditPath(website.id)}
            editLinkState={returnToHereState}
            onDeleteClick={handleDeleteClick}
          />
        ) : (
          <>
            <Button
              component={RouterLink}
              to={websiteEditPath(website.id)}
              state={returnToHereState}
              variant="outlined"
              color="secondary"
            >
              Edit
            </Button>
            <Button onClick={handleDeleteClick} variant="outlined" color="secondary">
              Delete
            </Button>
          </>
        )}
      </Box>

      {isPhoneLayout ? (
        <>
          {tabRow}
          {openTabPanel}
        </>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 380px",
            gap: "36px",
            alignItems: "start",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: "36px", minWidth: 0 }}>
            {actionsSection}
            {useCasesSection}
          </Box>
          <Box
            component="aside"
            aria-label="Crawls, screenshots, and credentials"
            sx={{
              backgroundColor: nocturneTokens.surface,
              borderRadius: `${String(nocturneTokens.radius.large)}px`,
              padding: "6px 18px 20px",
              minWidth: 0,
            }}
          >
            {tabRow}
            {openTabPanel}
          </Box>
        </Box>
      )}

      <ConfirmDeleteDialog
        isOpen={deleteDialogIsOpen}
        title="Delete website?"
        message={`"${website.name}" will be deleted, along with its ${useCaseCountText}, ${actionCountText}, ${screenshotRunCountText}, ${crawlRunCountText}, and ${credentialCountText}.`}
        isDeleting={isSubmitting}
        errorMessage={deleteErrorMessage}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
      />
    </PageContainer>
  );
}
