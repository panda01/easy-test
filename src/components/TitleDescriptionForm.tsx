import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { AddIcon } from "./icons";
import { type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";

/** The "Log in as" choice for running logged out (no credential). */
export const LOGGED_OUT_CREDENTIAL_VALUE = "";

/** One credential the "Log in as" select offers. */
export interface CredentialOption {
  /** The credential's cuid. */
  id: string;
  /** The credential's label. */
  name: string;
}

/** Props for `TitleDescriptionForm`. */
export interface TitleDescriptionFormProps {
  /** The values the fields start with: blank for create, the saved item for edit. */
  initialValues: WebsiteItemRequestBody;
  /** The submit button's text, e.g. "Create use case". */
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
  onSubmit: (values: WebsiteItemRequestBody) => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
  /**
   * The website's credentials, to show the "Log in as" select (actions
   * only); undefined hides it and leaves `credentialId` out of the values.
   */
  credentialOptions?: CredentialOption[];
}

/**
 * The title / description form shared by the create and edit pages of use
 * cases and actions. Both fields are required, so submit is disabled until
 * both are non-blank; the server validates the same rule.
 *
 * Given `credentialOptions` (actions), it also shows a "Log in as" select -
 * the credential the action logs in as before each run, or "Logged out" -
 * and submits the choice as `credentialId` (null for logged out). A saved
 * credential that is no longer offered falls back to "Logged out".
 *
 * Field state is seeded from `initialValues` once, on mount - see
 * `WebsiteForm` for why the edit pages mount it keyed by the record's id.
 *
 * On the create pages the submit button carries a plus
 * (`submitButtonShowsPlus`), like every button that creates something.
 * @param props - Initial values, labels (and whether submit shows a plus), request state, and callbacks
 * @returns The title / description form
 */
export default function TitleDescriptionForm(props: TitleDescriptionFormProps): ReactElement {
  const {
    initialValues,
    submitLabel,
    submitButtonShowsPlus = false,
    isSubmitting,
    errorMessage,
    onSubmit,
    onCancel,
    credentialOptions,
  } = props;
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [selectedCredentialId, setSelectedCredentialId] = useState(
    initialValues.credentialId ?? LOGGED_OUT_CREDENTIAL_VALUE,
  );
  const credentialPickerIsShown = credentialOptions !== undefined;
  const selectedCredentialIsOffered =
    credentialOptions?.some((credentialOption) => credentialOption.id === selectedCredentialId) ??
    false;
  // A credential that is not (or no longer) offered would leave the select
  // blank; it is shown - and saved - as logged out instead.
  const credentialIdToShow = selectedCredentialIsOffered
    ? selectedCredentialId
    : LOGGED_OUT_CREDENTIAL_VALUE;

  const titleIsFilled = title.trim() !== "";
  const descriptionIsFilled = description.trim() !== "";
  const requiredFieldsAreFilled = titleIsFilled && descriptionIsFilled;
  const submitIsBlocked = !requiredFieldsAreFilled || isSubmitting;
  const saveFailed = errorMessage !== null;

  /**
   * Keeps the title field's state in sync with what the user types.
   * @param event - The input's change event
   */
  const handleTitleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setTitle(event.target.value);
  };

  /**
   * Keeps the description field's state in sync with what the user types.
   * @param event - The textarea's change event
   */
  const handleDescriptionChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    setDescription(event.target.value);
  };

  /**
   * Keeps the "Log in as" choice in sync with the select.
   * @param event - The select's change event
   */
  const handleCredentialChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    setSelectedCredentialId(event.target.value);
  };

  /**
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    if (!credentialPickerIsShown) {
      onSubmit({ title, description });
      return;
    }
    const actionRunsLoggedOut = credentialIdToShow === LOGGED_OUT_CREDENTIAL_VALUE;
    onSubmit({ title, description, credentialId: actionRunsLoggedOut ? null : credentialIdToShow });
  };

  return (
    <Box component="form" noValidate onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField label="Title" value={title} onChange={handleTitleChange} required fullWidth />
        <TextField
          label="Description"
          value={description}
          onChange={handleDescriptionChange}
          required
          multiline
          minRows={3}
          fullWidth
        />
        {credentialPickerIsShown && (
          <TextField
            select
            label="Log in as"
            value={credentialIdToShow}
            onChange={handleCredentialChange}
            helperText="Before each run, the browser logs in as this credential first"
            // The logged-out option's value is "", which MUI renders as an
            // empty field unless told to display it.
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            fullWidth
          >
            <MenuItem value={LOGGED_OUT_CREDENTIAL_VALUE}>Logged out (no credential)</MenuItem>
            {credentialOptions.map((credentialOption) => (
              <MenuItem key={credentialOption.id} value={credentialOption.id}>
                {credentialOption.name}
              </MenuItem>
            ))}
          </TextField>
        )}
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
