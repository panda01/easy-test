import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import ScreenshotRunDetails from "./ScreenshotRunDetails";
import StatusDot from "./StatusDot";
import { type ScreenshotRunRecord } from "../hooks/useScreenshotRuns";
import { nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { describeScreenshotRunOutcome } from "../utils/describeScreenshotRun";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";

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
  /** Called when the user clicks "Take screenshot". */
  onTakeScreenshotClick: () => void;
}

/**
 * The "Screenshots" tab of a website's page: the "Take screenshot" button
 * (disabled, with a progress bar, while one is being taken), a line saying
 * when screenshots are taken (the website's timing settings), the outcome
 * and image of the selected screenshot run (the newest one unless the user
 * picked another), and the "History" of every run to pick from.
 *
 * A run's outcome is shown as a `role="status"` alert - it is a result, not an
 * error the user must act on - while request failures stay `role="alert"`.
 * The tab names the section, so it has no heading of its own.
 * @param props - The timing settings, the runs, the request states, and the callbacks
 * @returns The rendered tab content
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
    onTakeScreenshotClick,
  } = props;

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0) ?? null;
  const takeScreenshotFailed = takeScreenshotErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;
  const networkIdleWaitIsDisabled = networkIdleTimeoutMs === 0;
  const now = new Date();
  const timingSettingsText = networkIdleWaitIsDisabled
    ? `Before each screenshot: doesn't wait for network requests; takes it at least ${String(screenshotMinimumWaitMs)} ms after the page loads.`
    : `Before each screenshot: waits up to ${String(networkIdleTimeoutMs)} ms for network requests to finish, then for the page to paint, and at least ${String(screenshotMinimumWaitMs)} ms after the page loads. If the network is still busy after ${String(networkIdleTimeoutMs)} ms, the screenshot is taken right away.`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Box>
        <Button onClick={onTakeScreenshotClick} disabled={isTakingScreenshot} variant="outlined">
          {isTakingScreenshot ? "Taking screenshot…" : "Take screenshot"}
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
        {timingSettingsText}
      </Typography>

      {isTakingScreenshot && <LinearProgress aria-label="Taking screenshot" />}

      {takeScreenshotFailed && (
        <Alert severity="error">Could not take a screenshot: {takeScreenshotErrorMessage}</Alert>
      )}

      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading screenshot runs"
      />

      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No screenshots yet.
        </Typography>
      )}

      {selectedRun !== null && <ScreenshotRunDetails websiteId={websiteId} run={selectedRun} />}

      {thereAreRuns && (
        <Box>
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
            {runs.map((run) => {
              const runIsSelected = run.id === selectedRun?.id;
              return (
                <Box component="li" key={run.id} sx={{ listStyle: "none" }}>
                  <ButtonBase
                    aria-current={runIsSelected ? "true" : undefined}
                    onClick={() => {
                      onSelectRun(run.id);
                    }}
                    sx={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      py: "9px",
                      px: "6px",
                      fontSize: 13,
                      fontFamily: "inherit",
                      textAlign: "left",
                      borderRadius: `${String(nocturneTokens.radius.small)}px`,
                      borderBottom: `1px solid ${nocturneTokens.rowRule}`,
                      backgroundColor: runIsSelected ? nocturneTokens.accentRamp[900] : "transparent",
                    }}
                  >
                    <StatusDot color={run.succeeded ? statusColors.passed : statusColors.failed} />
                    <Box component="span" sx={{ mr: "auto" }}>
                      {describeScreenshotRunOutcome(run)}
                    </Box>
                    <Box
                      component="span"
                      title={formatFullDateTime(run.createdAt)}
                      sx={{ color: nocturneTokens.neutral[400], whiteSpace: "nowrap" }}
                    >
                      {formatRelativeTime(run.createdAt, now)}
                    </Box>
                  </ButtonBase>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
