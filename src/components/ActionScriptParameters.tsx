import { type ReactElement, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddActionParameterDialog, { type ObjectTypeOption } from "./AddActionParameterDialog";
import { AddIcon, DeleteOutlineIcon, EditOutlinedIcon } from "./icons";
import LoadStatusNotice from "./LoadStatusNotice";
import StatusTag from "./StatusTag";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";
import {
  MAX_PARAMETER_LABEL_LENGTH,
  type NewParameterRequestBody,
  type ParameterChoicesRequestBody,
  type VersionParameterRecord,
  type VersionParametersRecord,
  describeParameterRequirement,
  describeParameterSource,
  describeParameterSteps,
} from "../utils/actionParameters";

/** The required select's value for "Let the page decide" (the server's null). */
const LET_THE_PAGE_DECIDE = "page";

/** The name parameter select's value for "Detect" (the server's null). */
const DETECT_NAME_PARAMETER = "";

/** Props for `ActionScriptParameters`. */
export interface ActionScriptParametersProps {
  /** The version's parameters view, or null while it loads (or failed). */
  view: VersionParametersRecord | null;
  /** True while the view loads. */
  isLoading: boolean;
  /** Why the view could not be loaded, or null. */
  errorMessage: string | null;
  /** The website's object types, for an object parameter the user adds. */
  objectTypes: ObjectTypeOption[];
  /** The parameter the user chose to name created objects, or null for "Detect". */
  userNameParameterKey: string | null;
  /** True while a parameter change, add, or remove is in flight. */
  isSaving: boolean;
  /** Why the last change, add, or remove failed, or null. */
  saveErrorMessage: string | null;
  /** Saves a parameter's label and required choice; resolves true when saved. */
  onChangeParameter: (parameterKey: string, choices: ParameterChoicesRequestBody) => Promise<boolean>;
  /** Removes one of the user's own parameters. */
  onRemoveParameter: (parameterKey: string) => void;
  /** Adds one of the user's own parameters; resolves true when added. */
  onAddParameter: (body: NewParameterRequestBody) => Promise<boolean>;
  /** Saves which parameter names a created object (null for "Detect"). */
  onNameParameterChange: (parameterKey: string | null) => void;
}

/** Props for `EditParameterForm`. */
interface EditParameterFormProps {
  /** The parameter being changed. */
  parameter: VersionParameterRecord;
  /** True while the change is being saved. */
  isSaving: boolean;
  /** Why the last change failed, or null. */
  errorMessage: string | null;
  /** Called with the new label and required choice. */
  onSave: (choices: ParameterChoicesRequestBody) => void;
  /** Called when the user backs out. */
  onCancel: () => void;
}

/**
 * The change dialog's body: the label (blank goes back to the worked-out
 * one) and Required / Optional / Let the page decide - the object of an
 * Object action has only "Required, always".
 * @param props - The parameter, the request state, and the callbacks
 * @returns The title, fields, and buttons
 */
function EditParameterForm(props: EditParameterFormProps): ReactElement {
  const { parameter, isSaving, errorMessage, onSave, onCancel } = props;
  const [labelText, setLabelText] = useState(parameter.userLabel ?? "");
  const [requiredChoice, setRequiredChoice] = useState<string>(parameter.userRequiredChoice ?? LET_THE_PAGE_DECIDE);
  const [saveWasAttempted, setSaveWasAttempted] = useState(false);
  const parameterIsTheObject = parameter.kind === "object";

  /** Sends the change. */
  const handleSaveClick = (): void => {
    setSaveWasAttempted(true);
    const trimmedLabel = labelText.trim();
    onSave({
      userLabel: trimmedLabel === "" ? null : trimmedLabel,
      userRequiredChoice:
        parameterIsTheObject || requiredChoice === LET_THE_PAGE_DECIDE
          ? null
          : requiredChoice === "optional"
            ? "optional"
            : "required",
    });
  };

  return (
    <>
      <DialogTitle id="edit-action-parameter-title">Change “{parameter.label}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Label"
            value={labelText}
            onChange={(event) => {
              setLabelText(event.target.value);
            }}
            placeholder={parameter.detectedLabel}
            helperText={`Leave blank for the detected label, “${parameter.detectedLabel}”. It applies to every version.`}
            slotProps={{ htmlInput: { maxLength: MAX_PARAMETER_LABEL_LENGTH }, inputLabel: { shrink: true } }}
            fullWidth
          />
          {parameterIsTheObject ? (
            <TextField label="Required" value="Required, always" disabled fullWidth />
          ) : (
            <TextField
              select
              label="Required"
              value={requiredChoice}
              onChange={(event) => {
                setRequiredChoice(event.target.value);
              }}
              fullWidth
            >
              <MenuItem value="required">Required</MenuItem>
              <MenuItem value="optional">Optional</MenuItem>
              <MenuItem value={LET_THE_PAGE_DECIDE}>Let the page decide</MenuItem>
            </TextField>
          )}
          {saveWasAttempted && errorMessage !== null && <Alert severity="error">{errorMessage}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSaveClick} disabled={isSaving} variant="contained">
          Save
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Shows a parameter's value in the version, masked when it is secret.
 * @param parameter - The parameter
 * @returns The value to show
 */
function describeDefaultValue(parameter: VersionParameterRecord): string {
  if (parameter.addedField !== null) return "(empty until you give it a value)";
  if (parameter.isSecret) return "••••••";
  return parameter.defaultValue === "" ? "(none)" : parameter.defaultValue;
}

/**
 * The Parameters section of a version: what each run can change.
 * - Warnings first (no object type, a tie, no confirm step, ...).
 * - For a Create action, which parameter names the new object (Detect, or a
 *   pick) and its confirm step.
 * - Each parameter: its label, where it came from (in the steps, on the
 *   page, added by you, the object), "Secret" when it is, whether it is
 *   required and why, the version's value (masked when secret), the steps it
 *   is used in, and Change - plus Remove on the user's own.
 * - "Add parameter" (see `AddActionParameterDialog`).
 * A change belongs to the action, so it applies to every version.
 * @param props - The view, the object types, the request state, and the callbacks
 * @returns The rendered section content
 */
export default function ActionScriptParameters(props: ActionScriptParametersProps): ReactElement {
  const {
    view,
    isLoading,
    errorMessage,
    objectTypes,
    userNameParameterKey,
    isSaving,
    saveErrorMessage,
    onChangeParameter,
    onRemoveParameter,
    onAddParameter,
    onNameParameterChange,
  } = props;
  const [parameterBeingChanged, setParameterBeingChanged] = useState<VersionParameterRecord | null>(null);
  const [addDialogIsOpen, setAddDialogIsOpen] = useState(false);
  const parameters = view?.parameters ?? [];
  const nameParameterOptions = parameters.filter(
    (parameter) => parameter.kind === "text" && !parameter.isSecret && parameter.addedField === null,
  );
  const actionCreates = view?.role.kind === "create";

  /**
   * Saves the change dialog's choices, closing it when they were saved.
   * @param choices - The new label and required choice
   * @returns Resolves once the request is done
   */
  const saveParameterChange = async (choices: ParameterChoicesRequestBody): Promise<void> => {
    if (parameterBeingChanged === null) return;
    const changeWasSaved = await onChangeParameter(parameterBeingChanged.key, choices);
    if (changeWasSaved) setParameterBeingChanged(null);
  };

  /**
   * Adds the dialog's parameter, closing it when it was added.
   * @param body - The new parameter
   * @returns Resolves once the request is done
   */
  const addParameter = async (body: NewParameterRequestBody): Promise<void> => {
    const parameterWasAdded = await onAddParameter(body);
    if (parameterWasAdded) setAddDialogIsOpen(false);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading parameters" />
      {(view?.warnings ?? []).map((warning) => (
        <Alert key={warning} severity="warning" sx={{ fontSize: 13 }}>
          {warning}
        </Alert>
      ))}

      {view !== null && actionCreates && (
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label="Names the new object"
            value={userNameParameterKey ?? DETECT_NAME_PARAMETER}
            onChange={(event) => {
              onNameParameterChange(event.target.value === DETECT_NAME_PARAMETER ? null : event.target.value);
            }}
            disabled={isSaving}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value={DETECT_NAME_PARAMETER}>
              Detect
              {view.nameParameterKey === null
                ? " — none found"
                : ` — ${parameters.find((parameter) => parameter.key === view.nameParameterKey)?.label ?? view.nameParameterKey}`}
            </MenuItem>
            {nameParameterOptions.map((parameter) => (
              <MenuItem key={parameter.key} value={parameter.key}>
                {parameter.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[400] }}>
            {view.confirmStepNumber === null
              ? "No confirm step"
              : `Confirm step: step ${String(view.confirmStepNumber)} - a new object is recorded when it shows no error`}
          </Typography>
        </Stack>
      )}

      {view !== null && parameters.length === 0 && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          This version has no parameters. Add one if a value in its steps should change from run to run.
        </Typography>
      )}

      {parameters.length > 0 && (
        <Box component="ul" aria-label="Parameters" sx={{ m: 0, p: 0 }}>
          {parameters.map((parameter) => (
            <Box
              component="li"
              key={parameter.key}
              sx={{ listStyle: "none", py: "8px", borderBottom: `1px solid ${nocturneTokens.rowRule}` }}
            >
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                <Box sx={{ minWidth: 0, mr: "auto" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Typography component="h4" sx={{ m: 0, fontSize: 13.5, fontWeight: 600 }}>
                      {parameter.label}
                    </Typography>
                    <StatusTag label={describeParameterSource(parameter)} tone="neutral" isCompact />
                    {parameter.isSecret && <StatusTag label="Secret" tone="stale" isCompact />}
                    {parameter.key === view?.nameParameterKey && actionCreates && (
                      <StatusTag label="Names the new object" tone="accent" isCompact />
                    )}
                  </Box>
                  <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
                    {describeParameterRequirement(parameter)} · used in {describeParameterSteps(parameter)}
                    {parameter.containerName === null ? "" : ` · in “${parameter.containerName}”`}
                  </Typography>
                  <Typography
                    sx={{ fontFamily: MONOSPACE_FONT_FAMILY, fontSize: 12, color: nocturneTokens.neutral[300], overflowWrap: "anywhere" }}
                  >
                    {describeDefaultValue(parameter)}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  aria-label={`Change ${parameter.label}`}
                  onClick={() => {
                    setParameterBeingChanged(parameter);
                  }}
                  sx={{ p: "4px" }}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                {parameter.source === "you" && (
                  <IconButton
                    size="small"
                    aria-label={`Remove ${parameter.label}`}
                    disabled={isSaving}
                    onClick={() => {
                      onRemoveParameter(parameter.key);
                    }}
                    sx={{ p: "4px" }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {saveErrorMessage !== null && parameterBeingChanged === null && !addDialogIsOpen && (
        <Alert severity="error">{saveErrorMessage}</Alert>
      )}

      {view !== null && (
        <Box>
          <Button
            onClick={() => {
              setAddDialogIsOpen(true);
            }}
            variant="outlined"
            color="secondary"
            startIcon={<AddIcon />}
          >
            Add parameter
          </Button>
        </Box>
      )}

      <Dialog
        open={parameterBeingChanged !== null}
        onClose={() => {
          setParameterBeingChanged(null);
        }}
        aria-labelledby="edit-action-parameter-title"
        fullWidth
        maxWidth="xs"
      >
        {parameterBeingChanged !== null && (
          <EditParameterForm
            key={parameterBeingChanged.key}
            parameter={parameterBeingChanged}
            isSaving={isSaving}
            errorMessage={saveErrorMessage}
            onSave={(choices) => {
              void saveParameterChange(choices);
            }}
            onCancel={() => {
              setParameterBeingChanged(null);
            }}
          />
        )}
      </Dialog>

      {view !== null && (
        <AddActionParameterDialog
          isOpen={addDialogIsOpen}
          bindableTexts={view.bindableTexts}
          parameters={parameters.filter((parameter) => parameter.addedField === null && parameter.kind !== "object")}
          objectTypes={objectTypes}
          isSaving={isSaving}
          errorMessage={saveErrorMessage}
          onSave={(body) => {
            void addParameter(body);
          }}
          onCancel={() => {
            setAddDialogIsOpen(false);
          }}
        />
      )}
    </Box>
  );
}
