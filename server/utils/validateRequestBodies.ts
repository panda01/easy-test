import type {
  WebsiteInput,
  TitleDescriptionInput,
  ActionInput,
  CredentialInput,
} from "../services/dbService.js";
import { type ActionPlan, validateActionPlan } from "./actionPlanSchema.js";
import {
  CRAWL_BUTTON_MODES,
  DEFAULT_CRAWL_BUTTON_MODE,
  isCrawlButtonMode,
  type CrawlButtonMode,
} from "./crawlButtonModes.js";

/**
 * The network idle cap a website gets when the request leaves it out. Mirrors
 * the `@default(5000)` on `Website.networkIdleTimeoutMs` in the Prisma schema.
 */
export const DEFAULT_NETWORK_IDLE_TIMEOUT_MS = 5000;

/**
 * The minimum wait a website gets when the request leaves it out. Mirrors the
 * `@default(1)` on `Website.screenshotMinimumWaitMs` in the Prisma schema.
 */
export const DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS = 1;

/** The largest value either screenshot timing setting may have, in milliseconds. */
export const MAX_TIMING_SETTING_MS = 30_000;

/** Why a website's or a credential's login page URL was rejected. */
const LOGIN_URL_INVALID_MESSAGE = "The login page URL must be a valid http:// or https:// address";

/**
 * The outcome of validating a request body. Exactly one of `input` or
 * `errorMessage` is present, selected by `isValid`.
 */
export type ValidationResult<TInput> =
  | { isValid: true; input: TInput }
  | { isValid: false; errorMessage: string };

/**
 * Checks that a parsed request body is a plain JSON object.
 *
 * Express 5 leaves `req.body` undefined when a request has no JSON body, and
 * a client can also send an array or a bare string, so this guard runs before
 * any field is read.
 * @param body - The parsed request body
 * @returns True when `body` is a non-null, non-array object
 */
function isJsonObject(body: unknown): body is Record<string, unknown> {
  const bodyIsAnObject = typeof body === "object" && body !== null;
  const bodyIsAnArray = Array.isArray(body);
  return bodyIsAnObject && !bodyIsAnArray;
}

/**
 * Reads a field as a trimmed string.
 * @param body - The request body object
 * @param fieldName - The property to read
 * @returns The trimmed string, or null when the field is missing or is not a string
 */
function readTrimmedString(body: Record<string, unknown>, fieldName: string): string | null {
  const fieldValue = body[fieldName];
  const fieldIsAString = typeof fieldValue === "string";
  if (!fieldIsAString) {
    return null;
  }
  return fieldValue.trim();
}

/**
 * Reads an optional screenshot timing setting in milliseconds.
 *
 * Only a JSON number is accepted - a numeric string such as "5000" is
 * rejected, so the client must send real numbers.
 * @param rawValue - The field's value as it arrived in the body
 * @param defaultMs - What a missing or null value stands for
 * @returns The setting in milliseconds, or null when the value is not a whole number from 0 to `MAX_TIMING_SETTING_MS`
 */
function readOptionalMilliseconds(rawValue: unknown, defaultMs: number): number | null {
  const valueWasOmitted = rawValue === undefined || rawValue === null;
  if (valueWasOmitted) {
    return defaultMs;
  }
  const valueIsAWholeNumber = typeof rawValue === "number" && Number.isInteger(rawValue);
  if (!valueIsAWholeNumber) {
    return null;
  }
  const valueIsWithinRange = rawValue >= 0 && rawValue <= MAX_TIMING_SETTING_MS;
  return valueIsWithinRange ? rawValue : null;
}

/**
 * Reads an optional text field: a missing, null, or blank value becomes null,
 * and anything else is trimmed.
 * @param body - The request body object
 * @param fieldName - The property to read
 * @returns `{ isText: true, value }` (value null when left out or blank), or `{ isText: false }` when the field holds something other than a string
 */
