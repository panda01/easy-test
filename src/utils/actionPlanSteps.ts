/**
 * The JSON step plan, as the client sees it - types, the rules each step
 * action follows, and readable descriptions. This MIRRORS
 * `server/utils/actionPlanSchema.ts` (the client never imports server code);
 * the server stays the authority and re-checks every plan it saves or runs.
 */

/** Every step action a plan may use, in the order the editor lists them. */
export const PLAN_STEP_ACTIONS = [
  "goto",
  "click",
  "doubleClick",
  "hover",
  "fill",
  "press",
  "check",
  "uncheck",
  "selectOption",
  "scrollIntoView",
  "scroll",
  "uploadFile",
  "respondToNextDialog",
  "waitForUrl",
  "expectVisible",
  "expectHidden",
  "log",
] as const;

/** One allowed step action. */
export type PlanStepAction = (typeof PLAN_STEP_ACTIONS)[number];

/** Every ARIA role a `{ role, name }` target may use (Playwright's `getByRole` list). */
export const ARIA_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button",
  "caption", "cell", "checkbox", "code", "columnheader", "combobox", "complementary",
  "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis",
  "feed", "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img",
  "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math",
  "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "navigation", "none", "note", "option", "paragraph", "presentation", "progressbar",
  "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search",
  "searchbox", "separator", "slider", "spinbutton", "status", "strong", "subscript",
  "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
] as const;

/** The single keys a `press` step may press. */
export const PLAN_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;

/** How a `respondToNextDialog` step answers the next browser dialog. */
export const DIALOG_RESPONSES = ["accept", "dismiss"] as const;

/** The two values a `fill` step may type in place of literal text, filled in from the action's credential at run time. */
export const CREDENTIAL_PLACEHOLDERS = {
  username: "{{credential.username}}",
  password: "{{credential.password}}",
} as const;

/** The most steps one plan may have. */
export const MAX_PLAN_STEPS = 100;

/** The furthest one `scroll` step may move, in pixels, either way. */
export const MAX_SCROLL_PIXELS = 5000;

/** The element a step acts on: exactly one way of finding it. */
export type PlanTarget =
  | { role: string; name: string }
  | { label: string }
  | { placeholder: string }
  | { text: string }
  | { altText: string }
  | { title: string }
  | { css: string };

/** One way of finding an element - the key its target object uses. */
export type PlanTargetKind = "role" | "label" | "placeholder" | "text" | "altText" | "title" | "css";

/** Every way of finding an element, with the label the editor shows, most user-like first. */
export const PLAN_TARGET_KINDS: readonly { kind: PlanTargetKind; label: string }[] = [
  { kind: "role", label: "Role and name" },
  { kind: "label", label: "Label" },
  { kind: "placeholder", label: "Placeholder" },
  { kind: "text", label: "Visible text" },
  { kind: "altText", label: "Image alt text" },
  { kind: "title", label: "Title (tooltip)" },
  { kind: "css", label: "CSS selector (last resort)" },
];

/** One step of a plan, exactly as the API stores it. */
export interface PlanStep {
  action: PlanStepAction;
  target: PlanTarget | null;
  value: string | null;
}

/** A whole plan, exactly as the API stores it. */
export interface ActionPlan {
  name: string;
  startUrl: string;
  steps: PlanStep[];
}

/** What kind of value a step action takes. */
export type PlanValueKind =
  | "none"
  | "url"
  | "text"
  | "key"
  | "optionLabel"
  | "pixels"
  | "fileName"
  | "dialogResponse"
  | "urlPattern"
  | "message";

/** What one step action needs, and how the editor presents it. */
export interface PlanStepRule {
  /** The name the editor shows for the action. */
  label: string;
  /** `required`: must have a target; `optional`: may have one; `none`: must not. */
  target: "required" | "optional" | "none";
  /** The kind of value the action takes. */
  value: PlanValueKind;
  /** The value field's label in the editor; empty for actions without a value. */
  valueLabel: string;
}

/** What every step action needs. A `Map`, so a name like "constructor" can never find an inherited property. */
export const PLAN_STEP_RULES: ReadonlyMap<PlanStepAction, PlanStepRule> = new Map<
  PlanStepAction,
  PlanStepRule
