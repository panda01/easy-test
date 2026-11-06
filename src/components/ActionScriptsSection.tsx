import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import ScriptModelPicker, { type ScriptModelPickerProps } from "./ScriptModelPicker";
import ScriptRunStatusIcon from "./ScriptRunStatusIcon";
import StatusTag from "./StatusTag";
import { type ActionScriptRecord } from "../hooks/useActionScripts";
import { type AutoRefineJobRecord } from "../hooks/useAutoRefineJob";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { nocturneTokens } from "../theme/nocturneTheme";
import {
  type VersionNumberOfScriptId,
  describeAutoRefineOutcome,
  describeAutoRefineProgress,
} from "../utils/describeAutoRefineJob";
import { findScriptModelName, shortenScriptModelName } from "../utils/describeScriptModel";
import { describeScriptRunStatusBriefly, findScriptRunStatus } from "../utils/describeScriptRunStatus";
import { type CurrentActionText, findChangedActionFields } from "../utils/describeScriptStaleness";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";

const HEADING_ID = "action-script-versions-heading";
const VERSION_SELECT_LABEL_ID = "action-script-version-select-label";

/**
 * The "Auto-refine Version N" controls' props, grouped like `modelPicker`:
 * the shown version, whether a job can start and why not, the start and stop
 * requests' states, and the job being watched.
 */
export interface AutoRefineControlsProps {
  /** The shown version's number, for the button's label; null when no version is shown (the button then reads "Convert and auto-refine"). */
  shownVersionNumber: number | null;
  /** False when a job cannot start: no model is chosen (with no version yet), the version was saved from the step editor, or the run form has values to fix. */
  canStart: boolean;
  /** Why a job cannot start, shown as a caption under the button (e.g. "Fill in Name to run"); null when it can, or there is nothing to explain. */
  blockedReason: string | null;
  /** True while the start request is in flight (with no version yet, the conversion before it too). */
  isStarting: boolean;
  /** Why the last start request failed, or null. */
  startErrorMessage: string | null;
  /** The job being watched on this visit - running or ended - or null (see `useAutoRefineJob`). */
  job: AutoRefineJobRecord | null;
  /** Maps a version's id to its number in the list, or null when it is not listed yet (the page knows the list). */
  versionNumberOfScriptId: VersionNumberOfScriptId;
  /** Why the latest poll of the job failed (the last record stays shown and polling goes on), or null. */
  pollErrorMessage: string | null;
  /** Called when the user clicks "Auto-refine Version N". */
  onStart: () => void;
  /** Called when the user clicks "Stop". */
  onStop: () => void;
  /** True while the stop request is in flight. */
  isStopping: boolean;
}

/** Props for `ActionScriptsSection`. */
export interface ActionScriptsSectionProps {
  /** Every saved version, newest first (see `useActionScripts`). */
  scripts: ActionScriptRecord[];
  /** True while the script list is loading. */
  isLoading: boolean;
  /** Why the script list could not be fetched, or null. */
  errorMessage: string | null;
  /** The version shown (the page picks it from `?version=`), or null when there are none. */
  selectedScriptId: string | null;
  /** Called with a script's id when the user picks it. */
  onSelectScript: (actionScriptId: string) => void;
  /** True while a "Convert to new version" request is in flight. */
  isConverting: boolean;
  /** Why the last conversion request failed, or null. */
  convertErrorMessage: string | null;
  /** Called when the user clicks "Convert to new version". */
  onConvertClick: () => void;
  /** False until a model (and effort level) is chosen, i.e. while the model list loads or after it failed. */
  canConvert: boolean;
  /** The Model / Effort dropdowns' props (see `ScriptModelPicker`). */
  modelPicker: ScriptModelPickerProps;
  /** The "Auto-refine Version N" controls' props (see `AutoRefineControlsProps`). */
  autoRefine: AutoRefineControlsProps;
  /** The action as it is now, to mark versions generated from older text as out of date. */
  currentAction: CurrentActionText;
  /** Where "Compare" goes (see `actionScriptComparePath`). */
  comparePath: string;
  /** History state for the "Compare" link, so that page can return here. */
  compareLinkState: ReturnState;
  /** True for the phone layout (2c): a "Version" dropdown instead of the list. */
  isPhoneLayout: boolean;
}