function readOptionalTrimmedText(
  body: Record<string, unknown>,
  fieldName: string,
): { isText: true; value: string | null } | { isText: false } {
  const rawValue = body[fieldName];
  const valueWasOmitted = rawValue === undefined || rawValue === null;
  if (valueWasOmitted) {
    return { isText: true, value: null };
  }
  const valueIsAString = typeof rawValue === "string";
  if (!valueIsAString) {
    return { isText: false };
  }
  const trimmedValue = rawValue.trim();
  const valueIsBlank = trimmedValue === "";
  return { isText: true, value: valueIsBlank ? null : trimmedValue };
}

/**
 * Parses a URL string and returns its normalized form, but only for http and
 * https addresses.
 *
 * Normalizing with `new URL(...).href` lowercases the scheme and host and adds
 * the root path slash, so `HTTPS://Example.com` and `https://example.com/` are
 * stored identically and collide on the unique index instead of becoming two
 * websites.
 * @param rawUrl - The trimmed URL the client sent
 * @returns The normalized URL, or null when it does not parse or is not http/https
 */
function normalizeHttpUrl(rawUrl: string): string | null {
  const urlParses = URL.canParse(rawUrl);
  if (!urlParses) {
    return null;
  }
  const parsedUrl = new URL(rawUrl);
  const urlIsHttpOrHttps = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  if (!urlIsHttpOrHttps) {
    return null;
  }
  return parsedUrl.href;
}

/**
 * Reads an optional http/https URL field: a missing, null, or blank value
 * becomes null, and anything else must be an http/https address, which is
 * trimmed and normalized like a website's URL (see `normalizeHttpUrl`).
 * @param body - The request body object
 * @param fieldName - The property to read
 * @returns `{ isUrl: true, value }` (value null when left out or blank), or `{ isUrl: false }` when the field holds something other than an http/https address
 */
function readOptionalHttpUrl(
  body: Record<string, unknown>,
  fieldName: string,
): { isUrl: true; value: string | null } | { isUrl: false } {
  const text = readOptionalTrimmedText(body, fieldName);
  if (!text.isText) {
    return { isUrl: false };
  }
  const trimmedUrl = text.value;
  const urlWasLeftOut = trimmedUrl === null;
  if (urlWasLeftOut) {
    return { isUrl: true, value: null };
  }
  const normalizedUrl = normalizeHttpUrl(trimmedUrl);
  if (normalizedUrl === null) {
    return { isUrl: false };
  }
  return { isUrl: true, value: normalizedUrl };
}

