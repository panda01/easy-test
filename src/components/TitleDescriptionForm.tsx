import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";

/** Props for `TitleDescriptionForm`. */
export interface TitleDescriptionFormProps {
  /** The values the fields start with: blank for create, the saved item for edit. */
  initialValues: WebsiteItemRequestBody;
  /** The submit button's text, e.g. "Create use case". */
  submitLabel: string;
  /** True while the save request is in flight; disables submit. */
  isSubmitting: boolean;
  /** Why the last save failed (shown above the buttons), or null. */
  errorMessage: string | null;
  /** Called with the field values when the form is submitted. */
  onSubmit: (values: WebsiteItemRequestBody) => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
}

/**
 * The title / description form shared by the create and edit pages of use
 * cases and actions. Both fields are required, so submit is disabled until
 * both are non-blank; the server validates the same rule.
 *
 * Field state is seeded from `initialValues` once, on mount - see
 * `WebsiteForm` for why the edit pages mount it keyed by the record's id.
 * @param props - Initial values, labels, request state, and callbacks
 * @returns The title / description form
 */
export default function TitleDescriptionForm(props: TitleDescriptionFormProps): ReactElement {
  const { initialValues, submitLabel, isSubmitting, errorMessage, onSubmit, onCancel } = props;
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);

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
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    onSubmit({ title, description });
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
