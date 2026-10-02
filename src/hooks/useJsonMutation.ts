import { useCallback, useState } from "react";
import { describeError, readResponseErrorMessage } from "../utils/describeError";

/** The HTTP methods a mutation can use. Reads go through `useJsonResource`. */
export type MutationMethod = "POST" | "PUT" | "DELETE";

/** What one mutation request produced. */
export interface MutationResult {
  /** True for any 2xx response. */
  succeeded: boolean;
  /** The parsed response body; null for a 204 No Content and for failures. */
  data: unknown;
}

/** The function `useJsonMutation` hands back for sending one request. */
export type SendJsonRequest = (
  method: MutationMethod,
  url: string,
  body?: unknown,
) => Promise<MutationResult>;

/**
 * Sends create / replace / delete requests and tracks their progress, so a
 * form or a delete dialog can disable its button while a request is in flight
 * and show the server's reason when one fails.
 *
 * Plain `fetch` against a relative url, like every API call in this app.
 * `errorMessage` is cleared at the start of each request and set to the
 * server's `{ error }` text (or a network error) when it fails.
 * @returns `sendJsonRequest` plus the `isSubmitting` and `errorMessage` state it drives
 */
export function useJsonMutation(): {
  sendJsonRequest: SendJsonRequest;
  isSubmitting: boolean;
  errorMessage: string | null;
} {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendJsonRequest = useCallback<SendJsonRequest>(async (method, url, body) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const requestHasBody = body !== undefined;
    const requestInit: RequestInit = requestHasBody
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { method };

    try {
      const response = await fetch(url, requestInit);
      const responseIsOk = response.ok;
      if (!responseIsOk) {
        setErrorMessage(await readResponseErrorMessage(response));
        return { succeeded: false, data: null };
      }

      const responseHasNoContent = response.status === 204;
      const data: unknown = responseHasNoContent ? null : await response.json();
      return { succeeded: true, data };
    } catch (err: unknown) {
      setErrorMessage(describeError(err));
      return { succeeded: false, data: null };
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { sendJsonRequest, isSubmitting, errorMessage };
}
