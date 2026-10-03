import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The SDK's client is replaced by a fake that records its options; nothing calls Anthropic. */
const { mockAnthropicConstructor } = vi.hoisted(() => ({ mockAnthropicConstructor: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class MockAnthropic {
    /**
     * Records the options the client was built with.
     * @param options - The client options
     */
    constructor(options: unknown) {
      mockAnthropicConstructor(options);
    }
  },
}));

import {
  ScriptGenerationError,
  createAnthropicClient,
  readAnthropicApiKey,
} from "../../../server/services/anthropicClient.js";

const originalApiKey = process.env.ANTHROPIC_API_KEY;

describe("anthropicClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("reads the key from ANTHROPIC_API_KEY, trimmed", () => {
    process.env.ANTHROPIC_API_KEY = "  sk-test  ";
    expect(readAnthropicApiKey()).toBe("sk-test");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("throws missingApiKey when the key is %s", (_label, apiKey) => {
    if (apiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = apiKey;
    }

    expect(() => readAnthropicApiKey()).toThrow(ScriptGenerationError);
    expect(() => readAnthropicApiKey()).toThrow(
      "ANTHROPIC_API_KEY is not set in .env.local, so actions cannot be converted to scripts",
    );
  });

  it("builds a client with the key passed explicitly", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";

    createAnthropicClient();

    expect(mockAnthropicConstructor).toHaveBeenCalledWith({ apiKey: "sk-test" });
  });

  it("builds no client when the key is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => createAnthropicClient()).toThrow(ScriptGenerationError);
    expect(mockAnthropicConstructor).not.toHaveBeenCalled();
  });

  it("names its errors and carries the reason", () => {
    const error = new ScriptGenerationError("unsupportedModel", "No such model");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ScriptGenerationError");
    expect(error.reason).toBe("unsupportedModel");
    expect(error.message).toBe("No such model");
  });
});
