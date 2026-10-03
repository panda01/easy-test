import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CrawlRunRecord } from "../hooks/useCrawlRuns";
import { crawlRunSeverity, describeCrawlRunStatus } from "../utils/describeCrawlRun";
import { crawlRunDetailPath } from "../utils/routePaths";

const HEADING_ID = "crawl-runs-section-heading";
const HISTORY_HEADING_ID = "crawl-run-history-heading";

/** The theme colour each crawl severity is written in. */
const SEVERITY_TEXT_COLORS = {
  info: "info.main",
  success: "success.main",
  warning: "warning.main",
  error: "error.main",
} as const;

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
}

/**
 * The "Crawls" section of a website's page: what a crawl does, the "Crawl
 * website" button, and the "Crawl history" list, where each run links to its
 * own page (the page tree and each page's aria snapshot).
 *
 * The button is disabled while a crawl of this website is already running, as
 * well as while the request to start one is in flight. The section has no
 * `role="status"` region: a run's outcome is shown on its own page.
 * @param props - The runs, the request states, and the click handler
 * @returns The rendered section
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
  } = props;

  const aCrawlIsRunning = runs.some((run) => run.status === "running");
  const crawlButtonIsDisabled = isStartingCrawl || aCrawlIsRunning;
  const startCrawlFailed = startCrawlErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;

  let crawlButtonText = "Crawl website";
  if (isStartingCrawl) {
    crawlButtonText = "Starting crawl…";
  } else if (aCrawlIsRunning) {
    crawlButtonText = "Crawl running…";
  }

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 1 }}
      >
        <Typography id={HEADING_ID} variant="h5" component="h2">
          Crawls
        </Typography>
        <Button onClick={onCrawlClick} disabled={crawlButtonIsDisabled} variant="contained">
          {crawlButtonText}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A crawl starts at the website&apos;s URL and follows every link to another page on the
        same site (it only follows links - it never clicks buttons), up to 50 pages or 10
        minutes. It records each page&apos;s aria snapshot and the page it was found on.
      </Typography>

      {startCrawlFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not start a crawl: {startCrawlErrorMessage}
        </Alert>
      )}
      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading crawl runs"
      />
      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary">No crawls yet.</Typography>
      )}

      {thereAreRuns && (
        <>
          <Typography id={HISTORY_HEADING_ID} variant="subtitle1" component="h3" sx={{ mb: 1 }}>
            Crawl history
          </Typography>
          <Paper variant="outlined" sx={{ maxHeight: 320, overflow: "auto" }}>
            <List disablePadding aria-labelledby={HISTORY_HEADING_ID}>
              {runs.map((run) => (
                <ListItemButton
                  key={run.id}
                  component={RouterLink}
                  to={crawlRunDetailPath(websiteId, run.id)}
                  divider
                >
                  <ListItemText
                    primary={describeCrawlRunStatus(run)}
                    secondary={new Date(run.createdAt).toLocaleString()}
                    slotProps={{
                      primary: { sx: { color: SEVERITY_TEXT_COLORS[crawlRunSeverity(run.status)] } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </>
      )}
    </Box>
  );
}
