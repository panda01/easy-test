import { type ReactElement, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import ActionRunParameterFields from "./ActionRunParameterFields";
import ActionScriptRunDetails from "./ActionScriptRunDetails";
import ActionScriptRunHistory from "./ActionScriptRunHistory";
import { PlayArrowIcon } from "./icons";
import LoadStatusNotice from "./LoadStatusNotice";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { nocturneTokens } from "../theme/nocturneTheme";
import {
  type ParameterValues,
  type VersionParametersRecord,
  listChangedParameterValues,
  listParametersToFix,
} from "../utils/actionParameters";

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
  /** The run shown in full (the page picks it: the newest unless the user picked another), or null when there are no runs. */
  selectedRun: ActionScriptRunRecord | null;
  /** Called with a run's id when the user picks it from the history. */
  onSelectRun: (actionScriptRunId: string) => void;
  /** True while a "Run" request is in flight. */
  isRunning: boolean;
  /** Why the last "Run" request failed, or null. */
  runErrorMessage: string | null;
  /** Called with the values the user changed (by parameter key) when they click "Run" / "Run again". */
  onRunClick: (parameterValues: ParameterValues) => void;
  /** The version's parameters view, or null while it loads (the run waits for it). */
  parametersView: VersionParametersRecord | null;
  /** Why the parameters could not be loaded, or null. */
  parametersErrorMessage: string | null;
  /** True when the version was written by Claude (not saved from the step editor), so its failed runs can be refined. */
  versionCanBeRefined: boolean;
  /** True while a "Refine" request is in flight. */
  isRefining: boolean;
  /** Why the last "Refine" request failed, or null. */
  refineErrorMessage: string | null;
  /** Called with the failed run and the note for Claude (null when blank) when the user clicks Refine. */
  onRefine: (failedRun: ActionScriptRunRecord, note: string | null) => void;
  /** The number the next version will get, for "Refine into Version 6". */
  nextVersionNumber: number;
  /** True for the phone card (2c): the run's details with "Run again" and "Refine" side by side, and no history (the page lists it below the steps). */
  isPhoneLayout: boolean;
}

/**
 * The run panel of an action's page for the selected version, as the
 * mockups draw it:
 * - desktop (the right-hand column): "Latest run" with "Run again" (it opens
 *   a browser window on this computer, logs in first when the action has a
 *   credential, and works through the steps; a run is stopped after 5
 *   minutes), the shown run in full (see `ActionScriptRunDetails`), and
 *   "Runs of version N" to pick another run from;
 * - phone (the card above the steps): the shown run with "Run again" and
 *   "Refine" side by side.
 *
 * The heading says "Latest run" while the newest run is shown, and "Run"
 * once the user picks an older one. The details are keyed by the run's id,
 * so the note and whether a refine was tried start over for each run.
 *
 * Above the run's details sit the run's values (see
 * `ActionRunParameterFields`): prefilled with the version's own, and sent -
 * only the ones the user changed - with "Run". Run is disabled while a
 * required value is blank or a value breaks a rule, and until the
 * parameters have loaded. The page keys this panel by version, so values
 * typed for one version never carry over to another.
 * @param props - The runs, the shown run, the parameters, the request states, the callbacks, and the layout
 * @returns The rendered panel
 */
