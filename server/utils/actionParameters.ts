import {
  CREDENTIAL_PLACEHOLDERS,
  PlanTargetSchema,
  type ActionPlan,
  type PlanStep,
  type PlanStepAction,
  type PlanTarget,
} from "./actionPlanSchema.js";
import { normalizeFieldName } from "./formFields.js";
import { urlMatchesPatternKey } from "./detectPagePatterns.js";
import { normalizeCrawlUrl } from "./normalizeCrawlUrl.js";
import type { ActionKind } from "./scoreActionObjectRole.js";

/** The kinds of value a parameter holds: typed text, a picked option, or which object to act on. */
export const PARAMETER_KINDS = ["text", "option", "object"] as const;

/** One parameter kind (see `PARAMETER_KINDS`). */
export type ParameterKind = (typeof PARAMETER_KINDS)[number];

/** Where a parameter came from: a step types into it, the page has it beside such a field, or the user added it. */
export const PARAMETER_SOURCES = ["steps", "page", "you"] as const;

/** One parameter source (see `PARAMETER_SOURCES`). */
export type ParameterSource = (typeof PARAMETER_SOURCES)[number];

/** Where a parameter was seen. */
export const PARAMETER_FOUND_BY = ["plan", "snapshot", "crawl", "run", "you"] as const;

/** One place a parameter was seen (see `PARAMETER_FOUND_BY`). */
export type ParameterFoundBy = (typeof PARAMETER_FOUND_BY)[number];

/** The user's required choices; null (not listed) means "let the page decide". */
export const REQUIRED_CHOICES = ["required", "optional"] as const;

/** One required choice (see `REQUIRED_CHOICES`). */
export type RequiredChoice = (typeof REQUIRED_CHOICES)[number];

/** The step fields a parameter's value can be written into. */
export const PARAMETER_USE_FIELDS = ["value", "targetName", "targetText", "url"] as const;

/** One step field (see `PARAMETER_USE_FIELDS`). */
export type ParameterUseField = (typeof PARAMETER_USE_FIELDS)[number];

/** The step actions a parameter can fill in. */
export const PARAMETER_STEP_ACTIONS = ["fill", "selectOption"] as const;

/** One parameter step action (see `PARAMETER_STEP_ACTIONS`). */
export type ParameterStepAction = (typeof PARAMETER_STEP_ACTIONS)[number];

/** The key of an Object action's object parameter. */
export const OBJECT_PARAMETER_KEY = "object";

/** The step number a `url` use of the plan's start URL has (steps count from 1). */
export const START_URL_STEP_NUMBER = 0;

/** A typed value is only bound to later steps that repeat it when it is at least this long. */
const MIN_ECHO_VALUE_LENGTH = 3;

/** Labels that mark a field as secret: its value is masked, scrubbed, and never stored on a run. */
const SECRET_LABEL_PATTERN = /pass(word|code|phrase)?\b|\bpin\b|secret|token|api[\s_-]?key/i;

/** The steps that can repeat a typed value in their target (a check of the name just typed, a click on it). */
const ECHO_STEP_ACTIONS: ReadonlySet<PlanStepAction> = new Set([
  "click",
  "doubleClick",
  "hover",
  "check",
  "uncheck",
  "scrollIntoView",
  "expectVisible",
  "expectHidden",
]);

/** An `ActionParameter` row, as the parameter logic reads it (see the model's doc comment). */
export interface ActionParameterRecord {
  /** The row's cuid. */
  id: string;
  /** Its key, unique within the action. */
  key: string;
  /** What kind of value it holds. */
  kind: ParameterKind;
  /** Where it came from. */
  source: ParameterSource;
  /** Where it was seen. */
  foundBy: ParameterFoundBy[];
  /** True for a password-like field. */
  isSecret: boolean;
  /** Its worked-out name. */
  label: string;
  /** The user's name for it, or null. */
  userLabel: string | null;
  /** How to find its field, or null (an object, or a value in the steps). */
  fieldTarget: PlanTarget | null;
  /** Its field's role, when known. */
  fieldRole: string | null;
  /** Its field's input type, when known. */
  inputType: string | null;
  /** Its field's placeholder, when known. */
  placeholder: string | null;
  /** How its value is put in: typed, or picked. */
  stepAction: ParameterStepAction | null;
  /** The page its field was seen on, or null. */
  pageUrl: string | null;
  /** The form or dialog its field sits in, or null. */
  containerName: string | null;
  /** The parameters it sits beside (an added field fits a version that has one of them). */
  besideKeys: string[];
  /** The parameter an added field is typed after, or null. */
  fillAfterKey: string | null;
  /** The user's required choice, or null for "let the page decide". */
  userRequiredChoice: RequiredChoice | null;
  /** The latest run's reading of its required flag, or null when unknown. */
  runIsRequired: boolean | null;
  /** When that reading was taken. */
  runReadAt: Date | null;
  /** The latest crawl's reading, or null when unknown. */
  crawlIsRequired: boolean | null;
  /** When that crawl ran. */
  crawlReadAt: Date | null;
  /** The object type of an `object` parameter, or null. */
  objectTypeKey: string | null;
  /** The literal a "value in the steps" parameter replaces, or null. */
  matchText: string | null;
  /** Where that literal may appear. */
  matchFields: ParameterUseField[];
}

