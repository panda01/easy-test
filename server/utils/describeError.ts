/**
 * Turns anything a `catch` block received into a human-readable message for
 * a `{ error }` JSON response or a log line.
 *
 * A rejection is not guaranteed to be an `Error` - a library can throw a
 * string, an object, or `undefined` - so the non-Error case is stringified
 * instead of assumed away. Every route `catch` goes through this one helper.
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
