import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import {
  closeBrowserQuietly,
  measureElapsedMs,
  summarizeError,
  type ScreenshotTimingSettings,
} from "./playwrightService.js";
import { logInWithCredential, type CrawlLoginDetails } from "./crawlerLoginService.js";
import {
  CREDENTIAL_PLACEHOLDERS,
  readHttpOrigin,
  type ActionPlan,
  type PlanStep,
  type PlanTarget,
} from "../utils/actionPlanSchema.js";
import { capSnapshot } from "../utils/selectRelevantCrawledPages.js";
import {
  FORM_CONTAINER_SELECTOR,
  FORM_FIELD_SELECTOR,
  FORM_FIELD_SELECTORS,
  cleanRawFormFields,
  readRawFormFields,
} from "../utils/formFields.js";
import type { InsertedPlanStep } from "../utils/actionParameters.js";
import type { RunFieldReading } from "../utils/detectActionParameters.js";

/** How long a run may take before it is stopped: 5 minutes (the user's choice). */
export const PLAN_RUN_TIMEOUT_MS = 300_000;

/** How long each step may wait for its element, as the old script template did. */
export const PLAN_STEP_TIMEOUT_MS = 10_000;

/** How long `goto` and `waitForUrl` may wait for a page to load. */
export const PLAN_NAVIGATION_TIMEOUT_MS = 30_000;

/** The pause between typed characters, so typing looks like a person's. */
export const TYPING_DELAY_MS = 100;

/** The pause the visible browser adds between Playwright calls, so a person can follow along. */
export const PLAN_RUN_SLOW_MO_MS = 100;

/**
 * The most output a run keeps, in characters. When a run logs more, the
 * EARLY part is dropped, because the end holds the error and the last steps.
 */
export const PLAN_OUTPUT_CHARACTER_LIMIT = 200_000;

/** The screenshot a failed run writes into its run folder. */
export const FAILURE_SCREENSHOT_FILE_NAME = "failure.png";

/** What credential values are replaced by in error messages and the log. */
const SCRUBBED_SECRET = "••••••";

/** The 1280x720 viewport every browser in the app uses. */
const PLAN_RUN_VIEWPORT = { width: 1280, height: 720 };

/** How long the runner reads the fields around a step it typed into, before giving up on the reading. */
export const FIELD_READ_TIMEOUT_MS = 2000;

/** How long after the confirm step the runner watches for an error before calling it a success. */
export const CONFIRM_CHECK_WINDOW_MS = 2000;

/** How often the confirm check looks at the page within its window. */
const CONFIRM_CHECK_INTERVAL_MS = 200;

/** The elements that show a message the page wants noticed: alerts and alert dialogs. */
const ALERT_SELECTOR = "[role=alert], [role=alertdialog]";

