import { readFile } from "node:fs/promises";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ScriptGenerationError, createAnthropicClient } from "./anthropicClient.js";
import {
  SERVER_SIDE_FALLBACK_BETA,
  type EffortLevel,
  type ScriptModelOption,
} from "./scriptModelService.js";

/**
 * Upper bound on the reply, thinking included. 16000 keeps a non-streaming
 * request well inside the SDK's HTTP timeout; going higher needs streaming.
 */
const ACTION_SCRIPT_MAX_TOKENS = 16000;

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

/** The model and effort level the user picked for one conversion. */
export interface ScriptModelChoice {
  /** The model to ask, from the live catalog (see `scriptModelService`). */
  model: ScriptModelOption;
  /** One of the model's effort levels, or null when it has no effort setting ("Standard"). */
  effort: EffortLevel | null;
}

/** What one successful conversion produced. */
export interface ActionScriptConversion {
  /** One line summarizing what the script does. */
  summary: string;
  /** The assumptions Claude made where the action was ambiguous. */
  assumptions: string[];
  /** The complete `.mjs` source. */
  code: string;
  /** The model that actually answered (the fallback model when the chosen one declined). */
  modelId: string;
  /** The effort level sent, which a fallback inherits; null for "Standard". */
  effort: EffortLevel | null;
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
 * Asks Claude to convert one action into a Playwright `.mjs` script, following
 * the user's guidelines (`server/prompts/actionScriptGuidelines.md`) verbatim,
 * with the model and effort level the user picked.
 *
 * - The client is built per call, never at boot, so a missing key only
 *   affects this feature (see `createAnthropicClient`).
 * - The guidelines are the system prompt, marked for prompt caching: they are
 *   identical on every conversion, so repeat conversions on the same model
 *   within the cache lifetime read them from the cache instead of paying for
 *   them again. (Caches are per model.)
 * - Structured outputs make the reply a validated `{ summary, assumptions,
 *   script }` object.
 * - The request only carries what the chosen model supports: `fallbacks` when
 *   it has a fallback (the API then retries there, inside the same call, if a
 *   safety classifier declines), adaptive thinking when it takes it, and an
 *   effort level unless it has no effort setting.
 *
 * API and network errors (bad key, rate limit, outage) are not caught here;
 * they reject with the SDK's own error.
 * @param request - The website and action snapshots to convert
 * @param choice - The model and effort level to use
 * @returns The summary, assumptions, code, the model that wrote it, and the effort level sent
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured; `refused` when every model declined; `truncated` when the reply hit the token limit; `unparseable` when the reply did not match the schema or had an empty script
 */
export async function convertActionToScript(
  request: ActionScriptConversionRequest,
  choice: ScriptModelChoice,
): Promise<ActionScriptConversion> {
  const client = createAnthropicClient();
  const guidelines = await readFile(GUIDELINES_FILE_URL, "utf8");

  const { model, effort } = choice;
  const { fallbackModel } = model;
  const modelHasAFallback = fallbackModel !== null;
  const fallbackSettings = modelHasAFallback
    ? { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: [{ model: fallbackModel.id }] }
    : {};
  const thinkingSettings = model.supportsAdaptiveThinking
    ? { thinking: { type: "adaptive" as const } }
    : {};
  const modelHasNoEffortSetting = effort === null;
  const effortSettings = modelHasNoEffortSetting ? {} : { effort };

  const response = await client.beta.messages.parse({
    model: model.id,
    max_tokens: ACTION_SCRIPT_MAX_TOKENS,
    ...fallbackSettings,
    ...thinkingSettings,
    system: [{ type: "text", text: guidelines, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildConversionRequestMessage(request) }],
    output_config: {
      ...effortSettings,
      format: betaZodOutputFormat(ActionScriptConversionSchema),
    },
  });

  console.log(
    `[scripts] asked ${model.id} at ${effort ?? "standard"} effort; ` +
      `${response.model} answered: ${response.usage.input_tokens} input tokens, ` +
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
    effort,
  };
}
