import { type ReactElement, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";

/** The longest name a web object may be given; mirrors `MAX_WEB_OBJECT_NAME_LENGTH` on the server. */
export const MAX_WEB_OBJECT_NAME_LENGTH = 100;

/** The web object a rename dialog is open for. */
export interface WebObjectToRename {
  /** The name it shows now. */
  currentName: string;
  /** What detection named it - what "Use detected name" goes back to. */
  detectedName: string;
}

/** Props for `RenameWebObjectDialog`. */
export interface RenameWebObjectDialogProps {
  /** The object being renamed, or null when the dialog is closed. */
  webObject: WebObjectToRename | null;
  /** True while the rename request is in flight; disables the buttons. */
  isSaving: boolean;
  /** Why the last rename failed, or null. */
  errorMessage: string | null;
  /** Called with the new name (trimmed), or null to go back to the detected name. */
  onSave: (name: string | null) => void;
  /** Called when the user backs out (Cancel, Escape, or clicking outside). */
  onCancel: () => void;
}

/** Props for `RenameWebObjectForm`. */
interface RenameWebObjectFormProps extends Omit<RenameWebObjectDialogProps, "webObject"> {
  /** The object being renamed. */
  webObject: WebObjectToRename;
}

/**
 * The dialog's body: the name field, starting at the current name, and the
 * three buttons. Remounted for each object (see `RenameWebObjectDialog`), so
 * the field always starts from that object's name.
 * @param props - The object, the request state, and the two callbacks
 * @returns The title, field, and buttons
 */
function RenameWebObjectForm(props: RenameWebObjectFormProps): ReactElement {
  const { webObject, isSaving, errorMessage, onSave, onCancel } = props;
  const [nameText, setNameText] = useState(webObject.currentName);
  const [saveWasAttempted, setSaveWasAttempted] = useState(false);
  const trimmedName = nameText.trim();
  const nameIsBlank = trimmedName === "";
  // An error left over from an earlier opening of the dialog is not shown.
  const renameFailed = saveWasAttempted && errorMessage !== null;

  /**
   * Sends a name, remembering that this opening of the dialog tried to save.
   * @param name - The name to save, or null for the detected name
   */
  const save = (name: string | null): void => {
    setSaveWasAttempted(true);
    onSave(name);
  };

  return (
    <>
      <DialogTitle id="rename-web-object-title">Rename “{webObject.currentName}”</DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          value={nameText}
          onChange={(event) => {
            setNameText(event.target.value);
          }}
          autoFocus
          fullWidth
          margin="dense"
          slotProps={{ htmlInput: { maxLength: MAX_WEB_OBJECT_NAME_LENGTH } }}
          helperText={`Detected as “${webObject.detectedName}”. The name lasts until the next crawl.`}
        />
        {renameFailed && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            save(null);
          }}
          disabled={isSaving}
          sx={{ mr: "auto" }}
        >
          Use detected name
        </Button>
        <Button onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            save(nameIsBlank ? null : trimmedName);
          }}
          disabled={isSaving}
          variant="contained"
        >
          Save
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Renames a web object: a name field starting at its current name, with the
 * detected name and "The name lasts until the next crawl" under it (the
 * website's next crawl replaces its objects, renames included). Save sends
 * the trimmed name - a blank one goes back to the detected name, as "Use
 * detected name" does. A failed save keeps the dialog open with the server's
 * reason.
 * @param props - The object (null when closed), the request state, and the two callbacks
 * @returns The rename dialog
 */
export default function RenameWebObjectDialog(props: RenameWebObjectDialogProps): ReactElement {
  const { webObject, onCancel } = props;
  const dialogIsOpen = webObject !== null;

  return (
    <Dialog open={dialogIsOpen} onClose={onCancel} aria-labelledby="rename-web-object-title" fullWidth maxWidth="xs">
      {webObject !== null && (
        <RenameWebObjectForm key={`${webObject.currentName}|${webObject.detectedName}`} {...props} webObject={webObject} />
      )}
    </Dialog>
  );
}
