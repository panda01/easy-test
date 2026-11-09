import type { Response } from "express";
import { describeError } from "./describeError.js";
import { readSendErrorStatus } from "./readSendErrorStatus.js";

/**
 * Sends a stored image file - one whose path the database names RELATIVE to
 * a configured directory - and answers every way the send can end.
 *
 * The file is sent with `root` set to that directory, so the stored name is
 * resolved inside it and a name that tries to climb out with `..` is refused
 * rather than served (express's `send` reports that as a 403, answered here
 * as a 500, like any other unreadable file).
 *
 * The callback owns every send outcome: it runs after the async route
 * handler has returned, so the route's own try/catch never sees send errors.
 * @param res - The route's response
 * @param relativeFileName - The file's stored path, relative to `rootDirectory`
 * @param rootDirectory - Absolute path of the directory the file lives in
 * @param fileNotFoundMessage - The `{ error }` to answer with when the file is gone from disk
 */
export function sendStoredImageFile(
  res: Response,
  relativeFileName: string,
  rootDirectory: string,
  fileNotFoundMessage: string,
): void {
  /**
   * Answers the request when the file could not be sent.
   * @param sendError - Undefined when the file was sent; otherwise why it could not be
   */
  const handleFileSent = (sendError?: Error): void => {
    const fileWasSent = sendError === undefined;
    if (fileWasSent) return;
    // The client went away mid-stream: the headers are already out, and
    // writing a JSON error now would throw ERR_HTTP_HEADERS_SENT.
    const responseAlreadyStarted = res.headersSent;
    if (responseAlreadyStarted) return;
    const fileIsMissing = readSendErrorStatus(sendError) === 404;
    if (fileIsMissing) {
      res.status(404).json({ error: fileNotFoundMessage });
      return;
    }
    res.status(500).json({ error: describeError(sendError) });
  };

  res.sendFile(relativeFileName, { root: rootDirectory }, handleFileSent);
}
