import { Anthropic } from "@anthropic-ai/sdk";

/** Why an action-script request produced no usable result, as opposed to an API or network error. */
export type ScriptGenerationFailureReason =
  | "missingApiKey"
  | "refused"
  | "truncated"
  | "unparseable"
  | "unsupportedModel";

/**
 * A known failure of the script features that talk to Claude (listing the
 * models, converting an action). The controllers map `reason` to a status:
 * `missingApiKey` is a server configuration problem (503), `unsupportedModel`
 * is a bad request (400), and the rest mean Claude's reply was unusable (502).
 */
export class ScriptGenerationError extends Error {
  /** Which known failure this is. */
  readonly reason: ScriptGenerationFailureReason;

  /**
   * @param reason - Which known failure this is
   * @param message - A human-readable explanation, shown to the user
   */
  constructor(reason: ScriptGenerationFailureReason, message: string) {
    super(message);
    this.name = "ScriptGenerationError";
    this.reason = reason;
  }
}

/**
 * Reads the Anthropic API key from the environment.
 * @returns The trimmed key
 * @throws {ScriptGenerationError} `missingApiKey` when `ANTHROPIC_API_KEY` is unset or blank
 */
export function readAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const apiKeyIsMissing = apiKey === undefined || apiKey === "";
  if (apiKeyIsMissing) {
    throw new ScriptGenerationError(
      "missingApiKey",
      "ANTHROPIC_API_KEY is not set in .env.local, so actions cannot be converted to scripts",
    );
  }
  return apiKey;
}

/**
 * Builds an Anthropic client for one request. Built per call, never at boot,
 * so a missing key only affects the script features. The key is passed
 * explicitly, so the SDK never falls back to some other credential on this
 * machine.
 * @returns A client authenticated with `ANTHROPIC_API_KEY`
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = readAnthropicApiKey();
  return new Anthropic({ apiKey });
}
