import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AddIcon } from "./icons";
import { type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";
import {
  ACTION_KIND_HELP,
  ACTION_KIND_LABELS,
  DETECT_CHOICE_VALUE,
  describeDetectedKindChoice,
  describeDetectedObjectTypeChoice,
  kindTakesAnObjectType,
} from "../utils/actionObjectRole";
import {
  LOGIN_ACTION_KIND,
  type ActionKindRecord,
  type ActionObjectRoleRecord,
} from "../utils/actionParameters";

/** The "Log in as" choice for running logged out (no credential). */
export const LOGGED_OUT_CREDENTIAL_VALUE = "";

/** One credential the "Log in as" select offers. */
export interface CredentialOption {
  /** The credential's cuid. */
  id: string;
  /** The credential's label. */
  name: string;
}

/** The website's Login action, as the form names it. */
export interface LoginActionOption {
  /** The Login action's cuid. */
  id: string;
  /** Its title. */
  title: string;
}

/** What an action's login fields need (actions only). */
export interface LoginChoices {
  /** The website's credentials, for any other action's "Log in as" select. */
  credentials: CredentialOption[];
  /**
   * The website's Login action, or null when it has none - or when the
   * action being edited IS it (the page leaves it out). While it is set, the
   * Kind select does not offer Login: a website has only one.
   */
  loginAction: LoginActionOption | null;
  /** The website's default login page, which the Login action uses when it has none of its own; null when it has none. */
  websiteLoginUrl: string | null;
}

/** A Login action's three optional form-field selectors, with their labels. */
const LOGIN_SELECTOR_FIELDS = [
  { fieldName: "usernameSelector", label: "Username field selector" },
  { fieldName: "passwordSelector", label: "Password field selector" },
  { fieldName: "submitSelector", label: "Submit button selector" },
] as const;

/** The names of a Login action's three selector fields. */
type LoginSelectorFieldName = (typeof LOGIN_SELECTOR_FIELDS)[number]["fieldName"];

/**
 * Turns a typed text field into what the server stores: blank means null.
 * @param typedText - What the field holds
 * @returns The trimmed text, or null when it is blank
 */
function readOptionalText(typedText: string): string | null {
  const trimmedText = typedText.trim();
  return trimmedText === "" ? null : trimmedText;
}

/**
 * Says where a Login action with no login page of its own logs in, under its
 * "Login page URL" field.
 * @param websiteLoginUrl - The website's default login page, or null
 * @returns The helper text
 */
export function describeLoginPageHelp(websiteLoginUrl: string | null): string {
  if (websiteLoginUrl === null) {
    return "This website has no login page URL yet - enter it here (a successful crawl login will also save it to the website)";
  }
  return `Leave blank to use the website's login page (${websiteLoginUrl})`;
}

/**
 * Says what the "Log in as" choice does, under its select.
 * @param websiteHasCredentials - True when the website has a credential to pick
 * @param loginAction - The website's Login action, or null when it has none
 * @param aCredentialIsPicked - True when one is picked (false for "Logged out")
 * @returns The helper text
 */
export function describeLogInAsHelp(
  websiteHasCredentials: boolean,
  loginAction: LoginActionOption | null,
  aCredentialIsPicked: boolean,
): string {
  if (!websiteHasCredentials) {
    return "This website has no credentials yet - add one on its Credentials tab to run logged in";
  }
  if (loginAction === null) {
    return "This website has no login action yet, so a run cannot log in - look for a login form on its Credentials tab, or add an action with the kind Login";
  }
  if (!aCredentialIsPicked) {
    return "Each run starts logged out";
  }
  return `Before each run, the browser logs in as this credential with the login action "${loginAction.title}"`;
}

/** One object type the "Object type" select offers. */
export interface ObjectTypeChoice {
  /** The web object's key (its own page's URL pattern). */
  key: string;
  /** Its name. */
  name: string;
}

/** What the action's object role fields need: the types to offer, and what "Detect" picks now. */
export interface ObjectRoleChoices {
  /** The website's web objects. */
  objectTypes: ObjectTypeChoice[];
  /** The action's role with its detections, or null for a new action (nothing detected yet). */
  detectedRole: ActionObjectRoleRecord | null;
}

/**
 * Reads the kind select's value back.
 * @param choiceValue - The select's value
 * @returns The kind, or null for "Detect"
 */
function readKindChoice(choiceValue: string): ActionKindRecord | null {
  const kinds = Object.keys(ACTION_KIND_LABELS) as ActionKindRecord[];
  return kinds.find((kind) => kind === choiceValue) ?? null;
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
  /** Called when the user clicks Cancel (or the button `cancelLabel` names). */
  onCancel: () => void;
  /** The cancel button's text; "Cancel" when omitted. Step 2 of a Create action uses "Skip for now". */
  cancelLabel?: string;
  /**
   * The website's credentials and Login action (actions only), to show the
   * login fields: the Login action's login page and selectors, or any other
   * action's "Log in as". Undefined hides them and leaves the login fields
   * out of the values.
   */
  loginChoices?: LoginChoices;
  /**
   * The object role choices (actions only): shows the Kind, Object type,
   * selects; undefined hides them and leaves the
   * role fields out of the values.
   */
  objectRoleChoices?: ObjectRoleChoices;
}

/**
 * The title / description form shared by the create and edit pages of use
 * cases and actions. Both fields are required, so submit is disabled until
 * both are non-blank; the server validates the same rule.
 *
 * Given `objectRoleChoices` (actions), it also shows what the action does
 * with an object - each select starting on "Detect", which names what the
 * detection picks and how sure it is:
 * - Kind: Parameters (typed values only), Create (makes an object, recorded
 *   on each run), Read, Update, or Delete (act on an existing object, which
 *   every run names), or Login (only ever picked, never detected; not
 *   offered while the website already has its Login action);
 * - Object type (every kind but Parameters and Login): one of the website's
 *   web objects.
 * Their warnings (a tie, no type found, an unsure type) show under them. The
 * name parameter is kept as it was (it is picked in the Parameters section).
 *
 * Given `loginChoices` (actions), it also shows how the action logs in,
 * which depends on the kind:
 * - the LOGIN action: "Login page URL" (blank uses the website's) and the
 *   three optional form-field selectors; it logs in as whichever credential
 *   the action or crawl picks, so it has no credential - submitted as
 *   `loginUrl` and the selectors, with `credentialId` null;
 * - any other action: "Log in as" - one of the website's credentials, or
 *   "Logged out" - submitted as `credentialId` (null for logged out), with
 *   the Login-only fields null. A saved credential that is no longer
 *   offered falls back to "Logged out".
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
    cancelLabel = "Cancel",
    loginChoices,
    objectRoleChoices,
  } = props;
  const [kindChoice, setKindChoice] = useState<string>(initialValues.userActionKind ?? DETECT_CHOICE_VALUE);
  const [objectTypeChoice, setObjectTypeChoice] = useState<string>(
    initialValues.userObjectTypeKey ?? DETECT_CHOICE_VALUE,
  );
  const roleFieldsAreShown = objectRoleChoices !== undefined;
  const detectedRole = objectRoleChoices?.detectedRole ?? null;
  const effectiveKind = readKindChoice(kindChoice) ?? detectedRole?.detectedKind.kind ?? null;
  // Before anything is detected (a new action on "Detect"), a type may apply.
  const kindTakesAType = kindTakesAnObjectType(effectiveKind);
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const loginFieldsAreShown = loginChoices !== undefined;
  const actionIsALoginAction = effectiveKind === LOGIN_ACTION_KIND;
  const [selectedCredentialId, setSelectedCredentialId] = useState(
    initialValues.credentialId ?? LOGGED_OUT_CREDENTIAL_VALUE,
  );
  const selectedCredentialIsOffered =
    loginChoices?.credentials.some((credentialOption) => credentialOption.id === selectedCredentialId) ?? false;
  // A credential that is not (or no longer) offered would leave the select
  // blank; it is shown - and saved - as logged out instead.
  const credentialIdToShow = selectedCredentialIsOffered ? selectedCredentialId : LOGGED_OUT_CREDENTIAL_VALUE;
  const websiteLoginAction = loginChoices?.loginAction ?? null;
  const loginKindIsTaken = websiteLoginAction !== null;
  const [loginUrl, setLoginUrl] = useState(initialValues.loginUrl ?? "");
  const [loginSelectors, setLoginSelectors] = useState<Record<LoginSelectorFieldName, string>>({
    usernameSelector: initialValues.usernameSelector ?? "",
    passwordSelector: initialValues.passwordSelector ?? "",
    submitSelector: initialValues.submitSelector ?? "",
  });
  const websiteLoginUrl = loginChoices?.websiteLoginUrl ?? null;
  const loginActionPageIsMissing =
    loginFieldsAreShown && actionIsALoginAction && loginUrl.trim() === "" && websiteLoginUrl === null;

  const titleIsFilled = title.trim() !== "";
  const descriptionIsFilled = description.trim() !== "";
  const requiredFieldsAreFilled = titleIsFilled && descriptionIsFilled && !loginActionPageIsMissing;
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
   * Keeps any other action's "Log in as" choice in sync with the select.
   * @param event - The select's change event
   */
  const handleCredentialChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    setSelectedCredentialId(event.target.value);
  };

  /**
   * Keeps a Login action's "Login page URL" field in sync with what the user types.
   * @param event - The input's change event
   */
  const handleLoginUrlChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setLoginUrl(event.target.value);
  };

  /**
   * Builds the change handler of one of a Login action's selector fields.
   * @param fieldName - Which selector the field holds
   * @returns The field's change handler
   */
  const buildSelectorChangeHandler =
    (fieldName: LoginSelectorFieldName) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const typedSelector = event.target.value;
      setLoginSelectors((currentSelectors) => ({ ...currentSelectors, [fieldName]: typedSelector }));
    };

  /**
   * Builds the login fields the form submits for an action: the Login
   * action's login page and selectors, or any other action's credential -
   * the other kind's fields always null, as the server requires.
   * @returns The login fields of the request body
   */
  const buildLoginValues = (): Pick<
    WebsiteItemRequestBody,
    "credentialId" | "loginUrl" | "usernameSelector" | "passwordSelector" | "submitSelector"
  > => {
    if (actionIsALoginAction) {
      return {
        credentialId: null,
        loginUrl: readOptionalText(loginUrl),
        usernameSelector: readOptionalText(loginSelectors.usernameSelector),
        passwordSelector: readOptionalText(loginSelectors.passwordSelector),
        submitSelector: readOptionalText(loginSelectors.submitSelector),
      };
    }
    const actionRunsLoggedOut = credentialIdToShow === LOGGED_OUT_CREDENTIAL_VALUE;
    return {
      credentialId: actionRunsLoggedOut ? null : credentialIdToShow,
      loginUrl: null,
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    };
  };

  /**
   * Stops the browser's full-page form post and hands the values to the page.
   * Ignored while submit is blocked (e.g. Enter pressed with a blank field).
   * @param event - The form's submit event
   */
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitIsBlocked) return;
    if (!loginFieldsAreShown) {
      onSubmit({ title, description });
      return;
    }
    const roleValues = roleFieldsAreShown
      ? {
          userActionKind: readKindChoice(kindChoice),
          userObjectTypeKey:
            objectTypeChoice === DETECT_CHOICE_VALUE || !kindTakesAType ? null : objectTypeChoice,
          userNameParameterKey: initialValues.userNameParameterKey ?? null,
        }
      : {};
    onSubmit({ title, description, ...buildLoginValues(), ...roleValues });
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
        {roleFieldsAreShown && (
          <TextField
            select
            label="Kind"
            value={kindChoice}
            onChange={(event) => {
              setKindChoice(event.target.value);
            }}
            helperText={effectiveKind === null ? undefined : ACTION_KIND_HELP[effectiveKind]}
            fullWidth
          >
            <MenuItem value={DETECT_CHOICE_VALUE}>{describeDetectedKindChoice(detectedRole)}</MenuItem>
            {(Object.keys(ACTION_KIND_LABELS) as ActionKindRecord[]).map((kind) => {
              const kindIsATakenLogin = kind === LOGIN_ACTION_KIND && loginKindIsTaken;
              return (
                <MenuItem key={kind} value={kind} disabled={kindIsATakenLogin}>
                  {kindIsATakenLogin
                    ? `${ACTION_KIND_LABELS[kind]} (this website already has one: "${websiteLoginAction.title}")`
                    : ACTION_KIND_LABELS[kind]}
                </MenuItem>
              );
            })}
          </TextField>
        )}
        {roleFieldsAreShown && kindTakesAType && (
          <TextField
            select
            label="Object type"
            value={objectTypeChoice}
            onChange={(event) => {
              setObjectTypeChoice(event.target.value);
            }}
            helperText="The kind of object it works on or creates, from the latest crawl"
            fullWidth
          >
            <MenuItem value={DETECT_CHOICE_VALUE}>{describeDetectedObjectTypeChoice(detectedRole)}</MenuItem>
            {objectRoleChoices.objectTypes.map((objectType) => (
              <MenuItem key={objectType.key} value={objectType.key}>
                {objectType.name}
              </MenuItem>
            ))}
            {objectTypeChoice !== DETECT_CHOICE_VALUE &&
              !objectRoleChoices.objectTypes.some((objectType) => objectType.key === objectTypeChoice) && (
                <MenuItem value={objectTypeChoice}>{objectTypeChoice} (no longer found by the latest crawl)</MenuItem>
              )}
          </TextField>
        )}
        {loginFieldsAreShown && actionIsALoginAction && (
          <>
            <Typography variant="body2" color="text.secondary">
              Logs in as whichever credential the action or crawl picks: it opens the login page,
              types that credential&apos;s username and password, and submits.
            </Typography>
            <TextField
              label="Login page URL"
              value={loginUrl}
              onChange={handleLoginUrlChange}
              required={websiteLoginUrl === null}
              placeholder={websiteLoginUrl ?? "https://example.com/login"}
              helperText={describeLoginPageHelp(websiteLoginUrl)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <Typography variant="subtitle1" component="h2">
              Login form selectors (optional)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The login finds the username field, password field, and submit button on its own. Fill
              these in only when it picks the wrong one: each is a CSS selector, such as #email or
              button.sign-in.
            </Typography>
            {LOGIN_SELECTOR_FIELDS.map(({ fieldName, label }) => (
              <TextField
                key={fieldName}
                label={label}
                value={loginSelectors[fieldName]}
                onChange={buildSelectorChangeHandler(fieldName)}
                fullWidth
              />
            ))}
          </>
        )}
        {loginFieldsAreShown && !actionIsALoginAction && (
          <TextField
            select
            label="Log in as"
            value={credentialIdToShow}
            onChange={handleCredentialChange}
            helperText={describeLogInAsHelp(
              loginChoices.credentials.length > 0,
              websiteLoginAction,
              credentialIdToShow !== LOGGED_OUT_CREDENTIAL_VALUE,
            )}
            // The logged-out option's value is "", which MUI renders as an
            // empty field unless told to display it.
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            fullWidth
          >
            <MenuItem value={LOGGED_OUT_CREDENTIAL_VALUE}>Logged out (no login)</MenuItem>
            {loginChoices.credentials.map((credentialOption) => (
              <MenuItem key={credentialOption.id} value={credentialOption.id}>
                {credentialOption.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {roleFieldsAreShown &&
          (detectedRole?.warnings ?? []).map((warning) => (
            <Alert key={warning} severity="warning">
              {warning}
            </Alert>
          ))}
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
          <Button onClick={onCancel}>{cancelLabel}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
