import { type PlanTarget } from "./actionPlanSteps";

/*
 * The client's copy of the parameter shapes the server's parameters route
 * answers with (see `server/utils/actionParameters.ts` and
 * `server/services/actionParameterService.ts`), plus the small rules the run
 * form checks before it sends - the client never imports server code.
 */

/** The longest value one run may type; mirrors the server's `MAX_PLAN_TEXT_LENGTH`. */
export const MAX_PARAMETER_VALUE_LENGTH = 1000;

/** The longest parameter label; mirrors the server's `MAX_PARAMETER_TEXT_LENGTH`. */
export const MAX_PARAMETER_LABEL_LENGTH = 100;

/** The marker a value may never contain - it starts a credential placeholder. */
const PLACEHOLDER_OPENING = "{{";

/** What an action does with an object: only typed values, act on an existing one, or make a new one. */
export type ActionKindRecord = "parameters" | "object" | "create";

/** How sure a detection is. */
export type DetectionConfidenceRecord = "high" | "medium" | "low";

/** How the action kind was detected. */
export interface ActionKindDetectionRecord {
  /** The detected kind. */
  kind: ActionKindRecord;
  /** One category won, the two tied, or nothing matched. */
  reason: "won" | "tie" | "noMatch";
  /** How sure it is. */
  confidence: DetectionConfidenceRecord;
  /** The winner's share of the score, 0 to 1. */
  confidenceShare: number;
  /** The object words' score. */
  objectScore: number;
  /** The create words' score. */
  createScore: number;
  /** The words that decided it. */
  evidence: string[];
}

/** How the object type was detected. */
export interface ObjectTypeDetectionRecord {
  /** The type's key (its own page's URL pattern). */
  objectTypeKey: string;
  /** Its name. */
  objectTypeName: string;
  /** How sure it is. */
  confidence: DetectionConfidenceRecord;
  /** The winner's share of the score. */
  confidenceShare: number;
  /** The words (and `address`) that decided it. */
  evidence: string[];
}

/** What an action does with an object, as the action read returns it (`objectRole`). */
export interface ActionObjectRoleRecord {
  /** The kind it runs as. */
  kind: ActionKindRecord;
  /** Whether the user chose it or it was detected. */
  kindSource: "you" | "detected";
  /** The kind detection, always present. */
  detectedKind: ActionKindDetectionRecord;
  /** The type it works on, or null. */
  objectTypeKey: string | null;
  /** That type's name, or null when unknown. */
  objectTypeName: string | null;
  /** Whether the user chose the type or it was detected; null without a type. */
  objectTypeSource: "you" | "detected" | null;
  /** The type detection, or null when nothing matched. */
  detectedObjectType: ObjectTypeDetectionRecord | null;
  /** True when an Object action deletes its object. */
  deletesObject: boolean;
  /** Whether the user chose it or it was detected. */
  deletesObjectSource: "you" | "detected";
  /** The delete detection. */
  detectedDeletesObject: { deletesObject: boolean; evidence: string[] };
  /** Things to check, in plain words. */
  warnings: string[];
}

/** One step field a parameter's value is written into. */
export interface ParameterUseRecord {
  /** The 1-based step, or 0 for the plan's start URL. */
  stepNumber: number;
  /** Which field: the typed value, a target's name or text, or an address. */
  field: "value" | "targetName" | "targetText" | "url";
}

/** For a field the steps do not fill: the step a value adds. */
export interface AddedFieldStepRecord {
  /** How the field is found. */
  target: PlanTarget;
  /** Typed or picked. */
  stepAction: "fill" | "selectOption";
  /** The step it is typed after. */
  afterStepNumber: number;
}

/** Why a parameter is required or optional. */
export type RequiredReasonRecord = "object" | "you" | "run" | "crawl" | "default";

/** One parameter of one version. */
export interface VersionParameterRecord {
  /** Its row's cuid. */
  id: string;
  /** Its key - what a run's values are keyed by. */
  key: string;
  /** The name to show. */
  label: string;
  /** The worked-out name. */
  detectedLabel: string;
  /** The user's name, or null. */
  userLabel: string | null;
  /** Typed text, a picked option, or the object. */
  kind: "text" | "option" | "object";
  /** A step types into it, the page has it beside such a field, or the user added it. */
  source: "steps" | "page" | "you";
  /** Where it was seen. */
  foundBy: string[];
  /** True for a password-like field. */
  isSecret: boolean;
  /** Whether a run needs a value. */
  isRequired: boolean;
  /** Why. */
  requiredReason: RequiredReasonRecord;
  /** The user's required choice, or null for "let the page decide". */
  userRequiredChoice: "required" | "optional" | null;
  /** The value the version types ("" for an added field). */
  defaultValue: string;
  /** The step fields it writes. */
  uses: ParameterUseRecord[];
  /** For a field the steps do not fill: the step a value adds; otherwise null. */
  addedField: AddedFieldStepRecord | null;
  /** The object type of an object parameter, or null. */
  objectTypeKey: string | null;
  /** The form or dialog its field sits in, or null. */
  containerName: string | null;
}

