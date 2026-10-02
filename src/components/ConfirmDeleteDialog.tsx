import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

/** Props for `ConfirmDeleteDialog`. */
export interface ConfirmDeleteDialogProps {
  /** Whether the dialog is showing. */
  isOpen: boolean;
  /** The dialog heading, e.g. "Delete website?". */
  title: string;
  /** What will be deleted, in plain words. */
  message: string;
  /** True while the delete request is in flight; disables both buttons. */
  isDeleting: boolean;
  /** Why the last delete attempt failed, or null. */
  errorMessage: string | null;
  /** Called when the user backs out (Cancel, Escape, or clicking outside). */
  onCancel: () => void;
  /** Called when the user confirms the delete. */
  onConfirm: () => void;
}

/**
 * Asks the user to confirm a delete before it happens, and shows the server's
 * reason if the delete fails.
 * @param props - What to say, the request state, and the two callbacks
 * @returns The confirmation dialog
 */
export default function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps): ReactElement {
  const { isOpen, title, message, isDeleting, errorMessage, onCancel, onConfirm } = props;
  const deleteFailed = errorMessage !== null;

  return (
    <Dialog open={isOpen} onClose={onCancel} aria-labelledby="confirm-delete-title">
      <DialogTitle id="confirm-delete-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
        {deleteFailed && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isDeleting}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={isDeleting} color="error" variant="contained">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
