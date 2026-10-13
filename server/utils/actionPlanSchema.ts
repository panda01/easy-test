import { z } from "zod";
import type { Page } from "playwright";
import type { ValidationResult } from "./validateRequestBodies.js";

/** Every ARIA role Playwright's `getByRole` accepts (copied from its own signature). */
export type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * Every ARIA role, as a lookup. Typed as a `Record` over `AriaRole` so the
 * compiler fails when Playwright adds a role this list is missing, or when the
 * list names a role Playwright does not know.
 */
const ARIA_ROLE_LOOKUP: Record<AriaRole, true> = {
  alert: true,
  alertdialog: true,
  application: true,
  article: true,
  banner: true,
  blockquote: true,
  button: true,
  caption: true,
  cell: true,
  checkbox: true,
  code: true,
  columnheader: true,
  combobox: true,
  complementary: true,
  contentinfo: true,
  definition: true,
  deletion: true,
  dialog: true,
  directory: true,
  document: true,
  emphasis: true,
  feed: true,
  figure: true,
  form: true,
  generic: true,
  grid: true,
  gridcell: true,
  group: true,
  heading: true,
  img: true,
  insertion: true,
  link: true,
  list: true,
  listbox: true,
  listitem: true,
  log: true,
  main: true,
  marquee: true,
  math: true,
  meter: true,
  menu: true,
  menubar: true,
  menuitem: true,
  menuitemcheckbox: true,
  menuitemradio: true,
  navigation: true,
  none: true,
  note: true,
  option: true,
  paragraph: true,
  presentation: true,
  progressbar: true,
  radio: true,
  radiogroup: true,
  region: true,
  row: true,
  rowgroup: true,
  rowheader: true,
  scrollbar: true,
  search: true,
  searchbox: true,
  separator: true,
  slider: true,
  spinbutton: true,
  status: true,
  strong: true,
  subscript: true,
  superscript: true,
  switch: true,
  tab: true,
  table: true,
  tablist: true,
  tabpanel: true,
  term: true,
  textbox: true,
  time: true,
  timer: true,
  toolbar: true,
  tooltip: true,
  tree: true,
  treegrid: true,
  treeitem: true,
};

/** Every ARIA role a `{ role, name }` target may use. */
export const ARIA_ROLES = Object.keys(ARIA_ROLE_LOOKUP) as [AriaRole, ...AriaRole[]];

/**
 * The only step actions a plan may contain - the "Allowed Playwright
 * Features" of the old script guidelines, one action per feature. The runner
 * (`actionPlanRunnerService.ts`) has exactly one `switch` case per entry.
 */
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

/** The single keys a `press` step may press - the ones a user presses on their own. */
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

/** How a `respondToNextDialog` step answers the next alert / confirm / prompt. */
export const DIALOG_RESPONSES = ["accept", "dismiss"] as const;

/**
 * The two placeholders a `fill` step may type instead of literal text. They
 * are replaced at RUN time with the action's credential, so the real values
 * are never sent to Claude or stored in a plan.
 */
export const CREDENTIAL_PLACEHOLDERS = {
  username: "{{credential.username}}",
  password: "{{credential.password}}",
} as const;

/** The most steps one plan may have. */
export const MAX_PLAN_STEPS = 100;

/** The longest text any one plan field may hold (typing is 100 ms per character). */
export const MAX_PLAN_TEXT_LENGTH = 1000;

/** The furthest one `scroll` step may move the mouse wheel, in pixels, either way. */
export const MAX_SCROLL_PIXELS = 5000;

/** The marker that starts a placeholder; it may appear nowhere else in a plan. */
const PLACEHOLDER_OPENING = "{{";

/**
 * The element a step acts on, found the way a user would find it. Exactly one
 * way of finding it per target; `css` is the last resort.
 */