/** One step field a parameter's value is written into. */
export interface ParameterUse {
  /** The 1-based step, or `START_URL_STEP_NUMBER` for the plan's start URL. */
  stepNumber: number;
  /** Which field of the step. */
  field: ParameterUseField;
}

/** A field the steps do not fill, added as a step when the parameter has a value. */
export interface AddedFieldStep {
  /** How to find the field. */
  target: PlanTarget;
  /** How the value is put in. */
  stepAction: ParameterStepAction;
  /** The step it is typed after (1-based). */
  afterStepNumber: number;
}

/** Why a parameter is required or optional. */
export type RequiredReason = "object" | "you" | "run" | "crawl" | "default";

/** One parameter of one version, as the run form and the Parameters section show it. */
export interface VersionParameter {
  /** The row's cuid. */
  id: string;
  /** Its key - what a run's values are keyed by. */
  key: string;
  /** The name to show: the user's, or the worked-out one. */
  label: string;
  /** The worked-out name. */
  detectedLabel: string;
  /** The user's name, or null. */
  userLabel: string | null;
  /** What kind of value it holds. */
  kind: ParameterKind;
  /** Where it came from. */
  source: ParameterSource;
  /** Where it was seen. */
  foundBy: ParameterFoundBy[];
  /** True for a password-like field. */
  isSecret: boolean;
  /** Whether a run needs a value for it. */
  isRequired: boolean;
  /** Why. */
  requiredReason: RequiredReason;
  /** The user's required choice, or null. */
  userRequiredChoice: RequiredChoice | null;
  /** The value the version's steps type (empty for an added field). */
  defaultValue: string;
  /** The step fields its value is written into. */
  uses: ParameterUse[];
  /** For a field the steps do not fill: the step a value adds. */
  addedField: AddedFieldStep | null;
  /** The object type of an `object` parameter, or null. */
  objectTypeKey: string | null;
  /** The form or dialog its field sits in, or null. */
  containerName: string | null;
}

/** What the object parameter needs to bind a version's steps: the type's addresses and its known instances. */
export interface ObjectBindingContext {
  /** The type's own-page pattern (its key), or null when the action has no type. */
  instancePatternKey: string | null;
  /** Its create page patterns - an address matching one is not an instance. */
  createPatternKeys: string[];
  /** The type's known instances: crawled and created. */
  instances: ObjectChoice[];
}

/** One object an Object action can be run on. */
export interface ObjectChoice {
  /** The object's name, as the page shows it. */
  name: string;
  /** Its own page, or null when unknown. */
  url: string | null;
  /** `crawl` when the latest crawl saw it, `created` when a run of a Create action made it. */
  source: "crawl" | "created";
  /** For a created one: its `CreatedObject` row's cuid. */
  createdObjectId: string | null;
  /** For a created one: the title of the action that made it. */
  createdByActionTitle: string | null;
  /** For a created one: when it was made. */
  createdAt: Date | null;
  /** True when the latest crawl lists it (always for `crawl`). */
  seenOnCrawl: boolean;
}

/** What `applyParameterValues` produced. */
export interface AppliedParameterValues {
  /** The plan with every value written in (the same steps, numbered the same). */
  plan: ActionPlan;
  /** The steps to skip, because a blank optional parameter uses them. */
  skippedStepNumbers: number[];
  /** The steps to add for added fields with a value. */
  insertedSteps: InsertedPlanStep[];
  /** The values used, to store on the run - secrets left out, blank ones as "". */
  usedValues: UsedParameterValue[];
  /** The secret values, to scrub from the log and errors. */
  secretValues: string[];
  /** What is wrong with the values (a blank required one, an object with no address); empty when they can run. */
  problems: string[];
}

/** A step a run adds after one of the plan's steps. */
export interface InsertedPlanStep {
  /** The plan step it runs after (1-based). */
  afterStepNumber: number;
  /** The step. */
  step: PlanStep;
  /** The parameter it types. */
  parameterKey: string;
}

/** One value a run used, as stored on the run (`parameterValues`). */
export interface UsedParameterValue {
  /** The parameter's key. */
  key: string;
  /** Its label at run time. */
  label: string;
  /** The value; "" when left blank. */
  value: string;
}

/**
 * Turns a label into a parameter key: camelCase of its letters and digits
 * (`School name` → `schoolName`); `value` when nothing is left.
 * @param label - Any label
 * @returns The key
 */
