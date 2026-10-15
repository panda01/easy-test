import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import CrawlProgressCard from "./CrawlProgressCard";
import LoadStatusNotice from "./LoadStatusNotice";
import StatusDot from "./StatusDot";
import { type CrawlRunRecord } from "../hooks/useCrawlRuns";
import { type CredentialRecord } from "../hooks/useCredentials";
import { crawlSeverityColors, nocturneTokens } from "../theme/nocturneTheme";
import { crawlRunHistorySeverity, describeCrawlRunHistoryLabel } from "../utils/describeCrawlRun";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
import { crawlRunDetailPath } from "../utils/routePaths";

const CRAWL_AS_LABEL_ID = "crawl-as-label";
const HISTORY_HEADING_ID = "crawl-run-history-heading";

/**
 * The "Crawl as" picker's value for a crawl as a logged-out visitor. Every
 * other value is a credential's id (a cuid, never empty).
 */
export const CRAWL_LOGGED_OUT_VALUE = "";

/**
 * Words the History's empty line for a "Crawl as" pick that none of the
 * ended crawls was made as.
 * @param pickedCredentialIdOrNullForLoggedOut - The picked credential's id, or null for "Logged out"
 * @param credentials - The website's credentials, to name the picked one
 * @returns "No logged-out crawls yet." or e.g. "No crawls as “Admin” yet." (or "…as the picked credential…" if it is no longer listed)
 */
function describeNoCrawlsForPick(
  pickedCredentialIdOrNullForLoggedOut: string | null,
  credentials: CredentialRecord[],
): string {
  const loggedOutIsPicked = pickedCredentialIdOrNullForLoggedOut === null;
  if (loggedOutIsPicked) {
    return "No logged-out crawls yet.";
  }
  const pickedCredential = credentials.find(
    (credential) => credential.id === pickedCredentialIdOrNullForLoggedOut,
  );
  const pickedCredentialIsListed = pickedCredential !== undefined;
  return pickedCredentialIsListed
    ? `No crawls as “${pickedCredential.name}” yet.`
    : "No crawls as the picked credential yet.";
}

/** Props for `CrawlRunsSection`. */
export interface CrawlRunsSectionProps {
  /** The owning website's cuid, for the run page links. */
  websiteId: string;
  /** Every crawl run of the website, newest first (see `useCrawlRuns`). */
  runs: CrawlRunRecord[];
  /** True while the run list is loading. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** True while a "Crawl website" request is in flight. */
  isStartingCrawl: boolean;
  /** Why the last "Crawl website" request failed (e.g. a crawl is already running), or null. */
  startCrawlErrorMessage: string | null;
  /** Called when the user clicks "Crawl website". */
  onCrawlClick: () => void;
  /**
   * True when the "Crawl as" picker is shown: the website or one of its
   * credentials has a login page URL. False hides it, for a website that is
   * only ever crawled logged out. While it is shown, the picked option also
   * filters the History; while it is hidden, the History lists every ended run.
   */
  crawlAsPickerIsShown: boolean;
  /** The website's credentials, offered in the "Crawl as" picker. */
  credentials: CredentialRecord[];
  /**
   * The picked credential's id, or `CRAWL_LOGGED_OUT_VALUE` to crawl logged
   * out. It picks who the next crawl logs in as and, while the picker is
   * shown, which ended runs the History lists (only those made as that
   * credential, or only the logged-out ones).
   */
  selectedCredentialId: string;
  /** Called with the newly picked credential's id (or `CRAWL_LOGGED_OUT_VALUE`). */
  onSelectedCredentialChange: (credentialId: string) => void;
  /** The current moment, ticking while a crawl runs, for its elapsed time. */
  now: Date;
}

/**
 * The "Crawls" tab of a website's page, as the mockup's side panel draws it:
 * - "Crawl as" (logged out, or one of the website's credentials; hidden for
 *   a website without any login page URL) beside the "Crawl website" button,
 *   which is disabled while a crawl of this website runs - "One crawl at a
 *   time" says why - and while the request to start one is in flight;
 * - the running crawl, if any, as a live progress card with a "Watch" link
 *   to its own page - shown whoever it runs as, since it is why the button
 *   is disabled;
 * - the "History" of the ended crawls made as the person picked in "Crawl
 *   as" (every ended crawl when the picker is hidden): a colored dot, how
 *   each went (or that its login failed), and when, each linking to its own
 *   page. When the pick matches none of them, a line says so ("No crawls as
 *   “Admin” yet."). Crawls made as a since-deleted credential match no
 *   option, so they stay hidden.
 *
 * The tab names the section, so it has no heading of its own.
 * @param props - The runs, the credentials and the picked one, the request states, the handlers, and the current time
 * @returns The rendered tab content
 */