/**
 * Validates and normalizes the body of a website create or replace request.
 *
 * - `url` is required, must be an http/https address, and is normalized.
 * - `name` is required.
 * - `description` is optional; a missing, null, or blank value is stored as null.
 * - `networkIdleTimeoutMs` and `screenshotMinimumWaitMs` are optional whole
 *   numbers of milliseconds from 0 to 30000; a missing or null value becomes
 *   the default (5000 and 1). The cap may not be lower than the minimum
 *   wait - when the cap runs out the screenshot is taken at once, so the
 *   minimum must already have passed by then.
 * - `loginUrl` is optional: a missing, null, or blank value is stored as null
 *   (the website doesn't require login); anything else must be an http/https
 *   address, and is normalized like `url`. Credentials without a login URL of
 *   their own log in there.
 * @param body - The parsed request body
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateWebsiteInput(body: unknown): ValidationResult<WebsiteInput> {
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  const rawUrl = readTrimmedString(body, "url");
  const urlIsMissing = rawUrl === null || rawUrl === "";
  if (urlIsMissing) {
    return { isValid: false, errorMessage: "A URL is required" };
  }
  const normalizedUrl = normalizeHttpUrl(rawUrl);
  if (normalizedUrl === null) {
    return {
      isValid: false,
      errorMessage: "The URL must be a valid http:// or https:// address",
    };
  }

  const name = readTrimmedString(body, "name");
  const nameIsMissing = name === null || name === "";
  if (nameIsMissing) {
    return { isValid: false, errorMessage: "A name is required" };
  }

  const rawDescription = body.description;
  const descriptionWasOmitted = rawDescription === undefined || rawDescription === null;
  const descriptionIsAString = typeof rawDescription === "string";
  if (!descriptionWasOmitted && !descriptionIsAString) {
    return { isValid: false, errorMessage: "The description must be text" };
  }
  const trimmedDescription = descriptionIsAString ? rawDescription.trim() : "";
  const descriptionIsBlank = trimmedDescription === "";
  const description = descriptionIsBlank ? null : trimmedDescription;

  const networkIdleTimeoutMs = readOptionalMilliseconds(
    body.networkIdleTimeoutMs,
    DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
  );
  if (networkIdleTimeoutMs === null) {
    return {
      isValid: false,
      errorMessage: `The network idle cap must be a whole number of milliseconds from 0 to ${MAX_TIMING_SETTING_MS}`,
    };
  }
  const screenshotMinimumWaitMs = readOptionalMilliseconds(
    body.screenshotMinimumWaitMs,
    DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
  );
  if (screenshotMinimumWaitMs === null) {
    return {
      isValid: false,
      errorMessage: `The minimum wait must be a whole number of milliseconds from 0 to ${MAX_TIMING_SETTING_MS}`,
    };
  }
  const capIsLowerThanMinimumWait = networkIdleTimeoutMs < screenshotMinimumWaitMs;
  if (capIsLowerThanMinimumWait) {
    return {
      isValid: false,
      errorMessage: "The network idle cap cannot be lower than the minimum wait",
    };
  }

  const loginUrl = readOptionalHttpUrl(body, "loginUrl");
  if (!loginUrl.isUrl) {
    return { isValid: false, errorMessage: LOGIN_URL_INVALID_MESSAGE };
  }

  return {
    isValid: true,
    input: {
      url: normalizedUrl,
      name,
      description,
      networkIdleTimeoutMs,
      screenshotMinimumWaitMs,
      loginUrl: loginUrl.value,
    },
  };
}

/**
 * Validates the body of a use case or action create or replace request. Both
 * `title` and `description` are required, non-blank strings, and both are
 * trimmed.
 * @param body - The parsed request body
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateTitleDescriptionInput(
  body: unknown,
): ValidationResult<TitleDescriptionInput> {
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  const title = readTrimmedString(body, "title");
  const titleIsMissing = title === null || title === "";
  if (titleIsMissing) {
    return { isValid: false, errorMessage: "A title is required" };
  }

  const description = readTrimmedString(body, "description");
  const descriptionIsMissing = description === null || description === "";
  if (descriptionIsMissing) {
    return { isValid: false, errorMessage: "A description is required" };
  }

  return { isValid: true, input: { title, description } };
}

/**
 * Validates the body of an action create or replace request: `title` and
 * `description` exactly as `validateTitleDescriptionInput` checks them, plus
 * the credential the action runs as.
 *
 * `credentialId` is optional: a missing or null value means the action runs
 * logged out - so a PUT that leaves it out UNLINKS the credential, because a
 * PUT replaces the whole action. Otherwise it must be a non-blank string,
 * and is trimmed. Whether that credential exists (and belongs to the same
 * website) is checked by the controller.
 * @param body - The parsed request body
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateActionInput(body: unknown): ValidationResult<ActionInput> {
  const titleDescription = validateTitleDescriptionInput(body);
  if (!titleDescription.isValid) {
    return titleDescription;
  }
  // validateTitleDescriptionInput only succeeds for a JSON object.
  const bodyObject = body as Record<string, unknown>;

  const rawCredentialId = bodyObject.credentialId;
  const credentialIdWasLeftOut = rawCredentialId === undefined || rawCredentialId === null;
  if (credentialIdWasLeftOut) {
    return { isValid: true, input: { ...titleDescription.input, credentialId: null } };
  }
  const credentialId = readTrimmedString(bodyObject, "credentialId");
  const credentialIdIsNotANonBlankString = credentialId === null || credentialId === "";
  if (credentialIdIsNotANonBlankString) {
    return {
      isValid: false,
      errorMessage: "The credential id must be a non-blank string, or null to run logged out",
    };
  }
  return { isValid: true, input: { ...titleDescription.input, credentialId } };
}

/** A "save edited plan" request, as validated. */
export interface ActionPlanEditInput {
  /** The edited plan, fully validated. */
  plan: ActionPlan;
}