/**
 * The versions column of an action's page, as the mockups draw it:
 * - desktop: "Versions" with a "Compare" link once there are two, then one
 *   row per version - its run status icon (its latest run passed, failed, or
 *   it has not been run), "Version N", an "Out of date" tag when the action's
 *   title, description, or credential has changed since, and where it came
 *   from ("Refined from v4 · Opus 5.5 · 24 min ago") - with the shown one
 *   highlighted;
 * - phone: a "Version" dropdown ("Version 5 · Failed · 24 min ago").
 *
 * Under it sit the Model and Effort dropdowns and "Convert to new version":
 * Claude turns the action into a JSON step plan with the chosen model, saved
 * as a new version.
 *
 * Under those sits "Auto-refine Version N" (see `AutoRefineControlsProps`):
 * the server runs the shown version with the run form's values and, while it
 * fails, refines it and runs the refined version, up to five times. While
 * the job runs the column shows a progress bar, a `role="status"` line
 * ("Refinement 2 of 5 · Running Version 4…", "Refining Version 4 into
 * Version 5…", "… · Stopping after this step…"), a "Stop" button, and a
 * warning when a poll failed; Convert, the model picker, and Auto-refine
 * itself are disabled meanwhile. Once the job has ended, one alert says how
 * (see `describeAutoRefineOutcome`). A caption under the button says why it
 * cannot start, when the page gives a reason.
 * @param props - The scripts, the model choice, the auto-refine controls, the request states, the callbacks, and the layout
 * @returns The rendered column
 */
