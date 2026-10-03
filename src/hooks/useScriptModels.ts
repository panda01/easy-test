import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { SCRIPT_MODELS_API_URL } from "../utils/routePaths";

/** A model the API names, with the name people read. */
export interface ScriptModelReference {
  /** The model identifier string, e.g. "claude-opus-4-8". */
  id: string;
  /** The human-readable name, e.g. "Claude Opus 4.8". */
  displayName: string;
}

/**
 * One model "Convert to script" can use, as `GET /api/script-models`
 * describes it. Declared here rather than imported from the server: the
 * client never imports server code.
 */
export interface ScriptModelOption extends ScriptModelReference {
  /** The effort levels it offers, least to most; empty when it has no effort setting ("Standard"). */
  effortLevels: string[];
  /** True when the conversion runs with adaptive thinking on this model. */
  supportsAdaptiveThinking: boolean;
  /** The model that answers instead when this one declines, or null when there is none. */
  fallbackModel: ScriptModelReference | null;
}

/** The whole model list, plus where the picker should start. */
export interface ScriptModelCatalog {
  /** Every usable model, newest first. */
  models: ScriptModelOption[];
  /** The model the picker starts on, or null when no model is usable. */
  defaultModelId: string | null;
  /** The effort level the picker starts on; null for "Standard" or when no model is usable. */
  defaultEffort: string | null;
}

/**
 * Fetches the live list of models "Convert to script" can use
 * (`GET /api/script-models`), with each model's effort levels and fallback.
 * Without ANTHROPIC_API_KEY on the server this reports the server's 503
 * message as `errorMessage`.
 * @returns The loading / error / data state of the model catalog
 */
export function useScriptModels(): JsonResourceState<ScriptModelCatalog> {
  const catalogResource = useJsonResource(SCRIPT_MODELS_API_URL);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return catalogResource as JsonResourceState<ScriptModelCatalog>;
}
