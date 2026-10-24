import type { ActionPlan, PlanTarget } from "./actionPlanSchema.js";
import {
  OBJECT_PARAMETER_KEY,
  chooseFreeKey,
  labelFromTarget,
  listParameterSteps,
  looksSecret,
  readTargetIdentity,
  toParameterKey,
  type ParameterFoundBy,
  type ParameterKind,
  type ParameterStepAction,
} from "./actionParameters.js";
import {
  interpretRequiredReading,
  matchFieldToTarget,
  normalizeFieldName,
  type FormField,
} from "./formFields.js";
import { readAriaSnapshotOutline } from "./readAriaSnapshotFields.js";
import type { ActionKind } from "./scoreActionObjectRole.js";

/** One crawled page, as detection reads it: its address, aria snapshot, and form fields. */
export interface DetectionPage {
  /** The page's identity (origin + path). */
  url: string;
  /** Its aria snapshot, or null. */
  ariaSnapshot: string | null;
  /** The form fields the crawler read (empty for pages crawled before they were read). */
  formFields: FormField[];
}

/** What the runner read around one step it typed into. */
export interface RunFieldReading {
  /** The plan step it typed into (1-based). */
  stepNumber: number;
  /** The address the browser was on. */
  pageUrl: string;
  /** The fields of that step's form or dialog. */
  fields: FormField[];
  /** Which of them the step typed into, or -1 when unknown. */
  targetFieldIndex: number;
}

/** Everything one detection reads. */
export interface ParameterDetectionInput {
  /** The plans of the action's live versions, newest first. */
  versionPlans: ActionPlan[];
  /** The latest crawl's pages the versions visit. */
  pages: DetectionPage[];
  /** The aria snapshots of the pages the action's runs failed on (they show dialogs the crawler never opens). */
  failingPageSnapshots: { url: string | null; ariaSnapshot: string }[];
  /** The readings of the run that triggered this detection, with that run's plan; null when no run did. */
  runReadings: { plan: ActionPlan; readings: RunFieldReading[] } | null;
  /** The action's resolved kind and object type. */
  role: { kind: ActionKind; objectTypeKey: string | null; objectTypeName: string | null };
  /** Keys taken by the user's own rows, which detection must not use. */
  reservedKeys: string[];
}

/** One row detection says the action should have. */
export interface DetectedParameter {
  /** Its key. */
  key: string;
  /** Its kind. */
  kind: ParameterKind;
  /** `steps` (a step types into it) or `page` (it sits beside such a field). */
  source: "steps" | "page";
  /** Where it was seen. */
  foundBy: ParameterFoundBy[];
  /** True for a password-like field. */
  isSecret: boolean;
  /** Its worked-out name. */
  label: string;
  /** How to find its field (null for the object). */
  fieldTarget: PlanTarget | null;
  /** Its field's role, when known. */
  fieldRole: string | null;
  /** Its field's input type, when known. */
  inputType: string | null;
  /** Its field's placeholder, when known. */
  placeholder: string | null;
  /** How its value is put in (null for the object). */
  stepAction: ParameterStepAction | null;
  /** The page its field was seen on, or null. */
  pageUrl: string | null;
  /** The form or dialog it sits in, or null. */
  containerName: string | null;
  /** The `steps` parameters it sits beside (for a `page` row). */
  besideKeys: string[];
  /** The parameter it is typed after (for a `page` row), or null. */
  fillAfterKey: string | null;
  /** The latest crawl's required reading, or null when it has none. */
  crawlIsRequired: boolean | null;
  /** The triggering run's reading, or undefined when that run did not read this field (keep the stored one). */
  runIsRequired: boolean | null | undefined;
  /** The object type, for the object row. */
  objectTypeKey: string | null;
}

/**
 * One field as any source saw it, in one common shape - the crawler's and the
 * runner's own, which an aria snapshot's fields are put into (with
 * `isRequired` false: a snapshot cannot say).
 */
type ObservedField = FormField;

/** One read of a page's fields: from a crawled snapshot, the crawler's fields, or a run. */
interface FieldRead {
  /** The page's address. */
  pageUrl: string;
  /** Which source read it. */
  foundBy: ParameterFoundBy;
  /** The fields. */
  fields: ObservedField[];
  /** For a run's reading: the plan step it typed into, with the field it typed into. */
  runStep: { plan: ActionPlan; stepNumber: number; targetFieldIndex: number } | null;
}

