import {
  type ActionKindRecord,
  type ActionObjectRoleRecord,
  type DetectionConfidenceRecord,
} from "./actionParameters";

/** The kind select's value for "Detect" (the server's null). */
export const DETECT_CHOICE_VALUE = "detect";

/** What each action kind is called in the form. */
export const ACTION_KIND_LABELS: Record<ActionKindRecord, string> = {
  parameters: "Parameters",
  object: "Object",
  create: "Create",
};

/** What each action kind means, under the kind select. */
export const ACTION_KIND_HELP: Record<ActionKindRecord, string> = {
  parameters: "The action only takes typed values.",
  object: "The action works on an existing object, which every run must name.",
  create: "The action makes a new object, which each run records.",
};

/**
 * Names a confidence level the way the form shows it.
 * @param confidence - The level
 * @returns "High", "Medium", or "Low"
 */
export function describeConfidence(confidence: DetectionConfidenceRecord): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)}`;
}

/**
 * Describes what "Detect" picks for the kind, for its option in the form:
 * "Detect — Create (High: create, adds)", "Detect — Parameters (tie: add,
 * remove)", or "Detect — Parameters (no object or create words)".
 * @param role - The action's role, or null before the action exists
 * @returns The option's text
 */
export function describeDetectedKindChoice(role: ActionObjectRoleRecord | null): string {
  if (role === null) return "Detect from the title and description";
  const { detectedKind } = role;
  const kindLabel = ACTION_KIND_LABELS[detectedKind.kind];
  const evidenceText = detectedKind.evidence.join(", ");
  if (detectedKind.reason === "noMatch") return `Detect — ${kindLabel} (no object or create words)`;
  if (detectedKind.reason === "tie") return `Detect — ${kindLabel} (tie: ${evidenceText})`;
  return `Detect — ${kindLabel} (${describeConfidence(detectedKind.confidence)}: ${evidenceText})`;
}

/**
 * Describes what "Detect" picks for the object type: "Detect — Project
 * (High)", or "Detect — none found".
 * @param role - The action's role, or null before the action exists
 * @returns The option's text
 */
export function describeDetectedObjectTypeChoice(role: ActionObjectRoleRecord | null): string {
  if (role === null) return "Detect from the title, description, and addresses";
  const detectedType = role.detectedObjectType;
  if (detectedType === null) return "Detect — none found";
  return `Detect — ${detectedType.objectTypeName} (${describeConfidence(detectedType.confidence)})`;
}

/**
 * Describes what "Detect" picks for "Deletes the object": "Detect — Yes
 * (delete)" or "Detect — No".
 * @param role - The action's role, or null before the action exists
 * @returns The option's text
 */
export function describeDetectedDeletesChoice(role: ActionObjectRoleRecord | null): string {
  if (role === null) return "Detect from the title and description";
  const { detectedDeletesObject } = role;
  return detectedDeletesObject.deletesObject
    ? `Detect — Yes (${detectedDeletesObject.evidence.join(", ")})`
    : "Detect — No";
}

/**
 * Describes an action's object role in one line for its page's header:
 * "Takes a Project (detected, High)", "Deletes a Project (you chose)",
 * "Creates a Project, named by School name, confirmed by step 7", or null
 * for an action that only takes typed values.
 * @param role - The action's role
 * @param createDetails - For a Create action: the name parameter's label and the confirm step, when known
 * @param createDetails.nameParameterLabel - The label of the parameter that names a created object, or null
 * @param createDetails.confirmStepNumber - The confirm step, or null
 * @returns The line, or null
 */
export function describeObjectRole(
  role: ActionObjectRoleRecord,
  createDetails: { nameParameterLabel: string | null; confirmStepNumber: number | null },
): string | null {
  if (role.kind === "parameters") return null;
  const typeName = role.objectTypeName ?? "object";
  const article = /^[aeiou]/i.test(typeName) ? "an" : "a";
  const sourceText =
    role.kindSource === "you" ? "you chose" : `detected, ${describeConfidence(role.detectedKind.confidence)}`;
  if (role.kind === "object") {
    const verb = role.deletesObject ? "Deletes" : "Takes";
    return `${verb} ${article} ${typeName} (${sourceText})`;
  }
  const nameText =
    createDetails.nameParameterLabel === null ? "" : `, named by ${createDetails.nameParameterLabel}`;
  const confirmText =
    createDetails.confirmStepNumber === null ? "" : `, confirmed by step ${String(createDetails.confirmStepNumber)}`;
  return `Creates ${article} ${typeName}${nameText}${confirmText} (${sourceText})`;
}
