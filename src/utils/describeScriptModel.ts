/** The parts of a model the label needs: its id and the name people read. */
export interface DescribableScriptModel {
  /** The model identifier string. */
  id: string;
  /** The human-readable name. */
  displayName: string;
  /** The effort levels it offers; empty when it has no effort setting. */
  effortLevels: string[];
}

/**
 * Describes the effort a script was generated with:
 * - a recorded level reads "high effort";
 * - no level on a model that has no effort setting reads "Standard effort";
 * - no level on a model that HAS effort levels reads "effort not recorded" -
 *   only scripts saved before effort was stored look like that;
 * - no level on a model the catalog does not list (still loading, failed, or
 *   retired) reads "no effort level", which is true in both of the cases
 *   above, since the two cannot be told apart without the model.
 * @param effort - The stored effort level, or null
 * @param listedModel - The model as the catalog lists it, or undefined when it is not listed
 * @returns The effort text
 */
function describeEffort(effort: string | null, listedModel: DescribableScriptModel | undefined): string {
  const effortWasRecorded = effort !== null;
  if (effortWasRecorded) {
    return `${effort} effort`;
  }
  const modelIsNotListed = listedModel === undefined;
  if (modelIsNotListed) {
    return "no effort level";
  }
  const modelHasNoEffortSetting = listedModel.effortLevels.length === 0;
  return modelHasNoEffortSetting ? "Standard effort" : "effort not recorded";
}

/**
 * Describes which model wrote a script and at what effort, for captions and
 * version labels, e.g. "Claude Opus 5.5 (claude-opus-5-5) · high effort".
 * The display name comes from the live model list; a model no longer listed
 * is shown by its id alone.
 * @param modelId - The stored model id (the model that answered)
 * @param effort - The stored effort level, or null
 * @param catalogModels - The models the catalog lists (may be empty while it loads or after it failed)
 * @returns The model and effort text
 */
export function describeScriptModel(
  modelId: string,
  effort: string | null,
  catalogModels: DescribableScriptModel[],
): string {
  const listedModel = catalogModels.find((catalogModel) => catalogModel.id === modelId);
  const modelText = listedModel === undefined ? modelId : `${listedModel.displayName} (${modelId})`;
  return `${modelText} · ${describeEffort(effort, listedModel)}`;
}