/** A `steps` row while it is being built. */
interface StepsRowDraft {
  /** The row so far. */
  row: DetectedParameter;
  /** Every target the versions use for its field. */
  targets: PlanTarget[];
  /** Its identity (see `readTargetIdentity`). */
  identity: string;
}

/**
 * Turns the fields a source read into reads detection can compare: the
 * crawler's form fields, the aria snapshots (crawled and failing pages,
 * disabled fields left out), and the triggering run's readings.
 * @param input - The detection's input
 * @returns Every read, the run's first
 */
function collectFieldReads(input: ParameterDetectionInput): FieldRead[] {
  const reads: FieldRead[] = [];
  for (const reading of input.runReadings?.readings ?? []) {
    reads.push({
      pageUrl: reading.pageUrl,
      foundBy: "run",
      fields: reading.fields,
      runStep: {
        plan: input.runReadings?.plan ?? { name: "", startUrl: "", steps: [] },
        stepNumber: reading.stepNumber,
        targetFieldIndex: reading.targetFieldIndex,
      },
    });
  }
  for (const page of input.pages) {
    if (page.formFields.length > 0) {
      reads.push({ pageUrl: page.url, foundBy: "crawl", fields: page.formFields, runStep: null });
    }
  }
  const snapshots = [
    ...input.pages.flatMap((page) => (page.ariaSnapshot === null ? [] : [{ url: page.url, ariaSnapshot: page.ariaSnapshot }])),
    ...input.failingPageSnapshots.map((snapshot) => ({ url: snapshot.url ?? "", ariaSnapshot: snapshot.ariaSnapshot })),
  ];
  for (const snapshot of snapshots) {
    const snapshotFields = readAriaSnapshotOutline(snapshot.ariaSnapshot)
      .fields.filter((field) => !field.isDisabled)
      .map((field): ObservedField => ({
        role: field.role,
        inputType: null,
        label: field.name,
        placeholder: field.placeholder,
        isRequired: false,
        containerNumber: field.containerNumber,
        containerName: field.containerName,
      }));
    if (snapshotFields.length > 0) {
      reads.push({ pageUrl: snapshot.url, foundBy: "snapshot", fields: snapshotFields, runStep: null });
    }
  }
  return reads;
}

/**
 * Decides how a field's value is put in: picked for a native select (or a
 * combo or list box whose element is unknown), typed for anything else.
 * @param field - The observed field
 * @returns `selectOption` or `fill`
 */
function chooseStepAction(field: ObservedField): ParameterStepAction {
  const fieldIsAList = field.role === "combobox" || field.role === "listbox";
  if (field.inputType === "select") return "selectOption";
  return fieldIsAList && field.inputType === null ? "selectOption" : "fill";
}

/**
 * Builds a target for a field the steps do not fill: by its label, else its
 * placeholder.
 * @param field - The observed field
 * @returns The target, or null for a field with neither (it cannot be found)
 */
function buildFieldTarget(field: ObservedField): PlanTarget | null {
  if (field.label !== null) return { label: field.label };
  if (field.placeholder !== null) return { placeholder: field.placeholder };
  return null;
}

/**
 * Adds a source to a row's `foundBy`, once.
 * @param row - The row (changed in place)
 * @param foundBy - The source
 */
function addFoundBy(row: DetectedParameter, foundBy: ParameterFoundBy): void {
  if (!row.foundBy.includes(foundBy)) row.foundBy.push(foundBy);
}

/**
 * Builds the `steps` rows: one per field the versions' fill and select steps
 * type a literal into (credential placeholders never count), newest version
 * first, so the same field in several versions is one row. Its label and key
 * come from the plan alone; a `{placeholder}` target's label is improved
 * later from the page.
 * @param input - The detection's input
 * @param takenKeys - Keys already in use (changed in place)
 * @returns The drafts, in the newest version's step order
 */
