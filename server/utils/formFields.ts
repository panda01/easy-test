import type { PlanTarget } from "./actionPlanSchema.js";

/**
 * The ARIA roles a form field can have, as the aria snapshot names them: the
 * fields a parameter can type into or pick from.
 */
export const FORM_FIELD_ROLES = ["textbox", "searchbox", "spinbutton", "combobox", "listbox"] as const;

/** One form field role (see `FORM_FIELD_ROLES`). */
export type FormFieldRole = (typeof FORM_FIELD_ROLES)[number];

/**
 * The elements read as form fields: every text-like `<input>`, `<textarea>`,
 * and `<select>`, plus elements that take a field role themselves. Buttons,
 * check boxes, radios, files, ranges, and colours are left out - a parameter
 * cannot type into them.
 */
export const FORM_FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color])",
  "textarea",
  "select",
  ...FORM_FIELD_ROLES.map((role) => `[role=${role}]`),
].join(", ");

/** The elements that group fields into one form: forms and dialogs. */
export const FORM_CONTAINER_SELECTOR = "form, dialog, [role=dialog], [role=alertdialog], [role=form]";

/** The longest label, placeholder, or container name kept, in characters. */
export const MAX_FORM_FIELD_TEXT_LENGTH = 200;

/** One form field as the browser reports it, before `cleanRawFormFields` tidies it. */
export interface RawFormField {
  /** The element's tag, lower case (`input`, `textarea`, `select`, `div`, ...). */
  tagName: string;
  /** Its `type` attribute, or null. */
  typeAttribute: string | null;
  /** Its `role` attribute, or null. */
  roleAttribute: string | null;
  /** Its multiple attribute is set (a `<select multiple>` is a list box). */
  allowsMultiple: boolean;
  /** Its name as a person reads it: `aria-labelledby`, `aria-label`, its `<label>`, or its title; empty when it has none. */
  label: string;
  /** Its placeholder, or null. */
  placeholder: string | null;
  /** True when it has the `required` attribute or `aria-required="true"`. */
  isRequired: boolean;
  /** Which form or dialog it sits in, counting from 1 in page order; 0 when it is in none. */
  containerNumber: number;
  /** That form's or dialog's name (its label, or its first heading), or null. */
  containerName: string | null;
}

/** What one read of a page's fields returns. */
export interface RawFormFieldRead {
  /** The visible fields, in page order. */
  fields: RawFormField[];
  /** The position (in `fields`) of the field the read started from, or -1 when it started from a non-field. */
  startFieldIndex: number;
}

/** The selectors the in-browser read needs, passed in because the page cannot see this module. */
export interface FormFieldSelectors {
  /** See `FORM_FIELD_SELECTOR`. */
  field: string;
  /** See `FORM_CONTAINER_SELECTOR`. */
  container: string;
}

/** The selectors `readRawFormFields` is always called with. */
export const FORM_FIELD_SELECTORS: FormFieldSelectors = {
  field: FORM_FIELD_SELECTOR,
  container: FORM_CONTAINER_SELECTOR,
};

/** One form field, tidied - what a crawled page stores (`CrawledPage.formFields`) and a run reads. */
export interface FormField {
  /** The field's role, as the aria snapshot would name it. */
  role: FormFieldRole;
  /** `select`, `textarea`, or an `<input>`'s type (`text`, `email`, `password`, ...); null for an element with a field role. */
  inputType: string | null;
  /** Its name (no trailing `*`), or null when it has none. */
  label: string | null;
  /** Its placeholder, or null. */
  placeholder: string | null;
  /** True when the page marks it required. */
  isRequired: boolean;
  /** Which form or dialog it sits in, counting from 1; 0 when it is in none. */
  containerNumber: number;
  /** That form's or dialog's name, or null. */
  containerName: string | null;
}

/**
 * The function the field read runs INSIDE the browser. Started from a field,
 * it reads the fields of that field's form or dialog (the whole page when it
 * is in none) and says which one it started from; started from any other
 * element (the crawler passes `<body>`), it reads every field inside it.
 * Hidden fields - no layout box, or inside `aria-hidden` - are left out. A
 * `<label>` that wraps its field is read without the field's own text (a
 * `<select>`'s options).
 *
 * Kept as an anonymous arrow function with no named helpers inside, like
 * `readRawPageLinks`: `tsx` wraps NAMED functions in a `__name(...)` helper
 * that only exists on the server.
 * @param startElement - A field, or the element to read every field inside
 * @param selectors - `FORM_FIELD_SELECTORS`
 * @returns The fields and which one the read started from
 */
