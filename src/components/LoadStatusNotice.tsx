import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";

/** Props for `LoadStatusNotice`. */
export interface LoadStatusNoticeProps {
  /** True while the request is in flight. */
  isLoading: boolean;
  /** The failure reason, or null when the request has not failed. */
  errorMessage: string | null;
  /** Accessible name for the spinner, e.g. "Loading websites". */
  loadingLabel: string;
}

/**
 * Shows a spinner while a GET request is loading and an error alert when it
 * failed, and nothing once it has loaded - the page renders the data itself.
 * @param props - The request state and the spinner's accessible name
 * @returns The spinner, the error alert, or null
 */
export default function LoadStatusNotice(props: LoadStatusNoticeProps): ReactElement | null {
  const { isLoading, errorMessage, loadingLabel } = props;

  if (isLoading) {
    return <CircularProgress size={24} aria-label={loadingLabel} />;
  }
  const requestFailed = errorMessage !== null;
  if (requestFailed) {
    return <Alert severity="error">{errorMessage}</Alert>;
  }
  return null;
}