export const PlanTargetSchema = z.union([
  z.strictObject({
    role: z.enum(ARIA_ROLES).describe("The element's ARIA role, as shown in the aria snapshot"),
    name: z
      .string()
      .describe("The element's accessible name from the aria snapshot; empty string when it has none"),
  }),
  z.strictObject({ label: z.string().describe("The text of the form field's label") }),
  z.strictObject({ placeholder: z.string().describe("The input's placeholder text") }),
  z.strictObject({ text: z.string().describe("Visible text inside the element") }),
  z.strictObject({ altText: z.string().describe("An image's alt text") }),
  z.strictObject({ title: z.string().describe("The element's title attribute (tooltip)") }),
  z.strictObject({ css: z.string().describe("A CSS selector - only when nothing above can find the element") }),
]);

/** One way of finding an element (see `PlanTargetSchema`). */
export type PlanTarget = z.infer<typeof PlanTargetSchema>;

/** One step of a plan: what to do, to which element, with which value. */
export const PlanStepSchema = z.strictObject({
  action: z.enum(PLAN_STEP_ACTIONS).describe("One of the allowed step actions"),
  target: PlanTargetSchema.nullable().describe("The element to act on, or null for steps without one"),
  value: z
    .string()
    .nullable()
    .describe("The step's value (text, URL, key, option, ...), or null for steps without one"),
});

/** One step of a plan. */
export type PlanStep = z.infer<typeof PlanStepSchema>;

/**
 * A whole plan: `{ name, startUrl, steps }`. This is the STRUCTURE only - it
 * converts cleanly to a JSON schema (no refinements, transforms, or limits),
 * so it is also what Claude's structured output is held to. The per-action
 * rules are checked by `findActionPlanProblems`.
 */
export const ActionPlanSchema = z.strictObject({
  name: z.string().describe("A short name for the plan, usually the action's title"),
  startUrl: z.string().describe("The absolute URL the browser opens before the first step"),
  steps: z.array(PlanStepSchema).describe("The steps, in the order they run"),
});

/** A whole plan. */
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/** What kind of value a step action takes, which decides how `value` is checked. */
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

/** What one step action needs: whether it takes a target, and what kind of value. */
export interface PlanStepRule {
  /** `required`: must have a target; `optional`: may have one; `none`: must not. */
  target: "required" | "optional" | "none";
  /** The kind of value the action takes; `none` means `value` must be null. */
  value: PlanValueKind;
}

/**
 * What every step action needs. A `Map`, not a plain object, so a lookup with
 * a name such as "constructor" can never find an inherited property.
 */
export const PLAN_STEP_RULES: ReadonlyMap<PlanStepAction, PlanStepRule> = new Map<
  PlanStepAction,
  PlanStepRule
>([
  ["goto", { target: "none", value: "url" }],
  ["click", { target: "required", value: "none" }],
  ["doubleClick", { target: "required", value: "none" }],
  ["hover", { target: "required", value: "none" }],
  ["fill", { target: "required", value: "text" }],
  ["press", { target: "optional", value: "key" }],
  ["check", { target: "required", value: "none" }],
  ["uncheck", { target: "required", value: "none" }],
  ["selectOption", { target: "required", value: "optionLabel" }],
  ["scrollIntoView", { target: "required", value: "none" }],
  ["scroll", { target: "none", value: "pixels" }],
  ["uploadFile", { target: "required", value: "fileName" }],
  ["respondToNextDialog", { target: "none", value: "dialogResponse" }],
  ["waitForUrl", { target: "none", value: "urlPattern" }],
  ["expectVisible", { target: "required", value: "none" }],
  ["expectHidden", { target: "required", value: "none" }],
  ["log", { target: "none", value: "message" }],
]);

/**
 * Turns a URL into its origin, for the "same site" checks.
 * @param url - Any URL string
 * @returns The origin (`https://example.com`), or null when it does not parse or is not http/https
 */
