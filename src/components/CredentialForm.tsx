import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type CredentialRequestBody } from "../hooks/useCredentials";

/** Props for `CredentialForm`. */
export interface CredentialFormProps {
  /**
   * The values the fields start with: blank for create, the saved credential
   * for edit (its own login page URL, or blank when it uses the website's).
   * The password always starts blank - the server never sends it.
   */
  initialValues: CredentialRequestBody;
  /**
   * The owning website's login page URL, or null when the website has none.
   * With one, the credential's own login page URL is optional (blank uses the
   * website's); without one, it is required.
   */
  websiteLoginUrl: string | null;
  /**
   * True on the edit page, where a password is already saved: the password
   * field may then be left blank to keep it. False on create, where it is
   * required.
   */
  passwordIsSaved: boolean;
  /** The submit button's text, e.g. "Create credential". */
  submitLabel: string;
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
 * The form shared by the create and edit credential pages: name, description,
 * login page URL, username, password, and the three optional login form
 * selectors. It owns only the field values; saving and navigation belong to
 * the page.
 *
 * The login page URL overrides the website's own. When the website has one,
 * the field is optional - blank uses the website's, which the field shows as
 * its placeholder. When the website has none, the field is required (a
 * successful login with it also saves it to the website, on the server).
 *
 * Field state is seeded from `initialValues` once, on mount, so the edit page
 * mounts this form only after the credential has loaded, keyed by its id.
 *
 * Submit is disabled until name, username, - when the website has no login
 * page - the login page URL, and - on create - password are non-blank. On
 * edit, a blank password keeps the saved one. The server still validates
 * everything (e.g. the URL format) and its message is shown via
 * `errorMessage`.
 * @param props - Initial values, the website's login page URL, whether a password is saved, labels, request state, and callbacks
 * @returns The credential form
 */
export default function CredentialForm(props: CredentialFormProps): ReactElement {
  const {
    initialValues,
    websiteLoginUrl,
    passwordIsSaved,
    submitLabel,
    isSubmitting,
    errorMessage,
    onSubmit,
    onCancel,
  } = props;
  const [values, setValues] = useState<CredentialRequestBody>(initialValues);

  const nameIsFilled = values.name.trim() !== "";
  const usernameIsFilled = values.username.trim() !== "";
  const loginUrlIsFilled = values.loginUrl.trim() !== "";
  const websiteHasLoginUrl = websiteLoginUrl !== null;
  const loginUrlIsRequired = !websiteHasLoginUrl;
  const loginUrlRequirementIsMet = websiteHasLoginUrl || loginUrlIsFilled;
  const passwordIsFilled = values.password.trim() !== "";
  const passwordRequirementIsMet = passwordIsSaved || passwordIsFilled;
  const requiredFieldsAreFilled =
    nameIsFilled && usernameIsFilled && loginUrlRequirementIsMet && passwordRequirementIsMet;
  const submitIsBlocked = !requiredFieldsAreFilled || isSubmitting;
  const saveFailed = errorMessage !== null;
  const loginUrlPlaceholder = websiteHasLoginUrl ? websiteLoginUrl : "https://example.com/login";
  const loginUrlHelperText = websiteHasLoginUrl
    ? `Leave blank to use the website's login page (${websiteLoginUrl})`
    : "This website has no login page URL yet - enter it here (a successful login will also save it to the website)";
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
          label="Login page URL"
          value={values.loginUrl}
          onChange={handleFieldChange("loginUrl")}
          placeholder={loginUrlPlaceholder}
          helperText={loginUrlHelperText}
          required={loginUrlIsRequired}
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

        <Typography variant="subtitle1" component="h2">
          Login form selectors (optional)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          The crawler finds the username field, password field, and submit button on its own.
          Fill these in only when it picks the wrong one: each is a CSS selector, such as
          #email or button.sign-in.
        </Typography>
        <TextField
          label="Username field selector"
          value={values.usernameSelector}
          onChange={handleFieldChange("usernameSelector")}
          fullWidth
        />
        <TextField
          label="Password field selector"
          value={values.passwordSelector}
          onChange={handleFieldChange("passwordSelector")}
          fullWidth
        />
        <TextField
          label="Submit button selector"
          value={values.submitSelector}
          onChange={handleFieldChange("submitSelector")}
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