export default function CrawlRunsSection(props: CrawlRunsSectionProps): ReactElement {
  const {
    websiteId,
    runs,
    isLoading,
    errorMessage,
    isStartingCrawl,
    startCrawlErrorMessage,
    onCrawlClick,
    crawlAsPickerIsShown,
    credentials,
    selectedCredentialId,
    onSelectedCredentialChange,
    now,
  } = props;

  const runningRun = runs.find((run) => run.status === "running") ?? null;
  const aCrawlIsRunning = runningRun !== null;
  const endedRuns = runs.filter((run) => run.status !== "running");
  const crawlButtonIsDisabled = isStartingCrawl || aCrawlIsRunning;
  const startCrawlFailed = startCrawlErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreEndedRuns = endedRuns.length > 0;

  // A run's credentialId is null for a logged-out crawl, while the picker's
  // logged-out value is "": map it so the two can be compared.
  const pickedCredentialIdOrNullForLoggedOut =
    selectedCredentialId === CRAWL_LOGGED_OUT_VALUE ? null : selectedCredentialId;
  // No picker means nothing to filter by: list every ended run.
  const historyIsFilteredByCrawlAs = crawlAsPickerIsShown;
  const endedRunsShownInHistory = historyIsFilteredByCrawlAs
    ? endedRuns.filter((run) => run.credentialId === pickedCredentialIdOrNullForLoggedOut)
    : endedRuns;
  const thereAreEndedRunsShownInHistory = endedRunsShownInHistory.length > 0;
  const theFilterHidesEveryEndedRun = thereAreEndedRuns && !thereAreEndedRunsShownInHistory;
  const noMatchingCrawlsText = describeNoCrawlsForPick(
    pickedCredentialIdOrNullForLoggedOut,
    credentials,
  );

  /**
   * Hands the picked "Crawl as" option to the page.
   * @param event - The picker's change event
   */
  const handleCrawlAsChange = (event: SelectChangeEvent): void => {
    onSelectedCredentialChange(event.target.value);
  };

  const crawlButton = (
    <Button
      onClick={onCrawlClick}
      disabled={crawlButtonIsDisabled}
      variant="outlined"
      sx={{ flex: "none" }}
    >
      {isStartingCrawl ? "Starting crawl…" : "Crawl website"}
    </Button>
  );

  return (
    <Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", mb: "14px" }}>
        {crawlAsPickerIsShown ? (
          <>
            <Box
              component="label"
              id={CRAWL_AS_LABEL_ID}
              sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}
            >
              Crawl as
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Select
                labelId={CRAWL_AS_LABEL_ID}
                value={selectedCredentialId}
                onChange={handleCrawlAsChange}
                size="small"
                // The logged-out option's value is "", which MUI renders as an
                // empty field unless told to display it.
                displayEmpty
                sx={{ flex: 1, minWidth: 0 }}
              >
                <MenuItem value={CRAWL_LOGGED_OUT_VALUE}>Logged out</MenuItem>
                {credentials.map((credential) => (
                  <MenuItem key={credential.id} value={credential.id}>
                    {credential.name}
                  </MenuItem>
                ))}
              </Select>
              {crawlButton}
            </Box>
          </>
        ) : (
          <Box>{crawlButton}</Box>
        )}
        {aCrawlIsRunning && (
          <Box component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
            One crawl at a time — wait for the current one to finish.
          </Box>
        )}
      </Box>

      {startCrawlFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not start a crawl: {startCrawlErrorMessage}
        </Alert>
      )}

      {runningRun !== null && (
        <Box sx={{ mb: "18px" }}>
          <CrawlProgressCard
            run={runningRun}
            title="Crawl running"
            now={now}
            watchPath={crawlRunDetailPath(websiteId, runningRun.id)}
          />
        </Box>
      )}

      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading crawl runs"
      />
      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No crawls yet.
        </Typography>
      )}

      {theFilterHidesEveryEndedRun && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          {noMatchingCrawlsText}
        </Typography>
      )}

      {thereAreEndedRunsShownInHistory && (
        <>
          <Box
            id={HISTORY_HEADING_ID}
            component="h3"
            sx={{
              m: 0,
              mb: "6px",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: nocturneTokens.neutral[500],
            }}
          >
            History
          </Box>
          <Box component="ul" aria-labelledby={HISTORY_HEADING_ID} sx={{ m: 0, p: 0 }}>
            {endedRunsShownInHistory.map((run) => (
              <Box component="li" key={run.id} sx={{ listStyle: "none" }}>
                <Box
                  component={RouterLink}
                  to={crawlRunDetailPath(websiteId, run.id)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    py: "9px",
                    fontSize: 13,
                    color: "inherit",
                    textDecoration: "none",
                    borderBottom: `1px solid ${nocturneTokens.rowRule}`,
                    "&:hover": { color: nocturneTokens.accentRamp[300] },
                  }}
                >
                  <StatusDot color={crawlSeverityColors[crawlRunHistorySeverity(run)]} />
                  <Box component="span" sx={{ mr: "auto" }}>
                    {describeCrawlRunHistoryLabel(run)}
                  </Box>
                  <Box
                    component="span"
                    title={formatFullDateTime(run.createdAt)}
                    sx={{ color: nocturneTokens.neutral[400], whiteSpace: "nowrap" }}
                  >
                    {formatRelativeTime(run.createdAt, now)}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