export function readHttpOrigin(url: string): string | null {
  const urlParses = URL.canParse(url);
  if (!urlParses) return null;
  const parsedUrl = new URL(url);
  const urlIsHttpOrHttps = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  return urlIsHttpOrHttps ? parsedUrl.origin : null;
}

/**
 * Builds the list of origins a plan may open: the website's own, plus the
 * login pages' (a login page can live on another host, e.g. `auth.example.com`).
 * @param siteUrls - The website URL, the website's login URL, and the credential's login URL; null entries are skipped
 * @returns Every distinct http/https origin among them
 */
export function buildAllowedPlanOrigins(siteUrls: (string | null)[]): string[] {
  const allowedOrigins = new Set<string>();
  for (const siteUrl of siteUrls) {
    const origin = siteUrl === null ? null : readHttpOrigin(siteUrl);
    if (origin !== null) allowedOrigins.add(origin);
  }
  return [...allowedOrigins];
}

/**
 * Checks that a URL a plan opens is an http/https address on one of the
 * allowed origins, so a plan can never send the browser (and a typed
 * credential) to another site.
 * @param url - The URL to check
 * @param allowedOrigins - From `buildAllowedPlanOrigins`
 * @returns A problem description, or null when the URL is allowed
 */
function findUrlProblem(url: string, allowedOrigins: string[]): string | null {
  const origin = readHttpOrigin(url);
  if (origin === null) {
    return "must be an absolute http:// or https:// address";
  }
  const originIsAllowed = allowedOrigins.includes(origin);
  if (!originIsAllowed) {
    return `must be on this website (${allowedOrigins.join(" or ")}), not ${origin}`;
  }
  return null;
}

/**
 * Checks one text field against the rules every plan string follows: not
 * longer than `MAX_PLAN_TEXT_LENGTH`, and no placeholder marker.
 * @param text - The field's text
 * @returns A problem description, or null when the text is fine
 */
function findPlainTextProblem(text: string): string | null {
  const textIsTooLong = text.length > MAX_PLAN_TEXT_LENGTH;
  if (textIsTooLong) {
    return `must be at most ${MAX_PLAN_TEXT_LENGTH} characters`;
  }
  const textContainsAPlaceholder = text.includes(PLACEHOLDER_OPENING);
  if (textContainsAPlaceholder) {
    return "may not contain {{ - credential placeholders are only allowed as a whole fill value";
  }
  return null;
}

/**
 * Checks a step's target: each way of finding an element needs non-blank
 * text, except a role's name, which may be empty ("any name").
 * @param target - The step's target
 * @returns A problem description, or null when the target is fine
 */
function findTargetProblem(target: PlanTarget): string | null {
  const targetTexts = Object.entries(target).filter(([fieldName]) => fieldName !== "role");
  for (const [fieldName, fieldText] of targetTexts) {
    const fieldIsBlank = fieldText.trim() === "";
    const blankIsAllowed = fieldName === "name";
    if (fieldIsBlank && !blankIsAllowed) {
      return `the target's ${fieldName} may not be blank`;
    }
    const textProblem = findPlainTextProblem(fieldText);
    if (textProblem !== null) {
      return `the target's ${fieldName} ${textProblem}`;
    }
  }
  return null;
}

/**
 * Checks a `fill` value: any text, or EXACTLY one credential placeholder.
 * @param text - The text to type
 * @returns A problem description, or null when the value is fine
 */
function findFillTextProblem(text: string): string | null {
  const placeholderValues: string[] = Object.values(CREDENTIAL_PLACEHOLDERS);
  const valueIsAPlaceholder = placeholderValues.includes(text);
  if (valueIsAPlaceholder) return null;
  return findPlainTextProblem(text);
}

/**
 * Checks a `scroll` value: a whole, non-zero number of pixels within range.
 * @param text - The value as written in the plan, e.g. "600" or "-600"
 * @returns A problem description, or null when the value is fine
 */