>([
  ["goto", { label: "Go to address", target: "none", value: "url", valueLabel: "URL" }],
  ["click", { label: "Click", target: "required", value: "none", valueLabel: "" }],
  ["doubleClick", { label: "Double-click", target: "required", value: "none", valueLabel: "" }],
  ["hover", { label: "Hover", target: "required", value: "none", valueLabel: "" }],
  ["fill", { label: "Type text", target: "required", value: "text", valueLabel: "Text to type" }],
  ["press", { label: "Press key", target: "optional", value: "key", valueLabel: "Key" }],
  ["check", { label: "Check", target: "required", value: "none", valueLabel: "" }],
  ["uncheck", { label: "Uncheck", target: "required", value: "none", valueLabel: "" }],
  [
    "selectOption",
    { label: "Select option", target: "required", value: "optionLabel", valueLabel: "Option label" },
  ],
  ["scrollIntoView", { label: "Scroll to element", target: "required", value: "none", valueLabel: "" }],
  ["scroll", { label: "Scroll by pixels", target: "none", value: "pixels", valueLabel: "Pixels (negative scrolls up)" }],
  [
    "uploadFile",
    { label: "Upload file", target: "required", value: "fileName", valueLabel: "File name in the uploads folder" },
  ],
  [
    "respondToNextDialog",
    { label: "Answer next dialog", target: "none", value: "dialogResponse", valueLabel: "Answer" },
  ],
  ["waitForUrl", { label: "Wait for address", target: "none", value: "urlPattern", valueLabel: "URL or glob pattern" }],
  ["expectVisible", { label: "Expect visible", target: "required", value: "none", valueLabel: "" }],
  ["expectHidden", { label: "Expect hidden", target: "required", value: "none", valueLabel: "" }],
  ["log", { label: "Log a note", target: "none", value: "message", valueLabel: "Message" }],
]);

/**
 * Looks up an action's rule. Every action in `PLAN_STEP_ACTIONS` has one.
 * @param action - A step action
 * @returns Its rule
 */
export function readPlanStepRule(action: PlanStepAction): PlanStepRule {
  const rule = PLAN_STEP_RULES.get(action);
  if (rule === undefined) {
    throw new Error(`No rule for step action "${action}"`);
  }
  return rule;
}

/**
 * Tells which way of finding an element a target uses.
 * @param target - A step target
 * @returns The target's kind
 */
export function readPlanTargetKind(target: PlanTarget): PlanTargetKind {
  if ("role" in target) return "role";
  if ("label" in target) return "label";
  if ("placeholder" in target) return "placeholder";
  if ("text" in target) return "text";
  if ("altText" in target) return "altText";
  if ("title" in target) return "title";
  return "css";
}

/**
 * Reads the text a target searches for (a role target's NAME).
 * @param target - A step target
 * @returns The name, label, placeholder, text, alt text, title, or CSS
 */
export function readPlanTargetText(target: PlanTarget): string {
  if ("role" in target) return target.name;
  if ("label" in target) return target.label;
  if ("placeholder" in target) return target.placeholder;
  if ("text" in target) return target.text;
  if ("altText" in target) return target.altText;
  if ("title" in target) return target.title;
  return target.css;
}

/**
 * Builds a target of the given kind.
 * @param kind - How the element is found
 * @param text - What to search for (a role target's name)
 * @param role - The role, for a `role` target
 * @returns The target object
 */
export function buildPlanTarget(kind: PlanTargetKind, text: string, role: string): PlanTarget {
  switch (kind) {
    case "role":
      return { role, name: text };
    case "label":
      return { label: text };
    case "placeholder":
      return { placeholder: text };
    case "text":
      return { text };
    case "altText":
      return { altText: text };
    case "title":
      return { title: text };
    case "css":
      return { css: text };
  }
}

/**
 * Describes a target the way a person would point at it.
 * @param target - A step target
 * @returns e.g. `button "Sign in"` or `the field labelled "Email"`
 */
export function describePlanTarget(target: PlanTarget): string {
  if ("role" in target) {
    return target.name === "" ? `the ${target.role}` : `${target.role} "${target.name}"`;
  }
  if ("label" in target) return `the field labelled "${target.label}"`;
  if ("placeholder" in target) return `the field with placeholder "${target.placeholder}"`;
  if ("text" in target) return `the text "${target.text}"`;
  if ("altText" in target) return `the image "${target.altText}"`;
  if ("title" in target) return `the element titled "${target.title}"`;
  return `the element matching CSS "${target.css}"`;
}

