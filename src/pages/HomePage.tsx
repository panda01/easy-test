import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import ActionStatusBar from "../components/ActionStatusBar";
import { AddIcon, ChevronRightIcon } from "../components/icons";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageContainer from "../components/PageContainer";
import StatusDot from "../components/StatusDot";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useReturnToHereState } from "../hooks/useReturnNavigation";
import { type WebsiteWithSummaryRecord, useWebsites } from "../hooks/useWebsites";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { describeDashboardTotals, describeLatestCrawl } from "../utils/describeWebsiteSummary";
import { NEW_WEBSITE_PATH, newWebsiteItemPath, websiteDetailPath } from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** The desktop row's columns: website, actions, last crawl, and the chevron. */
const DESKTOP_ROW_COLUMNS = "minmax(0,2.2fr) minmax(0,2fr) minmax(0,1.4fr) 28px";

/** Props for `WebsiteDashboardRow`. */
interface WebsiteDashboardRowProps {
  /** The website and its summary. */
  website: WebsiteWithSummaryRecord;
  /** True for the stacked phone card instead of the desktop grid row. */
  isPhoneLayout: boolean;
  /** The current moment, for the relative times. */
  now: Date;
}

/**
 * One website on the dashboard: its name and URL; its actions as a pass /
 * fail / not run bar, or "No actions yet — add the first one"; and its last
 * crawl (with a glowing dot while one runs).
 *
 * The whole row opens the website: the name is the row's one link, stretched
 * over the row, so the row stays a single tab stop while "add the first one"
 * (lifted above the stretched link) still opens the new-action form.
 * @param props - The website, the layout, and the current moment
 * @returns The rendered row
 */
