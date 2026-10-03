import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * No test here calls the Models API. The SDK's client is replaced by a fake
 * whose `beta.models.list` returns the listed models as an async iterable,
 * the way the SDK's auto-paginating page does.
 */
const { mockModelsList } = vi.hoisted(() => ({ mockModelsList: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class MockAnthropic {
    beta = { models: { list: mockModelsList } };
  },
}));

import {
  chooseDefaultScriptModel,
  chooseEffortForModel,
  findScriptModel,
  listScriptModels,
  type ScriptModelOption,
} from "../../../server/services/scriptModelService.js";

/** What one listed model's settings are, before they are shaped like the API's reply. */
interface ListedModelSettings {
  id: string;
  displayName: string;
  effortLevels?: string[] | null;
  adaptive?: boolean;
  structuredOutputs?: boolean;
  allowedFallbacks?: string[] | null;
}

/**
 * Builds a model the way `client.beta.models.list` reports it.
 * @param settings - The model's id, name, and capabilities
 * @returns A BetaModelInfo-shaped stand-in
 */
function buildListedModel(settings: ListedModelSettings): Record<string, unknown> {
  const effortLevels = settings.effortLevels ?? null;
  const effortIsSupported = effortLevels !== null;
  const levelSupport = (level: string): { supported: boolean } => ({
    supported: effortIsSupported && effortLevels.includes(level),
  });
  return {
    id: settings.id,
    display_name: settings.displayName,
    allowed_fallback_models: settings.allowedFallbacks === undefined ? [] : settings.allowedFallbacks,
    capabilities: {
      structured_outputs: { supported: settings.structuredOutputs ?? true },
      thinking: {
        supported: true,
        types: { adaptive: { supported: settings.adaptive ?? true }, enabled: { supported: true } },
      },
      effort: {
        supported: effortIsSupported,
        low: levelSupport("low"),
        medium: levelSupport("medium"),
        high: levelSupport("high"),
        xhigh: levelSupport("xhigh"),
        max: levelSupport("max"),
      },
    },
  };
}

/**
 * Makes `beta.models.list` answer with these models, as an async iterable.
 * @param listedModels - The models, in the API's order
 */
function stubListedModels(listedModels: Record<string, unknown>[]): void {
  mockModelsList.mockImplementation(async function* listModels() {
    for (const listedModel of listedModels) {
      await Promise.resolve();
      yield listedModel;
    }
  });
}

const ALL_LEVELS = ["low", "medium", "high", "xhigh", "max"];

const opus55 = buildListedModel({
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  effortLevels: ALL_LEVELS,
  allowedFallbacks: ["claude-opus-5", "claude-opus-4-8"],
});
const sonnet55 = buildListedModel({
  id: "claude-sonnet-5-5",
  displayName: "Claude Sonnet 5.5",
  effortLevels: ALL_LEVELS,
  allowedFallbacks: ["claude-sonnet-5"],
});
const sonnet5 = buildListedModel({ id: "claude-sonnet-5", displayName: "Claude Sonnet 5", effortLevels: ALL_LEVELS });
const opus5 = buildListedModel({ id: "claude-opus-5", displayName: "Claude Opus 5", effortLevels: ALL_LEVELS });
const opus48 = buildListedModel({ id: "claude-opus-4-8", displayName: "Claude Opus 4.8", effortLevels: ALL_LEVELS });
const opus46 = buildListedModel({
  id: "claude-opus-4-6",
  displayName: "Claude Opus 4.6",
  // Listed out of ladder order on purpose: the service orders them.
  effortLevels: ["max", "low", "high", "medium"],
  allowedFallbacks: null,
});
const haiku45 = buildListedModel({
  id: "claude-haiku-4-5-20251001",
  displayName: "Claude Haiku 4.5",
  effortLevels: null,
  adaptive: false,
});
const legacyWithoutStructuredOutputs = buildListedModel({
  id: "claude-legacy",
  displayName: "Claude Legacy",
  structuredOutputs: false,
});

const originalApiKey = process.env.ANTHROPIC_API_KEY;