/** Words that make a new alert read as an error. */
const ERROR_ALERT_PATTERN =
  /\b(error|fail(ed|ure|s)?|invalid|required|already|taken|exists|could ?n[o']t|cannot|can't|unable|wrong|denied|not allowed|missing)\b/i;

/** Words that make a new alert read as a success (when no error word is in it). */
const SUCCESS_ALERT_PATTERN = /\b(success(ful(ly)?)?|created|saved|added|updated|done|thank you)\b/i;

/**
 * What a run does differently because of its parameter values (see
 * `applyParameterValues`): steps it skips, steps it adds, values it scrubs,
 * steps after which it reads the form's fields, and - for a Create action -
 * the confirm step it checks.
 */
export interface PlanParameterRun {
  /** The plan steps (1-based) to skip, because a blank optional parameter uses them. */
  skippedStepNumbers: number[];
  /** Steps to add after plan steps (added fields with a value). */
  insertedSteps: InsertedPlanStep[];
  /** Secret parameter values, scrubbed like the credential's. */
  secretValues: string[];
  /** The plan steps (1-based) after which the fields of the step's form are read. */
  readFieldsAfterStepNumbers: number[];
  /** The step that submits a Create action's form, or null. */
  confirmStepNumber: number | null;
}

/** A run with no parameter changes: nothing skipped, added, read, or checked. */
export const NO_PARAMETER_RUN: PlanParameterRun = {
  skippedStepNumbers: [],
  insertedSteps: [],
  secretValues: [],
  readFieldsAfterStepNumbers: [],
  confirmStepNumber: null,
};

/** The credential a run logs in as, already decrypted. */
export interface PlanRunLogin {
  /** The credential's name, for the log. */
  credentialName: string;
  /** Where and as whom to log in (see `buildCrawlLoginDetails`). */
  details: CrawlLoginDetails;
}

/** Everything one run needs. */
export interface ActionPlanRunRequest {
  /** The plan to run, already validated (`validateActionPlan`). */
  plan: ActionPlan;
  /** The credential to log in as before the first step, or null to run logged out. */
  login: PlanRunLogin | null;
  /** The website's network idle cap and minimum wait, which the login waits by. */
  timingSettings: ScreenshotTimingSettings;
  /** The origins credential values may be typed on (see `buildAllowedPlanOrigins`). */
  allowedOrigins: string[];
  /** Absolute path of this run's own (new) folder; `failure.png` is written there. */
  runDirectory: string;
  /** Absolute path of the folder `uploadFile` steps pick their files from. */
  uploadsDirectory: string;
  /** What the run's parameter values change (see `PlanParameterRun`). */
  parameterRun: PlanParameterRun;
}

/** What one run produced. */
export interface ActionPlanRunResult {
  /** True only when the login (if any) and every step finished in time. */
  succeeded: boolean;
  /** True when the run hit `PLAN_RUN_TIMEOUT_MS` and was stopped. */
  timedOut: boolean;
  /** Why the run stopped (first line, credential values scrubbed), or null when it passed. */
  errorMessage: string | null;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** The step log, capped to its tail. */
  output: string;
  /** True when the cap dropped the start of the output. */
  outputWasTruncated: boolean;
  /** True when `failure.png` was written into the run folder. */
  failureScreenshotWasCaptured: boolean;
  /** The address the browser was on when the run failed (credential values scrubbed); null when it passed or it could not be read. */
  failingPageUrl: string | null;
  /** The aria snapshot of the failing page's `<body>`, scrubbed and cut by `capSnapshot`; null when it passed or none could be taken. */
  failingPageAriaSnapshot: string | null;
  /** Milliseconds from browser launch to browser close. */
  durationMs: number;
  /** The fields read around each step the run typed a parameter into. */
  fieldReadings: RunFieldReading[];
  /** Whether the confirm step ran with no error showing; null when the run has none or never reached it. */
  confirmStepSucceeded: boolean | null;
  /** The address right after the confirm step (scrubbed), or null. */
  pageUrlAfterConfirm: string | null;
  /** The address the browser was on when the run ended (scrubbed), or null when it could not be read. */
  finalPageUrl: string | null;
}

/** What a run noticed along the way, beside passing or failing. */
interface RunObservations {
  /** See `ActionPlanRunResult.fieldReadings`. */
  fieldReadings: RunFieldReading[];
  /** See `ActionPlanRunResult.confirmStepSucceeded`. */
  confirmStepSucceeded: boolean | null;
  /** See `ActionPlanRunResult.pageUrlAfterConfirm`. */
  pageUrlAfterConfirm: string | null;
}

/**
 * What a failed run saves about the page it stopped on, so a person - and a
 * refinement request to Claude - can see what went wrong.
 */
interface FailureEvidence {
  /** True when `failure.png` was written into the run folder. */
  failureScreenshotWasCaptured: boolean;
  /** The page's address (credential values scrubbed); null when it could not be read or the page was blank. */
  failingPageUrl: string | null;
  /** The aria snapshot of the page's `<body>` (scrubbed, NUL-free, cut by `capSnapshot`); null when none could be taken. */
  failingPageAriaSnapshot: string | null;
}

/** The evidence of a run that passed: nothing was captured. */
const NO_FAILURE_EVIDENCE: FailureEvidence = {
  failureScreenshotWasCaptured: false,
  failingPageUrl: null,
  failingPageAriaSnapshot: null,
};

/** The address a page has before it opened anything. */
const BLANK_PAGE_URL = "about:blank";

/** Where a run stopped, and why. */
interface PlanRunFailure {
  /** The 1-based step, or null when it stopped before the first step. */
  failedStepNumber: number | null;
  /** Why it stopped. */
  errorMessage: string;
}

/** What a step needs besides the page: the credential values, the allowed origins, and where to log and pick files from. */
export interface PlanStepContext {
  /** The credential's username and password, or null for a logged-out run. */
  credentialValues: { username: string; password: string } | null;
  /** The origins credential values may be typed on. */
  allowedOrigins: string[];
  /** The folder `uploadFile` steps pick from. */
  uploadsDirectory: string;
  /** Appends one line to the run log. */
  log: (line: string) => void;
}

/**
 * Collects a run's log into one string, keeping only the last
 * `PLAN_OUTPUT_CHARACTER_LIMIT` characters.
 */
class RunOutputCollector {
  private collected = "";
  private droppedCharacterCount = 0;

  /**
   * Appends one line, dropping the oldest characters past the cap. NUL
   * characters are removed because Postgres text columns reject them.
   * @param line - One log line, without its newline
   */
  appendLine(line: string): void {
    this.collected += `${line.replaceAll("\u0000", "")}\n`;
    const overflowCharacterCount = this.collected.length - PLAN_OUTPUT_CHARACTER_LIMIT;
    const outputIsOverTheCap = overflowCharacterCount > 0;
    if (outputIsOverTheCap) {
      this.collected = this.collected.slice(overflowCharacterCount);
      this.droppedCharacterCount += overflowCharacterCount;
    }
  }

  /**
   * The collected output, prefixed with a marker when the cap dropped some.
   * @returns The output text and whether anything was dropped
   */
  finish(): { output: string; outputWasTruncated: boolean } {
    const outputWasTruncated = this.droppedCharacterCount > 0;
    const output = outputWasTruncated
      ? `[... ${this.droppedCharacterCount} earlier characters dropped ...]\n${this.collected}`
      : this.collected;
    return { output, outputWasTruncated };
  }
}

/**
 * Describes a target the way a person would point at it, for the log.
 * @param target - The step's target
 * @returns e.g. `button "Sign in"` or `the field labelled "Email"`
 */
export function describePlanTarget(target: PlanTarget): string {
  if ("role" in target) {
    const targetHasNoName = target.name === "";
    return targetHasNoName ? `the ${target.role}` : `${target.role} "${target.name}"`;
  }
  if ("label" in target) return `the field labelled "${target.label}"`;
  if ("placeholder" in target) return `the field with placeholder "${target.placeholder}"`;
  if ("text" in target) return `the text "${target.text}"`;
  if ("altText" in target) return `the image "${target.altText}"`;
  if ("title" in target) return `the element titled "${target.title}"`;
  return `the element matching CSS "${target.css}"`;
}

/**
 * Describes one step for the log. Typed text is NEVER included - it may be
 * a credential's username or password.
 * @param step - A validated step
 * @returns One short sentence, e.g. `Type into textbox "Password"`
 */
export function describePlanStep(step: PlanStep): string {
  const targetText = step.target === null ? "" : describePlanTarget(step.target);
  switch (step.action) {
    case "goto":
      return `Go to ${step.value ?? ""}`;
    case "click":
      return `Click ${targetText}`;
    case "doubleClick":
      return `Double-click ${targetText}`;
    case "hover":
      return `Hover over ${targetText}`;
    case "fill":
      return `Type into ${targetText}`;
    case "press":
      return step.target === null ? `Press ${step.value ?? ""}` : `Press ${step.value ?? ""} in ${targetText}`;
    case "check":
      return `Check ${targetText}`;
    case "uncheck":
      return `Uncheck ${targetText}`;
    case "selectOption":
      return `Select "${step.value ?? ""}" in ${targetText}`;
    case "scrollIntoView":
      return `Scroll to ${targetText}`;
    case "scroll":
      return `Scroll by ${step.value ?? ""} pixels`;
    case "uploadFile":
      return `Upload "${step.value ?? ""}" with ${targetText}`;
    case "respondToNextDialog":
      return `Answer the next browser dialog with "${step.value ?? ""}"`;
    case "waitForUrl":
      return `Wait for the address ${step.value ?? ""}`;
    case "expectVisible":
      return `Check that ${targetText} is visible`;
    case "expectHidden":
      return `Check that ${targetText} is hidden`;
    case "log":
      return `Note: ${step.value ?? ""}`;
  }
}

/**
 * Finds a step's element the way a user would - by role and name, label,
 * placeholder, visible text, alt text, or title - or by CSS as a last resort.
 * @param page - The run's page
 * @param target - The step's target
 * @returns A Playwright locator for it
 */
function locateTarget(page: Page, target: PlanTarget): Locator {
  if ("role" in target) {
    const targetHasNoName = target.name === "";
    return targetHasNoName
      ? page.getByRole(target.role)
      : page.getByRole(target.role, { name: target.name });
  }
  if ("label" in target) return page.getByLabel(target.label);
  if ("placeholder" in target) return page.getByPlaceholder(target.placeholder);
  if ("text" in target) return page.getByText(target.text);
  if ("altText" in target) return page.getByAltText(target.altText);
  if ("title" in target) return page.getByTitle(target.title);
  return page.locator(target.css);
}

/**
 * Reads the element a step acts on. Validation guarantees every step that
 * needs one has one; this is the runtime backstop.
 * @param page - The run's page
 * @param step - The step
 * @returns The step's locator
 * @throws When the step has no target
 */
function requireTarget(page: Page, step: PlanStep): Locator {
  if (step.target === null) {
    throw new Error(`The ${step.action} step needs a target`);
  }
  return locateTarget(page, step.target);
}

/**
 * Reads a step's value. Validation guarantees every step that needs one has
 * one; this is the runtime backstop.
 * @param step - The step
 * @returns The value
 * @throws When the step has no value
 */
function requireValue(step: PlanStep): string {
  if (step.value === null) {
    throw new Error(`The ${step.action} step needs a value`);
  }
  return step.value;
}

/**
 * Works out what a `fill` step types: its literal text, or - for a credential
 * placeholder - the credential's real value, but only while the page is on
 * one of the website's own origins, so a page that redirected elsewhere can
 * never receive the credential.
 * @param page - The run's page
 * @param text - The step's value
 * @param context - The credential values and allowed origins
 * @returns The text to type
 * @throws When the placeholder needs a credential the run does not have, or the page is on another site
 */
function resolveFillText(page: Page, text: string, context: PlanStepContext): string {
  const textIsTheUsername = text === CREDENTIAL_PLACEHOLDERS.username;
  const textIsThePassword = text === CREDENTIAL_PLACEHOLDERS.password;
  const textIsAPlaceholder = textIsTheUsername || textIsThePassword;
  if (!textIsAPlaceholder) return text;

  const { credentialValues } = context;
  if (credentialValues === null) {
    throw new Error(`${text} needs a credential, but this action runs logged out`);
  }
  const pageOrigin = readHttpOrigin(page.url());
  const pageIsOnTheWebsite = pageOrigin !== null && context.allowedOrigins.includes(pageOrigin);
  if (!pageIsOnTheWebsite) {
    throw new Error(
      `Refusing to type the credential on ${pageOrigin ?? page.url()}, which is not this website`,
    );
  }
  return textIsTheUsername ? credentialValues.username : credentialValues.password;
}

/**
 * Types into a field the way a person replaces its text: click it, select
 * what is there (Ctrl/Cmd+A), and type one key at a time. Never `.fill()`,
 * which sets the whole value at once. Long texts get a longer timeout, since
 * typing takes `TYPING_DELAY_MS` per character.
 * @param field - The field's locator
 * @param text - The text to type
 * @returns Resolves once the text is typed
 */
async function typeLikeAPerson(field: Locator, text: string): Promise<void> {
  await field.click();
  await field.press("ControlOrMeta+A");
  const textIsEmpty = text === "";
  if (textIsEmpty) {
    await field.press("Backspace");
    return;
  }
  const typingTimeoutMs = PLAN_STEP_TIMEOUT_MS + text.length * TYPING_DELAY_MS;
  await field.pressSequentially(text, { delay: TYPING_DELAY_MS, timeout: typingTimeoutMs });
}

/**
 * Picks a file the way a user does: click the element that opens the file
 * chooser, then choose the file in it. The file must sit directly in the
 * uploads folder (validation already refused names with a folder in them).
 * @param page - The run's page
 * @param opener - The button or link that opens the chooser
 * @param fileName - The file's name in the uploads folder
 * @param uploadsDirectory - The uploads folder
 * @returns Resolves once the file is chosen
 */
async function uploadFileThroughChooser(
  page: Page,
  opener: Locator,
  fileName: string,
  uploadsDirectory: string,
): Promise<void> {
  const filePath = path.resolve(uploadsDirectory, fileName);
  const fileIsInTheUploadsFolder = path.dirname(filePath) === path.resolve(uploadsDirectory);
  if (!fileIsInTheUploadsFolder) {
    throw new Error(`"${fileName}" is not a file in the uploads folder`);
  }
  const chooserPromise = page.waitForEvent("filechooser");
  // When the click below fails, nobody awaits the chooser; this keeps its
  // eventual rejection from becoming an unhandled one that stops the server.
  chooserPromise.catch(() => undefined);
  await opener.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(filePath);
}

/**
 * Runs ONE step. This exhaustive `switch` is the only code a plan can reach:
 * each allowed action maps to the one Playwright call a user's action
 * corresponds to, and anything else - which validation already rejected -
 * falls through to `default` and throws. Nothing from the plan is ever
 * turned into code.
 * @param page - The run's page
 * @param step - A validated step
 * @param context - Credential values, allowed origins, uploads folder, and the log
 * @returns Resolves once the step is done
 * @throws Whatever Playwright throws when the step cannot be done (element missing, timeout, ...)
 */
export async function runPlanStep(page: Page, step: PlanStep, context: PlanStepContext): Promise<void> {
  switch (step.action) {
    case "goto":
      await page.goto(requireValue(step));
      return;
    case "click":
      await requireTarget(page, step).click();
      return;
    case "doubleClick":
      await requireTarget(page, step).dblclick();
      return;
    case "hover":
      await requireTarget(page, step).hover();
      return;
    case "fill":
      await typeLikeAPerson(
        requireTarget(page, step),
        resolveFillText(page, requireValue(step), context),
      );
      return;
    case "press": {
      const key = requireValue(step);
      const stepPressesWhereTheFocusIs = step.target === null;
      if (stepPressesWhereTheFocusIs) {
        await page.keyboard.press(key);
      } else {
        await requireTarget(page, step).press(key);
      }
      return;
    }
    case "check":
      await requireTarget(page, step).check();
      return;
    case "uncheck":
      await requireTarget(page, step).uncheck();
      return;
    case "selectOption":
      await requireTarget(page, step).selectOption({ label: requireValue(step) });
      return;
    case "scrollIntoView":
      await requireTarget(page, step).scrollIntoViewIfNeeded();
      return;
    case "scroll":
      await page.mouse.wheel(0, Number(requireValue(step)));
      return;
    case "uploadFile":
      await uploadFileThroughChooser(
        page,
        requireTarget(page, step),
        requireValue(step),
        context.uploadsDirectory,
      );
      return;
    case "respondToNextDialog": {
      const dialogShouldBeAccepted = requireValue(step) === "accept";
      page.once("dialog", (dialog) => {
        const answer = dialogShouldBeAccepted ? dialog.accept() : dialog.dismiss();
        // A dialog answered as the page closes rejects; that must not become
        // an unhandled rejection that stops the server.
        answer.catch(() => undefined);
      });
      return;
    }
    case "waitForUrl":
      // A plain string is a glob pattern (or an exact URL); it is never
      // turned into a RegExp, so no pattern can hang the server.
      await page.waitForURL(requireValue(step));
      return;
    case "expectVisible":
      await requireTarget(page, step).waitFor({ state: "visible" });
      return;
    case "expectHidden":
      await requireTarget(page, step).waitFor({ state: "hidden" });
      return;
    case "log":
      // The message is already in the log: walkPlan writes every step's
      // description (`Note: <message>`) before running it.
      return;
    default: {
      const unknownAction: never = step.action;
      throw new Error(`"${String(unknownAction)}" is not an allowed step action`);
    }
  }
}

/**
 * Replaces every credential value in a message, so neither the log nor the
 * stored error can reveal it. Playwright's own messages can echo typed text.
 * @param message - Any text that may contain a credential value
 * @param secrets - The values to hide (empty ones are skipped)
 * @returns The message with each value replaced
 */
export function scrubSecrets(message: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret !== "")
    .reduce((scrubbed, secret) => scrubbed.replaceAll(secret, SCRUBBED_SECRET), message);
}