function findPixelsProblem(text: string): string | null {
  const valueIsAWholeNumber = /^-?\d+$/.test(text);
  const pixels = Number(text);
  const valueIsInRange = pixels !== 0 && Math.abs(pixels) <= MAX_SCROLL_PIXELS;
  if (!valueIsAWholeNumber || !valueIsInRange) {
    return `must be a whole number of pixels from -${MAX_SCROLL_PIXELS} to ${MAX_SCROLL_PIXELS} (not 0); negative scrolls up`;
  }
  return null;
}

/**
 * Checks an `uploadFile` value: a bare file name (no folders), so the runner
 * can only pick files from its own uploads folder.
 * @param text - The file name
 * @returns A problem description, or null when the value is fine
 */
function findFileNameProblem(text: string): string | null {
  const nameHasAFolder = /[/\\]/.test(text);
  const nameIsADotEntry = text === "." || text === "..";
  if (nameHasAFolder || nameIsADotEntry || text.includes("\u0000")) {
    return "must be a file name inside the uploads folder, with no folder path";
  }
  return findPlainTextProblem(text);
}

/**
 * Checks a step's value against the kind of value its action takes.
 * @param valueKind - From `PLAN_STEP_RULES`
 * @param value - The step's value
 * @param allowedOrigins - Origins a `goto` may open
 * @returns A problem description, or null when the value is fine
 */
function findValueProblem(
  valueKind: PlanValueKind,
  value: string | null,
  allowedOrigins: string[],
): string | null {
  if (valueKind === "none") {
    return value === null ? null : "takes no value";
  }
  if (value === null) {
    return "needs a value";
  }
  // Typing an empty string is meaningless but harmless (it just clears the
  // field), so only the other kinds need visible text.
  const valueIsBlank = value.trim() === "";
  if (valueIsBlank && valueKind !== "text") {
    return "needs a value";
  }

  switch (valueKind) {
    case "url":
      return findUrlProblem(value, allowedOrigins);
    case "text":
      return findFillTextProblem(value);
    case "key": {
      const keyIsAllowed = (PLAN_KEYS as readonly string[]).includes(value);
      return keyIsAllowed ? null : `must be one of: ${PLAN_KEYS.join(", ")}`;
    }
    case "dialogResponse": {
      const responseIsAllowed = (DIALOG_RESPONSES as readonly string[]).includes(value);
      return responseIsAllowed ? null : `must be one of: ${DIALOG_RESPONSES.join(", ")}`;
    }
    case "pixels":
      return findPixelsProblem(value);
    case "fileName":
      return findFileNameProblem(value);
    case "optionLabel":
    case "urlPattern":
    case "message":
      return findPlainTextProblem(value);
  }
}

/**
 * Checks one step against its action's rules.
 * @param step - The step (already structurally valid)
 * @param allowedOrigins - Origins a `goto` may open
 * @returns A problem description, or null when the step is fine
 */
function findStepProblem(step: PlanStep, allowedOrigins: string[]): string | null {
  const rule = PLAN_STEP_RULES.get(step.action);
  if (rule === undefined) {
    return "is not an allowed action";
  }
  const stepHasATarget = step.target !== null;
  if (rule.target === "required" && !stepHasATarget) {
    return "needs a target";
  }
  if (rule.target === "none" && stepHasATarget) {
    return "takes no target";
  }
  if (step.target !== null) {
    const targetProblem = findTargetProblem(step.target);
    if (targetProblem !== null) return targetProblem;
  }
  return findValueProblem(rule.value, step.value, allowedOrigins);
}

/**
 * Applies every per-action rule to a structurally valid plan: the plan has a
 * name, its start URL and every `goto` stay on the allowed origins, it has
 * 1 to `MAX_PLAN_STEPS` steps, and each step has exactly the target and value
 * its action needs. Credential placeholders are allowed only as a whole
 * `fill` value.
 * @param plan - A plan that already passed `ActionPlanSchema`
 * @param allowedOrigins - From `buildAllowedPlanOrigins`
 * @returns One message per problem ("Step 3 (click): needs a target"); empty when the plan is valid
 */