export function toParameterKey(label: string): string {
  const words = label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return "value";
  const [firstWord, ...laterWords] = words;
  const key = [firstWord, ...laterWords.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)].join("");
  return /^\p{N}/u.test(key) ? `field${key}` : key;
}

/**
 * Makes a key unique among keys already taken, by numbering it (`name`,
 * `name2`, `name3`, ...).
 * @param baseKey - The wanted key
 * @param takenKeys - Keys already in use
 * @returns The first free key
 */
export function chooseFreeKey(baseKey: string, takenKeys: ReadonlySet<string>): string {
  if (!takenKeys.has(baseKey)) return baseKey;
  let suffix = 2;
  while (takenKeys.has(`${baseKey}${suffix}`)) suffix += 1;
  return `${baseKey}${suffix}`;
}

/**
 * Reads the text a target finds its element by: its label, name,
 * placeholder, text, alt text, or title.
 * @param target - A step's target
 * @returns The text, or null for a CSS target or a role with no name
 */
export function readTargetText(target: PlanTarget): string | null {
  if ("label" in target) return target.label;
  if ("role" in target) return target.name === "" ? null : target.name;
  if ("placeholder" in target) return target.placeholder;
  if ("text" in target) return target.text;
  if ("altText" in target) return target.altText;
  if ("title" in target) return target.title;
  return null;
}

/**
 * Names the field a step's target points at, from the plan alone: its text,
 * or `Value for step N` when it has none.
 * @param target - A fill or select step's target
 * @param stepNumber - The step's number
 * @returns The label
 */
export function labelFromTarget(target: PlanTarget, stepNumber: number): string {
  return readTargetText(target)?.trim() || `Value for step ${stepNumber}`;
}

/**
 * Identifies the field a target points at, so the same field is the same
 * parameter in every version: by its text (case and spacing ignored), by its
 * CSS selector, or by its role when it has no name.
 * @param target - A step's target
 * @returns The identity
 */
export function readTargetIdentity(target: PlanTarget): string {
  if ("css" in target) return `css:${target.css}`;
  const targetText = readTargetText(target);
  if (targetText !== null && targetText.trim() !== "") return `name:${toParameterKey(targetText)}`;
  return "role" in target ? `role:${target.role}` : "unknown";
}

/**
 * Reads a stored `fieldTarget` column back.
 * @param storedTarget - The column's value
 * @returns The target, or null when it is not a valid one
 */
export function readStoredTarget(storedTarget: unknown): PlanTarget | null {
  const parsed = PlanTargetSchema.safeParse(storedTarget);
  return parsed.success ? parsed.data : null;
}

/**
 * Checks whether a field is password-like, from its input type or its name.
 * @param inputType - Its input type, when known
 * @param labels - Its names (label, placeholder, ...)
 * @returns True when its value must be treated as secret
 */
export function looksSecret(inputType: string | null, labels: (string | null)[]): boolean {
  if (inputType === "password") return true;
  return labels.some((label) => label !== null && SECRET_LABEL_PATTERN.test(label));
}

/**
 * Checks whether a fill value is a credential placeholder, which is never a
 * parameter (it is the action's credential).
 * @param value - A fill step's value
 * @returns True for `{{credential.username}}` or `{{credential.password}}`
 */
export function isCredentialPlaceholder(value: string | null): boolean {
  const placeholderValues: (string | null)[] = Object.values(CREDENTIAL_PLACEHOLDERS);
  return placeholderValues.includes(value);
}

/**
 * Lists the fill and select steps of a plan a parameter could type into:
 * each with a target and a non-empty literal value that is not a credential
 * placeholder.
 * @param plan - A plan
 * @returns Each such step with its 1-based number
 */
export function listParameterSteps(plan: ActionPlan): { stepNumber: number; step: PlanStep; target: PlanTarget; value: string }[] {
  return plan.steps.flatMap((step, stepIndex) => {
    const stepTypesAValue = step.action === "fill" || step.action === "selectOption";
    const { target, value } = step;
    const stepHasALiteral = target !== null && value !== null && value !== "" && !isCredentialPlaceholder(value);
    if (!stepTypesAValue || !stepHasALiteral) return [];
    return [{ stepNumber: stepIndex + 1, step, target, value }];
  });
}

/**
 * Finds the step that submits a Create action's form - its "confirm step":
 * the first click on a button (a `button` role, or a text or title target)
 * or Enter key press after the last step that types a parameter.
 * @param plan - A version's plan
 * @returns The 1-based step number, or null when there is none
 */