/**
 * Validates the body of a "save edited plan" request: `{ plan }`, where the
 * plan must pass every rule a generated plan passes (`validateActionPlan`) -
 * only the allowed step actions, each with the target and value it needs,
 * and nothing that leaves the website's origins.
 * @param body - The parsed request body
 * @param allowedOrigins - The origins the plan may open (see `buildAllowedPlanOrigins`)
 * @returns The validated plan, or every problem found as one message
 */
export function validateActionPlanEditInput(
  body: unknown,
  allowedOrigins: string[],
): ValidationResult<ActionPlanEditInput> {
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }
  const planWasLeftOut = body.plan === undefined || body.plan === null;
  if (planWasLeftOut) {
    return { isValid: false, errorMessage: "A plan is required" };
  }
  const planValidation = validateActionPlan(body.plan, allowedOrigins);
  if (!planValidation.isValid) {
    return planValidation;
  }
  return { isValid: true, input: { plan: planValidation.input } };
}

/**
 * The model and effort level a "Convert to script" request asks for, as sent.
 * Whether that model exists and offers that level is checked afterwards,
 * against the live model catalog.
 */
export interface ScriptModelChoiceInput {
  /** The model identifier string, e.g. "claude-opus-5-5". */
  modelId: string;
  /** The effort level, or null for a model with no effort setting ("Standard"). */
  effort: string | null;
}

/**
 * Validates the body of a "Convert to script" request: `modelId` is a
 * required, non-blank string; `effort` is a non-blank string, or null / left
 * out for "Standard". Both are trimmed.
 * @param body - The parsed request body
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateScriptModelChoiceInput(
  body: unknown,
): ValidationResult<ScriptModelChoiceInput> {
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  const modelId = readTrimmedString(body, "modelId");
  const modelIdIsMissing = modelId === null || modelId === "";
  if (modelIdIsMissing) {
    return { isValid: false, errorMessage: "A model is required" };
  }

  const rawEffort = body.effort;
  const effortIsLeftOut = rawEffort === undefined || rawEffort === null;
  if (effortIsLeftOut) {
    return { isValid: true, input: { modelId, effort: null } };
  }
  const effort = readTrimmedString(body, "effort");
  const effortIsNotANonBlankString = effort === null || effort === "";
  if (effortIsNotANonBlankString) {
    return {
      isValid: false,
      errorMessage: "The effort level must be a non-blank string, or null for a model with no effort setting",
    };
  }

  return { isValid: true, input: { modelId, effort } };
}

/** The most characters a "Refine" request's note may have, after trimming. */
export const MAX_REFINE_NOTE_LENGTH = 2000;

/** A "Refine a failed run" request, as validated. */
export interface ActionPlanRefineInput {
  /** The user's hint for Claude, trimmed, or null when left out or blank. */
  note: string | null;
}

/**
 * Validates the body of a "Refine a failed run" request. The body is
 * optional: no body at all (Express 5 leaves `req.body` undefined) means
 * "refine without a note".
 *
 * `note` is optional: a missing, null, or blank value becomes null; anything
 * else must be text, is trimmed, and may be at most `MAX_REFINE_NOTE_LENGTH`
 * characters long once trimmed.
 * @param body - The parsed request body, or undefined when none was sent
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateActionPlanRefineInput(
  body: unknown,
): ValidationResult<ActionPlanRefineInput> {
  const bodyWasLeftOut = body === undefined;
  if (bodyWasLeftOut) {
    return { isValid: true, input: { note: null } };
  }
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  const note = readOptionalTrimmedText(body, "note");
  if (!note.isText) {
    return { isValid: false, errorMessage: "The note must be text" };
  }
  const noteIsTooLong = note.value !== null && note.value.length > MAX_REFINE_NOTE_LENGTH;
  if (noteIsTooLong) {
    return {
      isValid: false,
      errorMessage: `The note must be at most ${MAX_REFINE_NOTE_LENGTH} characters`,
    };
  }

  return { isValid: true, input: { note: note.value } };
}

/**
 * A credential create or replace request, as validated: the credential's
 * fields, plus the password exactly as typed (it is encrypted by the
 * controller, never stored as is).
 */
