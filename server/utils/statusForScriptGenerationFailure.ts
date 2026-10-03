/**
 * The status each known script-feature failure answers with (see
 * `ScriptGenerationError` in `../services/anthropicClient.ts`). A missing API
 * key is a server configuration problem (503 Service Unavailable), an unknown
 * model or effort level is a bad request (400), and the rest mean Claude
 * answered but its reply was unusable (502 Bad Gateway).
 */
const STATUS_BY_SCRIPT_GENERATION_FAILURE: Readonly<Record<string, number>> = {
  missingApiKey: 503,
  unsupportedModel: 400,
  refused: 502,
  truncated: 502,
  unparseable: 502,
};

/**
 * Picks the HTTP status for a failed request to one of the script features
 * that talk to Claude. Known failures are `ScriptGenerationError`s,
 * recognized structurally (by `name` and `reason`) the same way dbService
 * recognizes Prisma errors, so tests can throw plain errors carrying those
 * fields - and so this stays a pure helper with no service import.
 * @param error - Whatever the request rejected with
 * @returns The status for a known failure, or 500 for anything else (an Anthropic API error included)
 */
export function statusForScriptGenerationFailure(error: unknown): number {
  const errorIsAnObject = typeof error === "object" && error !== null;
  if (!errorIsAnObject) {
    return 500;
  }
  const errorIsAScriptGenerationError =
    "name" in error && error.name === "ScriptGenerationError";
  const reason: unknown = "reason" in error ? error.reason : undefined;
  const reasonIsKnown = typeof reason === "string" && reason in STATUS_BY_SCRIPT_GENERATION_FAILURE;
  if (errorIsAScriptGenerationError && reasonIsKnown) {
    return STATUS_BY_SCRIPT_GENERATION_FAILURE[reason];
  }
  return 500;
}
