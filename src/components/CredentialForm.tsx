import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { AddIcon } from "./icons";
import { type CredentialRequestBody } from "../hooks/useCredentials";

/** Props for `CredentialForm`. */
export interface CredentialFormProps {
  /**
   * The values the fields start with: blank for create, the saved credential
   * for edit. The password always starts blank - the server never sends it.
   */
  initialValues: CredentialRequestBody;
  /**
   * True on the edit page, where a password is already saved: the password
   * field may then be left blank to keep it. False on create, where it is
   * required.
   */
  passwordIsSaved: boolean;
  /** The submit button's text, e.g. "Create credential". */
  submitLabel: string;
  /**
   * True to put a plus before the submit button's text, as every button that
   * creates something has (the create pages); false or omitted for an edit
   * page's "Save changes".
   */
  submitButtonShowsPlus?: boolean;
  /** True while the save request is in flight; disables submit. */
  isSubmitting: boolean;
  /** Why the last save failed (shown above the buttons), or null. */
  errorMessage: string | null;
  /** Called with the field values when the form is submitted. */
  onSubmit: (values: CredentialRequestBody) => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
}

/** The text fields of the form, in the order they are shown. */
type CredentialFieldName = keyof CredentialRequestBody;

/**
 * The form shared by the create and edit credential pages: name,
 * description, username, and password - the account a Login action logs in
 * as. Where and how it logs in (the login page and form selectors) belongs
 * to the Login action, not here. It owns only the field values; saving and
 * navigation belong to the page.
 *
 * Field state is seeded from `initialValues` once, on mount, so the edit page
 * mounts this form only after the credential has loaded, keyed by its id.
 *
 * Submit is disabled until name, username, and - on create - password are
 * non-blank. On edit, a blank password keeps the saved one. The server still
 * validates everything and its message is shown via `errorMessage`.
 *
 * On the create page the submit button carries a plus
 * (`submitButtonShowsPlus`), like every button that creates something.
 * @param props - Initial values, whether a password is saved, labels (and whether submit shows a plus), request state, and callbacks
 * @returns The credential form
 */
export default function CredentialForm(props: CredentialFormProps): ReactElement {
  const {
    initialValues,
    passwordIsSaved,
    submitLabel,
    submitButtonShowsPlus = false,
    isSubmitting,
    errorMessage,
    onSubmit,
    onCancel,
  } = props;
  const [values, setValues] = useState<CredentialRequestBody>(initialValues);

  const nameIsFilled = values.name.trim() !== "";
  const usernameIsFilled = values.username.trim() !== "";
  const passwordIsFilled = values.password.trim() !== "";
  const passwordRequirementIsMet = passwordIsSaved || passwordIsFilled;
  const requiredFieldsAreFilled = nameIsFilled && usernameIsFilled && passwordRequirementIsMet;
  const submitIsBlocked = !requiredFieldsAreFilled || isSubmitting;
  const saveFailed = errorMessage !== null;
  const passwordHelperText = passwordIsSaved
    ? "A password is saved. Leave this blank to keep it, or type a new one to replace it."
    : "Stored encrypted. It is never shown again after you save.";

  /**
   * Builds the change handler of one field, which keeps that field's state in
   * sync with what the user types.
   * @param fieldName - The field the handler updates
   * @returns The field's change handler
   */
  const handleFieldChange =
    (fieldName: CredentialFieldName) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const newValue = event.target.value;
      setValues((currentValues) => ({ ...currentValues, [fieldName]: newValue }));
    };

  /**
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    onSubmit(values);
  };

  return (
    <Box component="form" noValidate onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField
          label="Name"
          value={values.name}
          onChange={handleFieldChange("name")}
          placeholder="e.g. Admin user"
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={values.description}
          onChange={handleFieldChange("description")}
          multiline
          minRows={2}
          fullWidth
        />
        <TextField
          label="Username"
          value={values.username}
          onChange={handleFieldChange("username")}
          autoComplete="off"
          required
          fullWidth
        />
        <TextField
          label="Password"
          type="password"
          value={values.password}
          onChange={handleFieldChange("password")}
          helperText={passwordHelperText}
          autoComplete="new-password"
          required={!passwordIsSaved}
          fullWidth
        />

        {saveFailed && <Alert severity="error">{errorMessage}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button
            type="submit"
            variant="contained"
            disabled={submitIsBlocked}
            startIcon={submitButtonShowsPlus ? <AddIcon /> : undefined}
          >
            {submitLabel}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
