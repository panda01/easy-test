import { type ChangeEvent, type ReactElement, type SubmitEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { AddIcon } from "./icons";
import { type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";
import {
  ACTION_KIND_HELP,
  ACTION_KIND_LABELS,
  DETECT_CHOICE_VALUE,
  describeDetectedDeletesChoice,
  describeDetectedKindChoice,
  describeDetectedObjectTypeChoice,
} from "../utils/actionObjectRole";
import { type ActionKindRecord, type ActionObjectRoleRecord } from "../utils/actionParameters";

/** The "Log in as" choice for running logged out (no credential). */
export const LOGGED_OUT_CREDENTIAL_VALUE = "";

/** One credential the "Log in as" select offers. */
export interface CredentialOption {
  /** The credential's cuid. */
  id: string;
  /** The credential's label. */
  name: string;
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

/** The "Deletes the object" select's values. */
const DELETES_CHOICE_VALUES = { yes: "yes", no: "no" } as const;

/**
 * Reads the kind select's value back.
 * @param choiceValue - The select's value
 * @returns The kind, or null for "Detect"
 */
function readKindChoice(choiceValue: string): ActionKindRecord | null {
  const kinds: ActionKindRecord[] = ["parameters", "object", "create"];
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
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
  /**
   * The website's credentials, to show the "Log in as" select (actions
   * only); undefined hides it and leaves `credentialId` out of the values.
   */
  credentialOptions?: CredentialOption[];
  /**
   * The object role choices (actions only): shows the Kind, Object type,
   * and Deletes the object selects; undefined hides them and leaves the
   * role fields out of the values.
   */
  objectRoleChoices?: ObjectRoleChoices;
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
 * Given `objectRoleChoices` (actions), it also shows what the action does
 * with an object - each select starting on "Detect", which names what the
 * detection picks and how sure it is:
 * - Kind: Parameters, Object (acts on an existing object, always required),
 *   or Create (makes one, recorded on each run);
 * - Object type (for Object and Create): one of the website's web objects;
 * - Deletes the object (for Object): Yes or No.
 * Their warnings (a tie, no type found, an unsure type) show under them. The
 * name parameter is kept as it was (it is picked in the Parameters section).
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
    objectRoleChoices,
  } = props;
  const [kindChoice, setKindChoice] = useState<string>(initialValues.userActionKind ?? DETECT_CHOICE_VALUE);
  const [objectTypeChoice, setObjectTypeChoice] = useState<string>(
    initialValues.userObjectTypeKey ?? DETECT_CHOICE_VALUE,
  );
  const [deletesChoice, setDeletesChoice] = useState<string>(
    initialValues.userDeletesObject === null || initialValues.userDeletesObject === undefined
      ? DETECT_CHOICE_VALUE
      : initialValues.userDeletesObject
        ? DELETES_CHOICE_VALUES.yes
        : DELETES_CHOICE_VALUES.no,
  );
  const roleFieldsAreShown = objectRoleChoices !== undefined;
  const detectedRole = objectRoleChoices?.detectedRole ?? null;
  const effectiveKind = readKindChoice(kindChoice) ?? detectedRole?.detectedKind.kind ?? null;
  // Before anything is detected (a new action on "Detect"), both may apply.
  const kindTakesAType = effectiveKind !== "parameters";
  const kindActsOnAnObject = effectiveKind === "object" || effectiveKind === null;
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
    const roleValues = roleFieldsAreShown
      ? {
          userActionKind: readKindChoice(kindChoice),
          userObjectTypeKey: objectTypeChoice === DETECT_CHOICE_VALUE ? null : objectTypeChoice,
          userNameParameterKey: initialValues.userNameParameterKey ?? null,
          userDeletesObject: deletesChoice === DETECT_CHOICE_VALUE ? null : deletesChoice === DELETES_CHOICE_VALUES.yes,
        }
      : {};
    onSubmit({ title, description, credentialId: actionRunsLoggedOut ? null : credentialIdToShow, ...roleValues });
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
            {(Object.keys(ACTION_KIND_LABELS) as ActionKindRecord[]).map((kind) => (
              <MenuItem key={kind} value={kind}>
                {ACTION_KIND_LABELS[kind]}
              </MenuItem>
            ))}
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
        {roleFieldsAreShown && kindTakesAType && kindActsOnAnObject && (
          <TextField
            select
            label="Deletes the object"
            value={deletesChoice}
            onChange={(event) => {
              setDeletesChoice(event.target.value);
            }}
            helperText="A passed run marks the created object it ran on as deleted"
            fullWidth
          >
            <MenuItem value={DETECT_CHOICE_VALUE}>{describeDetectedDeletesChoice(detectedRole)}</MenuItem>
            <MenuItem value={DELETES_CHOICE_VALUES.yes}>Yes</MenuItem>
            <MenuItem value={DELETES_CHOICE_VALUES.no}>No</MenuItem>
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
          <Button onClick={onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
