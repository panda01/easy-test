import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * No test here calls the Anthropic API. The SDK's `Anthropic` class is
 * replaced by a fake whose `beta.messages.parse` is a spy, and whose
 * constructor records the options it was built with. The real round trip
 * (including prompt caching) is proven by the manual verification run.
 */
const { mockParse, mockAnthropicConstructor } = vi.hoisted(() => ({
  mockParse: vi.fn(),
  mockAnthropicConstructor: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class MockAnthropic {
    beta = { messages: { parse: mockParse } };
    /**
     * Records the options the service built the client with.
     * @param options - The client options
     */
    constructor(options: unknown) {
      mockAnthropicConstructor(options);
    }
  },
}));

import { ScriptGenerationError } from "../../../server/services/anthropicClient.js";
import { convertActionToScript } from "../../../server/services/scriptGenerationService.js";
import { type ScriptModelOption } from "../../../server/services/scriptModelService.js";

const GUIDELINES_TEXT = readFileSync(
  path.join(process.cwd(), "server", "prompts", "actionScriptGuidelines.md"),
  "utf8",
);

const conversionRequest = {
  websiteName: "Example Shop",
  startUrl: "https://shop.example.com/",
  actionTitle: "Log in",
  actionDescription: "Click Sign in, type the email and password, and confirm the welcome text.",
};

/** A current model: effort levels, adaptive thinking, and a fallback. */
const opusWithFallback: ScriptModelOption = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  supportsAdaptiveThinking: true,
  fallbackModel: { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
};

/** An older model: effort levels, but no adaptive thinking and no fallback. */
const opusWithoutAdaptiveThinking: ScriptModelOption = {
  id: "claude-opus-4-5-20251101",
  displayName: "Claude Opus 4.5",
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: false,
  fallbackModel: null,
};

/** A model with no effort setting ("Standard"), no adaptive thinking, and no fallback. */
const haikuStandard: ScriptModelOption = {
  id: "claude-haiku-4-5-20251001",
  displayName: "Claude Haiku 4.5",
  effortLevels: [],
  supportsAdaptiveThinking: false,
  fallbackModel: null,
};

const parsedConversion = {
  summary: "Logs in to Example Shop.",
  assumptions: ["The button is labelled Sign in"],
  script: "import { chromium } from 'playwright';\n// steps\n",
};

/**
 * Builds what `beta.messages.parse` resolves with: a parsed message that
 * ended normally, unless the test overrides a field.
 * @param overrides - Fields to replace
 * @returns A ParsedBetaMessage-shaped stand-in
 */
function buildParsedResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    stop_details: null,
    content: [],
    usage: {
      input_tokens: 380,
      output_tokens: 700,
      cache_read_input_tokens: 2535,
      cache_creation_input_tokens: 0,
    },
    parsed_output: parsedConversion,
    ...overrides,
  };
}

/** The request body the service sent to `beta.messages.parse`. */
interface SentRequest {
  model: string;
  max_tokens: number;
  betas?: string[];
  fallbacks?: { model: string }[];
  thinking?: { type: string };
  system: { type: string; text: string; cache_control: { type: string } }[];
  messages: { role: string; content: string }[];
  output_config: { effort?: string; format: { type: string } };
}

/**
 * Reads the request body of the first `parse` call.
 * @returns The sent request
 */
function readSentRequest(): SentRequest {
  const [sentRequest] = mockParse.mock.calls[0] as [SentRequest];
  return sentRequest;
}

const originalApiKey = process.env.ANTHROPIC_API_KEY;