export default function ActionScriptsSection(props: ActionScriptsSectionProps): ReactElement {
  const {
    scripts,
    isLoading,
    errorMessage,
    selectedScriptId,
    onSelectScript,
    isConverting,
    convertErrorMessage,
    onConvertClick,
    canConvert,
    modelPicker,
    autoRefine,
    currentAction,
    comparePath,
    compareLinkState,
    isPhoneLayout,
  } = props;

  const now = new Date();
  const convertFailed = convertErrorMessage !== null;
  const scriptListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoScripts = scripts.length === 0;
  const thereAreScripts = !thereAreNoScripts;
  const thereAreVersionsToCompare = scripts.length >= 2;
  const autoRefineJob = autoRefine.job;
  const autoRefineJobIsRunning = autoRefineJob !== null && autoRefineJob.status === "running";
  const autoRefineJobHasEnded = autoRefineJob !== null && !autoRefineJobIsRunning;
  const convertIsBlocked = isConverting || !canConvert || autoRefineJobIsRunning;
  const autoRefineIsBlocked =
    !autoRefine.canStart || autoRefine.isStarting || isConverting || autoRefineJobIsRunning;
  const autoRefineBlockedReasonIsShown = autoRefine.blockedReason !== null && !autoRefineJobIsRunning;
  const stopWasRequested = autoRefineJob !== null && autoRefineJob.stopRequestedAt !== null;
  const stopIsBlocked = autoRefine.isStopping || stopWasRequested;
  const autoRefineOutcome =
    autoRefineJobHasEnded ? describeAutoRefineOutcome(autoRefineJob, autoRefine.versionNumberOfScriptId) : null;
  const buttonMinHeight = isPhoneLayout ? 44 : 36;

  // With no version yet, the button converts first, then auto-refines the new version.
  let autoRefineButtonText = "Convert and auto-refine";
  if (autoRefine.isStarting) {
    autoRefineButtonText = "Starting…";
  } else if (autoRefine.shownVersionNumber !== null) {
    autoRefineButtonText = `Auto-refine Version ${String(autoRefine.shownVersionNumber)}`;
  }

  /**
   * Numbers versions by age: the list is newest first, so the oldest is 1.
   * @param scriptIndex - The script's position in the newest-first list
   * @returns Its version number
   */
  const versionNumberAt = (scriptIndex: number): number => scripts.length - scriptIndex;

  /**
   * Names the version another one came from, the short way the list does.
   * @param scriptId - The source version's id, or null when there is no source
   * @returns "v2", or "an earlier version" when it is not listed
   */
  const describeSourceVersionOf = (scriptId: string | null): string => {
    const sourceIndex = scripts.findIndex((listedScript) => listedScript.id === scriptId);
    const sourceIsListed = scriptId !== null && sourceIndex !== -1;
    return sourceIsListed ? `v${String(versionNumberAt(sourceIndex))}` : "an earlier version";
  };

  /**
   * Describes where a listed version came from, checked in this order: the
   * version it was edited from; the version it was refined from and the
   * model that refined it; or the model and effort that generated it - each
   * ending with how long ago.
   * @param script - A listed version
   * @returns e.g. "Opus 5.5 · high · 2 h ago", "Edited from v3 · 1 h ago", or "Refined from v4 · Opus 5.5 · 24 min ago"
   */
  const describeVersionSource = (script: ActionScriptRecord): string => {
    const whenText = formatRelativeTime(script.createdAt, now);
    const versionWasEdited = script.editedFromActionScriptId !== null;
    if (versionWasEdited) {
      return `Edited from ${describeSourceVersionOf(script.editedFromActionScriptId)} · ${whenText}`;
    }
    const modelText =
      script.modelId === null
        ? "unknown model"
        : shortenScriptModelName(findScriptModelName(script.modelId, modelPicker.models));
    const { refinement } = script;
    const versionWasRefined = refinement !== null;
    if (versionWasRefined) {
      return `Refined from ${describeSourceVersionOf(refinement.sourceActionScriptId)} · ${modelText} · ${whenText}`;
    }
    const effortText = script.effort === null ? "" : ` · ${script.effort}`;
    return `${modelText}${effortText} · ${whenText}`;
  };

  /**
   * Tells whether a version was generated from different action text than
   * the action has now.
   * @param script - A listed version
   * @returns True when it is out of date
   */
  const versionIsOutOfDate = (script: ActionScriptRecord): boolean =>
    findChangedActionFields(script, currentAction).length > 0;

  /**
   * Hands the version picked in the phone dropdown to the page.
   * @param event - The dropdown's change event
   */
  const handleVersionSelectChange = (event: SelectChangeEvent): void => {
    onSelectScript(event.target.value);
  };

  const autoRefineControls = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Button
        onClick={autoRefine.onStart}
        disabled={autoRefineIsBlocked}
        variant="outlined"
        color="secondary"
        fullWidth
        sx={{ minHeight: buttonMinHeight }}
      >
        {autoRefineButtonText}
      </Button>
      {autoRefineBlockedReasonIsShown && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: -0.5 }}>
          {autoRefine.blockedReason}
        </Typography>
      )}
      {autoRefineJobIsRunning && (
        <Box>
          <LinearProgress aria-label="Auto-refining" />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
            <Typography role="status" variant="caption" color="text.secondary" component="p" sx={{ mr: "auto" }}>
              {describeAutoRefineProgress(autoRefineJob, autoRefine.versionNumberOfScriptId)}
            </Typography>
            <Button onClick={autoRefine.onStop} disabled={stopIsBlocked} variant="text" size="small" sx={{ flex: "none" }}>
              Stop
            </Button>
          </Box>
        </Box>
      )}
      {autoRefineJobIsRunning && autoRefine.pollErrorMessage !== null && (
        <Alert severity="warning">
          Could not refresh the auto-refine ({autoRefine.pollErrorMessage}); still trying.
        </Alert>
      )}
      {autoRefineOutcome !== null && <Alert severity={autoRefineOutcome.severity}>{autoRefineOutcome.text}</Alert>}
      {autoRefine.startErrorMessage !== null && (
        <Alert severity="error">Could not start auto-refine: {autoRefine.startErrorMessage}</Alert>
      )}
    </Box>
  );

  const convertControls = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        ...(isPhoneLayout
          ? {}
          : { mt: 2, pt: "14px", borderTop: `1px solid ${nocturneTokens.divider}` }),
      }}
    >
      <ScriptModelPicker {...modelPicker} isDisabled={modelPicker.isDisabled || autoRefineJobIsRunning} />
      <Button
        onClick={onConvertClick}
        disabled={convertIsBlocked}
        variant="outlined"
        color="secondary"
        fullWidth
        sx={{ minHeight: buttonMinHeight }}
      >
        {isConverting ? "Converting…" : "Convert to new version"}
      </Button>
      {isConverting && (
        <Box>
          <LinearProgress aria-label="Converting to script" />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            This can take a few minutes.
          </Typography>
        </Box>
      )}
      {convertFailed && <Alert severity="error">Could not convert: {convertErrorMessage}</Alert>}
      {autoRefineControls}
    </Box>
  );

  const emptyAndLoadingNotices = (
    <>
      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading scripts" />
      {scriptListLoadedWithoutError && thereAreNoScripts && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No versions yet.
        </Typography>
      )}
    </>
  );

  if (isPhoneLayout) {
    return (
      <Box component="section" aria-label="Versions" sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {emptyAndLoadingNotices}
        {thereAreScripts && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Box
              component="label"
              id={VERSION_SELECT_LABEL_ID}
              sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}
            >
              Version
            </Box>
            <Select
              labelId={VERSION_SELECT_LABEL_ID}
              value={selectedScriptId ?? ""}
              onChange={handleVersionSelectChange}
              sx={{ minHeight: 44 }}
            >
              {scripts.map((script, scriptIndex) => {
                const statusText = describeScriptRunStatusBriefly(findScriptRunStatus(script.latestRun));
                const outOfDateText = versionIsOutOfDate(script) ? " · Out of date" : "";
                return (
                  <MenuItem key={script.id} value={script.id}>
                    Version {versionNumberAt(scriptIndex)} · {statusText} ·{" "}
                    {formatRelativeTime(script.createdAt, now)}
                    {outOfDateText}
                  </MenuItem>
                );
              })}
            </Select>
          </Box>
        )}
        {convertControls}
      </Box>
    );
  }

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: "10px" }}>
        <Typography id={HEADING_ID} variant="h5" component="h2" sx={{ m: 0, mr: "auto" }}>
          Versions
        </Typography>
        {thereAreVersionsToCompare && (
          <Link component={RouterLink} to={comparePath} state={compareLinkState} underline="none" sx={{ fontSize: 12.5 }}>
            Compare
          </Link>
        )}
      </Box>

      {emptyAndLoadingNotices}

      {thereAreScripts && (
        <Box component="ul" aria-labelledby={HEADING_ID} sx={{ m: 0, p: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {scripts.map((script, scriptIndex) => {
            const scriptIsSelected = script.id === selectedScriptId;
            return (
              <Box component="li" key={script.id} sx={{ listStyle: "none" }}>
                <ButtonBase
                  aria-current={scriptIsSelected ? "true" : undefined}
                  onClick={() => {
                    onSelectScript(script.id);
                  }}
                  sx={{
                    width: "100%",
                    display: "block",
                    textAlign: "left",
                    fontFamily: "inherit",
                    padding: "10px 12px",
                    borderRadius: `${String(nocturneTokens.radius.medium)}px`,
                    backgroundColor: scriptIsSelected ? nocturneTokens.accentRamp[900] : "transparent",
                    boxShadow: scriptIsSelected ? `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}` : "none",
                    "&:hover": {
                      backgroundColor: scriptIsSelected ? nocturneTokens.accentRamp[900] : nocturneTokens.surface,
                    },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 14, fontWeight: 500 }}>
                    <ScriptRunStatusIcon latestRun={script.latestRun} size={15} />{" "}
                    Version {versionNumberAt(scriptIndex)}{" "}
                    {versionIsOutOfDate(script) && (
                      <Box component="span" sx={{ ml: "auto", display: "flex" }}>
                        <StatusTag label="Out of date" tone="stale" isCompact />
                      </Box>
                    )}
                  </Box>{" "}
                  <Box
                    title={formatFullDateTime(script.createdAt)}
                    sx={{ fontSize: 12, color: nocturneTokens.neutral[400], mt: "3px", ml: "23px" }}
                  >
                    {describeVersionSource(script)}
                  </Box>
                </ButtonBase>
              </Box>
            );
          })}
        </Box>
      )}

      {convertControls}
    </Box>
  );
}