export interface CredentialRequestInput {
  /** Everything stored on the credential except the password. */
  credential: CredentialInput;
  /** The new password as typed, or null to keep the saved one (only allowed when replacing). */
  password: string | null;
}

/** The three optional CSS selector fields of a credential, with the names used in error messages. */
const CREDENTIAL_SELECTOR_FIELDS = [
  { fieldName: "usernameSelector", label: "username field selector" },
  { fieldName: "passwordSelector", label: "password field selector" },
  { fieldName: "submitSelector", label: "submit button selector" },
] as const;

/**
 * Validates the body of a credential create or replace request.
 *
 * - `name` and `username` are required, non-blank, and trimmed.
 * - `description` is optional; a missing, null, or blank value is stored as null.
 * - `password` is required when creating. When replacing, a missing, null, or
 *   empty value means "keep the saved password". It is NOT trimmed - spaces
 *   can be part of a password - but a password of only spaces is rejected.
 * - `loginUrl` is optional: a missing, null, or blank value is stored as null,
 *   meaning "use the website's login URL"; anything else must be an
 *   http/https address, and is normalized. Whether the website has a login
 *   URL to fall back on is checked by the controller.
 * - `usernameSelector`, `passwordSelector`, and `submitSelector` are optional
 *   CSS selectors; a missing, null, or blank value is stored as null (the
 *   crawler then finds that part of the form on its own).
 * @param body - The parsed request body
 * @param options - Whether a password must be sent
 * @param options.passwordIsRequired - True when creating; false when replacing, where a left-out password keeps the saved one
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateCredentialInput(
  body: unknown,
  options: { passwordIsRequired: boolean },
): ValidationResult<CredentialRequestInput> {
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  const name = readTrimmedString(body, "name");
  const nameIsMissing = name === null || name === "";
  if (nameIsMissing) {
    return { isValid: false, errorMessage: "A name is required" };
  }

  const description = readOptionalTrimmedText(body, "description");
  if (!description.isText) {
    return { isValid: false, errorMessage: "The description must be text" };
  }

  const username = readTrimmedString(body, "username");
  const usernameIsMissing = username === null || username === "";
  if (usernameIsMissing) {
    return { isValid: false, errorMessage: "A username is required" };
  }

  const rawPassword = body.password;
  const passwordWasLeftOut = rawPassword === undefined || rawPassword === null || rawPassword === "";
  const passwordIsMissingButRequired = passwordWasLeftOut && options.passwordIsRequired;
  if (passwordIsMissingButRequired) {
    return { isValid: false, errorMessage: "A password is required" };
  }
  const passwordIsAString = typeof rawPassword === "string";
  const passwordHasTheWrongType = !passwordWasLeftOut && !passwordIsAString;
  if (passwordHasTheWrongType) {
    return { isValid: false, errorMessage: "The password must be text" };
  }
  const password = passwordWasLeftOut || !passwordIsAString ? null : rawPassword;
  const passwordIsOnlyWhitespace = password !== null && password.trim() === "";
  if (passwordIsOnlyWhitespace) {
    return { isValid: false, errorMessage: "The password cannot be only spaces" };
  }

  const loginUrl = readOptionalHttpUrl(body, "loginUrl");
  if (!loginUrl.isUrl) {
    return { isValid: false, errorMessage: LOGIN_URL_INVALID_MESSAGE };
  }

  const selectors: Record<(typeof CREDENTIAL_SELECTOR_FIELDS)[number]["fieldName"], string | null> =
    { usernameSelector: null, passwordSelector: null, submitSelector: null };
  for (const { fieldName, label } of CREDENTIAL_SELECTOR_FIELDS) {
    const selector = readOptionalTrimmedText(body, fieldName);
    if (!selector.isText) {
      return { isValid: false, errorMessage: `The ${label} must be text` };
    }
    selectors[fieldName] = selector.value;
  }

  return {
    isValid: true,
    input: {
      credential: {
        name,
        description: description.value,
        username,
        loginUrl: loginUrl.value,
        ...selectors,
      },
      password,
    },
  };
}

/** What a "start a crawl" request asks for, as validated. */
export interface CrawlRunStartInput {
  /** The credential to log in as before crawling, or null to crawl as a logged-out visitor. */
  credentialId: string | null;
  /** Which buttons the crawl clicks on each page, on top of following its links. */
  buttonMode: CrawlButtonMode;
}