export const readRawFormFields = (startElement: Element, selectors: FormFieldSelectors): RawFormFieldRead => {
  const startIsAField = startElement.matches(selectors.field);
  const scope = startIsAField
    ? (startElement.closest(selectors.container) ?? startElement.ownerDocument.body)
    : startElement;
  const visibleFields = Array.from(scope.querySelectorAll(selectors.field)).filter(
    (field) => field.getClientRects().length > 0 && field.closest("[aria-hidden=true]") === null,
  );
  const containers: Element[] = [];
  const fields = visibleFields.map((field): RawFormField => {
    const container = field.closest(selectors.container);
    if (container !== null && !containers.includes(container)) containers.push(container);
    const labelledByText = (field.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter((elementId) => elementId !== "")
      .map((elementId) => field.ownerDocument.getElementById(elementId)?.textContent ?? "")
      .join(" ")
      .trim();
    const ariaLabelText = (field.getAttribute("aria-label") ?? "").trim();
    const fieldHasLabels =
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement;
    const labelElementText = fieldHasLabels
      ? Array.from(field.labels ?? [])
          .map((labelElement) => labelElement.textContent.replace(field.textContent, ""))
          .join(" ")
          .trim()
      : "";
    const titleText = (field.getAttribute("title") ?? "").trim();
    const containerLabelText =
      container === null
        ? ""
        : (
            container.getAttribute("aria-label") ??
            (container.getAttribute("aria-labelledby") ?? "")
              .split(/\s+/)
              .filter((elementId) => elementId !== "")
              .map((elementId) => field.ownerDocument.getElementById(elementId)?.textContent ?? "")
              .join(" ")
          ).trim();
    const containerHeadingText =
      container === null ? "" : (container.querySelector("h1, h2, h3, h4, h5, h6")?.textContent ?? "").trim();
    return {
      tagName: field.tagName.toLowerCase(),
      typeAttribute: field.getAttribute("type"),
      roleAttribute: field.getAttribute("role"),
      allowsMultiple: field.hasAttribute("multiple"),
      label: [labelledByText, ariaLabelText, labelElementText, titleText].find((text) => text !== "") ?? "",
      placeholder: field.getAttribute("placeholder") ?? field.getAttribute("aria-placeholder"),
      isRequired: field.hasAttribute("required") || field.getAttribute("aria-required") === "true",
      containerNumber: container === null ? 0 : containers.indexOf(container) + 1,
      containerName:
        container === null ? null : [containerLabelText, containerHeadingText].find((text) => text !== "") ?? null,
    };
  });
  return { fields, startFieldIndex: visibleFields.indexOf(startElement) };
};

/**
 * Tidies a text the browser read: whitespace collapsed, a trailing required
 * marker (`*`) dropped, NUL characters removed (Postgres text rejects them),
 * and capped at `MAX_FORM_FIELD_TEXT_LENGTH`.
 * @param text - The raw text, or null
 * @returns The tidy text, or null when nothing is left
 */
export function tidyFieldText(text: string | null): string | null {
  if (text === null) return null;
  const tidiedText = text
    .replaceAll("\u0000", "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\*+$/, "")
    .trim()
    .slice(0, MAX_FORM_FIELD_TEXT_LENGTH);
  return tidiedText === "" ? null : tidiedText;
}

/**
 * Works out a field's role the way the aria snapshot names it: its own
 * `role` attribute when that is a field role, otherwise from its tag and type
 * (a `<select>` is a combo box - a list box when it allows several - a
 * number input a spin button, a search input a search box, any other a text
 * box).
 * @param rawField - The field as the browser reported it
 * @returns The field's role
 */
function readFieldRole(rawField: RawFormField): FormFieldRole {
  const ownRole = FORM_FIELD_ROLES.find((role) => role === rawField.roleAttribute);
  if (ownRole !== undefined) return ownRole;
  if (rawField.tagName === "select") return rawField.allowsMultiple ? "listbox" : "combobox";
  const inputType = (rawField.typeAttribute ?? "text").toLowerCase();
  if (inputType === "number") return "spinbutton";
  if (inputType === "search") return "searchbox";
  return "textbox";
}

/**
 * Reads what kind of input a field is: `select`, `textarea`, or an
 * `<input>`'s type (`text` when it has none).
 * @param rawField - The field as the browser reported it
 * @returns The input type, or null for an element that only has a field role
 */
function readInputType(rawField: RawFormField): string | null {
  if (rawField.tagName === "select" || rawField.tagName === "textarea") return rawField.tagName;
  if (rawField.tagName === "input") return (rawField.typeAttribute ?? "text").toLowerCase();
  return null;
}

/**
 * Tidies the fields one browser read returned (see `readRawFormFields`).
 * @param rawFields - The fields as the browser reported them
 * @returns The same fields, tidied, in the same order
 */
export function cleanRawFormFields(rawFields: RawFormField[]): FormField[] {
  return rawFields.map((rawField) => ({
    role: readFieldRole(rawField),
    inputType: readInputType(rawField),
    label: tidyFieldText(rawField.label),
    placeholder: tidyFieldText(rawField.placeholder),
    isRequired: rawField.isRequired,
    containerNumber: rawField.containerNumber,
    containerName: tidyFieldText(rawField.containerName),
  }));
}

/**
 * Reads a stored `formFields` column back - it is JSON, so anything could be
 * there - keeping only the entries shaped like a `FormField`.
 * @param storedFields - The column's value
 * @returns The well-formed fields; empty when the value is not a list
 */
export function readStoredFormFields(storedFields: unknown): FormField[] {
  if (!Array.isArray(storedFields)) return [];
  return storedFields.filter((storedField: unknown): storedField is FormField => {
    const fieldIsAnObject = typeof storedField === "object" && storedField !== null;
    if (!fieldIsAnObject) return false;
    const roleIsKnown = FORM_FIELD_ROLES.some((role) => "role" in storedField && storedField.role === role);
    const flagIsABoolean = "isRequired" in storedField && typeof storedField.isRequired === "boolean";
    const containerIsANumber = "containerNumber" in storedField && typeof storedField.containerNumber === "number";
    return roleIsKnown && flagIsABoolean && containerIsANumber;
  });
}

/**
 * Compares two names the way a person would: case, extra spaces, and a
 * trailing required marker (`*`) do not matter.
 * @param name - A name from the page or a plan
 * @returns The name, normalized for comparing
 */
export function normalizeFieldName(name: string): string {
  return (tidyFieldText(name) ?? "").toLowerCase();
}

/**
 * Lists the names a plan target can find a field by: `{label}` its label,
 * `{placeholder}` its placeholder, and `{role, name}` its label or - when it
 * has no label, which is how the accessible name works - its placeholder.
 * @param target - A step's target
 * @returns Which of the field's names to compare, and the target's text; null for a target that does not name a field (text, alt text, title, CSS)
 */
function readTargetFieldName(
  target: PlanTarget,
): { comparesLabel: boolean; comparesPlaceholder: boolean; name: string } | null {
  if ("label" in target) return { comparesLabel: true, comparesPlaceholder: false, name: target.label };
  if ("placeholder" in target) {
    return { comparesLabel: false, comparesPlaceholder: true, name: target.placeholder };
  }
  if ("role" in target && target.name !== "") {
    return { comparesLabel: true, comparesPlaceholder: true, name: target.name };
  }
  return null;
}

/**
 * Finds the field a step's target points at among fields read from a page.
 * An exact match (see `normalizeFieldName`) wins; otherwise, like
 * Playwright's own `getByLabel` and `getByRole`, a field whose name CONTAINS
 * the target's text is taken - but only when exactly one does.
 * @param target - A step's target
 * @param fields - Fields read from the page (by the crawler, the runner, or the aria snapshot)
 * @param readFieldNames - Reads a field's label and placeholder
 * @returns The matching field's position in `fields`, or -1 when none (or several partial ones) match
 */
export function matchFieldToTarget<TField>(
  target: PlanTarget,
  fields: TField[],
  readFieldNames: (field: TField) => { label: string | null; placeholder: string | null },
): number {
  const targetName = readTargetFieldName(target);
  if (targetName === null) return -1;
  const wantedName = normalizeFieldName(targetName.name);
  if (wantedName === "") return -1;
  const comparableNames = fields.map((field) => {
    const { label, placeholder } = readFieldNames(field);
    const names: string[] = [];
    if (targetName.comparesLabel && label !== null) names.push(normalizeFieldName(label));
    const placeholderCounts = targetName.comparesPlaceholder && (targetName.comparesLabel ? label === null : true);
    if (placeholderCounts && placeholder !== null) names.push(normalizeFieldName(placeholder));
    return names;
  });
  const exactIndex = comparableNames.findIndex((names) => names.includes(wantedName));
  if (exactIndex !== -1) return exactIndex;
  const partialIndexes = comparableNames
    .map((names, fieldIndex) => (names.some((name) => name.includes(wantedName)) ? fieldIndex : -1))
    .filter((fieldIndex) => fieldIndex !== -1);
  return partialIndexes.length === 1 ? partialIndexes[0] : -1;
}

/**
 * Finds the field a step's target points at among fields the browser read
 * (see `matchFieldToTarget`).
 * @param target - A step's target
 * @param fields - Fields read by the crawler or the runner
 * @returns The matching field's position, or -1 when none matches
 */
export function matchFormField(target: PlanTarget, fields: FormField[]): number {
  return matchFieldToTarget(target, fields, (field) => ({ label: field.label, placeholder: field.placeholder }));
}

/**
 * Interprets one field's required flag. A flag means required. A field
 * WITHOUT one only counts as optional when another field of its form or
 * dialog has one - otherwise the page may simply not mark required fields at
 * all, and nothing is known.
 * @param fields - The fields one read returned
 * @param fieldIndex - The field to judge
 * @returns True (required), false (optional), or null (the page does not say)
 */
export function interpretRequiredReading(fields: FormField[], fieldIndex: number): boolean | null {
  const field = fields.at(fieldIndex);
  if (field === undefined) return null;
  if (field.isRequired) return true;
  const anotherFieldIsMarkedRequired = fields.some(
    (otherField, otherIndex) =>
      otherIndex !== fieldIndex && otherField.containerNumber === field.containerNumber && otherField.isRequired,
  );
  return anotherFieldIsMarkedRequired ? false : null;
}