export function findConfirmStepNumber(plan: ActionPlan): number | null {
  const lastTypingStepNumber = listParameterSteps(plan).at(-1)?.stepNumber;
  if (lastTypingStepNumber === undefined) return null;
  const confirmStepIndex = plan.steps.findIndex((step, stepIndex) => {
    const stepComesAfterTheTyping = stepIndex + 1 > lastTypingStepNumber;
    if (!stepComesAfterTheTyping) return false;
    const { target } = step;
    const stepClicksAButton =
      step.action === "click" &&
      target !== null &&
      (("role" in target && target.role === "button") || "text" in target || "title" in target);
    const stepPressesEnter = step.action === "press" && step.value === "Enter";
    return stepClicksAButton || stepPressesEnter;
  });
  return confirmStepIndex === -1 ? null : confirmStepIndex + 1;
}

/**
 * Works out whether a parameter is required, and why: the object always is;
 * then the user's choice; then the latest run's reading; then the latest
 * crawl's; then the default - a field a step types into is required, any
 * other optional.
 * @param row - The parameter's row
 * @param isTypedByAStep - True when a step of the version types its value
 * @returns Whether it is required, and the reason
 */
export function decideRequired(
  row: ActionParameterRecord,
  isTypedByAStep: boolean,
): { isRequired: boolean; requiredReason: RequiredReason } {
  if (row.kind === "object") return { isRequired: true, requiredReason: "object" };
  if (row.userRequiredChoice !== null) {
    return { isRequired: row.userRequiredChoice === "required", requiredReason: "you" };
  }
  if (row.runIsRequired !== null) return { isRequired: row.runIsRequired, requiredReason: "run" };
  if (row.crawlIsRequired !== null) return { isRequired: row.crawlIsRequired, requiredReason: "crawl" };
  return { isRequired: isTypedByAStep, requiredReason: "default" };
}

/**
 * Reads the text a step field holds.
 * @param plan - The plan
 * @param use - The step and field
 * @returns The text, or null when the step or field does not exist
 */
function readUseText(plan: ActionPlan, use: ParameterUse): string | null {
  if (use.stepNumber === START_URL_STEP_NUMBER) return use.field === "url" ? plan.startUrl : null;
  const step = plan.steps.at(use.stepNumber - 1);
  if (step === undefined) return null;
  const { target } = step;
  switch (use.field) {
    case "value":
      return step.value;
    case "url":
      return step.action === "goto" ? step.value : null;
    case "targetName":
      return target !== null && "role" in target ? target.name : null;
    case "targetText":
      return target !== null && "text" in target ? target.text : null;
  }
}

/**
 * Lists every step field of a plan that holds exactly some text (for a
 * `url` field: contains it), in the fields allowed.
 * @param plan - The plan
 * @param text - The text to look for
 * @param allowedFields - Where it may appear
 * @returns The fields that hold it
 */
export function findTextUses(plan: ActionPlan, text: string, allowedFields: readonly ParameterUseField[]): ParameterUse[] {
  const candidateUses: ParameterUse[] = [
    { stepNumber: START_URL_STEP_NUMBER, field: "url" },
    ...plan.steps.flatMap((_step, stepIndex) =>
      PARAMETER_USE_FIELDS.map((field) => ({ stepNumber: stepIndex + 1, field })),
    ),
  ];
  return candidateUses.filter((use) => {
    if (!allowedFields.includes(use.field)) return false;
    const useText = readUseText(plan, use);
    if (useText === null) return false;
    return use.field === "url" ? useText.includes(text) : useText === text;
  });
}

/**
 * Identifies a step field, so two parameters never bind the same one.
 * @param use - A step field
 * @returns `stepNumber:field`
 */
function describeUse(use: ParameterUse): string {
  return `${use.stepNumber}:${use.field}`;
}

/**
 * Checks whether a typed value may be bound to later steps that repeat it:
 * long enough, with a letter, and not secret.
 * @param value - The typed value
 * @param isSecret - True for a password-like parameter
 * @returns True when echoes may be bound
 */
function valueCanBeEchoed(value: string, isSecret: boolean): boolean {
  return !isSecret && value.length >= MIN_ECHO_VALUE_LENGTH && /\p{L}/u.test(value);
}

/**
 * Finds the later steps that repeat a typed value in their target - a check
 * of the heading just named, a click on the row just created - so they
 * follow the value when it changes.
 * @param plan - The plan
 * @param value - The typed value
 * @param afterStepNumber - Only steps after this one count
 * @returns The `targetName` / `targetText` uses
 */
function findEchoUses(plan: ActionPlan, value: string, afterStepNumber: number): ParameterUse[] {
  return plan.steps.flatMap((step, stepIndex): ParameterUse[] => {
    const stepNumber = stepIndex + 1;
    const { target } = step;
    const stepCanEcho = stepNumber > afterStepNumber && ECHO_STEP_ACTIONS.has(step.action) && target !== null;
    if (!stepCanEcho) return [];
    if ("role" in target && target.name === value) return [{ stepNumber, field: "targetName" }];
    if ("text" in target && target.text === value) return [{ stepNumber, field: "targetText" }];
    return [];
  });
}