/**
 * Reads the fields of the form or dialog around the field a step just typed
 * into (see `readRawFormFields`), so the run learns which of them the page
 * marks required, and which other fields sit beside it. A reading is a bonus:
 * one that fails or takes longer than `FIELD_READ_TIMEOUT_MS` gives none.
 * @param page - The run's page
 * @param step - The step that typed
 * @param stepNumber - Its 1-based number
 * @returns The reading, or null when none could be taken
 */
async function readFieldsAroundStep(page: Page, step: PlanStep, stepNumber: number): Promise<RunFieldReading | null> {
  try {
    const rawFieldRead = await requireTarget(page, step)
      .first()
      .evaluate(readRawFormFields, FORM_FIELD_SELECTORS, { timeout: FIELD_READ_TIMEOUT_MS });
    return {
      stepNumber,
      pageUrl: page.url(),
      fields: cleanRawFormFields(rawFieldRead.fields),
      targetFieldIndex: rawFieldRead.startFieldIndex,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the text of every alert the page shows now.
 * @param page - The run's page
 * @returns Each non-empty alert's text; empty when none could be read
 */
async function readAlertTexts(page: Page): Promise<string[]> {
  try {
    const alertTexts = await page.locator(ALERT_SELECTOR).allInnerTexts();
    return alertTexts.map((alertText) => alertText.trim()).filter((alertText) => alertText !== "");
  } catch {
    return [];
  }
}

/**
 * Decides whether an alert reads as an error: it has an error word, or it
 * has no success word ("Saved", "Created", ...).
 * @param alertText - The alert's text
 * @returns True when it reads as an error
 */
export function alertReadsAsAnError(alertText: string): boolean {
  if (ERROR_ALERT_PATTERN.test(alertText)) return true;
  return !SUCCESS_ALERT_PATTERN.test(alertText);
}

/**
 * Checks whether the form a confirm step submitted is still there and shows
 * a field the browser or the page marks invalid (`aria-invalid="true"`, or
 * the browser's own `:user-invalid` after a submit attempt).
 * @param container - The form or dialog the confirm button sat in, or null when it sat in none
 * @returns Whether the form is gone, and whether it shows an invalid field
 */
async function readSubmittedFormState(
  container: Awaited<ReturnType<Locator["evaluateHandle"]>> | null,
): Promise<{ formIsGone: boolean; formShowsAnInvalidField: boolean }> {
  if (container === null) return { formIsGone: false, formShowsAnInvalidField: false };
  try {
    return await container.evaluate(
      (element, fieldSelector) => {
        const formIsGone = !(element instanceof Element) || !element.isConnected;
        if (formIsGone) return { formIsGone: true, formShowsAnInvalidField: false };
        const invalidFields = Array.from(element.querySelectorAll(fieldSelector)).filter((field) => {
          try {
            return field.getAttribute("aria-invalid") === "true" || field.matches(":user-invalid");
          } catch {
            return field.getAttribute("aria-invalid") === "true";
          }
        });
        return { formIsGone: false, formShowsAnInvalidField: invalidFields.length > 0 };
      },
      FORM_FIELD_SELECTOR,
    );
  } catch {
    return { formIsGone: false, formShowsAnInvalidField: false };
  }
}

/**
 * Runs a Create action's confirm step - the click that submits its form -
 * and checks it did not error out: for `CONFIRM_CHECK_WINDOW_MS` afterwards
 * it watches for a new alert that reads as an error (see
 * `alertReadsAsAnError`) and for an invalid field in the submitted form. The
 * watch ends early once the form is gone or the address changed.
 * @param page - The run's page
 * @param step - The confirm step
 * @param context - What each step needs
 * @returns Null when the step succeeded; otherwise why the page says it did not (the step itself throwing is rethrown)
 * @throws Whatever the step itself throws
 */
async function runConfirmStep(page: Page, step: PlanStep, context: PlanStepContext): Promise<string | null> {
  const alertsBefore = await readAlertTexts(page);
  const urlBefore = page.url();
  const container =
    step.target === null
      ? null
      : await requireTarget(page, step)
          .first()
          .evaluateHandle(
            (element, containerSelector) => element.closest(containerSelector),
            FORM_CONTAINER_SELECTOR,
            { timeout: FIELD_READ_TIMEOUT_MS },
          )
          .catch(() => null);
  await runPlanStep(page, step, context);

  const watchEndsAt = performance.now() + CONFIRM_CHECK_WINDOW_MS;
  while (performance.now() < watchEndsAt) {
    const newErrorAlert = (await readAlertTexts(page)).find(
      (alertText) => !alertsBefore.includes(alertText) && alertReadsAsAnError(alertText),
    );
    if (newErrorAlert !== undefined) return `the page showed "${newErrorAlert.split("\n")[0]}"`;
    const formState = await readSubmittedFormState(container);
    if (formState.formShowsAnInvalidField) return "the form still shows a field marked invalid";
    const pageMovedOn = formState.formIsGone || page.url() !== urlBefore;
    if (pageMovedOn) return null;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_CHECK_INTERVAL_MS));
  }
  return null;
}

/**
 * Runs one plan step - through the confirm check when it is the confirm
 * step (an error the page shows is noted, not thrown: the run goes on, and
 * only the created object is not recorded) - then reads its form's fields
 * when it typed a parameter.
 * @param page - The run's page
 * @param step - The step
 * @param stepNumber - Its 1-based number
 * @param request - The run's request (its parameter changes)
 * @param context - What each step needs
 * @param observations - What the run noticed (changed in place)
 * @returns Resolves once the step is done
 * @throws Whatever the step throws
 */
async function runWalkedStep(
  page: Page,
  step: PlanStep,
  stepNumber: number,
  request: ActionPlanRunRequest,
  context: PlanStepContext,
  observations: RunObservations,
): Promise<void> {
  const { parameterRun } = request;
  const stepIsTheConfirmStep = stepNumber === parameterRun.confirmStepNumber;
  if (stepIsTheConfirmStep) {
    observations.confirmStepSucceeded = false;
    const confirmError = await runConfirmStep(page, step, context);
    observations.pageUrlAfterConfirm = page.url();
    const confirmShowedNoError = confirmError === null;
    observations.confirmStepSucceeded = confirmShowedNoError;
    context.log(
      confirmShowedNoError
        ? "✔ Confirmed - no error showed, so the new object is recorded"
        : `✘ The confirm step showed an error (${confirmError}), so no new object is recorded`,
    );
  } else {
    await runPlanStep(page, step, context);
  }
  if (parameterRun.readFieldsAfterStepNumbers.includes(stepNumber)) {
    const fieldReading = await readFieldsAroundStep(page, step, stepNumber);
    if (fieldReading !== null) observations.fieldReadings.push(fieldReading);
  }
}

/**
 * Logs in (when the run has a credential), opens the start URL, and runs
 * every step in order, stopping at the first one that fails. Steps a blank
 * optional parameter uses are skipped (and logged as skipped); the steps an
 * added field brings run right after the step they follow, and a failure in
 * one is reported at that step.
 * @param page - The run's page
 * @param request - The plan, login, folders, and parameter changes
 * @param context - What each step needs
 * @param observations - What the run noticed (changed in place)
 * @returns Null when everything ran; otherwise where it stopped and why
 */
async function walkPlan(
  page: Page,
  request: ActionPlanRunRequest,
  context: PlanStepContext,
  observations: RunObservations,
): Promise<PlanRunFailure | null> {
  const { plan, login, parameterRun } = request;
  if (login !== null) {
    context.log(`Log in as "${login.credentialName}"`);
    const loginAttempt = await logInWithCredential(page, login.details, request.timingSettings);
    if (!loginAttempt.loggedIn) {
      return {
        failedStepNumber: null,
        errorMessage: `Could not log in as "${login.credentialName}": ${loginAttempt.errorMessage}`,
      };
    }
    context.log("✔ Logged in");
  }

  context.log(`Open ${plan.startUrl}`);
  try {
    await page.goto(plan.startUrl);
  } catch (error: unknown) {
    return {
      failedStepNumber: null,
      errorMessage: `Could not open the start URL: ${summarizeError(error)}`,
    };
  }

  for (const [stepIndex, step] of plan.steps.entries()) {
    const stepNumber = stepIndex + 1;
    const stepIsSkipped = parameterRun.skippedStepNumbers.includes(stepNumber);
    if (stepIsSkipped) {
      context.log(`Step ${stepNumber}: skipped (its parameter was left blank) - ${describePlanStep(step)}`);
    } else {
      context.log(`Step ${stepNumber}: ${describePlanStep(step)}`);
      try {
        await runWalkedStep(page, step, stepNumber, request, context, observations);
      } catch (error: unknown) {
        return { failedStepNumber: stepNumber, errorMessage: summarizeError(error) };
      }
    }
    const addedSteps = parameterRun.insertedSteps.filter((insertedStep) => insertedStep.afterStepNumber === stepNumber);
    for (const addedStep of addedSteps) {
      context.log(`Step ${stepNumber} (added field): ${describePlanStep(addedStep.step)}`);
      try {
        await runPlanStep(page, addedStep.step, context);
      } catch (error: unknown) {
        return {
          failedStepNumber: stepNumber,
          errorMessage: `The added field after step ${stepNumber} could not be filled in: ${summarizeError(error)}`,
        };
      }
    }
  }
  return null;
}

/**
 * Saves what the browser shows, for a failed run. Never rejects: the run has
 * already failed, and a screenshot that cannot be taken (e.g. the browser
 * already closed) must not turn that into a different error.
 * @param page - The run's page
 * @param screenshotPath - Absolute path of the PNG to write
 * @returns True when the PNG was written
 */
async function captureFailureScreenshot(page: Page, screenshotPath: string): Promise<boolean> {
  try {
    await page.screenshot({ path: screenshotPath, timeout: PLAN_STEP_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the address the browser is on (when the run failed, or ended).
 * Never throws: a page that can no longer be asked (e.g. already closed)
 * just has no address.
 * @param page - The run's page
 * @param secrets - The credential values to scrub from the address
 * @returns The scrubbed address, or null when it is blank or could not be read
 */
function readScrubbedPageUrl(page: Page, secrets: string[]): string | null {
  try {
    const pageUrl = page.url();
    const pageHasNoAddress = pageUrl === "" || pageUrl === BLANK_PAGE_URL;
    if (pageHasNoAddress) return null;
    return scrubSecrets(pageUrl, secrets);
  } catch {
    return null;
  }
}

/**
 * Takes the aria snapshot of the failing page's `<body>` - the same outline
 * the crawler records - so the failing page's real roles and names can be
 * compared with the plan's targets. Credential values are scrubbed (a field
 * can show a typed username), NUL characters are removed (Postgres text
 * columns reject them), and the result is cut by `capSnapshot`. Never
 * rejects: the run has already failed, and a snapshot that cannot be taken
 * must not turn that into a different error.
 * @param page - The run's page
 * @param secrets - The credential values to scrub from the snapshot
 * @returns The cleaned snapshot, or null when none could be taken
 */
async function takeFailingPageAriaSnapshot(page: Page, secrets: string[]): Promise<string | null> {
  try {
    const ariaSnapshot = await page.locator("body").ariaSnapshot({ timeout: PLAN_STEP_TIMEOUT_MS });
    const scrubbedSnapshot = scrubSecrets(ariaSnapshot, secrets).replaceAll("\u0000", "");
    return capSnapshot(scrubbedSnapshot);
  } catch {
    return null;
  }
}

/**
 * Saves everything a failed run can tell about the page it stopped on, in
 * this order: the screenshot (`failure.png`), the page's address, and the
 * page's aria snapshot. Must be called while the browser is still open.
 * Never rejects: each piece that cannot be captured is simply missing.
 * @param page - The run's page
 * @param screenshotPath - Absolute path of the PNG to write
 * @param secrets - The credential values to scrub from the address and the snapshot
 * @returns Whether the screenshot was written, and the address and snapshot (each null when unavailable)
 */
async function captureFailureEvidence(
  page: Page,
  screenshotPath: string,
  secrets: string[],
): Promise<FailureEvidence> {
  const failureScreenshotWasCaptured = await captureFailureScreenshot(page, screenshotPath);
  const failingPageUrl = readScrubbedPageUrl(page, secrets);
  const failingPageAriaSnapshot = await takeFailingPageAriaSnapshot(page, secrets);
  return { failureScreenshotWasCaptured, failingPageUrl, failingPageAriaSnapshot };
}

/**
 * Runs a validated plan in a visible browser on this machine and reports
 * what happened - the JSON plan is never turned into code: every step goes
 * through `runPlanStep`'s fixed `switch`.
 *
 * 1. The run folder is created BEFORE the browser launches, so a bad folder
 *    fails with nothing started.
 * 2. With a credential, the browser first logs in with the crawler's own
 *    login routine (`logInWithCredential`); a failed login fails the run
 *    before any step.
 * 3. The browser opens `startUrl`, then each step runs in order; the first
 *    failure stops the run.
 * 4. After `PLAN_RUN_TIMEOUT_MS` the run is stopped: the failure evidence
 *    (below) is captured, then the browser is closed, which makes the
 *    pending step reject.
 * 5. A failed run - in time or stopped by the time limit - captures its
 *    failure evidence BEFORE the browser closes (`captureFailureEvidence`):
 *    it writes `failure.png` into its run folder, then reads the failing
 *    page's address and takes its aria snapshot. A passing run captures none
 *    of it.
 *
 * Credential values - and secret parameter values - are only ever in
 * memory: they are scrubbed from every error message, the failing page's
 * address, its snapshot, and the final address, and the log never includes
 * typed text.
 *
 * The run's parameter changes (`request.parameterRun`) skip and add steps,
 * read the fields around each parameter step, and check a Create action's
 * confirm step (see `walkPlan`).
 * @param request - The plan, login, timing settings, origins, folders, and parameter changes
 * @returns The outcome, the log, whether a failure screenshot was written, the failing page's address and aria snapshot, the field readings, the confirm check, and the final address
 * @throws When the run folder cannot be created or the browser cannot be launched
 */
export async function runActionPlan(request: ActionPlanRunRequest): Promise<ActionPlanRunResult> {
  await mkdir(request.runDirectory, { recursive: true });
  const screenshotPath = path.join(request.runDirectory, FAILURE_SCREENSHOT_FILE_NAME);
  const outputCollector = new RunOutputCollector();
  const { login } = request;
  const credentialSecrets = login === null ? [] : [login.details.password, login.details.username];
  const secrets = [...credentialSecrets, ...request.parameterRun.secretValues];
  const observations: RunObservations = { fieldReadings: [], confirmStepSucceeded: null, pageUrlAfterConfirm: null };
  /**
   * Appends one line to the run log, with any credential value scrubbed.
   * @param line - The line
   */
  const log = (line: string): void => {
    outputCollector.appendLine(scrubSecrets(line, secrets));
  };
  const context: PlanStepContext = {
    credentialValues:
      login === null ? null : { username: login.details.username, password: login.details.password },
    allowedOrigins: request.allowedOrigins,
    uploadsDirectory: request.uploadsDirectory,
    log,
  };

  const startedAt = performance.now();
  const browser = await chromium.launch({ headless: true, slowMo: PLAN_RUN_SLOW_MO_MS });
  // Kept on an object because the timer below changes it from a callback.
  const timeLimit: { wasHit: boolean; stopping: Promise<FailureEvidence> | null } = {
    wasHit: false,
    stopping: null,
  };
  let failure: PlanRunFailure | null = null;
  let failureEvidence: FailureEvidence = NO_FAILURE_EVIDENCE;
  let finalPageUrl: string | null = null;

  try {
    const page = await browser.newPage({ viewport: PLAN_RUN_VIEWPORT });
    page.setDefaultTimeout(PLAN_STEP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PLAN_NAVIGATION_TIMEOUT_MS);

    /**
     * Stops a run that hit the time limit: the failure evidence first (the
     * screenshot, the address, and the aria snapshot), while the page is
     * still open, then close the browser so the pending step rejects.
     * @returns The failure evidence that could be captured
     */
    const stopTimedOutRun = async (): Promise<FailureEvidence> => {
      const timedOutRunEvidence = await captureFailureEvidence(page, screenshotPath, secrets);
      await closeBrowserQuietly(browser);
      return timedOutRunEvidence;
    };
    /** Starts stopping the run; the promise is awaited below. */
    const handleTimeLimit = (): void => {
      timeLimit.wasHit = true;
      timeLimit.stopping = stopTimedOutRun();
    };
    const timeoutTimer = setTimeout(handleTimeLimit, PLAN_RUN_TIMEOUT_MS);

    try {
      failure = await walkPlan(page, request, context, observations);
    } finally {
      clearTimeout(timeoutTimer);
    }

    if (timeLimit.stopping !== null) {
      failureEvidence = await timeLimit.stopping;
    }
    const runFailedInTime = failure !== null && !timeLimit.wasHit;
    if (runFailedInTime) {
      failureEvidence = await captureFailureEvidence(page, screenshotPath, secrets);
    }
    // A failed run's evidence already read the address; a passed run reads it now.
    finalPageUrl = failure === null ? readScrubbedPageUrl(page, secrets) : failureEvidence.failingPageUrl;
  } finally {
    await closeBrowserQuietly(browser);
  }

  if (timeLimit.wasHit) {
    failure = {
      failedStepNumber: failure?.failedStepNumber ?? null,
      errorMessage: `Stopped after ${PLAN_RUN_TIMEOUT_MS / 60_000} minutes (the time limit)`,
    };
  }
  const errorMessage = failure === null ? null : scrubSecrets(failure.errorMessage, secrets);
  if (errorMessage === null) {
    log("✔ Use case completed");
  } else {
    const failedStepNumber = failure?.failedStepNumber ?? null;
    const stopPoint = failedStepNumber === null ? "" : ` at step ${failedStepNumber}`;
    log(`✘ Stopped${stopPoint}: ${errorMessage}`);
  }
  const { output, outputWasTruncated } = outputCollector.finish();

  return {
    succeeded: failure === null,
    timedOut: timeLimit.wasHit,
    errorMessage,
    failedStepNumber: failure?.failedStepNumber ?? null,
    output,
    outputWasTruncated,
    failureScreenshotWasCaptured: failureEvidence.failureScreenshotWasCaptured,
    failingPageUrl: failureEvidence.failingPageUrl,
    failingPageAriaSnapshot: failureEvidence.failingPageAriaSnapshot,
    durationMs: measureElapsedMs(startedAt),
    fieldReadings: observations.fieldReadings,
    confirmStepSucceeded: observations.confirmStepSucceeded,
    pageUrlAfterConfirm:
      observations.pageUrlAfterConfirm === null ? null : scrubSecrets(observations.pageUrlAfterConfirm, secrets),
    finalPageUrl,
  };
}
