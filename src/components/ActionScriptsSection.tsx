import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ActionScriptDetails from "./ActionScriptDetails";
import LoadStatusNotice from "./LoadStatusNotice";
import ScriptModelPicker, { type ScriptModelPickerProps } from "./ScriptModelPicker";
import { type ActionScriptRecord } from "../hooks/useActionScripts";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { describeScriptModel } from "../utils/describeScriptModel";
import { type CurrentActionText, findChangedActionFields } from "../utils/describeScriptStaleness";
import { formatCount } from "../utils/formatCount";

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
}

/**
 * The "Scripts" section of an action's page: the Model and Effort dropdowns
 * and the "Convert to script" button (Claude turns the action into a
 * Playwright script with the chosen model; each conversion is saved as a new,
 * never-edited version), a "Compare versions" link once there are two, the
 * list of versions to pick from - each with its model and effort, and an
 * "Out of date" chip when the action's title or description has changed since
 * - and the selected version in full (the newest unless the user picked
 * another).
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
        Claude turns this action into a Playwright script that only does what a user could do with
        a mouse and keyboard. Each conversion is saved as a new version; versions are never edited.
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
                const ruleWarningCount = script.ruleViolations.length;
                const scriptHasRuleWarnings = ruleWarningCount > 0;
                const scriptIsOutOfDate =
                  findChangedActionFields(script, currentAction).length > 0;
                const generatedAtText = new Date(script.createdAt).toLocaleString();
                const modelText = describeScriptModel(
                  script.modelId,
                  script.effort,
                  modelPicker.models,
                );
                const versionDetailsText = scriptHasRuleWarnings
                  ? `${generatedAtText} · ${modelText} · ${formatCount(ruleWarningCount, "rule warning", "rule warnings")}`
                  : `${generatedAtText} · ${modelText}`;
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
          script={selectedScript}
          versionNumber={versionNumberAt(selectedScriptIndex)}
          currentAction={currentAction}
          catalogModels={modelPicker.models}
        />
      )}
    </Box>
  );
}