/**
 * Reads the identity of an address - origin + path, the way the crawler
 * records pages (see `normalizeCrawlUrl`) - for comparing pages.
 * @param url - An address, absolute or relative to `baseUrl`
 * @param baseUrl - What a relative address is resolved against (defaults to the address itself)
 * @returns The identity, or null when it is not an http(s) address
 */
export function readPageIdentity(url: string, baseUrl: string = url): string | null {
  return normalizeCrawlUrl(url, baseUrl)?.identityUrl ?? null;
}

/**
 * Checks whether an address is one object's own page: it fits the type's
 * instance pattern, and none of its create patterns (`/projects/new` fits
 * `/projects/{project}` too).
 * @param url - An absolute address
 * @param context - The type's patterns
 * @returns True for an instance page
 */
export function isInstanceAddress(url: string, context: ObjectBindingContext): boolean {
  const { instancePatternKey } = context;
  if (instancePatternKey === null) return false;
  const fitsTheInstancePattern = urlMatchesPatternKey(url, instancePatternKey);
  const fitsACreatePattern = context.createPatternKeys.some((patternKey) => urlMatchesPatternKey(url, patternKey));
  return fitsTheInstancePattern && !fitsACreatePattern;
}

/**
 * Binds an Object action's object parameter to a version's steps: the start
 * URL or `goto` steps that open one instance's page (`url` uses), and the
 * link or text targets that name a known instance, plus the later steps that
 * repeat that name.
 * @param plan - The version's plan
 * @param context - The type's patterns and known instances
 * @param takenUses - Step fields other parameters already bound
 * @returns The uses and the default value (the named instance)
 */
function bindObjectParameter(
  plan: ActionPlan,
  context: ObjectBindingContext,
  takenUses: ReadonlySet<string>,
): { uses: ParameterUse[]; defaultValue: string } {
  const instanceNames = new Set(context.instances.map((instance) => instance.name));
  const uses: ParameterUse[] = [];
  let defaultValue = "";
  const addressedInstanceName = (url: string): string => {
    const pageIdentity = readPageIdentity(url);
    return context.instances.find((instance) => instance.url !== null && readPageIdentity(instance.url) === pageIdentity)?.name ?? "";
  };
  if (isInstanceAddress(plan.startUrl, context)) {
    uses.push({ stepNumber: START_URL_STEP_NUMBER, field: "url" });
    defaultValue = addressedInstanceName(plan.startUrl);
  }
  plan.steps.forEach((step, stepIndex) => {
    const stepNumber = stepIndex + 1;
    const { target, value } = step;
    if (step.action === "goto" && value !== null && isInstanceAddress(value, context)) {
      uses.push({ stepNumber, field: "url" });
      if (defaultValue === "") defaultValue = addressedInstanceName(value);
      return;
    }
    const namedInstance = target === null ? null : readTargetText(target);
    const targetNamesAnInstance =
      target !== null &&
      namedInstance !== null &&
      (("role" in target && target.role === "link") || "text" in target) &&
      instanceNames.has(namedInstance);
    if (!targetNamesAnInstance) return;
    const field: ParameterUseField = "role" in target ? "targetName" : "targetText";
    const use = { stepNumber, field };
    if (takenUses.has(describeUse(use))) return;
    uses.push(use);
    if (defaultValue === "") defaultValue = namedInstance;
    const echoUses = findEchoUses(plan, namedInstance, stepNumber).filter(
      (echoUse) => !takenUses.has(describeUse(echoUse)) && !uses.some((bound) => describeUse(bound) === describeUse(echoUse)),
    );
    uses.push(...echoUses);
  });
  return { uses, defaultValue };
}

/**
 * Builds the shown form of one row for one version.
 * @param row - The parameter's row
 * @param binding - Its uses, default, and added field in this version
 * @param binding.uses - The step fields it writes
 * @param binding.defaultValue - The value the version types
 * @param binding.addedField - The step a value adds, for a field the steps do not fill
 * @returns The version parameter
 */
function toVersionParameter(
  row: ActionParameterRecord,
  binding: { uses: ParameterUse[]; defaultValue: string; addedField: AddedFieldStep | null },
): VersionParameter {
  const isTypedByAStep = binding.addedField === null;
  return {
    id: row.id,
    key: row.key,
    label: row.userLabel ?? row.label,
    detectedLabel: row.label,
    userLabel: row.userLabel,
    kind: row.kind,
    source: row.source,
    foundBy: row.foundBy,
    isSecret: row.isSecret,
    ...decideRequired(row, isTypedByAStep),
    userRequiredChoice: row.userRequiredChoice,
    defaultValue: binding.defaultValue,
    uses: binding.uses,
    addedField: binding.addedField,
    objectTypeKey: row.objectTypeKey,
    containerName: row.containerName,
  };
}

