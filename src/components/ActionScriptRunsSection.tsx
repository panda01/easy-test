import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ActionScriptRunDetails from "./ActionScriptRunDetails";
import LoadStatusNotice from "./LoadStatusNotice";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";

const HEADING_ID = "action-script-runs-section-heading";
const HISTORY_HEADING_ID = "action-script-run-history-heading";

/** Props for `ActionScriptRunsSection`. */
export interface ActionScriptRunsSectionProps {
  /** The owning website's cuid, for the failure screenshot urls. */
  websiteId: string;
  /** The version number of the script these runs belong to. */
  versionNumber: number;
  /** Every run of that script, newest first (see `useActionScriptRuns`). */
  runs: ActionScriptRunRecord[];
  /** True while the run list is loading. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** The run the user picked; null (or an unknown id) shows the newest run. */
  selectedRunId: string | null;
  /** Called with a run's id when the user picks it from the history. */
  onSelectRun: (actionScriptRunId: string) => void;
  /** True while a "Run script" request is in flight. */
  isRunning: boolean;
  /** Why the last "Run script" request failed, or null. */
  runErrorMessage: string | null;
  /** Called when the user clicks "Run script". */
  onRunClick: () => void;
}

/**
 * The "Runs" section for the selected script version: the "Run script"
 * button (it opens a browser window on this computer and works through the
 * steps), the selected run in full (the newest unless the user picked
 * another), and the run history to pick from.
 * @param props - The runs, the request states, and the callbacks
 * @returns The rendered section
 */
export default function ActionScriptRunsSection(props: ActionScriptRunsSectionProps): ReactElement {
  const {
    websiteId,
    versionNumber,
    runs,
    isLoading,
    errorMessage,
    selectedRunId,
    onSelectRun,
    isRunning,
    runErrorMessage,
    onRunClick,
  } = props;

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0) ?? null;
  const runFailedToStart = runErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 1 }}
      >
        <Typography id={HEADING_ID} variant="h5" component="h2">
          Runs of version {versionNumber}
        </Typography>
        <Button onClick={onRunClick} disabled={isRunning} variant="contained">
          {isRunning ? "Running…" : "Run script"}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Running opens a browser window on this computer and works through the steps. A run is
        stopped after 5 minutes.
      </Typography>

      {isRunning && <LinearProgress aria-label="Running script" sx={{ mb: 2 }} />}

      {runFailedToStart && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not run the script: {runErrorMessage}
        </Alert>
      )}

      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading runs" />

      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary">This version has not been run yet.</Typography>
      )}

      {selectedRun !== null && <ActionScriptRunDetails websiteId={websiteId} run={selectedRun} />}

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
                      primary={describeActionScriptRunOutcome(run)}
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