function WebsiteDashboardRow(props: WebsiteDashboardRowProps): ReactElement {
  const { website, isPhoneLayout, now } = props;
  const { summary } = website;
  const websiteHasActions = summary.actionCount > 0;
  const crawlIsRunning = summary.latestCrawlRun?.status === "running";
  const returnToHereState = useReturnToHereState();

  const actionsCell = websiteHasActions ? (
    <ActionStatusBar
      counts={{
        passed: summary.passedActionCount,
        failed: summary.failedActionCount,
        notRun: summary.notRunActionCount,
      }}
      legendHasDots={!isPhoneLayout}
    />
  ) : (
    <Box component="span" sx={{ fontSize: isPhoneLayout ? 12.5 : 13, color: nocturneTokens.neutral[400] }}>
      No actions yet —{" "}
      <Link
        component={RouterLink}
        to={newWebsiteItemPath(ACTION_KIND, website.id)}
        state={returnToHereState}
        sx={{ position: "relative", zIndex: 1 }}
      >
        add the first one
      </Link>
    </Box>
  );

  return (
    <Box
      component="li"
      sx={{
        position: "relative",
        listStyle: "none",
        padding: isPhoneLayout ? "14px" : "16px",
        backgroundColor: nocturneTokens.surface,
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        "&:hover": { boxShadow: nocturneTokens.shadow.small },
        "&:focus-within": { boxShadow: nocturneTokens.shadow.small },
        ...(isPhoneLayout
          ? { display: "flex", flexDirection: "column", gap: "10px" }
          : {
              display: "grid",
              gridTemplateColumns: DESKTOP_ROW_COLUMNS,
              gap: "20px",
              alignItems: "center",
            }),
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Link
          component={RouterLink}
          to={websiteDetailPath(website.id)}
          state={returnToHereState}
          color="inherit"
          underline="none"
          sx={{
            display: "block",
            fontSize: 15,
            fontWeight: 500,
            mb: isPhoneLayout ? "2px" : "3px",
            "&:hover": { color: "inherit" },
            // Stretch the link over the whole row, so anywhere on it opens the website.
            "&::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit" },
          }}
        >
          {website.name}
        </Link>
        <Box
          sx={{
            fontFamily: MONOSPACE_FONT_FAMILY,
            fontSize: isPhoneLayout ? 12 : 12.5,
            color: nocturneTokens.neutral[400],
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {website.url}
        </Box>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>{actionsCell}</Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          fontSize: isPhoneLayout ? 12 : 13,
          color: isPhoneLayout ? nocturneTokens.neutral[400] : nocturneTokens.neutral[300],
        }}
      >
        {crawlIsRunning && <StatusDot color={statusColors.running} isGlowing />}
        {describeLatestCrawl(summary.latestCrawlRun, now)}
      </Box>
      {!isPhoneLayout && (
        <ChevronRightIcon aria-hidden="true" sx={{ fontSize: 18, color: nocturneTokens.neutral[500] }} />
      )}
    </Box>
  );
}

/**
 * The home page (`/`): the dashboard of every website. A header says how
 * many sites and actions there are and when a script last ran, with a "New
 * website" button; then one row per website (see `WebsiteDashboardRow`),
 * newest first, under column headings (Website / Actions / Last crawl) on
 * desktop, or as stacked cards on a phone. The old `/websites` URL redirects
 * here.
 *
 * The list is fetched on every mount (`GET /api/websites`, which brings each
 * website's summary), so coming Back here after a create, edit, run, or
 * delete shows the current data.
 * @returns The rendered dashboard
 */
export default function HomePage(): ReactElement {
  const { data: websites, isLoading, errorMessage } = useWebsites();
  const returnToHereState = useReturnToHereState();
  const isPhoneLayout = useIsNarrowerThan("md");
  const now = new Date();
  const thereAreWebsites = websites !== null && websites.length > 0;
  const thereAreNoWebsites = websites !== null && websites.length === 0;

  return (
    <PageContainer maxWidth={1080}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: isPhoneLayout ? "12px" : "16px",
          mt: isPhoneLayout ? "6px" : "16px",
          mb: isPhoneLayout ? "20px" : "28px",
        }}
      >
        <Box sx={{ mr: "auto" }}>
          <Typography variant={isPhoneLayout ? "h3" : "h2"} component="h1" sx={{ mb: isPhoneLayout ? "4px" : "6px" }}>
            Websites
          </Typography>
          {websites !== null && (
            <Typography sx={{ fontSize: isPhoneLayout ? 13 : 14, color: nocturneTokens.neutral[400] }}>
              {describeDashboardTotals(websites, now, !isPhoneLayout)}
            </Typography>
          )}
        </Box>
        <Button
          component={RouterLink}
          to={NEW_WEBSITE_PATH}
          state={returnToHereState}
          variant="outlined"
          startIcon={<AddIcon />}
          sx={{ minHeight: isPhoneLayout ? 44 : 36, flex: "none" }}
        >
          {isPhoneLayout ? "New" : "New website"}
        </Button>
      </Box>

      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading websites" />

      {thereAreNoWebsites && (
        <Typography color="text.secondary">
          No websites yet. Add one to start describing what to test.
        </Typography>
      )}

      {thereAreWebsites && (
        <>
          {!isPhoneLayout && (
            <Box
              aria-hidden="true"
              sx={{
                display: "grid",
                gridTemplateColumns: DESKTOP_ROW_COLUMNS,
                gap: "20px",
                px: "16px",
                pb: "10px",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: nocturneTokens.neutral[500],
              }}
            >
              <span>Website</span>
              <span>Actions</span>
              <span>Last crawl</span>
              <span />
            </Box>
          )}
          <Box
            component="ul"
            aria-label="Websites"
            sx={{ display: "flex", flexDirection: "column", gap: 1, m: 0, p: 0 }}
          >
            {websites.map((website) => (
              <WebsiteDashboardRow
                key={website.id}
                website={website}
                isPhoneLayout={isPhoneLayout}
                now={now}
              />
            ))}
          </Box>
        </>
      )}
    </PageContainer>
  );
}
