import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ActionScriptDetails from "./ActionScriptDetails";
import LoadStatusNotice from "./LoadStatusNotice";
import ScriptModelPicker, { type ScriptModelPickerProps } from "./ScriptModelPicker";
import ScriptRunStatusIcon from "./ScriptRunStatusIcon";
import { type ActionScriptRecord } from "../hooks/useActionScripts";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { type ActionPlan } from "../utils/actionPlanSteps";
import { describeScriptModel } from "../utils/describeScriptModel";
import { type CurrentActionText, findChangedActionFields } from "../utils/describeScriptStaleness";

const HEADING_ID = "action-scripts-section-heading";
const VERSIONS_HEADING_ID = "action-script-versions-heading";

/** Props for `ActionScriptsSection`. */
export interface ActionScriptsSectionProps {
  /** Every saved version, newest first (see `useActionScripts`). */
  scripts: ActionScriptRecord[];
  /** True while the script list is loading. */
  isLoading: boolean;
  /** Why the script list could not be fetched, or null. */
  errorMessage: string | null;
  /** The version the user picked; null (or an unknown id) shows the newest. */
  selectedScriptId: string | null;
  /** Called with a script's id when the user picks it from the versions list. */
  onSelectScript: (actionScriptId: string) => void;
  /** True while a "Convert to script" request is in flight. */
  isConverting: boolean;
  /** Why the last "Convert to script" request failed, or null. */
  convertErrorMessage: string | null;
  /** Called when the user clicks "Convert to script". */
  onConvertClick: () => void;
  /** False until a model (and effort level) is chosen, i.e. while the model list loads or after it failed. */
  canConvert: boolean;
  /** The Model / Effort dropdowns' props (see `ScriptModelPicker`). */
  modelPicker: ScriptModelPickerProps;
  /** The action as it is now, to mark versions generated from older text as out of date. */
  currentAction: CurrentActionText;
  /** Where "Compare versions" goes (see `actionScriptComparePath`). */
  comparePath: string;
  /** History state for the "Compare versions" link, so that page can return here. */
  compareLinkState: ReturnState;
  /** True while an edited plan is being saved as a new version. */
  isSavingEdit: boolean;
  /** Why the last save of an edited plan failed, or null. */
  saveEditErrorMessage: string | null;
  /** Called with the version that was edited and the edited plan, to save it as a new version. */
  onSaveEdit: (sourceScript: ActionScriptRecord, plan: ActionPlan) => void;
}