describe("scriptModelService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-test";
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  describe("listScriptModels", () => {
    it("asks for the models with the fallback beta, so allowed fallbacks are reported", async () => {
      stubListedModels([]);

      await listScriptModels();

      expect(mockModelsList).toHaveBeenCalledWith({ betas: ["server-side-fallback-2026-06-01"] });
    });

    it("keeps only models with structured outputs, in the API's order", async () => {
      stubListedModels([sonnet55, opus55, legacyWithoutStructuredOutputs, haiku45]);

      const models = await listScriptModels();

      expect(models.map((model) => model.id)).toEqual([
        "claude-sonnet-5-5",
        "claude-opus-5-5",
        "claude-haiku-4-5-20251001",
      ]);
    });

    it("describes each model's effort levels in ladder order, adaptive thinking, and display name", async () => {
      stubListedModels([opus46, haiku45]);

      const [opus, haiku] = await listScriptModels();

      expect(opus).toMatchObject({
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        effortLevels: ["low", "medium", "high", "max"],
        supportsAdaptiveThinking: true,
      });
      expect(haiku).toMatchObject({ effortLevels: [], supportsAdaptiveThinking: false });
    });

    it("prefers Claude Opus 4.8 as the fallback whenever the model allows it", async () => {
      stubListedModels([opus55, opus5, opus48]);

      const [opus] = await listScriptModels();

      expect(opus.fallbackModel).toEqual({ id: "claude-opus-4-8", displayName: "Claude Opus 4.8" });
    });

    it("falls back to the first allowed model when Opus 4.8 is not allowed", async () => {
      stubListedModels([sonnet55, sonnet5]);

      const [sonnet] = await listScriptModels();

      expect(sonnet.fallbackModel).toEqual({ id: "claude-sonnet-5", displayName: "Claude Sonnet 5" });
    });

    it("has no fallback when none is allowed, or when the allowed one is not listed", async () => {
      const allowsAnUnlistedModel = buildListedModel({
        id: "claude-x",
        displayName: "Claude X",
        effortLevels: ALL_LEVELS,
        allowedFallbacks: ["claude-not-listed"],
      });
      stubListedModels([opus46, haiku45, allowsAnUnlistedModel]);

      const models = await listScriptModels();

      expect(models.map((model) => model.fallbackModel)).toEqual([null, null, null]);
    });

    it("treats a model with no capability details as unusable", async () => {
      stubListedModels([{ id: "claude-bare", display_name: "Claude Bare", capabilities: null }]);

      expect(await listScriptModels()).toEqual([]);
    });

    it("throws missingApiKey without listing anything when no key is configured", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(listScriptModels()).rejects.toMatchObject({ reason: "missingApiKey" });
      expect(mockModelsList).not.toHaveBeenCalled();
    });
  });

  describe("findScriptModel", () => {
    it("finds a listed model by id", async () => {
      stubListedModels([opus55, haiku45]);

      expect(await findScriptModel("claude-haiku-4-5-20251001")).toMatchObject({
        displayName: "Claude Haiku 4.5",
      });
    });

    it("returns null for a model that is not listed or cannot do structured outputs", async () => {
      stubListedModels([opus55, legacyWithoutStructuredOutputs]);

      expect(await findScriptModel("claude-nope")).toBeNull();
      expect(await findScriptModel("claude-legacy")).toBeNull();
    });
  });

  describe("chooseEffortForModel", () => {
    const opus: ScriptModelOption = {
      id: "claude-opus-4-6",
      displayName: "Claude Opus 4.6",
      effortLevels: ["low", "medium", "high", "max"],
      supportsAdaptiveThinking: true,
      fallbackModel: null,
    };

    it("keeps the wanted level when the model offers it", () => {
      expect(chooseEffortForModel(opus, "max")).toBe("max");
    });

    it("uses high when the wanted level is not offered or none was wanted", () => {
      expect(chooseEffortForModel(opus, "xhigh")).toBe("high");
      expect(chooseEffortForModel(opus, null)).toBe("high");
    });

    it("uses the model's highest level when it does not offer high", () => {
      expect(chooseEffortForModel({ ...opus, effortLevels: ["low", "medium"] }, "xhigh")).toBe("medium");
    });

    it("returns null for a model with no effort setting", () => {
      expect(chooseEffortForModel({ ...opus, effortLevels: [] }, "high")).toBeNull();
    });
  });

  describe("chooseDefaultScriptModel", () => {
    it("starts on Claude Opus 5.5 at high when it is listed", async () => {
      stubListedModels([sonnet55, opus55]);

      expect(chooseDefaultScriptModel(await listScriptModels())).toEqual({
        modelId: "claude-opus-5-5",
        effort: "high",
      });
    });

    it("starts on the newest model when Opus 5.5 is not listed", async () => {
      stubListedModels([haiku45, opus46]);

      expect(chooseDefaultScriptModel(await listScriptModels())).toEqual({
        modelId: "claude-haiku-4-5-20251001",
        effort: null,
      });
    });

    it("has no default when no model is usable", () => {
      expect(chooseDefaultScriptModel([])).toBeNull();
    });
  });
});
