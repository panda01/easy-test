import { type ReactElement, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import {
  MAX_PARAMETER_LABEL_LENGTH,
  type BindableTextRecord,
  type NewParameterRequestBody,
  type VersionParameterRecord,
} from "../utils/actionParameters";
import { ARIA_ROLES, type PlanTarget } from "../utils/actionPlanSteps";

/** One object type the dialog offers for an object parameter. */
export interface ObjectTypeOption {
  /** The type's key. */
  key: string;
  /** Its name. */
  name: string;
}

/** Props for `AddActionParameterDialog`. */
export interface AddActionParameterDialogProps {
  /** True while the dialog is open. */
  isOpen: boolean;
  /** The texts of the version's steps the user can make a parameter of. */
  bindableTexts: BindableTextRecord[];
  /** The version's parameters, to fill a new field in after. */
  parameters: VersionParameterRecord[];
  /** The website's object types, for an object parameter. */
  objectTypes: ObjectTypeOption[];
  /** True while the add request is in flight. */
  isSaving: boolean;
  /** Why the last add failed, or null. */
  errorMessage: string | null;
  /** Called with the new parameter when the user clicks Add. */
  onSave: (body: NewParameterRequestBody) => void;
  /** Called when the user backs out. */
  onCancel: () => void;
}

/** How a new field is found. */
type FieldFinder = "label" | "placeholder" | "role";

/** Words for where a text appears in the steps. */
const FIELD_WORDS: Record<BindableTextRecord["fields"][number], string> = {
  value: "typed",
  targetName: "a name clicked or checked",
  targetText: "a text clicked or checked",
  url: "in an address",
};

/**
 * Builds the target a new field is found by.
 * @param fieldFinder - By label, placeholder, or role and name
 * @param findText - The label, placeholder, or name
 * @param role - The role, for a role target
 * @returns The target
 */
function buildFieldTarget(fieldFinder: FieldFinder, findText: string, role: string): PlanTarget {
  if (fieldFinder === "label") return { label: findText };
  if (fieldFinder === "placeholder") return { placeholder: findText };
  return { role, name: findText };
}

/**
 * The dialog's form, mounted fresh each time the dialog opens.
 * @param props - The dialog's props
 * @returns The title, fields, and buttons
 */
function AddActionParameterForm(props: AddActionParameterDialogProps): ReactElement {
  const { bindableTexts, parameters, objectTypes, isSaving, errorMessage, onSave, onCancel } = props;
  const [addKind, setAddKind] = useState<"value" | "field">("value");
  const [label, setLabel] = useState("");
  const [requiredChoice, setRequiredChoice] = useState<"required" | "optional">("required");
  const [matchText, setMatchText] = useState(bindableTexts.at(0)?.text ?? "");
  const [valueKind, setValueKind] = useState<"text" | "object">("text");
  const [objectTypeKey, setObjectTypeKey] = useState(objectTypes.at(0)?.key ?? "");
  const [fieldFinder, setFieldFinder] = useState<FieldFinder>("label");
  const [findText, setFindText] = useState("");
  const [role, setRole] = useState("textbox");
  const [stepAction, setStepAction] = useState<"fill" | "selectOption">("fill");
  const [fillAfterKey, setFillAfterKey] = useState(parameters.at(0)?.key ?? "");
  const [saveWasAttempted, setSaveWasAttempted] = useState(false);

  const labelIsFilled = label.trim() !== "";
  const valueIsComplete = matchText !== "" && (valueKind === "text" || objectTypeKey !== "");
  const fieldIsComplete = findText.trim() !== "" && fillAfterKey !== "";
  const addIsBlocked = isSaving || !labelIsFilled || (addKind === "value" ? !valueIsComplete : !fieldIsComplete);
  const addFailed = saveWasAttempted && errorMessage !== null;

  /** Sends the new parameter. */
  const handleAddClick = (): void => {
    setSaveWasAttempted(true);
    if (addKind === "value") {
      onSave({
        addKind,
        label: label.trim(),
        requiredChoice: valueKind === "object" ? "required" : requiredChoice,
        valueKind,
        objectTypeKey: valueKind === "object" ? objectTypeKey : null,
        matchText,
      });
      return;
    }
    onSave({
      addKind,
      label: label.trim(),
      requiredChoice,
      fieldTarget: buildFieldTarget(fieldFinder, findText.trim(), role),
      stepAction,
      fillAfterKey,
    });
  };

  return (
    <>
      <DialogTitle id="add-action-parameter-title">Add a parameter</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Kind"
            value={addKind}
            onChange={(event) => {
              setAddKind(event.target.value === "field" ? "field" : "value");
              setRequiredChoice(event.target.value === "field" ? "optional" : "required");
            }}
            fullWidth
          >
            <MenuItem value="value">A value in the steps</MenuItem>
            <MenuItem value="field">A field the steps don&apos;t fill</MenuItem>
          </TextField>
          <TextField
            label="Label"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            slotProps={{ htmlInput: { maxLength: MAX_PARAMETER_LABEL_LENGTH } }}
            required
            fullWidth
          />

          {addKind === "value" ? (
            <>
              <TextField
                select
                label="Value in the steps"
                value={matchText}
                onChange={(event) => {
                  setMatchText(event.target.value);
                }}
                helperText="Every version whose steps hold this text gets the parameter"
                fullWidth
              >
                {bindableTexts.map((bindableText) => (
                  <MenuItem key={bindableText.text} value={bindableText.text}>
                    {bindableText.text} ({bindableText.fields.map((field) => FIELD_WORDS[field]).join(", ")})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="It is"
                value={valueKind}
                onChange={(event) => {
                  setValueKind(event.target.value === "object" ? "object" : "text");
                }}
                fullWidth
              >
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="object">An object (always required)</MenuItem>
              </TextField>
              {valueKind === "object" && (
                <TextField
                  select
                  label="Object type"
                  value={objectTypeKey}
                  onChange={(event) => {
                    setObjectTypeKey(event.target.value);
                  }}
                  fullWidth
                >
                  {objectTypes.map((objectType) => (
                    <MenuItem key={objectType.key} value={objectType.key}>
                      {objectType.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </>
          ) : (
            <>
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  label="Find it by"
                  value={fieldFinder}
                  onChange={(event) => {
                    const pickedFinder = event.target.value;
                    setFieldFinder(pickedFinder === "placeholder" || pickedFinder === "role" ? pickedFinder : "label");
                  }}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="label">Label</MenuItem>
                  <MenuItem value="placeholder">Placeholder</MenuItem>
                  <MenuItem value="role">Role and name</MenuItem>
                </TextField>
                {fieldFinder === "role" && (
                  <TextField
                    select
                    label="Role"
                    value={role}
                    onChange={(event) => {
                      setRole(event.target.value);
                    }}
                    sx={{ minWidth: 140 }}
                  >
                    {ARIA_ROLES.map((ariaRole) => (
                      <MenuItem key={ariaRole} value={ariaRole}>
                        {ariaRole}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                <TextField
                  label={
                    fieldFinder === "role"
                      ? "The field's name"
                      : fieldFinder === "placeholder"
                        ? "The field's placeholder"
                        : "The field's label"
                  }
                  value={findText}
                  onChange={(event) => {
                    setFindText(event.target.value);
                  }}
                  required
                  fullWidth
                />
              </Stack>
              <TextField
                select
                label="Typed or picked"
                value={stepAction}
                onChange={(event) => {
                  setStepAction(event.target.value === "selectOption" ? "selectOption" : "fill");
                }}
                fullWidth
              >
                <MenuItem value="fill">Typed (fill)</MenuItem>
                <MenuItem value="selectOption">Picked from a list (select)</MenuItem>
              </TextField>
              <TextField
                select
                label="Filled in after"
                value={fillAfterKey}
                onChange={(event) => {
                  setFillAfterKey(event.target.value);
                }}
                helperText="Every version that has this parameter gets the field"
                fullWidth
              >
                {parameters.map((parameter) => (
                  <MenuItem key={parameter.key} value={parameter.key}>
                    {parameter.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          {!(addKind === "value" && valueKind === "object") && (
            <TextField
              select
              label="Required"
              value={requiredChoice}
              onChange={(event) => {
                setRequiredChoice(event.target.value === "optional" ? "optional" : "required");
              }}
              fullWidth
            >
              <MenuItem value="required">Required</MenuItem>
              <MenuItem value="optional">Optional</MenuItem>
            </TextField>
          )}
          {addFailed && <Alert severity="error">{errorMessage}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleAddClick} disabled={addIsBlocked} variant="contained">
          Add
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Adds one of the user's own parameters, for when detection missed one:
 * - "A value in the steps": pick a text of the version's steps (a typed
 *   value, a clicked name or text, an address), name it, and say whether it
 *   is text or an object (with its type - an object one is always
 *   required). It applies to every version whose steps hold that text.
 * - "A field the steps don't fill": say how to find the field (by label,
 *   placeholder, or role and name), whether it is typed or picked, and which
 *   parameter it is filled in after. It applies to every version that has
 *   that parameter.
 * A failed add keeps the dialog open with the server's reason.
 * @param props - Whether it is open, the version's texts and parameters, the object types, the request state, and the callbacks
 * @returns The dialog
 */
export default function AddActionParameterDialog(props: AddActionParameterDialogProps): ReactElement {
  const { isOpen, onCancel } = props;
  return (
    <Dialog open={isOpen} onClose={onCancel} aria-labelledby="add-action-parameter-title" fullWidth maxWidth="sm">
      {isOpen && <AddActionParameterForm {...props} />}
    </Dialog>
  );
}