/**
 * The "Scripts" section of an action's page: the Model and Effort dropdowns
 * and the "Convert to script" button (Claude turns the action into a JSON
 * step plan with the chosen model; each conversion is saved as a new
 * version), a "Compare versions" link once there are two, the list of
 * versions to pick from - each with its run status icon (its latest run
 * passed, failed, or it has not been run yet), its model and effort, the
 * version it was refined from (with the model and effort that refined it), or
 * the version it was edited from, and an "Out of date" chip when the action's
 * title, description, or credential has changed since - and the selected version in
 * full (the newest unless the user picked another), whose steps can be
 * edited and saved as yet another version.
 * @param props - The scripts, the model choice, the request states, and the callbacks
 * @returns The rendered section
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
    currentAction,
    comparePath,
    compareLinkState,
    isSavingEdit,
    saveEditErrorMessage,
    onSaveEdit,
  } = props;

  const selectedScriptIndex = Math.max(
    scripts.findIndex((script) => script.id === selectedScriptId),
    0,
  );
  const selectedScript = scripts.at(selectedScriptIndex) ?? null;
  const convertFailed = convertErrorMessage !== null;
  const scriptListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoScripts = scripts.length === 0;
  const thereAreScripts = !thereAreNoScripts;
  const thereAreVersionsToCompare = scripts.length >= 2;
  const convertIsBlocked = isConverting || !canConvert;

  /**
   * Numbers versions by age: the list is newest first, so the oldest is 1.
   * @param scriptIndex - The script's position in the newest-first list
   * @returns Its version number
   */
  const versionNumberAt = (scriptIndex: number): number => scripts.length - scriptIndex;

  /**
   * Finds the version number of a listed version by its id - the version
   * another one was edited or refined from.
   * @param scriptId - The source version's id, or null when there is no source
   * @returns Its version number, or null when there is no source or it is no longer listed
   */
  const versionNumberOfScriptId = (scriptId: string | null): number | null => {
    const thereIsNoSourceVersion = scriptId === null;
    if (thereIsNoSourceVersion) return null;
    const sourceIndex = scripts.findIndex((listedScript) => listedScript.id === scriptId);
    const sourceIsNoLongerListed = sourceIndex === -1;
    return sourceIsNoLongerListed ? null : versionNumberAt(sourceIndex);
  };

  /**
   * Names the version another one came from, for the versions list.
   * @param scriptId - The source version's id, or null
   * @returns "Version 2", or "an earlier version" when it is not listed
   */
  const describeSourceVersionOf = (scriptId: string | null): string => {
    const sourceVersionNumber = versionNumberOfScriptId(scriptId);
    return sourceVersionNumber === null ? "an earlier version" : `Version ${String(sourceVersionNumber)}`;
  };

  /**
   * Describes where a listed version came from, checked in this order: the
   * version it was edited from; the version it was refined from and the
   * model and effort that refined it; or the model and effort that
   * generated it.
   * @param script - A listed version
   * @returns e.g. "Claude Opus 5.5 (claude-opus-5-5) · high effort", "Edited from Version 2", or "Refined from Version 1 · Claude Opus 5.5 (claude-opus-5-5) · high effort"
   */
  const describeVersionSource = (script: ActionScriptRecord): string => {
    const versionWasEdited = script.editedFromActionScriptId !== null;
    if (versionWasEdited) {
      return `Edited from ${describeSourceVersionOf(script.editedFromActionScriptId)}`;
    }
    const modelText =
      script.modelId === null
        ? "unknown model"
        : describeScriptModel(script.modelId, script.effort, modelPicker.models);
    const { refinement } = script;
    const versionWasRefined = refinement !== null;
    if (versionWasRefined) {
      return `Refined from ${describeSourceVersionOf(refinement.sourceActionScriptId)} · ${modelText}`;
    }
    return modelText;
  };

  /**
   * Hands an edited plan to the page together with the version it was edited from.
   * @param plan - The edited plan
   */
  const handleSaveEdit = (plan: ActionPlan): void => {
    if (selectedScript === null) return;
    onSaveEdit(selectedScript, plan);
  };

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 1 }}
      >
        <Typography id={HEADING_ID} variant="h5" component="h2">
          Scripts
        </Typography>
        {thereAreVersionsToCompare && (
          <Button component={RouterLink} to={comparePath} state={compareLinkState} variant="outlined">
            Compare versions
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Claude turns this action into a JSON step plan that only does what a user could do with a
        mouse and keyboard, using the crawled pages most relevant to it. Each conversion is saved
        as a new version, and so is each edit: a saved version never changes.
      </Typography>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: { md: "flex-start" }, mb: 2 }}
      >
        <ScriptModelPicker {...modelPicker} />
        <Button
          onClick={onConvertClick}
          disabled={convertIsBlocked}
          variant="contained"
          sx={{ flexShrink: 0 }}
        >
          {isConverting ? "Converting…" : "Convert to script"}
        </Button>
      </Stack>

      {isConverting && (
        <>
          <LinearProgress aria-label="Converting to script" />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
            This can take a few minutes.
          </Typography>
        </>
      )}

      {convertFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not convert: {convertErrorMessage}
        </Alert>
      )}

      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading scripts"
      />

      {scriptListLoadedWithoutError && thereAreNoScripts && (
        <Typography color="text.secondary">No scripts yet.</Typography>
      )}

      {thereAreScripts && (
        <>
          <Typography id={VERSIONS_HEADING_ID} variant="subtitle1" component="h3" sx={{ mb: 1 }}>
            Versions
          </Typography>
          <Paper variant="outlined" sx={{ maxHeight: 240, overflow: "auto", mb: 3 }}>
            <List disablePadding aria-labelledby={VERSIONS_HEADING_ID}>
              {scripts.map((script, scriptIndex) => {
                const scriptIsSelected = scriptIndex === selectedScriptIndex;
                const scriptIsOutOfDate =
                  findChangedActionFields(script, currentAction).length > 0;
                const createdAtText = new Date(script.createdAt).toLocaleString();
                const versionDetailsText = `${createdAtText} · ${describeVersionSource(script)}`;
                return (
                  <ListItemButton
                    key={script.id}
                    selected={scriptIsSelected}
                    aria-current={scriptIsSelected ? "true" : undefined}
                    onClick={() => {
                      onSelectScript(script.id);
                    }}
                    divider
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <ScriptRunStatusIcon latestRun={script.latestRun} />
                    </ListItemIcon>
                    <ListItemText
                      primary={`Version ${String(versionNumberAt(scriptIndex))}`}
                      secondary={versionDetailsText}
                    />
                    {scriptIsOutOfDate && (
                      <Chip label="Out of date" color="warning" size="small" sx={{ ml: 1 }} />
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          </Paper>
        </>
      )}

      {selectedScript !== null && (
        <ActionScriptDetails
          // Keyed by version, so picking (or saving) another version closes the editor.
          key={selectedScript.id}
          script={selectedScript}
          versionNumber={versionNumberAt(selectedScriptIndex)}
          editedFromVersionNumber={versionNumberOfScriptId(selectedScript.editedFromActionScriptId)}
          refinedFromVersionNumber={versionNumberOfScriptId(
            selectedScript.refinement?.sourceActionScriptId ?? null,
          )}
          currentAction={currentAction}
          catalogModels={modelPicker.models}
          isSavingEdit={isSavingEdit}
          saveEditErrorMessage={saveEditErrorMessage}
          onSaveEdit={handleSaveEdit}
        />
      )}
    </Box>
  );
}
