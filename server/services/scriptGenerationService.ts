import { readFile } from "node:fs/promises";
import { Anthropic } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/** The model that converts actions into scripts (the user's choice). */
export const ACTION_SCRIPT_MODEL_ID = "claude-opus-5-5";

/**
 * The model the API retries on, inside the same call, when a safety
 * classifier declines the request on `ACTION_SCRIPT_MODEL_ID` (the user chose
 * a named fallback). The saved script records whichever model answered.
 */
export const ACTION_SCRIPT_FALLBACK_MODEL_ID = "claude-opus-4-8";

/**
 * Upper bound on the reply, thinking included. 16000 keeps a non-streaming
 * request well inside the SDK's HTTP timeout; going higher needs streaming.
 */
const ACTION_SCRIPT_MAX_TOKENS = 16000;

/** Beta flag for the array form of `fallbacks` (a named fallback model). */
const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-06-01";

/**
 * The user's script-writing guidelines, used VERBATIM as the system prompt.
 * Resolved relative to this file so it works from any working directory.
 */
const GUIDELINES_FILE_URL = new URL("../prompts/actionScriptGuidelines.md", import.meta.url);

/**
 * The JSON shape Claude must answer with: the guidelines' three-part Output
 * Format, one field per part. Enforced by structured outputs, so the reply is
 * parsed and validated by the SDK instead of scraped out of Markdown.
 */
export const ActionScriptConversionSchema = z.object({
  summary: z.string().describe("Part 1 of the Output Format: one line summarizing what the script does"),
  assumptions: z
    .array(z.string())
    .describe("Part 2 of the Output Format: one entry per assumption; empty when there are none"),
  script: z
    .string()
    .describe("Part 3 of the Output Format: the complete contents of the .mjs file, with no Markdown code fences"),
});

/** What gets sent to Claude for one conversion - all snapshots of the current rows. */
export interface ActionScriptConversionRequest {
  /** The website's display name. */
  websiteName: string;
  /** The website's URL; the script's START_URL must be exactly this. */
  startUrl: string;
  /** The action's title. */
  actionTitle: string;
  /** The action's description: the steps to turn into a script. */
  actionDescription: string;
}

/** What one successful conversion produced. */
export interface ActionScriptConversion {
  /** One line summarizing what the script does. */
  summary: string;
  /** The assumptions Claude made where the action was ambiguous. */
  assumptions: string[];
  /** The complete `.mjs` source. */
  code: string;
  /** The model that actually answered (the fallback model when the first one declined). */
  modelId: string;
}

/** Why a conversion produced no usable script, as opposed to an API or network error. */
export type ScriptGenerationFailureReason = "missingApiKey" | "refused" | "truncated" | "unparseable";

/**
 * A conversion that cannot produce a script for a known reason. The
 * controller maps `reason` to a status: `missingApiKey` is a server
 * configuration problem (503); the rest mean Claude's reply was unusable (502).
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
 * Builds the user message for one conversion: the website and action to
 * convert, plus the two things the guidelines cannot know - that nobody can
 * answer questions in this one-shot flow, and how the Output Format maps onto
 * the JSON fields.
 *
 * Everything that varies per request lives here, AFTER the cached system
 * prompt, so the cached prefix is identical on every conversion.
 * @param request - The website and action snapshots
 * @returns The message text
 */
function buildConversionRequestMessage(request: ActionScriptConversionRequest): string {
  return [
    "Convert this action into a Playwright script.",
    "",
    `Website name: ${request.websiteName}`,
    `START_URL: set the START_URL constant to exactly '${request.startUrl}'`,
    "",
    `Action title: ${request.actionTitle}`,
    "Action description (the use case to perform):",
    request.actionDescription,
    "",
    "This is a one-shot conversion: you cannot ask questions and nobody will answer them.",
    "Wherever the guidelines say to ask, make the most reasonable assumption instead, record it",
    "in `assumptions`, and write the script. For steps only a human can do (CAPTCHAs, two-factor",
    "codes, credentials or other values the action does not give), insert `await page.pause();`",
    "with a comment, as the guidelines describe.",
    "",
    "Return the three parts of the Output Format as the JSON fields:",
    "- `summary`: part 1, the one line summarizing what the script does",
    "- `assumptions`: part 2, one entry per assumption (an empty list when there are none)",
    "- `script`: part 3, the complete contents of the .mjs file exactly as it should be saved:",
    "  raw JavaScript, with no Markdown code fences around it",
  ].join("\n");
}

