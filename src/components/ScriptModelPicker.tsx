import { type ChangeEvent, type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
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
 * The "Model" and "Effort" dropdowns next to "Convert to script". The model
 * list comes live from Anthropic, so it has every model and, for the chosen
 * one, exactly the effort levels it offers - or a single "Standard" entry
 * for a model with no effort setting. The helper text names the model id and
 * the fallback that answers when the model declines.
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
  const modelHelperText = selectedModel === null ? "Loading models…" : `${selectedModel.id} · ${fallbackText}`;

  /**
   * Reports the picked model.
   * @param event - The select's change event
   */
  const handleModelChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onModelChange(event.target.value);
  };

  /**
   * Reports the picked effort level.
   * @param event - The select's change event
   */
  const handleEffortChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onEffortChange(event.target.value);
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ flexGrow: 1 }}>
      <TextField
        select
        label="Model"
        value={selectedModel?.id ?? ""}
        onChange={handleModelChange}
        disabled={pickersAreDisabled}
        helperText={modelHelperText}
        size="small"
        sx={{ minWidth: 240 }}
      >
        {models.map((model) => (
          <MenuItem key={model.id} value={model.id}>
            {model.displayName}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Effort"
        value={modelHasNoEffortSetting ? STANDARD_EFFORT_VALUE : (selectedEffort ?? "")}
        onChange={handleEffortChange}
        disabled={pickersAreDisabled || modelHasNoEffortSetting}
        helperText={modelHasNoEffortSetting ? "This model has no effort setting" : " "}
        size="small"
        sx={{ minWidth: 160 }}
      >
        {modelHasNoEffortSetting ? (
          <MenuItem value={STANDARD_EFFORT_VALUE}>Standard</MenuItem>
        ) : (
          (selectedModel?.effortLevels ?? []).map((effortLevel) => (
            <MenuItem key={effortLevel} value={effortLevel}>
              {effortLevel}
            </MenuItem>
          ))
        )}
      </TextField>
    </Stack>
  );
}