/**
 * Works out one version's parameters from the action's rows - which rows fit
 * the version, which of its step fields each writes, and the value it types
 * (both read from the plan, never stored):
 * 1. the user's "value in the steps" rows bind every field holding their text;
 * 2. the object row (Object actions) binds the instance the steps open or name;
 * 3. each `steps` row binds the fill or select steps whose target is its
 *    field, plus later steps that repeat the typed value;
 * 4. `page` rows, and the user's "field the steps don't fill" rows, fit when
 *    the version types one of the parameters they sit beside, and add a step
 *    after the last such step.
 * A field bound by an earlier rule is never bound again (the user's take
 * over). A row that binds nothing in this version is left out.
 * @param plan - The version's plan
 * @param rows - The action's active parameter rows
 * @param actionKind - The action's kind (the object row only counts for `object`)
 * @param objectContext - The object type's patterns and known instances
 * @returns The version's parameters, in step order (added fields after the steps they follow)
 */
export function resolveVersionParameters(
  plan: ActionPlan,
  rows: ActionParameterRecord[],
  actionKind: ActionKind,
  objectContext: ObjectBindingContext,
): VersionParameter[] {
  const takenUses = new Set<string>();
  const parameters: VersionParameter[] = [];
  const claimUses = (uses: ParameterUse[]): ParameterUse[] => {
    const freeUses = uses.filter((use) => !takenUses.has(describeUse(use)));
    freeUses.forEach((use) => takenUses.add(describeUse(use)));
    return freeUses;
  };

  for (const row of rows.filter((candidate) => candidate.source === "you" && candidate.matchText !== null)) {
    const uses = claimUses(findTextUses(plan, row.matchText ?? "", row.matchFields));
    if (uses.length > 0) parameters.push(toVersionParameter(row, { uses, defaultValue: row.matchText ?? "", addedField: null }));
  }

  const objectRow = rows.find((row) => row.kind === "object" && row.source !== "you");
  if (objectRow !== undefined && actionKind === "object") {
    const objectBinding = bindObjectParameter(plan, objectContext, takenUses);
    const uses = claimUses(objectBinding.uses);
    if (uses.length > 0) {
      parameters.push(toVersionParameter(objectRow, { uses, defaultValue: objectBinding.defaultValue, addedField: null }));
    }
  }

  const parameterSteps = listParameterSteps(plan);
  const stepRows = rows.filter((row) => row.source === "steps" && row.kind !== "object" && row.fieldTarget !== null);
  const lastStepNumberByKey = new Map<string, number>();
  for (const row of stepRows) {
    const rowIdentity = row.fieldTarget === null ? null : readTargetIdentity(row.fieldTarget);
    const filledSteps = parameterSteps.filter((parameterStep) => readTargetIdentity(parameterStep.target) === rowIdentity);
    const valueUses = claimUses(filledSteps.map((filledStep) => ({ stepNumber: filledStep.stepNumber, field: "value" as const })));
    if (valueUses.length === 0) continue;
    const defaultValue = readUseText(plan, valueUses[0]) ?? "";
    const echoUses = valueCanBeEchoed(defaultValue, row.isSecret)
      ? claimUses(findEchoUses(plan, defaultValue, valueUses[0].stepNumber))
      : [];
    lastStepNumberByKey.set(row.key, Math.max(...valueUses.map((use) => use.stepNumber)));
    parameters.push(toVersionParameter(row, { uses: [...valueUses, ...echoUses], defaultValue, addedField: null }));
  }

  const versionFieldIdentities = new Set(parameterSteps.map((parameterStep) => readTargetIdentity(parameterStep.target)));
  const fieldRows = rows.filter(
    (row) => (row.source === "page" || (row.source === "you" && row.matchText === null)) && row.fieldTarget !== null,
  );
  for (const row of fieldRows) {
    const { fieldTarget } = row;
    if (fieldTarget === null || versionFieldIdentities.has(readTargetIdentity(fieldTarget))) continue;
    const anchorKeys = row.source === "you" ? [row.fillAfterKey ?? ""] : row.besideKeys;
    const anchorStepNumbers = anchorKeys.flatMap((anchorKey) => {
      const anchorStepNumber = lastStepNumberByKey.get(anchorKey);
      return anchorStepNumber === undefined ? [] : [anchorStepNumber];
    });
    if (anchorStepNumbers.length === 0) continue;
    const addedField: AddedFieldStep = {
      target: fieldTarget,
      stepAction: row.stepAction ?? "fill",
      afterStepNumber: Math.max(...anchorStepNumbers),
    };
    parameters.push(toVersionParameter(row, { uses: [], defaultValue: "", addedField }));
  }

  const firstStepNumberOf = (parameter: VersionParameter): number =>
    parameter.addedField === null
      ? Math.min(...parameter.uses.map((use) => use.stepNumber))
      : parameter.addedField.afterStepNumber + 0.5;
  return parameters.sort((first, second) => firstStepNumberOf(first) - firstStepNumberOf(second));
}