/**
 * Reads the Anthropic API key from the environment.
 * @returns The trimmed key
 * @throws {ScriptGenerationError} `missingApiKey` when `ANTHROPIC_API_KEY` is unset or blank
 */
function readAnthropicApiKey(): string {
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
 * Asks Claude to convert one action into a Playwright `.mjs` script, following
 * the user's guidelines (`server/prompts/actionScriptGuidelines.md`) verbatim.
 *
 * - The client is built per call, never at boot, so a missing key only
 *   affects this feature. The key is passed explicitly, so the SDK never falls
 *   back to some other credential on this machine.
 * - The guidelines are the system prompt, marked for prompt caching: they are
 *   identical on every conversion, so repeat conversions within the cache
 *   lifetime read them from the cache instead of paying for them again.
 * - Structured outputs make the reply a validated `{ summary, assumptions,
 *   script }` object.
 * - If a safety classifier declines on the main model, the API retries on
 *   `ACTION_SCRIPT_FALLBACK_MODEL_ID` within the same call.
 *
 * API and network errors (bad key, rate limit, outage) are not caught here;
 * they reject with the SDK's own error.
 * @param request - The website and action snapshots to convert
 * @returns The summary, assumptions, code, and the model that wrote it
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured; `refused` when every model declined; `truncated` when the reply hit the token limit; `unparseable` when the reply did not match the schema or had an empty script
 */
export async function convertActionToScript(
  request: ActionScriptConversionRequest,
): Promise<ActionScriptConversion> {
  const apiKey = readAnthropicApiKey();
  const guidelines = await readFile(GUIDELINES_FILE_URL, "utf8");
  const client = new Anthropic({ apiKey });

  const response = await client.beta.messages.parse({
    model: ACTION_SCRIPT_MODEL_ID,
    max_tokens: ACTION_SCRIPT_MAX_TOKENS,
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: [{ model: ACTION_SCRIPT_FALLBACK_MODEL_ID }],
    system: [{ type: "text", text: guidelines, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildConversionRequestMessage(request) }],
    output_config: {
      effort: "high",
      format: betaZodOutputFormat(ActionScriptConversionSchema),
    },
  });

  console.log(
    `[scripts] ${response.model} answered: ${response.usage.input_tokens} input tokens, ` +
      `${response.usage.cache_read_input_tokens ?? 0} read from cache, ` +
      `${response.usage.cache_creation_input_tokens ?? 0} written to cache, ` +
      `${response.usage.output_tokens} output tokens`,
  );

  // A refusal on the final response means the whole chain - the main model
  // and the fallback - declined.
  const everyModelDeclined = response.stop_reason === "refusal";
  if (everyModelDeclined) {
    const refusalCategory = response.stop_details?.category ?? "no category given";
    throw new ScriptGenerationError(
      "refused",
      `Claude declined to convert this action (${refusalCategory})`,
    );
  }

  const replyHitTheTokenLimit = response.stop_reason === "max_tokens";
  if (replyHitTheTokenLimit) {
    throw new ScriptGenerationError(
      "truncated",
      `Claude's reply was cut off at ${ACTION_SCRIPT_MAX_TOKENS} tokens before the script was finished`,
    );
  }

  const conversion = response.parsed_output;
  const replyDidNotMatchTheSchema = conversion === null;
  if (replyDidNotMatchTheSchema) {
    throw new ScriptGenerationError(
      "unparseable",
      "Claude's reply did not contain a summary, assumptions, and script",
    );
  }

  const scriptIsEmpty = conversion.script.trim() === "";
  if (scriptIsEmpty) {
    throw new ScriptGenerationError("unparseable", "Claude's reply contained an empty script");
  }

  return {
    summary: conversion.summary,
    assumptions: conversion.assumptions,
    code: conversion.script,
    modelId: response.model,
  };
}