export function findActionPlanProblems(plan: ActionPlan, allowedOrigins: string[]): string[] {
  const problems: string[] = [];

  const nameIsBlank = plan.name.trim() === "";
  const nameProblem = nameIsBlank ? "may not be blank" : findPlainTextProblem(plan.name);
  if (nameProblem !== null) problems.push(`Name: ${nameProblem}`);

  const startUrlProblem = findUrlProblem(plan.startUrl, allowedOrigins);
  if (startUrlProblem !== null) problems.push(`Start URL: ${startUrlProblem}`);

  const planHasNoSteps = plan.steps.length === 0;
  const planHasTooManySteps = plan.steps.length > MAX_PLAN_STEPS;
  if (planHasNoSteps) problems.push("Steps: a plan needs at least one step");
  if (planHasTooManySteps) problems.push(`Steps: a plan may have at most ${MAX_PLAN_STEPS} steps`);

  plan.steps.forEach((step, stepIndex) => {
    const stepProblem = findStepProblem(step, allowedOrigins);
    if (stepProblem !== null) {
      problems.push(`Step ${stepIndex + 1} (${step.action}): ${stepProblem}`);
    }
  });
  return problems;
}

/**
 * Describes why a value is not a structurally valid plan, in plain words
 * instead of zod's issue dump. Only the first few issues are listed.
 * @param error - The failed parse
 * @returns One line naming where each issue is and what it is
 */
function describePlanStructureError(error: z.ZodError): string {
  const describedIssues = error.issues.slice(0, 5).map((issue) => {
    const location = issue.path.length === 0 ? "plan" : issue.path.join(".");
    return `${location}: ${issue.message}`;
  });
  return `The plan does not have the expected shape - ${describedIssues.join("; ")}`;
}

/**
 * Parses a plan's STRUCTURE only (see `ActionPlanSchema`). Used when reading
 * stored plans back, which also restores the field order Postgres `jsonb`
 * shuffles.
 * @param input - A value that should be a plan
 * @returns The typed plan, or why it is not one
 */
export function parseActionPlan(input: unknown): ValidationResult<ActionPlan> {
  const parsed = ActionPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { isValid: false, errorMessage: describePlanStructureError(parsed.error) };
  }
  return { isValid: true, input: parsed.data };
}

/**
 * Fully validates a plan: its structure first - so an unknown action such as
 * "evaluate" or "__proto__" is rejected before any lookup - then every
 * per-action rule (`findActionPlanProblems`).
 * @param input - A value that should be a plan (from Claude, the editor, or the database)
 * @param allowedOrigins - From `buildAllowedPlanOrigins`
 * @returns The typed plan, or every problem joined into one message
 */
export function validateActionPlan(
  input: unknown,
  allowedOrigins: string[],
): ValidationResult<ActionPlan> {
  const structure = parseActionPlan(input);
  if (!structure.isValid) {
    return structure;
  }
  const problems = findActionPlanProblems(structure.input, allowedOrigins);
  const planHasProblems = problems.length > 0;
  if (planHasProblems) {
    return { isValid: false, errorMessage: problems.join("; ") };
  }
  return structure;
}

/**
 * Reports whether a plan types a credential placeholder anywhere, so a run
 * can refuse up front when the action has no credential to fill it with.
 * @param plan - A validated plan
 * @returns True when any `fill` value is a credential placeholder
 */
export function planUsesCredentialPlaceholders(plan: ActionPlan): boolean {
  const placeholderValues: (string | null)[] = Object.values(CREDENTIAL_PLACEHOLDERS);
  return plan.steps.some(
    (step) => step.action === "fill" && placeholderValues.includes(step.value),
  );
}