/**
 * Picks the parameter that names what a Create action makes: the user's
 * choice when it fits the version; otherwise the one the plan checks after
 * the confirm step (it repeats the typed name); otherwise the one labelled
 * like a name or title; otherwise the first typed text.
 * @param parameters - The version's parameters
 * @param confirmStepNumber - The version's confirm step, or null
 * @param userNameParameterKey - The user's choice, or null
 * @returns The parameter's key, or null when the version types no text
 */
export function chooseNameParameterKey(
  parameters: VersionParameter[],
  confirmStepNumber: number | null,
  userNameParameterKey: string | null,
): string | null {
  const textParameters = parameters.filter(
    (parameter) => parameter.kind === "text" && !parameter.isSecret && parameter.addedField === null,
  );
  const usersChoice = textParameters.find((parameter) => parameter.key === userNameParameterKey);
  if (usersChoice !== undefined) return usersChoice.key;
  const checkedAfterConfirming = textParameters.find((parameter) =>
    parameter.uses.some(
      (use) => use.field !== "value" && (confirmStepNumber === null || use.stepNumber > confirmStepNumber),
    ),
  );
  if (checkedAfterConfirming !== undefined) return checkedAfterConfirming.key;
  const labelledLikeAName = textParameters.find((parameter) => /\b(name|title)\b/i.test(parameter.label));
  return labelledLikeAName?.key ?? textParameters.at(0)?.key ?? null;
}

/**
 * Writes one value into one step field of a plan copy.
 * @param plan - The plan copy (changed in place)
 * @param use - The step field
 * @param value - The new value (for a user's URL value, it replaces `replacedText` inside the address)
 * @param replacedText - The text a `url` use replaces, or null to replace the whole address
 */
function writeUse(plan: ActionPlan, use: ParameterUse, value: string, replacedText: string | null): void {
  if (use.stepNumber === START_URL_STEP_NUMBER) {
    plan.startUrl = replacedText === null ? value : plan.startUrl.replaceAll(replacedText, value);
    return;
  }
  const step = plan.steps.at(use.stepNumber - 1);
  if (step === undefined) return;
  const { target } = step;
  switch (use.field) {
    case "value":
      step.value = value;
      return;
    case "url":
      step.value = replacedText === null ? value : (step.value ?? "").replaceAll(replacedText, value);
      return;
    case "targetName":
      if (target !== null && "role" in target) step.target = { role: target.role, name: value };
      return;
    case "targetText":
      if (target !== null && "text" in target) step.target = { text: value };
      return;
  }
}

/**
 * Finds the object choice a value names (exactly, then ignoring case and
 * spacing).
 * @param value - The chosen name
 * @param choices - The known objects
 * @returns The choice, or undefined when none has that name
 */
function findChoiceByName(value: string, choices: ObjectChoice[]): ObjectChoice | undefined {
  return (
    choices.find((choice) => choice.name === value) ??
    choices.find((choice) => normalizeFieldName(choice.name) === normalizeFieldName(value))
  );
}

/**
 * Puts a run's values into a version's plan. A key that is not given keeps
 * the version's own value. For each parameter:
 * - a blank value: a required one is a problem; an optional one skips every
 *   step it is used in (an added field simply adds no step);
 * - an object's value is written into the steps that name it, and - for a
 *   version that opens it by its address - replaced by the chosen object's
 *   address, which only a listed object has (a typed name it does not know
 *   is a problem);
 * - any other value is written into each of its step fields, or, for an
 *   added field, typed in a new step after its anchor step.
 * Secret values are left out of `usedValues` and listed in `secretValues`.
 * The plan the caller gets is a copy; the version is never changed.
 * @param plan - The version's plan
 * @param parameters - Its parameters (see `resolveVersionParameters`)
 * @param values - The run's values, by key
 * @param objectChoices - The known objects of the action's type
 * @returns The plan with the values in, the steps to skip and add, the values to store, the secrets, and any problems
 */