/**
 * Describes the text a `fill` step types: placeholders by name, so the
 * reader knows the credential is used, and literal text in quotes.
 * @param value - The step's value
 * @returns e.g. `"hello"` or `the credential's password`
 */
function describeFillText(value: string | null): string {
  if (value === CREDENTIAL_PLACEHOLDERS.username) return "the credential's username";
  if (value === CREDENTIAL_PLACEHOLDERS.password) return "the credential's password";
  return `"${value ?? ""}"`;
}

/** A step's sentence split the way the step list shows it: the verb (muted) and the rest. */
export interface PlanStepParts {
  /** What the step does, e.g. "Click", "Go to", "Check that". */
  verb: string;
  /** What it does it to, e.g. `button "Sign in"`. */
  rest: string;
}

/**
 * Describes one step as its verb and the rest of its sentence, for the
 * read-only step list, which shows the verb muted.
 * @param step - A plan step
 * @returns e.g. `{ verb: "Type", rest: '"hello" into textbox "Search"' }`
 */
export function describePlanStepParts(step: PlanStep): PlanStepParts {
  const targetText = step.target === null ? "" : describePlanTarget(step.target);
  const value = step.value ?? "";
  switch (step.action) {
    case "goto":
      return { verb: "Go to", rest: value };
    case "click":
      return { verb: "Click", rest: targetText };
    case "doubleClick":
      return { verb: "Double-click", rest: targetText };
    case "hover":
      return { verb: "Hover over", rest: targetText };
    case "fill":
      return { verb: "Type", rest: `${describeFillText(step.value)} into ${targetText}` };
    case "press":
      return { verb: "Press", rest: step.target === null ? value : `${value} in ${targetText}` };
    case "check":
      return { verb: "Check", rest: targetText };
    case "uncheck":
      return { verb: "Uncheck", rest: targetText };
    case "selectOption":
      return { verb: "Select", rest: `"${value}" in ${targetText}` };
    case "scrollIntoView":
      return { verb: "Scroll to", rest: targetText };
    case "scroll":
      return { verb: "Scroll by", rest: `${value} pixels` };
    case "uploadFile":
      return { verb: "Upload", rest: `"${value}" with ${targetText}` };
    case "respondToNextDialog":
      return { verb: "Answer", rest: `the next browser dialog with "${value}"` };
    case "waitForUrl":
      return { verb: "Wait for", rest: `the address ${value}` };
    case "expectVisible":
      return { verb: "Check that", rest: `${targetText} is visible` };
    case "expectHidden":
      return { verb: "Check that", rest: `${targetText} is hidden` };
    case "log":
      return { verb: "Note:", rest: value };
  }
}

/**
 * Describes one step in a sentence: its verb and the rest, joined
 * (see `describePlanStepParts`).
 * @param step - A plan step
 * @returns e.g. `Type "hello" into textbox "Search"`
 */
export function describePlanStep(step: PlanStep): string {
  const { verb, rest } = describePlanStepParts(step);
  return `${verb} ${rest}`;
}

/**
 * Checks that a URL is an absolute http/https address.
 * @param url - The URL text
 * @returns True when it parses and is http or https
 */
function isHttpUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:";
}

/**
 * Checks a step's value against its action's value kind - the same rules the
 * server applies, minus the "same website" check, which needs the website's
 * login URLs and is left to the server.
 * @param rule - The action's rule
 * @param value - The step's value
 * @returns A problem description, or null when the value is fine
 */
function findValueProblem(rule: PlanStepRule, value: string | null): string | null {
  if (rule.value === "none") return value === null ? null : "takes no value";
  if (value === null) return "needs a value";
  const valueIsBlank = value.trim() === "";
  if (valueIsBlank && rule.value !== "text") return `needs a value (${rule.valueLabel})`;
  const placeholderValues: string[] = Object.values(CREDENTIAL_PLACEHOLDERS);
  const valueIsAPlaceholder = placeholderValues.includes(value);
  if (value.includes("{{") && !(rule.value === "text" && valueIsAPlaceholder)) {
    return "may not contain {{ - credential placeholders are only allowed as a whole text value";
  }
  switch (rule.value) {
    case "url":
      return isHttpUrl(value) ? null : "must be an absolute http:// or https:// address";
    case "key":
      return (PLAN_KEYS as readonly string[]).includes(value) ? null : "must be one of the listed keys";
    case "dialogResponse":
      return (DIALOG_RESPONSES as readonly string[]).includes(value) ? null : "must be accept or dismiss";
    case "pixels": {
      const pixels = Number(value);
      const pixelsAreValid =
        /^-?\d+$/.test(value) && pixels !== 0 && Math.abs(pixels) <= MAX_SCROLL_PIXELS;
      return pixelsAreValid
        ? null
        : `must be a whole number from -${String(MAX_SCROLL_PIXELS)} to ${String(MAX_SCROLL_PIXELS)}, not 0`;
    }
    case "fileName":
      return /[/\\]/.test(value) || value === "." || value === ".." ? "must be a file name with no folder" : null;
    case "text":
    case "optionLabel":
    case "urlPattern":
    case "message":
      return null;
  }
}

