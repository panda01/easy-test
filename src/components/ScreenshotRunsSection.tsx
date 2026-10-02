import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import ScreenshotRunDetails from "./ScreenshotRunDetails";
import { type ScreenshotRunRecord } from "../hooks/useScreenshotRuns";
import { describeScreenshotRunOutcome } from "../utils/describeScreenshotRun";

const HEADING_ID = "screenshot-runs-section-heading";
const HISTORY_HEADING_ID = "screenshot-run-history-heading";

/** Props for `ScreenshotRunsSection`. */
export interface ScreenshotRunsSectionProps {
  /** The owning website's cuid, for the screenshot image urls. */
  websiteId: string;
  /** The website's cap on waiting for network requests to finish, in ms; 0 = don't wait. */
  networkIdleTimeoutMs: number;
  /** The website's floor on the time from page load to screenshot, in ms. */
  screenshotMinimumWaitMs: number;
  /** Every run to show, newest first (see `useScreenshotRuns`). */
  runs: ScreenshotRunRecord[];
  /** True while the run list is loading. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** The run the user picked from the history; null (or an unknown id) shows the newest run. */
  selectedRunId: string | null;
  /** Called with a run's id when the user picks it from the history. */
  onSelectRun: (screenshotRunId: string) => void;
  /** True while a "Take screenshot" request is in flight. */
  isTakingScreenshot: boolean;
  /** Why the last "Take screenshot" request failed, or null. */
  takeScreenshotErrorMessage: string | null;
}

/**
 * The "Screenshots" section of a website's detail page: a line saying when
 * screenshots are taken (the website's timing settings), the outcome and
 * image of the selected screenshot run (the newest one unless the user picked
 * another), and the history of every run to pick from.
 *
 * A run's outcome is shown as a `role="status"` alert - it is a result, not an
 * error the user must act on - while request failures stay `role="alert"`.
 * @param props - The timing settings, the runs, the request states, and the selection callback
 * @returns The rendered section
 */
export default function ScreenshotRunsSection(props: ScreenshotRunsSectionProps): ReactElement {
  const {
    websiteId,
    networkIdleTimeoutMs,
    screenshotMinimumWaitMs,
    runs,
    isLoading,
    errorMessage,
    selectedRunId,
    onSelectRun,
    isTakingScreenshot,
    takeScreenshotErrorMessage,
  } = props;

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0) ?? null;
  const takeScreenshotFailed = takeScreenshotErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;
  const networkIdleWaitIsDisabled = networkIdleTimeoutMs === 0;
  const timingSettingsText = networkIdleWaitIsDisabled
    ? `Before each screenshot: doesn't wait for network requests; takes it at least ${String(screenshotMinimumWaitMs)} ms after the page loads.`
    : `Before each screenshot: waits up to ${String(networkIdleTimeoutMs)} ms for network requests to finish, then for the page to paint, and at least ${String(screenshotMinimumWaitMs)} ms after the page loads. If the network is still busy after ${String(networkIdleTimeoutMs)} ms, the screenshot is taken right away.`;

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Typography id={HEADING_ID} variant="h5" component="h2" sx={{ mb: 1 }}>
        Screenshots
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {timingSettingsText}
      </Typography>

      {isTakingScreenshot && <LinearProgress aria-label="Taking screenshot" sx={{ mb: 2 }} />}

      {takeScreenshotFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not take a screenshot: {takeScreenshotErrorMessage}
        </Alert>
      )}

      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading screenshot runs"
      />

      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary">No screenshots yet.</Typography>
      )}

      {selectedRun !== null && <ScreenshotRunDetails websiteId={websiteId} run={selectedRun} />}

      {thereAreRuns && (
        <>
          <Typography
            id={HISTORY_HEADING_ID}
            variant="subtitle1"
            component="h3"
            sx={{ mt: 3, mb: 1 }}
          >
            Run history
          </Typography>
          <Paper variant="outlined" sx={{ maxHeight: 320, overflow: "auto" }}>
            <List disablePadding aria-labelledby={HISTORY_HEADING_ID}>
              {runs.map((run) => {
                const runIsSelected = run.id === selectedRun?.id;
                return (
                  <ListItemButton
                    key={run.id}
                    selected={runIsSelected}
                    aria-current={runIsSelected ? "true" : undefined}
                    onClick={() => {
                      onSelectRun(run.id);
                    }}
                    divider
                  >
                    <ListItemText
                      primary={describeScreenshotRunOutcome(run)}
                      secondary={new Date(run.createdAt).toLocaleString()}
                      slotProps={{
                        primary: { sx: { color: run.succeeded ? "success.main" : "error.main" } },
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Paper>
        </>
      )}
    </Box>
  );
}