/** Why a "start a crawl" request's button mode was rejected. */
const BUTTON_MODE_INVALID_MESSAGE = `The button mode must be one of: ${CRAWL_BUTTON_MODES.join(", ")}`;

/**
 * Reads the optional button mode of a "start a crawl" request.
 * @param rawValue - The field's value as it arrived in the body
 * @returns The mode - `DEFAULT_CRAWL_BUTTON_MODE` when the value is missing or null - or null when the value is not one of `CRAWL_BUTTON_MODES`
 */
function readOptionalCrawlButtonMode(rawValue: unknown): CrawlButtonMode | null {
  const valueWasOmitted = rawValue === undefined || rawValue === null;
  if (valueWasOmitted) {
    return DEFAULT_CRAWL_BUTTON_MODE;
  }
  return isCrawlButtonMode(rawValue) ? rawValue : null;
}

/**
 * Validates the body of a "start a crawl" request. The body is optional: no
 * body at all (Express 5 leaves `req.body` undefined) or an empty object
 * means "crawl logged out, following links only".
 *
 * - `credentialId` is optional: a missing or null value crawls logged out;
 *   otherwise it must be a non-blank string, and is trimmed. Whether that
 *   credential exists is checked by the controller.
 * - `buttonMode` is optional: a missing or null value becomes
 *   `DEFAULT_CRAWL_BUTTON_MODE` (`linksOnly`); otherwise it must be exactly one
 *   of `CRAWL_BUTTON_MODES`.
 * @param body - The parsed request body, or undefined when none was sent
 * @returns The cleaned input, or the first problem found as a message
 */
export function validateCrawlRunStartInput(body: unknown): ValidationResult<CrawlRunStartInput> {
  const bodyWasLeftOut = body === undefined || body === null;
  if (bodyWasLeftOut) {
    return {
      isValid: true,
      input: { credentialId: null, buttonMode: DEFAULT_CRAWL_BUTTON_MODE },
    };
  }
  if (!isJsonObject(body)) {
    return { isValid: false, errorMessage: "The request body must be a JSON object" };
  }

  let credentialId: string | null = null;
  const rawCredentialId = body.credentialId;
  const credentialIdWasLeftOut = rawCredentialId === undefined || rawCredentialId === null;
  if (!credentialIdWasLeftOut) {
    const trimmedCredentialId = readTrimmedString(body, "credentialId");
    const credentialIdIsNotANonBlankString =
      trimmedCredentialId === null || trimmedCredentialId === "";
    if (credentialIdIsNotANonBlankString) {
      return {
        isValid: false,
        errorMessage: "The credential id must be a non-blank string, or null to crawl logged out",
      };
    }
    credentialId = trimmedCredentialId;
  }

  const buttonMode = readOptionalCrawlButtonMode(body.buttonMode);
  if (buttonMode === null) {
    return { isValid: false, errorMessage: BUTTON_MODE_INVALID_MESSAGE };
  }

  return { isValid: true, input: { credentialId, buttonMode } };
}
