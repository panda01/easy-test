import {
  LOGIN_ACTION_KIND,
  type ActionKindRecord,
  type ActionObjectRoleRecord,
  type CrudActionKindRecord,
  type DetectionConfidenceRecord,
} from "./actionParameters";

/** The kind select's value for "Detect" (the server's null). */
export const DETECT_CHOICE_VALUE = "detect";

/** What each action kind is called in the form, in the order the select lists them. */
export const ACTION_KIND_LABELS: Record<ActionKindRecord, string> = {
  parameters: "Parameters",
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
  login: "Login",
};

/** What each action kind means, under the kind select. */
export const ACTION_KIND_HELP: Record<ActionKindRecord, string> = {
  parameters: "The action only takes typed values; it touches no object.",
  create: "The action makes a new object, which each run records and its delete action cleans up.",
  read: "The action opens or checks an existing object without changing it.",
  update: "The action changes an existing object, which every run must name.",
  delete: "The action deletes the object its create action makes; it shares that action's parameters, and a passed run marks the object deleted.",
  login: "The website's one login: it types the username and password of whichever credential an action or crawl runs as, before they start.",
};

/**
 * Says whether a kind can have an object type: every kind but Parameters and
 * Login.
 * @param kind - The kind, or null before anything is detected (then yes)
 * @returns True for the four object kinds and for null
 */
export function kindTakesAnObjectType(kind: ActionKindRecord | null): boolean {
  const kindTouchesNoObject = kind === "parameters" || kind === LOGIN_ACTION_KIND;
  return !kindTouchesNoObject;
}

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
 * remove)", or "Detect — Parameters (no kind words)".
 * @param role - The action's role, or null before the action exists
 * @returns The option's text
 */
export function describeDetectedKindChoice(role: ActionObjectRoleRecord | null): string {
  if (role === null) return "Detect from the title and description";
  const { detectedKind } = role;
  const kindLabel = ACTION_KIND_LABELS[detectedKind.kind];
  const evidenceText = detectedKind.evidence.join(", ");
  if (detectedKind.reason === "noMatch") return `Detect — ${kindLabel} (no kind words)`;
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

/** The verb each object kind's header line starts with. */
const OBJECT_KIND_VERBS: Record<CrudActionKindRecord, string> = {
  create: "Creates",
  read: "Reads",
  update: "Updates",
  delete: "Deletes",
};

/**
 * Describes an action's object role in one line for its page's header:
 * "Reads a Project (detected, High)", "Deletes a Project (you chose)",
 * "Creates a Project, named by School name, confirmed by step 7 (detected,
 * High)", or null for an action that only takes typed values or logs in. The cleanup
 * links (which Delete action cleans up after a Create action) are shown
 * beside it by the page, not in this line.
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
  const { kind } = role;
  const actionTouchesNoObject = kind === "parameters" || kind === LOGIN_ACTION_KIND;
  if (actionTouchesNoObject) return null;
  const typeName = role.objectTypeName ?? "object";
  const article = /^[aeiou]/i.test(typeName) ? "an" : "a";
  const sourceText =
    role.kindSource === "you" ? "you chose" : `detected, ${describeConfidence(role.detectedKind.confidence)}`;
  const verb = OBJECT_KIND_VERBS[kind];
  if (kind !== "create") {
    return `${verb} ${article} ${typeName} (${sourceText})`;
  }
  const nameText =
    createDetails.nameParameterLabel === null ? "" : `, named by ${createDetails.nameParameterLabel}`;
  const confirmText =
    createDetails.confirmStepNumber === null ? "" : `, confirmed by step ${String(createDetails.confirmStepNumber)}`;
  return `${verb} ${article} ${typeName}${nameText}${confirmText} (${sourceText})`;
}