/**
 * Checks one step against its action's rule.
 * @param step - A plan step
 * @returns A problem description, or null when the step is fine
 */
function findStepProblem(step: PlanStep): string | null {
  const rule = readPlanStepRule(step.action);
  const stepHasATarget = step.target !== null;
  if (rule.target === "required" && !stepHasATarget) return "needs an element to act on";
  if (rule.target === "none" && stepHasATarget) return "takes no element";
  if (step.target !== null) {
    const targetText = readPlanTargetText(step.target);
    const targetTextIsBlank = targetText.trim() === "";
    const blankIsAllowed = readPlanTargetKind(step.target) === "role";
    if (targetTextIsBlank && !blankIsAllowed) return "needs the text to find the element by";
  }
  return findValueProblem(rule, step.value);
}

/**
 * Finds every problem that would make the server refuse a plan, so the
 * editor can say what to fix before saving.
 * @param plan - The plan being edited
 * @returns One message per problem ("Step 3 (Click): needs an element to act on"); empty when the plan can be saved
 */
export function findPlanProblems(plan: ActionPlan): string[] {
  const problems: string[] = [];
  if (plan.name.trim() === "") problems.push("Name: may not be blank");
  if (!isHttpUrl(plan.startUrl)) problems.push("Start URL: must be an absolute http:// or https:// address");
  if (plan.steps.length === 0) problems.push("Steps: a plan needs at least one step");
  if (plan.steps.length > MAX_PLAN_STEPS) {
    problems.push(`Steps: a plan may have at most ${String(MAX_PLAN_STEPS)} steps`);
  }
  plan.steps.forEach((step, stepIndex) => {
    const stepProblem = findStepProblem(step);
    if (stepProblem !== null) {
      problems.push(`Step ${String(stepIndex + 1)} (${readPlanStepRule(step.action).label}): ${stepProblem}`);
    }
  });
  return problems;
}

/**
 * Changes a step's action, keeping what still fits: the target when the new
 * action takes one, and the value when it takes the same kind of value.
 * Anything that no longer fits is cleared or given a starting value.
 * @param step - The step before the change
 * @param action - The new action
 * @returns The changed step
 */
export function changePlanStepAction(step: PlanStep, action: PlanStepAction): PlanStep {
  const oldRule = readPlanStepRule(step.action);
  const newRule = readPlanStepRule(action);
  const targetStillFits = newRule.target !== "none";
  const target = targetStillFits
    ? (step.target ?? (newRule.target === "required" ? { role: "button", name: "" } : null))
    : null;
  const valueKindIsUnchanged = oldRule.value === newRule.value;
  const value = valueKindIsUnchanged ? step.value : startingValueFor(newRule.value);
  return { action, target, value };
}

/**
 * The value a new step of a given value kind starts with.
 * @param valueKind - The action's value kind
 * @returns The starting value (null when the action takes none)
 */
export function startingValueFor(valueKind: PlanValueKind): string | null {
  switch (valueKind) {
    case "none":
      return null;
    case "key":
      return "Enter";
    case "dialogResponse":
      return "accept";
    case "pixels":
      return "600";
    case "url":
    case "text":
    case "optionLabel":
    case "fileName":
    case "urlPattern":
    case "message":
      return "";
  }
}

/**
 * Formats a plan as the indented JSON the details panel and the compare page
 * show, with each step's fields in their written order.
 * @param plan - The plan
 * @returns Pretty-printed JSON
 */
export function formatPlanJson(plan: ActionPlan): string {
  return JSON.stringify(plan, null, 2);
}