describe("convertActionToScript", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ANTHROPIC_API_KEY = "  test-key  ";
    mockParse.mockResolvedValue(buildParsedResponse());
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

  it("throws missingApiKey and builds no client when no key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const conversion = convertActionToScript(conversionRequest, {
      model: opusWithFallback,
      effort: "high",
    });

    await expect(conversion).rejects.toBeInstanceOf(ScriptGenerationError);
    await expect(conversion).rejects.toMatchObject({ reason: "missingApiKey" });
    expect(mockAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("passes the trimmed key to the client explicitly", async () => {
    await convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" });

    expect(mockAnthropicConstructor).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("sends the guidelines file verbatim as a cached system prompt, whatever the model", async () => {
    await convertActionToScript(conversionRequest, { model: haikuStandard, effort: null });

    expect(readSentRequest().system).toEqual([
      { type: "text", text: GUIDELINES_TEXT, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("asks a current model with its fallback, adaptive thinking, the chosen effort, and structured output", async () => {
    await convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "xhigh" });

    const sentRequest = readSentRequest();
    expect(sentRequest.model).toBe("claude-opus-5-5");
    expect(sentRequest.max_tokens).toBe(16000);
    expect(sentRequest.betas).toEqual(["server-side-fallback-2026-06-01"]);
    expect(sentRequest.fallbacks).toEqual([{ model: "claude-opus-4-8" }]);
    expect(sentRequest.thinking).toEqual({ type: "adaptive" });
    expect(sentRequest.output_config.effort).toBe("xhigh");
    expect(sentRequest.output_config.format.type).toBe("json_schema");
  });

  it("sends an effort level but no thinking or fallback to an older model without them", async () => {
    await convertActionToScript(conversionRequest, {
      model: opusWithoutAdaptiveThinking,
      effort: "low",
    });

    const sentRequest = readSentRequest();
    expect(sentRequest.model).toBe("claude-opus-4-5-20251101");
    expect(sentRequest.output_config.effort).toBe("low");
    expect(sentRequest).not.toHaveProperty("thinking");
    expect(sentRequest).not.toHaveProperty("fallbacks");
    expect(sentRequest).not.toHaveProperty("betas");
  });

  it("sends no effort, thinking, or fallback to a model with no effort setting", async () => {
    await convertActionToScript(conversionRequest, { model: haikuStandard, effort: null });

    const sentRequest = readSentRequest();
    expect(sentRequest.model).toBe("claude-haiku-4-5-20251001");
    expect(sentRequest.output_config).not.toHaveProperty("effort");
    expect(sentRequest.output_config.format.type).toBe("json_schema");
    expect(sentRequest).not.toHaveProperty("thinking");
    expect(sentRequest).not.toHaveProperty("fallbacks");
  });

  it("puts the website, the action, the one-shot rules, and the field mapping in the user message", async () => {
    await convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" });

    const { messages } = readSentRequest();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const userMessage = messages[0].content;
    expect(userMessage).toContain("Website name: Example Shop");
    expect(userMessage).toContain(
      "START_URL: set the START_URL constant to exactly 'https://shop.example.com/'",
    );
    expect(userMessage).toContain("Action title: Log in");
    expect(userMessage).toContain(conversionRequest.actionDescription);
    expect(userMessage).toContain("you cannot ask questions");
    expect(userMessage).toContain("await page.pause();");
    expect(userMessage).toContain("no Markdown code fences");
  });

  it("returns the summary, assumptions, script, the model that answered, and the effort sent", async () => {
    const conversion = await convertActionToScript(conversionRequest, {
      model: opusWithFallback,
      effort: "medium",
    });

    expect(conversion).toEqual({
      summary: parsedConversion.summary,
      assumptions: parsedConversion.assumptions,
      code: parsedConversion.script,
      modelId: "claude-opus-5-5",
      effort: "medium",
    });
  });

  it("reports the fallback as the model that answered when the chosen one declined", async () => {
    mockParse.mockResolvedValue(buildParsedResponse({ model: "claude-opus-4-8" }));

    const conversion = await convertActionToScript(conversionRequest, {
      model: opusWithFallback,
      effort: "high",
    });

    expect(conversion).toMatchObject({ modelId: "claude-opus-4-8", effort: "high" });
  });

  it("returns a null effort for a model with no effort setting", async () => {
    mockParse.mockResolvedValue(buildParsedResponse({ model: "claude-haiku-4-5-20251001" }));

    const conversion = await convertActionToScript(conversionRequest, {
      model: haikuStandard,
      effort: null,
    });

    expect(conversion).toMatchObject({ modelId: "claude-haiku-4-5-20251001", effort: null });
  });

  it("logs the model asked, the effort, the model that answered, and the cache use", async () => {
    await convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" });

    expect(console.log).toHaveBeenCalledWith(
      "[scripts] asked claude-opus-5-5 at high effort; claude-opus-5-5 answered: 380 input tokens, 2535 read from cache, 0 written to cache, 700 output tokens",
    );
  });

  it("logs standard effort and 0 for cache figures the API left out", async () => {
    mockParse.mockResolvedValue(
      buildParsedResponse({
        model: "claude-haiku-4-5-20251001",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }),
    );

    await convertActionToScript(conversionRequest, { model: haikuStandard, effort: null });

    expect(console.log).toHaveBeenCalledWith(
      "[scripts] asked claude-haiku-4-5-20251001 at standard effort; claude-haiku-4-5-20251001 answered: 10 input tokens, 0 read from cache, 0 written to cache, 20 output tokens",
    );
  });

  it("throws refused, naming the category, when every model declined", async () => {
    mockParse.mockResolvedValue(
      buildParsedResponse({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null },
        parsed_output: null,
      }),
    );

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" }),
    ).rejects.toMatchObject({
      reason: "refused",
      message: "Claude declined to convert this action (cyber)",
    });
  });

  it("says so when a refusal carries no category", async () => {
    mockParse.mockResolvedValue(
      buildParsedResponse({ stop_reason: "refusal", stop_details: null, parsed_output: null }),
    );

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" }),
    ).rejects.toMatchObject({
      reason: "refused",
      message: "Claude declined to convert this action (no category given)",
    });
  });

  it("throws truncated when the reply hit the token limit", async () => {
    mockParse.mockResolvedValue(buildParsedResponse({ stop_reason: "max_tokens" }));

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "max" }),
    ).rejects.toMatchObject({
      reason: "truncated",
      message: "Claude's reply was cut off at 16000 tokens before the script was finished",
    });
  });

  it("throws unparseable when the reply did not match the schema", async () => {
    mockParse.mockResolvedValue(buildParsedResponse({ parsed_output: null }));

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" }),
    ).rejects.toMatchObject({
      reason: "unparseable",
      message: "Claude's reply did not contain a summary, assumptions, and script",
    });
  });

  it("throws unparseable when the script is empty", async () => {
    mockParse.mockResolvedValue(
      buildParsedResponse({ parsed_output: { ...parsedConversion, script: "  \n " } }),
    );

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" }),
    ).rejects.toMatchObject({
      reason: "unparseable",
      message: "Claude's reply contained an empty script",
    });
  });

  it("lets an API error reject unchanged", async () => {
    const apiError = new Error("429 rate_limit_error");
    mockParse.mockRejectedValue(apiError);

    await expect(
      convertActionToScript(conversionRequest, { model: opusWithFallback, effort: "high" }),
    ).rejects.toBe(apiError);
  });
});
