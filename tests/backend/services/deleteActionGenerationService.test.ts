import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * No test here calls the Anthropic API. The SDK's `Anthropic` class is
 * replaced by a fake whose `beta.messages.create` is a spy, like the plan
 * generation spec does, and the model catalog is replaced so no network is
 * touched for the model list either.
 */
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
const mockScriptModelService = vi.hoisted(() => ({
  listScriptModels: vi.fn(),
  findScriptModel: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class MockAnthropic {
    beta = { messages: { create: mockCreate } };
  },
}));
vi.mock("../../../server/services/scriptModelService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/services/scriptModelService.js")>()),
  ...mockScriptModelService,
}));

import type { Anthropic } from "@anthropic-ai/sdk";
import {
  buildDeleteActionRequestMessage,
  proposeDeleteAction,
  type DeleteActionProposalRequest,
} from "../../../server/services/deleteActionGenerationService.js";

const GUIDELINES_TEXT = readFileSync(
  path.join(process.cwd(), "server", "prompts", "deleteActionGuidelines.md"),
  "utf8",
);

const opusModel = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: true,
  fallbackModel: null,
};

const request: DeleteActionProposalRequest = {
  websiteName: "Forge Gym",
  createTitle: "Create a new member",
  createDescription: 'Open Members, click Add member, fill in "Jamie Rivera", save',
  objectTypeName: "Member",
  credentialName: "Admin",
};

/**
 * Builds the API's reply with the given text content (and stop reason).
 * @param text - The reply text
 * @param stopReason - The stop reason
 * @returns A minimal message response
 */
function buildResponse(text: string, stopReason = "end_turn"): Partial<Anthropic.Beta.BetaMessage> {
  return {
    model: "claude-opus-5-5",
    stop_reason: stopReason as Anthropic.Beta.BetaMessage["stop_reason"],
    content: [{ type: "text", text, citations: null }],
    usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  } as Partial<Anthropic.Beta.BetaMessage>;
}

const originalApiKey = process.env.ANTHROPIC_API_KEY;

describe("proposeDeleteAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockScriptModelService.listScriptModels.mockResolvedValue([opusModel]);
    mockScriptModelService.findScriptModel.mockResolvedValue(opusModel);
    mockCreate.mockResolvedValue(
      buildResponse(JSON.stringify({ title: " Delete the member Jamie Rivera ", description: " Open Members… " })),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("sends the guidelines file verbatim as a cached system prompt, the request message, and a structured output schema to the default model", async () => {
    await proposeDeleteAction(request);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [sent] = mockCreate.mock.calls[0] as [Anthropic.Beta.MessageCreateParamsNonStreaming];
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.max_tokens).toBe(1500);
    expect(sent.betas).toEqual(["structured-outputs-2025-12-15"]);
    expect(sent.system).toEqual([{ type: "text", text: GUIDELINES_TEXT, cache_control: { type: "ephemeral" } }]);
    expect(sent.messages).toEqual([{ role: "user", content: buildDeleteActionRequestMessage(request) }]);
    const outputFormat = sent.output_config?.format as { type: string; schema: Record<string, unknown> } | undefined;
    expect(outputFormat?.type).toBe("json_schema");
    expect(outputFormat?.schema).toMatchObject({ required: ["title", "description"], additionalProperties: false });
    expect(sent).not.toHaveProperty("thinking");
  });

  it("returns the trimmed title and description with the model that answered", async () => {
    await expect(proposeDeleteAction(request)).resolves.toEqual({
      title: "Delete the member Jamie Rivera",
      description: "Open Members…",
      modelId: "claude-opus-5-5",
    });
  });

  it("throws unsupportedModel and asks nothing when the catalog lists no model", async () => {
    mockScriptModelService.listScriptModels.mockResolvedValue([]);

    await expect(proposeDeleteAction(request)).rejects.toMatchObject({
      name: "ScriptGenerationError",
      reason: "unsupportedModel",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws missingApiKey and builds no client when no key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(proposeDeleteAction(request)).rejects.toMatchObject({ reason: "missingApiKey" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws refused, truncated, or unparseable for a declined, cut-off, or unusable reply", async () => {
    mockCreate.mockResolvedValueOnce({ ...buildResponse("", "refusal"), stop_details: { category: "harmful" } });
    await expect(proposeDeleteAction(request)).rejects.toMatchObject({
      reason: "refused",
      message: "Claude declined to write the delete action (harmful)",
    });

    mockCreate.mockResolvedValueOnce(buildResponse("{", "max_tokens"));
    await expect(proposeDeleteAction(request)).rejects.toMatchObject({ reason: "truncated" });

    mockCreate.mockResolvedValueOnce(buildResponse("not json"));
    await expect(proposeDeleteAction(request)).rejects.toMatchObject({
      reason: "unparseable",
      message: "Claude's reply was not JSON",
    });
    mockCreate.mockResolvedValueOnce(buildResponse(JSON.stringify({ title: "x" })));
    await expect(proposeDeleteAction(request)).rejects.toMatchObject({
      reason: "unparseable",
      message: "Claude's reply did not have a title and a description",
    });
    mockCreate.mockResolvedValueOnce(buildResponse(JSON.stringify({ title: "  ", description: "d" })));
    await expect(proposeDeleteAction(request)).rejects.toMatchObject({
      reason: "unparseable",
      message: "Claude's reply left the title or the description blank",
    });
  });

  it("lets an API error reject unchanged", async () => {
    const apiError = new Error("rate limited");
    mockCreate.mockRejectedValue(apiError);

    await expect(proposeDeleteAction(request)).rejects.toBe(apiError);
  });
});

describe("buildDeleteActionRequestMessage", () => {
  it("lays out the website, the login, the create action, and the object type, each quoted as JSON", () => {
    expect(buildDeleteActionRequestMessage(request)).toBe(
      [
        "Write the delete action that cleans up after this create action.",
        "",
        'Website: "Forge Gym"',
        'The browser is logged in as the credential named "Admin".',
        "",
        'Create action title: "Create a new member"',
        `Create action description: ${JSON.stringify(request.createDescription)}`,
        'It makes an object of the kind "Member".',
        "",
        "Answer with the JSON object described in the Output Format: `title` and `description`.",
      ].join("\n"),
    );
  });

  it("says the browser is logged out and the kind is unknown when they are", () => {
    const message = buildDeleteActionRequestMessage({ ...request, credentialName: null, objectTypeName: null });

    expect(message).toContain("The browser is logged out.");
    expect(message).toContain("The kind of object it makes is not known; read it from the title and description.");
  });
});
