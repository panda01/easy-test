import { type ReactElement } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { nocturneTokens } from "../theme/nocturneTheme";
import {
  MAX_PARAMETER_VALUE_LENGTH,
  type ObjectChoiceRecord,
  type ParameterValues,
  type VersionParameterRecord,
  findParameterValueProblem,
} from "../utils/actionParameters";
import { formatRelativeTime } from "../utils/formatRelativeTime";

/** Props for `ActionRunParameterFields`. */
export interface ActionRunParameterFieldsProps {
  /** The version's parameters, in step order. */
  parameters: VersionParameterRecord[];
  /** The objects an Object action can be run on. */
  objectChoices: ObjectChoiceRecord[];
  /** The values the next run will use, by key. */
  values: ParameterValues;
  /** Called with a parameter's key and its new value as the user types or picks. */
  onValueChange: (parameterKey: string, value: string) => void;
  /** True while a run is in flight (the fields are locked). */
  isDisabled: boolean;
}

/**
 * Describes where an object choice comes from, under its name in the list.
 * @param choice - The choice
 * @returns e.g. "created by a run of Create a project · 2 minutes ago, seen on crawl" or "seen on crawl"
 */
function describeObjectChoice(choice: ObjectChoiceRecord): string {
  if (choice.source === "crawl") return "seen on crawl";
  const ranAt = choice.createdAt === null ? "" : ` · ${formatRelativeTime(choice.createdAt, new Date())}`;
  const madeBy = `created by a run of ${choice.createdByActionTitle ?? "an action"}${ranAt}`;
  return choice.seenOnCrawl ? `${madeBy}, seen on crawl` : madeBy;
}

/**
 * Says what a field is for, under it: an added field's step, an object's
 * choices, or a value's problem.
 * @param parameter - The parameter
 * @param value - Its current value
 * @returns The helper text
 */
function describeFieldHelp(parameter: VersionParameterRecord, value: string): string {
  const valueProblem = findParameterValueProblem(value);
  if (valueProblem !== null) return valueProblem;
  if (parameter.addedField !== null) {
    return `A field the steps don't fill - typed after step ${String(parameter.addedField.afterStepNumber)} when you give it a value`;
  }
  if (parameter.kind === "object") return "Pick a known one, or type any name";
  if (parameter.isSecret) return "Secret - never stored on the run";
  return parameter.isRequired ? "" : "Optional - leave it blank to skip its steps";
}

/**
 * The run form's fields: one per parameter of the shown version, prefilled
 * with the version's own values (an added field starts empty), marked
 * required with the usual asterisk. A secret one is a password field. The
 * object of an Object action is a combo box of the known objects - the ones
 * Create actions made first, marked "created by a run of …", then the ones
 * the latest crawl saw - that also takes any typed name.
 * @param props - The parameters, the object choices, the values, the change callback, and whether the fields are locked
 * @returns The fields, or nothing when the version has no parameters
 */
export default function ActionRunParameterFields(props: ActionRunParameterFieldsProps): ReactElement | null {
  const { parameters, objectChoices, values, onValueChange, isDisabled } = props;
  const versionHasNoParameters = parameters.length === 0;
  if (versionHasNoParameters) return null;

  return (
    <Box component="fieldset" sx={{ border: "none", m: 0, p: 0 }}>
      <Typography component="legend" sx={{ fontSize: 13.5, fontWeight: 500, mb: 1 }}>
        Values for this run
      </Typography>
      <Stack spacing={1.5}>
        {parameters.map((parameter) => {
          const value = values[parameter.key] ?? parameter.defaultValue;
          const helpText = describeFieldHelp(parameter, value);
          const valueHasAProblem = findParameterValueProblem(value) !== null;
          if (parameter.kind === "object") {
            return (
              <Autocomplete
                key={parameter.key}
                freeSolo
                disabled={isDisabled}
                options={objectChoices.map((choice) => choice.name)}
                // A field still holding one of the choices lists them all, so
                // another can be picked without clearing it first.
                filterOptions={(optionNames, filterState) => {
                  const inputText = filterState.inputValue.trim().toLowerCase();
                  const inputIsAChoice = optionNames.some((optionName) => optionName.toLowerCase() === inputText);
                  if (inputText === "" || inputIsAChoice) return optionNames;
                  return optionNames.filter((optionName) => optionName.toLowerCase().includes(inputText));
                }}
                inputValue={value}
                onInputChange={(_event, inputText) => {
                  onValueChange(parameter.key, inputText);
                }}
                renderOption={(optionProps, optionName) => {
                  const { key: optionKey, ...otherOptionProps } = optionProps;
                  const choice = objectChoices.find((candidate) => candidate.name === optionName);
                  return (
                    <Box component="li" key={optionKey} {...otherOptionProps} sx={{ flexDirection: "column", alignItems: "flex-start !important" }}>
                      <span>{optionName}</span>
                      {choice !== undefined && (
                        <Box component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
                          {describeObjectChoice(choice)}
                        </Box>
                      )}
                    </Box>
                  );
                }}
                renderInput={(inputParams) => (
                  <TextField
                    {...inputParams}
                    label={parameter.label}
                    required
                    size="small"
                    error={valueHasAProblem}
                    helperText={helpText}
                  />
                )}
              />
            );
          }
          return (
            <TextField
              key={parameter.key}
              label={parameter.label}
              value={value}
              onChange={(event) => {
                onValueChange(parameter.key, event.target.value);
              }}
              type={parameter.isSecret ? "password" : "text"}
              required={parameter.isRequired}
              disabled={isDisabled}
              size="small"
              error={valueHasAProblem}
              helperText={helpText === "" ? undefined : helpText}
              slotProps={{ htmlInput: { maxLength: MAX_PARAMETER_VALUE_LENGTH + 1, autoComplete: "off" } }}
              fullWidth
            />
          );
        })}
      </Stack>
    </Box>
  );
}
