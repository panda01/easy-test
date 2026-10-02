import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type WebsiteRequestBody } from "../hooks/useWebsites";

/** Props for `WebsiteForm`. */
export interface WebsiteFormProps {
  /** The values the fields start with: blank for create, the saved website for edit. */
  initialValues: WebsiteRequestBody;
  /** The submit button's text, e.g. "Create website". */
  submitLabel: string;
  /** True while the save request is in flight; disables submit. */
  isSubmitting: boolean;
  /** Why the last save failed (shown above the buttons), or null. */
  errorMessage: string | null;
  /** Called with the field values when the form is submitted. */
  onSubmit: (values: WebsiteRequestBody) => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
}

/**
 * The URL / name / description form shared by the create and edit website
 * pages. It owns only the field values; saving and navigation belong to the
 * page.
 *
 * Field state is seeded from `initialValues` once, on mount. The edit page
 * therefore mounts this form only after the website has loaded, keyed by its
 * id, so a different website always gets a fresh form.
 *
 * Submit is disabled until URL and name are non-blank. The server still
 * validates everything (URL format included) and its message is shown via
 * `errorMessage`.
 * @param props - Initial values, labels, request state, and callbacks
 * @returns The website form
 */
export default function WebsiteForm(props: WebsiteFormProps): ReactElement {
  const { initialValues, submitLabel, isSubmitting, errorMessage, onSubmit, onCancel } = props;
  const [url, setUrl] = useState(initialValues.url);
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);

  const urlIsFilled = url.trim() !== "";
  const nameIsFilled = name.trim() !== "";
  const requiredFieldsAreFilled = urlIsFilled && nameIsFilled;
  const submitIsBlocked = !requiredFieldsAreFilled || isSubmitting;
  const saveFailed = errorMessage !== null;

  /**
   * Keeps the URL field's state in sync with what the user types.
   * @param event - The input's change event
   */
  const handleUrlChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setUrl(event.target.value);
  };

  /**
   * Keeps the name field's state in sync with what the user types.
   * @param event - The input's change event
   */
  const handleNameChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setName(event.target.value);
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
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    onSubmit({ url, name, description });
  };

  return (
    <Box component="form" noValidate onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField
          label="URL"
          value={url}
          onChange={handleUrlChange}
          placeholder="https://example.com"
          required
          fullWidth
        />
        <TextField label="Name" value={name} onChange={handleNameChange} required fullWidth />
        <TextField
          label="Description"
          value={description}
          onChange={handleDescriptionChange}
          multiline
          minRows={3}
          fullWidth
        />
        {saveFailed && <Alert severity="error">{errorMessage}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={submitIsBlocked}>
            {submitLabel}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