function draftStepsRows(input: ParameterDetectionInput, takenKeys: Set<string>): StepsRowDraft[] {
  const draftsByIdentity = new Map<string, StepsRowDraft>();
  for (const plan of input.versionPlans) {
    for (const { stepNumber, step, target } of listParameterSteps(plan)) {
      const identity = readTargetIdentity(target);
      const existingDraft = draftsByIdentity.get(identity);
      if (existingDraft !== undefined) {
        existingDraft.targets.push(target);
        continue;
      }
      const label = labelFromTarget(target, stepNumber);
      const key = chooseFreeKey(toParameterKey(label), takenKeys);
      takenKeys.add(key);
      const stepAction: ParameterStepAction = step.action === "selectOption" ? "selectOption" : "fill";
      draftsByIdentity.set(identity, {
        identity,
        targets: [target],
        row: {
          key,
          kind: stepAction === "selectOption" ? "option" : "text",
          source: "steps",
          foundBy: ["plan"],
          isSecret: looksSecret(null, [label]),
          label,
          fieldTarget: target,
          fieldRole: null,
          inputType: null,
          placeholder: "placeholder" in target ? target.placeholder : null,
          stepAction,
          pageUrl: null,
          containerName: null,
          besideKeys: [],
          fillAfterKey: null,
          crawlIsRequired: null,
          runIsRequired: undefined,
          objectTypeKey: null,
        },
      });
    }
  }
  return [...draftsByIdentity.values()];
}

/**
 * Finds which field of a read a `steps` row is: for a run's reading of that
 * row's own step, the field the runner typed into; otherwise the first of the
 * row's targets that matches a field (see `matchFieldToTarget`).
 * @param draft - The row
 * @param read - The read
 * @returns The field's position in the read, or -1
 */
function findDraftField(draft: StepsRowDraft, read: FieldRead): number {
  const { runStep } = read;
  if (runStep !== null) {
    const typedStep = runStep.plan.steps.at(runStep.stepNumber - 1);
    const readIsOfThisRowsStep =
      typedStep?.target !== undefined && typedStep.target !== null && readTargetIdentity(typedStep.target) === draft.identity;
    return readIsOfThisRowsStep ? runStep.targetFieldIndex : -1;
  }
  for (const target of draft.targets) {
    const fieldIndex = matchFieldToTarget(target, read.fields, (field) => ({ label: field.label, placeholder: field.placeholder }));
    if (fieldIndex !== -1) return fieldIndex;
  }
  return -1;
}

/**
 * Detects an action's parameters with no LLM - the rows the action should
 * have, apart from the user's own:
 * - a `steps` row per field the versions type into (see `draftStepsRows`);
 * - for an Object action with an object type, the `object` row;
 * - a `page` row per other text or select field in the same form or dialog
 *   as a `steps` row's field, from every read of the pages: the aria
 *   snapshots (no re-crawl needed), the crawler's form fields, and the
 *   triggering run's readings. A field with neither a label nor a
 *   placeholder cannot be found, so it is skipped.
 * Each row gets the required readings of the reads that found its field
 * (see `interpretRequiredReading`), its page, its container, and whether it
 * is secret (a password input, or a password-like name).
 * @param input - The versions, pages, snapshots, readings, role, and reserved keys
 * @returns The detected rows: `steps` rows, the object row, then `page` rows
 */
