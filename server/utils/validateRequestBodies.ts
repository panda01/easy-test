import type { WebsiteInput, TitleDescriptionInput } from "../services/dbService.js";

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
 * Validates and normalizes the body of a website create or replace request.
 *
 * - `url` is required, must be an http/https address, and is normalized.
 * - `name` is required.
 * - `description` is optional; a missing, null, or blank value is stored as null.
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

  return { isValid: true, input: { url: normalizedUrl, name, description } };
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
