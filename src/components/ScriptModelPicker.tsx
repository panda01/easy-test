import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import { type ScriptModelOption } from "../hooks/useScriptModels";

/** The Effort select's value for a model with no effort setting. */
const STANDARD_EFFORT_VALUE = "standard";

/** Props for `ScriptModelPicker`. */
export interface ScriptModelPickerProps {
  /** Every usable model, newest first (see `useScriptModels`). */
  models: ScriptModelOption[];
  /** The chosen model's id, or null before the list has loaded. */
  selectedModelId: string | null;
  /** The chosen effort level, or null for "Standard". */
  selectedEffort: string | null;
  /** True while the model list is loading. */
  isLoading: boolean;
  /** Why the model list could not be fetched, or null. */
  errorMessage: string | null;
  /** True while a conversion is in flight, so the choice cannot change under it. */
  isDisabled: boolean;
  /** Called with a model's id when the user picks it. */
  onModelChange: (modelId: string) => void;
  /** Called with an effort level when the user picks it. */
  onEffortChange: (effort: string) => void;
}

/**
 * The compact "Model" and "Effort" dropdowns above "Convert to new version",
 * side by side as the mockup's versions column draws them. The model list
 * comes live from Anthropic, so it has every model and, for the chosen one,
 * exactly the effort levels it offers - or a single "Standard" entry for a
 * model with no effort setting. Each dropdown is named for screen readers
 * ("Model", "Effort"); the model's hover title names its id and the fallback
 * that answers when the model declines.
 * @param props - The models, the current choice, the request state, and the change callbacks
 * @returns The rendered pickers (or why the model list could not load)
 */
export default function ScriptModelPicker(props: ScriptModelPickerProps): ReactElement {
  const {
    models,
    selectedModelId,
    selectedEffort,
    isLoading,
    errorMessage,
    isDisabled,
    onModelChange,
    onEffortChange,
  } = props;

  const modelListFailed = errorMessage !== null;
  if (modelListFailed) {
    return <Alert severity="error">Could not load models: {errorMessage}</Alert>;
  }

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const modelHasNoEffortSetting = selectedModel !== null && selectedModel.effortLevels.length === 0;
  const pickersAreDisabled = isLoading || isDisabled || selectedModel === null;
  const fallbackText =
    selectedModel?.fallbackModel === null || selectedModel === null
      ? "No fallback for this model"
      : `If it declines, ${selectedModel.fallbackModel.displayName} answers instead`;
  const modelTitle = selectedModel === null ? "Loading models…" : `${selectedModel.id} · ${fallbackText}`;

  /**
   * Reports the picked model.
   * @param event - The select's change event
   */
  const handleModelChange = (event: SelectChangeEvent): void => {
    onModelChange(event.target.value);
  };

  /**
   * Reports the picked effort level.
   * @param event - The select's change event
   */
  const handleEffortChange = (event: SelectChangeEvent): void => {
    onEffortChange(event.target.value);
  };

  return (
    <Box sx={{ display: "flex", gap: "6px" }}>
      <Select
        value={selectedModel?.id ?? ""}
        onChange={handleModelChange}
        disabled={pickersAreDisabled}
        displayEmpty
        renderValue={() => selectedModel?.displayName ?? "Loading models…"}
        size="small"
        title={modelTitle}
        inputProps={{ "aria-label": "Model" }}
        sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }}
      >
        {models.map((model) => (
          <MenuItem key={model.id} value={model.id}>
            {model.displayName}
          </MenuItem>
        ))}
      </Select>
      <Select
        value={modelHasNoEffortSetting ? STANDARD_EFFORT_VALUE : (selectedEffort ?? "")}
        onChange={handleEffortChange}
        disabled={pickersAreDisabled || modelHasNoEffortSetting}
        size="small"
        inputProps={{ "aria-label": "Effort" }}
        sx={{ width: 96, flex: "none", fontSize: 12.5, textTransform: "capitalize" }}
      >
        {modelHasNoEffortSetting ? (
          <MenuItem value={STANDARD_EFFORT_VALUE}>Standard</MenuItem>
        ) : (
          (selectedModel?.effortLevels ?? []).map((effortLevel) => (
            <MenuItem key={effortLevel} value={effortLevel} sx={{ textTransform: "capitalize" }}>
              {effortLevel}
            </MenuItem>
          ))
        )}
      </Select>
    </Box>
  );
}