export function detectActionParameters(input: ParameterDetectionInput): DetectedParameter[] {
  const takenKeys = new Set([...input.reservedKeys, OBJECT_PARAMETER_KEY]);
  const stepDrafts = draftStepsRows(input, takenKeys);
  const reads = collectFieldReads(input);
  const pageRowsByKey = new Map<string, DetectedParameter>();
  const stepKeyOrder = stepDrafts.map((draft) => draft.row.key);

  for (const read of reads) {
    const matchedFieldIndexes = new Map<number, StepsRowDraft>();
    for (const draft of stepDrafts) {
      const fieldIndex = findDraftField(draft, read);
      if (fieldIndex !== -1 && !matchedFieldIndexes.has(fieldIndex)) matchedFieldIndexes.set(fieldIndex, draft);
    }
    for (const [fieldIndex, draft] of matchedFieldIndexes) {
      const field = read.fields[fieldIndex];
      const { row } = draft;
      addFoundBy(row, read.foundBy);
      row.fieldRole ??= field.role;
      row.inputType ??= field.inputType;
      row.placeholder ??= field.placeholder;
      row.pageUrl ??= read.pageUrl;
      row.containerName ??= field.containerName;
      row.isSecret ||= looksSecret(field.inputType, [field.label, field.placeholder]);
      const targetIsAPlaceholder = row.fieldTarget !== null && "placeholder" in row.fieldTarget;
      if (targetIsAPlaceholder && read.foundBy === "snapshot" && field.label !== null && row.label === row.placeholder) {
        row.label = field.label;
      }
      if (read.foundBy === "crawl") {
        row.crawlIsRequired ??= interpretRequiredReading(read.fields, fieldIndex);
      }
      if (read.foundBy === "run") {
        row.runIsRequired = interpretRequiredReading(read.fields, fieldIndex);
      }
    }

    const matchedContainers = new Map<number, string[]>();
    for (const [fieldIndex, draft] of matchedFieldIndexes) {
      const containerNumber = read.fields[fieldIndex].containerNumber;
      matchedContainers.set(containerNumber, [...(matchedContainers.get(containerNumber) ?? []), draft.row.key]);
    }
    read.fields.forEach((field, fieldIndex) => {
      const besideKeys = matchedContainers.get(field.containerNumber);
      const fieldIsAStepsField = matchedFieldIndexes.has(fieldIndex);
      const fieldTarget = buildFieldTarget(field);
      if (besideKeys === undefined || fieldIsAStepsField || fieldTarget === null) return;
      const label = field.label ?? field.placeholder ?? "";
      const baseKey = toParameterKey(label);
      const keyIsAStepsKey = stepDrafts.some(
        (draft) => draft.row.key === baseKey || normalizeFieldName(draft.row.label) === normalizeFieldName(label),
      );
      if (keyIsAStepsKey || input.reservedKeys.includes(baseKey) || baseKey === OBJECT_PARAMETER_KEY) return;
      const existingRow = pageRowsByKey.get(baseKey);
      const row: DetectedParameter = existingRow ?? {
        key: baseKey,
        kind: chooseStepAction(field) === "selectOption" ? "option" : "text",
        source: "page",
        foundBy: [],
        isSecret: false,
        label,
        fieldTarget,
        fieldRole: field.role,
        inputType: field.inputType,
        placeholder: field.placeholder,
        stepAction: chooseStepAction(field),
        pageUrl: read.pageUrl,
        containerName: field.containerName,
        besideKeys: [],
        fillAfterKey: null,
        crawlIsRequired: null,
        runIsRequired: undefined,
        objectTypeKey: null,
      };
      addFoundBy(row, read.foundBy);
      row.inputType ??= field.inputType;
      row.isSecret ||= looksSecret(field.inputType, [field.label, field.placeholder]);
      row.besideKeys = [...new Set([...row.besideKeys, ...besideKeys])].sort(
        (first, second) => stepKeyOrder.indexOf(first) - stepKeyOrder.indexOf(second),
      );
      row.fillAfterKey = row.besideKeys.at(-1) ?? null;
      if (read.foundBy === "crawl") row.crawlIsRequired ??= interpretRequiredReading(read.fields, fieldIndex);
      if (read.foundBy === "run") row.runIsRequired = interpretRequiredReading(read.fields, fieldIndex);
      pageRowsByKey.set(baseKey, row);
    });
  }

  const { role } = input;
  const objectRows: DetectedParameter[] =
    role.kind === "object" && role.objectTypeKey !== null
      ? [
          {
            key: OBJECT_PARAMETER_KEY,
            kind: "object",
            source: "steps",
            foundBy: ["plan"],
            isSecret: false,
            label: role.objectTypeName ?? "Object",
            fieldTarget: null,
            fieldRole: null,
            inputType: null,
            placeholder: null,
            stepAction: null,
            pageUrl: null,
            containerName: null,
            besideKeys: [],
            fillAfterKey: null,
            crawlIsRequired: null,
            runIsRequired: undefined,
            objectTypeKey: role.objectTypeKey,
          },
        ]
      : [];
  return [...stepDrafts.map((draft) => draft.row), ...objectRows, ...pageRowsByKey.values()];
}
