/**
 * Reads the HTTP status `res.sendFile` attached to its error. Express's `send`
 * stamps `.status` on the errors it reports: 404 for a missing file, 403 for
 * a path that tries to climb out of `root`. Read structurally, since the
 * callback only promises a plain `Error`.
 *
 * Shared by every controller that serves files from disk (screenshots and
 * script-run failure screenshots).
 * @param sendError - The error `res.sendFile` passed to its callback
 * @returns The attached status, or null when there is none
 */
export function readSendErrorStatus(sendError: Error): number | null {
  const attachedStatus: unknown = "status" in sendError ? sendError.status : undefined;
  const attachedStatusIsANumber = typeof attachedStatus === "number";
  return attachedStatusIsANumber ? attachedStatus : null;
}