export default function ActionScriptRunsSection(props: ActionScriptRunsSectionProps): ReactElement {
  const {
    websiteId,
    versionNumber,
    runs,
    isLoading,
    errorMessage,
    selectedRun,
    onSelectRun,
    isRunning,
    runErrorMessage,
    onRunClick,
    versionCanBeRefined,
    isRefining,
    refineErrorMessage,
    onRefine,
    nextVersionNumber,
    isPhoneLayout,
    parametersView,
    parametersErrorMessage,
  } = props;
  const [editedValues, setEditedValues] = useState<ParameterValues>({});
  const parameters = parametersView?.parameters ?? [];
  const parametersToFix = listParametersToFix(parameters, editedValues);
  const parametersAreLoading = parametersView === null && parametersErrorMessage === null;
  const runIsBlocked = isRunning || parametersAreLoading || parametersToFix.length > 0;

  /**
   * Remembers a value the user typed or picked.
   * @param parameterKey - The parameter's key
   * @param value - Its new value
   */
  const handleValueChange = (parameterKey: string, value: string): void => {
    setEditedValues((previousValues) => ({ ...previousValues, [parameterKey]: value }));
  };

  /** Runs with the values the user changed. */
  const handleRunClick = (): void => {
    onRunClick(listChangedParameterValues(parameters, editedValues));
  };

  const runFailedToStart = runErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;
  const newestRunIsShown = selectedRun !== null && selectedRun.id === runs.at(0)?.id;

  let runButtonText = "Run again";
  if (isRunning) {
    runButtonText = "Running…";
  } else if (thereAreNoRuns) {
    runButtonText = "Run";
  }
  const runButton = (
    <Button
      onClick={handleRunClick}
      disabled={runIsBlocked}
      variant="outlined"
      // On the phone card Refine is the primary action beside it, as in the mockup.
      color={isPhoneLayout ? "secondary" : "primary"}
      startIcon={isPhoneLayout ? undefined : <PlayArrowIcon />}
      sx={{ minHeight: isPhoneLayout ? 44 : 36, flex: "none" }}
    >
      {runButtonText}
    </Button>
  );

  const runStatusNotices = (
    <>
      {isRunning && <LinearProgress aria-label="Running script" />}
      {runFailedToStart && <Alert severity="error">Could not run the script: {runErrorMessage}</Alert>}
      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading runs" />
      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          This version has not been run yet.
        </Typography>
      )}
    </>
  );

  return (
    <Box
      component="section"
      aria-labelledby={isPhoneLayout ? undefined : HEADING_ID}
      aria-label={isPhoneLayout ? "Latest run" : undefined}
      sx={{
        backgroundColor: nocturneTokens.surface,
        borderRadius: `${String(nocturneTokens.radius.large)}px`,
        padding: isPhoneLayout ? "14px" : "18px",
        display: "flex",
        flexDirection: "column",
        gap: isPhoneLayout ? "12px" : 2,
        minWidth: 0,
      }}
    >
      {!isPhoneLayout && (
        <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Typography id={HEADING_ID} variant="h5" component="h2" sx={{ m: 0, mr: "auto" }}>
            {newestRunIsShown || selectedRun === null ? "Latest run" : "Run"}
          </Typography>
          {runButton}
        </Box>
      )}

      {parametersView !== null && (
        <ActionRunParameterFields
          parameters={parameters}
          objectChoices={parametersView.objectChoices}
          values={editedValues}
          onValueChange={handleValueChange}
          isDisabled={isRunning}
        />
      )}
      {parametersErrorMessage !== null && (
        <Alert severity="warning">Could not load this version's parameters: {parametersErrorMessage}</Alert>
      )}
      {parametersToFix.length > 0 && !isRunning && (
        <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
          Fill in {parametersToFix.join(", ")} to run.
        </Typography>
      )}

      {runStatusNotices}

      {isPhoneLayout && thereAreNoRuns && runButton}

      {selectedRun !== null && (
        <ActionScriptRunDetails
          // Keyed by run, so picking another run clears the note and any refine error.
          key={selectedRun.id}
          websiteId={websiteId}
          run={selectedRun}
          versionCanBeRefined={versionCanBeRefined}
          isRefining={isRefining}
          isRunning={isRunning}
          refineErrorMessage={refineErrorMessage}
          onRefine={onRefine}
          refinedVersionNumber={nextVersionNumber}
          isCompact={isPhoneLayout}
          runAgainButton={runButton}
        />
      )}

      {thereAreRuns && !isPhoneLayout && (
        <Box>
          <Box
            id={HISTORY_HEADING_ID}
            component="h3"
            sx={{
              m: 0,
              mb: "4px",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: nocturneTokens.neutral[500],
            }}
          >
            Runs of version {versionNumber}
          </Box>
          <ActionScriptRunHistory
            runs={runs}
            selectedRunId={selectedRun?.id ?? null}
            onSelectRun={onSelectRun}
            label={`Runs of version ${String(versionNumber)}`}
          />
        </Box>
      )}
    </Box>
  );
}