export function applyParameterValues(
  plan: ActionPlan,
  parameters: VersionParameter[],
  values: Readonly<Record<string, string>>,
  objectChoices: ObjectChoice[],
): AppliedParameterValues {
  const appliedPlan: ActionPlan = structuredClone(plan);
  const skippedStepNumbers = new Set<number>();
  const insertedSteps: InsertedPlanStep[] = [];
  const usedValues: UsedParameterValue[] = [];
  const secretValues: string[] = [];
  const problems: string[] = [];

  for (const parameter of parameters) {
    const valueWasGiven = Object.hasOwn(values, parameter.key);
    const value = valueWasGiven ? values[parameter.key] : parameter.defaultValue;
    const valueIsBlank = value.trim() === "";
    if (parameter.isSecret) {
      if (!valueIsBlank) secretValues.push(value);
    } else {
      usedValues.push({ key: parameter.key, label: parameter.label, value: valueIsBlank ? "" : value });
    }

    if (valueIsBlank) {
      if (parameter.isRequired) {
        problems.push(`"${parameter.label}" is required`);
        continue;
      }
      const startUrlUsesIt = parameter.uses.some((use) => use.stepNumber === START_URL_STEP_NUMBER);
      if (startUrlUsesIt) {
        problems.push(`"${parameter.label}" is in the start address, so it cannot be left blank`);
        continue;
      }
      parameter.uses.forEach((use) => skippedStepNumbers.add(use.stepNumber));
      continue;
    }

    if (parameter.addedField !== null) {
      insertedSteps.push({
        afterStepNumber: parameter.addedField.afterStepNumber,
        step: { action: parameter.addedField.stepAction, target: parameter.addedField.target, value },
        parameterKey: parameter.key,
      });
      continue;
    }

    const urlUses = parameter.uses.filter((use) => use.field === "url");
    const isAWholeAddressObject = parameter.kind === "object" && urlUses.length > 0;
    const valueIsTheVersionsOwn = value === parameter.defaultValue;
    if (isAWholeAddressObject && !valueIsTheVersionsOwn) {
      const choice = findChoiceByName(value, objectChoices);
      if (choice === undefined || choice.url === null) {
        problems.push(
          `This version opens the ${parameter.label} by its address, so pick one of the listed ones - "${value}" has no known address`,
        );
        continue;
      }
      urlUses.forEach((use) => {
        writeUse(appliedPlan, use, choice.url ?? "", null);
      });
    }
    const replacedUrlText = parameter.kind === "object" ? null : parameter.defaultValue;
    for (const use of parameter.uses) {
      const useIsAnObjectAddress = use.field === "url" && parameter.kind === "object";
      if (useIsAnObjectAddress) continue;
      writeUse(appliedPlan, use, value, use.field === "url" ? replacedUrlText : null);
    }
  }

  return {
    plan: appliedPlan,
    skippedStepNumbers: [...skippedStepNumbers].sort((first, second) => first - second),
    insertedSteps,
    usedValues,
    secretValues,
    problems,
  };
}

/**
 * Lays out the steps a run really walks: the plan's steps minus the skipped
 * ones, with each inserted step after the step it follows - so the whole can
 * be validated like any plan.
 * @param applied - From `applyParameterValues`
 * @returns The plan with that list of steps
 */
export function expandAppliedPlan(applied: AppliedParameterValues): ActionPlan {
  const skippedStepNumbers = new Set(applied.skippedStepNumbers);
  const expandedSteps = applied.plan.steps.flatMap((step, stepIndex) => {
    const stepNumber = stepIndex + 1;
    const keptStep = skippedStepNumbers.has(stepNumber) ? [] : [step];
    const followingSteps = applied.insertedSteps
      .filter((insertedStep) => insertedStep.afterStepNumber === stepNumber)
      .map((insertedStep) => insertedStep.step);
    return [...keptStep, ...followingSteps];
  });
  return { ...applied.plan, steps: expandedSteps };
}

/**
 * Reads a run's stored values (`parameterValues`). The column is JSON, so
 * only `{ key, label, value }` entries of text are kept; runs from before
 * parameters have none.
 * @param storedValues - The column's value
 * @returns The values, in order
 */
export function readUsedParameterValues(storedValues: unknown): UsedParameterValue[] {
  if (!Array.isArray(storedValues)) return [];
  const storedEntries: unknown[] = storedValues;
  return storedEntries.filter(
    (storedValue): storedValue is UsedParameterValue =>
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

/**
 * Lists the values a version's steps can be bound to by the user ("a value in
 * the steps"): every typed value, link or button name, text target, and the
 * start address - each with the fields it appears in.
 * @param plan - The version's plan
 * @returns Each distinct text once, with its fields
 */
export function listBindableTexts(plan: ActionPlan): { text: string; fields: ParameterUseField[] }[] {
  const fieldsByText = new Map<string, Set<ParameterUseField>>();
  const addText = (text: string | null, field: ParameterUseField): void => {
    if (text === null || text.trim() === "" || isCredentialPlaceholder(text)) return;
    const fields = fieldsByText.get(text) ?? new Set<ParameterUseField>();
    fields.add(field);
    fieldsByText.set(text, fields);
  };
  for (const step of plan.steps) {
    const { target } = step;
    if (step.action === "fill" || step.action === "selectOption") addText(step.value, "value");
    if (step.action === "goto") addText(step.value, "url");
    if (target !== null && "role" in target) addText(target.name, "targetName");
    if (target !== null && "text" in target) addText(target.text, "targetText");
  }
  return [...fieldsByText.entries()].map(([text, fields]) => ({ text, fields: [...fields] }));
}
