import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type WebsiteRequestBody } from "../hooks/useWebsites";

/** Props for `WebsiteForm`. */
export interface WebsiteFormProps {
  /** The values the fields start with: blank text and default timing settings for create, the saved website for edit. */
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
 * pages, plus the website's two screenshot timing settings (network idle cap
 * and minimum wait, in milliseconds). It owns only the field values; saving
 * and navigation belong to the page.
 *
 * Field state is seeded from `initialValues` once, on mount. The edit page
 * therefore mounts this form only after the website has loaded, keyed by its
 * id, so a different website always gets a fresh form.
 *
 * Submit is disabled until URL, name, and both timing settings are non-blank.
 * The timing settings are held as text while editing and sent as numbers. The
 * server still validates everything (URL format, the 0-30000 range, whole
 * numbers, and the cap not being lower than the minimum) and its message is
 * shown via `errorMessage`.
 * @param props - Initial values, labels, request state, and callbacks
 * @returns The website form
 */
export default function WebsiteForm(props: WebsiteFormProps): ReactElement {
  const { initialValues, submitLabel, isSubmitting, errorMessage, onSubmit, onCancel } = props;
  const [url, setUrl] = useState(initialValues.url);
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [networkIdleTimeoutMs, setNetworkIdleTimeoutMs] = useState(
    String(initialValues.networkIdleTimeoutMs),
  );
  const [screenshotMinimumWaitMs, setScreenshotMinimumWaitMs] = useState(
    String(initialValues.screenshotMinimumWaitMs),
  );

  const urlIsFilled = url.trim() !== "";
  const nameIsFilled = name.trim() !== "";
  const networkIdleTimeoutIsFilled = networkIdleTimeoutMs.trim() !== "";
  const screenshotMinimumWaitIsFilled = screenshotMinimumWaitMs.trim() !== "";
  const requiredFieldsAreFilled =
    urlIsFilled && nameIsFilled && networkIdleTimeoutIsFilled && screenshotMinimumWaitIsFilled;
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
   * Keeps the network idle cap field's state in sync with what the user types.
   * @param event - The input's change event
   */
  const handleNetworkIdleTimeoutChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    setNetworkIdleTimeoutMs(event.target.value);
  };

  /**
   * Keeps the minimum wait field's state in sync with what the user types.
   * @param event - The input's change event
   */
  const handleScreenshotMinimumWaitChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    setScreenshotMinimumWaitMs(event.target.value);
  };

  /**
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    onSubmit({
      url,
      name,
      description,
      networkIdleTimeoutMs: Number(networkIdleTimeoutMs),
      screenshotMinimumWaitMs: Number(screenshotMinimumWaitMs),
    });
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
        <Typography variant="subtitle1" component="h2">
          Screenshot settings
        </Typography>
        <TextField
          label="Network idle cap (ms)"
          type="number"
          value={networkIdleTimeoutMs}
          onChange={handleNetworkIdleTimeoutChange}
          helperText="How long to wait for network requests to finish (0–30000, and not lower than the minimum wait). If they're still running after this, the screenshot is taken right away."
          slotProps={{ htmlInput: { min: 0, max: 30000, step: 1 } }}
          required
          fullWidth
        />
        <TextField
          label="Minimum wait (ms)"
          type="number"
          value={screenshotMinimumWaitMs}
          onChange={handleScreenshotMinimumWaitChange}
          helperText="The screenshot is never taken sooner than this after the page loads (0–30000). If the page is ready later, there is no extra wait."
          slotProps={{ htmlInput: { min: 0, max: 30000, step: 1 } }}
          required
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
