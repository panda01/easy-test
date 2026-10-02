/**
 * Turns anything a `catch` block received into a human-readable message.
 *
 * A rejection is not guaranteed to be an `Error` (fetch can reject with a
 * string in some environments, and tests do exactly that), so the non-Error
 * case is stringified instead of assumed away.
 * @param error - The value a `catch` block received
 * @returns The Error's message, or the stringified value for anything else
 */
export function describeError(error: unknown): string {
  const errorIsAnErrorInstance = error instanceof Error;
  if (errorIsAnErrorInstance) {
    return error.message;
  }
  return String(error);
}

/**
 * Reads the human-readable reason out of a failed (non-2xx) API response.
 *
 * Every route in this project answers failures with `{ error: string }`, so
 * that text is preferred - it is what tells the user "Website not found"
 * rather than "404". Anything else (an HTML error page from the proxy, an
 * empty body) falls back to the bare status code.
 * @param response - A fetch response whose `ok` is false
 * @returns The server's `error` text, or "Server responded with <status>"
 */
export async function readResponseErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Server responded with ${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
    return fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}
