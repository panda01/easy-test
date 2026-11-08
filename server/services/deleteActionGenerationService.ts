import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ScriptGenerationError, createAnthropicClient } from "./anthropicClient.js";
import { chooseDefaultScriptModel, findScriptModel, listScriptModels } from "./scriptModelService.js";
import { STRUCTURED_OUTPUTS_BETA, toStructuredOutputSchema } from "../utils/structuredOutputSchema.js";

/**
 * The delete-action guidelines, used VERBATIM as the system prompt. Resolved
 * relative to this file so it works from any working directory.
 */
const GUIDELINES_FILE_URL = new URL("../prompts/deleteActionGuidelines.md", import.meta.url);

/** Upper bound on the reply: a title and a short description need far less. */
const DELETE_ACTION_MAX_TOKENS = 1500;

/** The JSON shape Claude must answer with: the guidelines' Output Format. */
export const DeleteActionProposalSchema = z.strictObject({
  title: z.string().describe("The delete action's title"),
  description: z.string().describe("The delete action's description, in plain language"),
});

/** The JSON schema sent as `output_config.format`, built once from `DeleteActionProposalSchema`. */
const PROPOSAL_OUTPUT_SCHEMA = toStructuredOutputSchema(z.toJSONSchema(DeleteActionProposalSchema)) as Record<
  string,
  unknown
>;

/** What gets sent to Claude to propose one Delete action. */
export interface DeleteActionProposalRequest {
  /** The website's display name. */
  websiteName: string;
  /** The Create action's title. */
  createTitle: string;
  /** The Create action's description. */
  createDescription: string;
  /** The kind of object the Create action makes, or null when unknown. */
  objectTypeName: string | null;
  /** The credential the browser is logged in as (only its NAME), or null for logged out. */
  credentialName: string | null;
}

/** The Delete action Claude proposed. */
export interface DeleteActionProposal {
  /** The proposed title. */
  title: string;
  /** The proposed description. */
  description: string;
  /** The model that answered. */
  modelId: string;
}

/**
 * Builds the user message for one proposal: the website, the login, the
 * Create action and its object type, each value quoted as JSON so a title or
 * description cannot break out of its line.
 * @param request - The proposal inputs
 * @returns The message text
 */
export function buildDeleteActionRequestMessage(request: DeleteActionProposalRequest): string {
  const loginLine =
    request.credentialName === null
      ? "The browser is logged out."
      : `The browser is logged in as the credential named ${JSON.stringify(request.credentialName)}.`;
  const objectTypeLine =
    request.objectTypeName === null
      ? "The kind of object it makes is not known; read it from the title and description."
      : `It makes an object of the kind ${JSON.stringify(request.objectTypeName)}.`;
  return [
    "Write the delete action that cleans up after this create action.",
    "",
    `Website: ${JSON.stringify(request.websiteName)}`,
    loginLine,
    "",
    `Create action title: ${JSON.stringify(request.createTitle)}`,
    `Create action description: ${JSON.stringify(request.createDescription)}`,
    objectTypeLine,
    "",
    "Answer with the JSON object described in the Output Format: `title` and `description`.",
  ].join("\n");
}

/**
 * Turns Claude's reply text into a checked proposal: JSON first, then the
 * schema, then non-blank title and description.
 * @param replyText - The text of Claude's reply
 * @returns The title and description, trimmed
 * @throws {ScriptGenerationError} `unparseable` when the text is not JSON, does not match the schema, or a field is blank
 */
function readProposalReply(replyText: string): z.infer<typeof DeleteActionProposalSchema> {
  let replyJson: unknown;
  try {
    replyJson = JSON.parse(replyText);
  } catch {
    throw new ScriptGenerationError("unparseable", "Claude's reply was not JSON");
  }
  const parsed = DeleteActionProposalSchema.safeParse(replyJson);
  if (!parsed.success) {
    throw new ScriptGenerationError("unparseable", "Claude's reply did not have a title and a description");
  }
  const title = parsed.data.title.trim();
  const description = parsed.data.description.trim();
  const aFieldIsBlank = title === "" || description === "";
  if (aFieldIsBlank) {
    throw new ScriptGenerationError("unparseable", "Claude's reply left the title or the description blank");
  }
  return { title, description };
}

/**
 * Asks Claude to propose the Delete action that cleans up after a Create
 * action: the inverse of the user's request, with the same names and values,
 * confirming the deletion when the site asks (see
 * `server/prompts/deleteActionGuidelines.md`, sent verbatim as a cached
 * system prompt). It uses the catalog's default model (the one the Convert
 * picker starts on) with no effort setting, since the answer is two short
 * fields. Nothing is saved here; the user reviews the proposal first.
 *
 * API and network errors (bad key, rate limit, outage) are not caught here;
 * they reject with the SDK's own error.
 * @param request - The website, login, and Create action to invert
 * @returns The proposed title and description, and the model that answered
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured; `unsupportedModel` when the catalog lists no usable model; `refused` when Claude declined; `truncated` when the reply hit the token limit; `unparseable` when the reply was not a title and description
 */
export async function proposeDeleteAction(request: DeleteActionProposalRequest): Promise<DeleteActionProposal> {
  const client = createAnthropicClient();
  const guidelines = await readFile(GUIDELINES_FILE_URL, "utf8");
  const defaultChoice = chooseDefaultScriptModel(await listScriptModels());
  const model = defaultChoice === null ? null : await findScriptModel(defaultChoice.modelId);
  if (model === null) {
    throw new ScriptGenerationError("unsupportedModel", "No model is available to write the delete action");
  }

  const response = await client.beta.messages.create({
    model: model.id,
    max_tokens: DELETE_ACTION_MAX_TOKENS,
    betas: [STRUCTURED_OUTPUTS_BETA],
    system: [{ type: "text", text: guidelines, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildDeleteActionRequestMessage(request) }],
    output_config: { format: { type: "json_schema", schema: PROPOSAL_OUTPUT_SCHEMA } },
  });
  console.log(
    `[delete-action] asked ${model.id} to invert "${request.createTitle}"; ${response.model} answered: ` +
      `${String(response.usage.input_tokens)} input tokens, ` +
      `${String(response.usage.cache_read_input_tokens ?? 0)} read from cache, ` +
      `${String(response.usage.cache_creation_input_tokens ?? 0)} written to cache, ` +
      `${String(response.usage.output_tokens)} output tokens`,
  );

  const claudeDeclined = response.stop_reason === "refusal";
  if (claudeDeclined) {
    const refusalCategory = response.stop_details?.category ?? "no category given";
    throw new ScriptGenerationError("refused", `Claude declined to write the delete action (${refusalCategory})`);
  }
  const replyHitTheTokenLimit = response.stop_reason === "max_tokens";
  if (replyHitTheTokenLimit) {
    throw new ScriptGenerationError(
      "truncated",
      `Claude's reply was cut off at ${String(DELETE_ACTION_MAX_TOKENS)} tokens before the delete action was finished`,
    );
  }
  const replyText = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const proposal = readProposalReply(replyText);
  return { ...proposal, modelId: response.model };
}