/** One object an Object action can be run on. */
export interface ObjectChoiceRecord {
  /** Its name. */
  name: string;
  /** Its own page, or null. */
  url: string | null;
  /** Seen by the latest crawl, or made by a run. */
  source: "crawl" | "created";
  /** A created one's record id, or null. */
  createdObjectId: string | null;
  /** The action that made a created one, or null. */
  createdByActionTitle: string | null;
  /** When a created one was made, or null. */
  createdAt: string | null;
  /** True when the latest crawl lists it. */
  seenOnCrawl: boolean;
}

/** A text of the steps the user can make a parameter of. */
export interface BindableTextRecord {
  /** The text. */
  text: string;
  /** Where it appears. */
  fields: ParameterUseRecord["field"][];
}

/** Everything about one version's parameters, as the parameters route answers. */
export interface VersionParametersRecord {
  /** The action's object role. */
  role: ActionObjectRoleRecord;
  /** The parameters, in step order. */
  parameters: VersionParameterRecord[];
  /** The objects an Object action can be run on. */
  objectChoices: ObjectChoiceRecord[];
  /** A Create action's confirm step, or null. */
  confirmStepNumber: number | null;
  /** The parameter that names a created object, or null. */
  nameParameterKey: string | null;
  /** The texts of the steps the user can make a parameter of. */
  bindableTexts: BindableTextRecord[];
  /** Things to check, in plain words. */
  warnings: string[];
}

/** One value a run used, as stored on the run. */
export interface UsedParameterValueRecord {
  /** The parameter's key. */
  key: string;
  /** Its label at run time. */
  label: string;
  /** The value ("" when left blank). */
  value: string;
}

/** A run's values, by parameter key. */
export type ParameterValues = Record<string, string>;

/**
 * Builds the values a run form starts with: each parameter's own value in
 * the version (an added field starts empty).
 * @param parameters - The version's parameters
 * @returns The starting values, by key
 */
export function buildInitialParameterValues(parameters: VersionParameterRecord[]): ParameterValues {
  return Object.fromEntries(parameters.map((parameter) => [parameter.key, parameter.defaultValue]));
}

/**
 * Checks one value the way the server will: not too long, and no `{{`.
 * @param value - The typed value
 * @returns What is wrong, or null when it is fine
 */
export function findParameterValueProblem(value: string): string | null {
  if (value.length > MAX_PARAMETER_VALUE_LENGTH) return `At most ${String(MAX_PARAMETER_VALUE_LENGTH)} characters`;
  if (value.includes(PLACEHOLDER_OPENING)) return "May not contain {{";
  return null;
}

/**
 * Lists the parameters a run cannot start without: required ones left blank,
 * and ones whose value breaks a rule.
 * @param parameters - The version's parameters
 * @param values - The run form's values
 * @returns The labels of the parameters to fix; empty when the run can start
 */
export function listParametersToFix(parameters: VersionParameterRecord[], values: ParameterValues): string[] {
  return parameters
    .filter((parameter) => {
      const value = values[parameter.key] ?? parameter.defaultValue;
      const requiredValueIsBlank = parameter.isRequired && value.trim() === "";
      return requiredValueIsBlank || findParameterValueProblem(value) !== null;
    })
    .map((parameter) => parameter.label);
}

/**
 * Keeps only the values that differ from what the version would type anyway,
 * so a run request only names the parameters the user changed.
 * @param parameters - The version's parameters
 * @param values - The run form's values
 * @returns The changed values, by key
 */
export function listChangedParameterValues(
  parameters: VersionParameterRecord[],
  values: ParameterValues,
): ParameterValues {
  const changedEntries = parameters.flatMap((parameter) => {
    const valueWasTyped = Object.hasOwn(values, parameter.key);
    const valueChanged = valueWasTyped && values[parameter.key] !== parameter.defaultValue;
    return valueChanged ? [[parameter.key, values[parameter.key]] as const] : [];
  });
  return Object.fromEntries(changedEntries);
}

/**
 * Says whether a parameter is required and why, for the Parameters section.
 * @param parameter - The parameter
 * @returns e.g. "Required, always", "Optional (you chose)", "Required (the page marks it)"
 */
