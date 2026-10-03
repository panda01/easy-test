import { type Anthropic } from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./anthropicClient.js";

/** The effort levels the Messages API knows, in order from least to most effort. */
export const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

/** One effort level a model can be asked to use. */
export type EffortLevel = (typeof EFFORT_LADDER)[number];

/** The model "Convert to script" uses unless the user picks another. */
export const DEFAULT_SCRIPT_MODEL_ID = "claude-opus-5-5";

/** The effort level "Convert to script" uses unless the user picks another. */
export const DEFAULT_SCRIPT_EFFORT: EffortLevel = "high";

/**
 * The fallback used whenever the chosen model allows it - the user's earlier
 * choice of a named fallback. Other models fall back to the first model the
 * API allows for them, or to nothing.
 */
export const PREFERRED_FALLBACK_MODEL_ID = "claude-opus-4-8";

/**
 * Beta flag for the array form of `fallbacks`. Also sent when listing models,
 * because only then does the API report each model's `allowed_fallback_models`.
 */
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-06-01";

/** A model the API names, with the name people read. */
export interface ScriptModelReference {
  /** The model identifier string, e.g. "claude-opus-4-8". */
  id: string;
  /** The human-readable name, e.g. "Claude Opus 4.8". */
  displayName: string;
}

/** One model "Convert to script" can use, described from the live Models API. */
export interface ScriptModelOption extends ScriptModelReference {
  /** The effort levels it offers, least to most; empty when it has no effort setting ("Standard"). */
  effortLevels: EffortLevel[];
  /** True when it accepts `thinking: { type: "adaptive" }`. */
  supportsAdaptiveThinking: boolean;
  /** The model the API retries on when a safety classifier declines, or null when there is none. */
  fallbackModel: ScriptModelReference | null;
}

/** The model and effort the picker starts on. */
export interface ScriptModelChoiceDefaults {
  /** The default model's id. */
  modelId: string;
  /** The default effort level, or null when that model has no effort setting. */
  effort: EffortLevel | null;
}

/** What the Models API says about one model, before it is turned into an option. */
type ListedModel = Anthropic.Beta.BetaModelInfo;

/**
 * Reads which effort levels a model offers, in ladder order.
 * @param listedModel - The model as the Models API lists it
 * @returns The supported levels; empty when the model has no effort setting
 */
function readEffortLevels(listedModel: ListedModel): EffortLevel[] {
  const effortCapability = listedModel.capabilities?.effort;
  const modelHasNoEffortSetting = effortCapability?.supported !== true;
  if (modelHasNoEffortSetting) {
    return [];
  }
  return EFFORT_LADDER.filter((effortLevel) => effortCapability[effortLevel]?.supported === true);
}

/**
 * Picks the fallback for a model: the preferred fallback when the API allows
 * it, otherwise the first model the API allows, otherwise none. Only models
 * that are themselves listed (so have a display name) can be picked.
 * @param allowedFallbackIds - The model's `allowed_fallback_models`
 * @param displayNamesById - Every listed model's display name, by id
 * @returns The fallback model, or null when there is none
 */
function pickFallbackModel(
  allowedFallbackIds: string[],
  displayNamesById: Map<string, string>,
): ScriptModelReference | null {
  const listedAllowedIds = allowedFallbackIds.filter((allowedId) => displayNamesById.has(allowedId));
  const preferredFallbackIsAllowed = listedAllowedIds.includes(PREFERRED_FALLBACK_MODEL_ID);
  const fallbackId = preferredFallbackIsAllowed ? PREFERRED_FALLBACK_MODEL_ID : listedAllowedIds.at(0);
  if (fallbackId === undefined) {
    return null;
  }
  return { id: fallbackId, displayName: displayNamesById.get(fallbackId) ?? fallbackId };
}

/**
 * Lists every model "Convert to script" can use, straight from the live
 * Models API, newest first: each one's effort levels, whether it takes
 * adaptive thinking, and the fallback it would use.
 *
 * Only models with structured outputs are listed, because the conversion
 * relies on them. Nothing is hard-coded, so a model Anthropic adds or retires
 * appears or disappears on its own.
 * @returns The usable models, in the API's order
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured
 */
export async function listScriptModels(): Promise<ScriptModelOption[]> {
  const client = createAnthropicClient();
  const listedModels: ListedModel[] = [];
  for await (const listedModel of client.beta.models.list({ betas: [SERVER_SIDE_FALLBACK_BETA] })) {
    listedModels.push(listedModel);
  }

  const displayNamesById = new Map(
    listedModels.map((listedModel) => [listedModel.id, listedModel.display_name]),
  );
  const modelsWithStructuredOutputs = listedModels.filter(
    (listedModel) => listedModel.capabilities?.structured_outputs.supported === true,
  );

  return modelsWithStructuredOutputs.map((listedModel) => ({
    id: listedModel.id,
    displayName: listedModel.display_name,
    effortLevels: readEffortLevels(listedModel),
    supportsAdaptiveThinking: listedModel.capabilities?.thinking.types.adaptive.supported === true,
    fallbackModel: pickFallbackModel(listedModel.allowed_fallback_models ?? [], displayNamesById),
  }));
}

/**
 * Looks up one usable model in the live catalog.
 * @param modelId - The model identifier string
 * @returns The model, or null when it is not listed (unknown, retired, or without structured outputs)
 * @throws {ScriptGenerationError} `missingApiKey` when no key is configured
 */
export async function findScriptModel(modelId: string): Promise<ScriptModelOption | null> {
  const scriptModels = await listScriptModels();
  return scriptModels.find((scriptModel) => scriptModel.id === modelId) ?? null;
}

/**
 * Chooses the effort level to use for a model: the wanted level when the
 * model offers it, otherwise `high` when offered, otherwise the model's
 * highest level, otherwise null (no effort setting).
 * @param model - The model being chosen
 * @param wantedEffort - The level the user had, if any
 * @returns The level to use, or null for a model with no effort setting
 */
export function chooseEffortForModel(
  model: ScriptModelOption,
  wantedEffort: EffortLevel | null,
): EffortLevel | null {
  const wantedEffortIsOffered = wantedEffort !== null && model.effortLevels.includes(wantedEffort);
  if (wantedEffortIsOffered) {
    return wantedEffort;
  }
  const defaultEffortIsOffered = model.effortLevels.includes(DEFAULT_SCRIPT_EFFORT);
  if (defaultEffortIsOffered) {
    return DEFAULT_SCRIPT_EFFORT;
  }
  return model.effortLevels.at(-1) ?? null;
}

/**
 * Picks the model and effort the picker starts on: Claude Opus 5.5 at `high`
 * when it is listed, otherwise the newest listed model at its best match.
 * @param scriptModels - The usable models, newest first
 * @returns The default choice, or null when no model is usable
 */
export function chooseDefaultScriptModel(
  scriptModels: ScriptModelOption[],
): ScriptModelChoiceDefaults | null {
  const defaultModel =
    scriptModels.find((scriptModel) => scriptModel.id === DEFAULT_SCRIPT_MODEL_ID) ??
    scriptModels.at(0);
  if (defaultModel === undefined) {
    return null;
  }
  return {
    modelId: defaultModel.id,
    effort: chooseEffortForModel(defaultModel, DEFAULT_SCRIPT_EFFORT),
  };
}