export function describeParameterRequirement(parameter: VersionParameterRecord): string {
  if (parameter.requiredReason === "object") return "Required, always";
  const requirement = parameter.isRequired ? "Required" : "Optional";
  switch (parameter.requiredReason) {
    case "you":
      return `${requirement} (you chose)`;
    case "run":
      return `${requirement} (the page says so, seen on a run)`;
    case "crawl":
      return `${requirement} (the page says so, seen on a crawl)`;
    case "default":
      return parameter.addedField === null
        ? `${requirement} (a step types it)`
        : `${requirement} (the page doesn't say)`;
  }
}

/**
 * Describes where a parameter came from, for its tag.
 * @param parameter - The parameter
 * @returns "In the steps", "On the page", "Added by you", or "The object"
 */
export function describeParameterSource(parameter: VersionParameterRecord): string {
  if (parameter.kind === "object") return "The object";
  if (parameter.source === "you") return "Added by you";
  return parameter.source === "page" ? "On the page" : "In the steps";
}

/**
 * Lists the steps a parameter is used in, for "Used in steps 5, 9".
 * @param parameter - The parameter
 * @returns e.g. "steps 5, 9", "the start address", or "after step 6" for an added field
 */
export function describeParameterSteps(parameter: VersionParameterRecord): string {
  if (parameter.addedField !== null) return `typed after step ${String(parameter.addedField.afterStepNumber)}`;
  const stepNumbers = [...new Set(parameter.uses.map((use) => use.stepNumber))];
  const usesTheStartAddress = stepNumbers.includes(0);
  const numberedSteps = stepNumbers.filter((stepNumber) => stepNumber !== 0);
  const parts = [
    ...(usesTheStartAddress ? ["the start address"] : []),
    ...(numberedSteps.length === 0
      ? []
      : [`${numberedSteps.length === 1 ? "step" : "steps"} ${numberedSteps.join(", ")}`]),
  ];
  return parts.join(" and ");
}

/**
 * Builds the tags the step list shows on each step: the label of every
 * parameter that writes into it, and "Confirm" on the confirm step.
 * @param view - The version's parameters view, or null while it loads
 * @returns The tags, by 1-based step number
 */
export function buildStepParameterTags(view: VersionParametersRecord | null): Map<number, string[]> {
  const tagsByStep = new Map<number, string[]>();
  if (view === null) return tagsByStep;
  /**
   * Adds one tag to a step, once.
   * @param stepNumber - The step
   * @param tag - The tag
   */
  const addTag = (stepNumber: number, tag: string): void => {
    const stepTags = tagsByStep.get(stepNumber) ?? [];
    if (!stepTags.includes(tag)) tagsByStep.set(stepNumber, [...stepTags, tag]);
  };
  for (const parameter of view.parameters) {
    for (const use of parameter.uses) {
      if (use.stepNumber > 0) addTag(use.stepNumber, parameter.label);
    }
  }
  if (view.confirmStepNumber !== null) addTag(view.confirmStepNumber, "Confirm");
  return tagsByStep;
}

/**
 * Reads a run's stored values. The column is JSON, so only well-formed
 * entries are kept; runs from before parameters have none.
 * @param storedValues - The run's `parameterValues`
 * @returns The values, in order
 */
export function readUsedParameterValues(storedValues: unknown): UsedParameterValueRecord[] {
  if (!Array.isArray(storedValues)) return [];
  return storedValues.filter(
    (storedValue: unknown): storedValue is UsedParameterValueRecord =>
      typeof storedValue === "object" &&
      storedValue !== null &&
      "key" in storedValue &&
      "label" in storedValue &&
      "value" in storedValue &&
      typeof storedValue.key === "string" &&
      typeof storedValue.label === "string" &&
      typeof storedValue.value === "string",
  );
}

/** The user's changes to a parameter, as the "change a parameter" request sends them. */
export interface ParameterChoicesRequestBody {
  /** The user's name, or null for the worked-out one. */
  userLabel: string | null;
  /** Required or optional, or null to let the page decide. */
  userRequiredChoice: "required" | "optional" | null;
}

/** A parameter the user adds, as the "add a parameter" request sends it. */
export type NewParameterRequestBody =
  | {
      /** A value in the steps. */
      addKind: "value";
      /** Its name. */
      label: string;
      /** Required or optional (an object one is always required). */
      requiredChoice: "required" | "optional";
      /** Text, or which object. */
      valueKind: "text" | "object";
      /** The object type, for an object one; otherwise null. */
      objectTypeKey: string | null;
      /** The literal of the steps. */
      matchText: string;
    }
  | {
      /** A field the steps don't fill. */
      addKind: "field";
      /** Its name. */
      label: string;
      /** Required or optional. */
      requiredChoice: "required" | "optional";
      /** How the field is found. */
      fieldTarget: PlanTarget;
      /** Typed or picked. */
      stepAction: "fill" | "selectOption";
      /** The parameter it is filled in after. */
      fillAfterKey: string;
    };
