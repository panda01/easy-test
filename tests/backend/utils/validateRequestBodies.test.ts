import { describe, it, expect } from "vitest";
import {
  DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
  DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
  validateWebsiteInput,
  validateTitleDescriptionInput,
} from "../../../server/utils/validateRequestBodies.js";

const NOT_A_JSON_OBJECT_MESSAGE = "The request body must be a JSON object";
const URL_REQUIRED_MESSAGE = "A URL is required";
const URL_INVALID_MESSAGE = "The URL must be a valid http:// or https:// address";
const NAME_REQUIRED_MESSAGE = "A name is required";
const DESCRIPTION_NOT_TEXT_MESSAGE = "The description must be text";
const TITLE_REQUIRED_MESSAGE = "A title is required";
const DESCRIPTION_REQUIRED_MESSAGE = "A description is required";
const NETWORK_IDLE_CAP_INVALID_MESSAGE =
  "The network idle cap must be a whole number of milliseconds from 0 to 30000";
const MINIMUM_WAIT_INVALID_MESSAGE =
  "The minimum wait must be a whole number of milliseconds from 0 to 30000";
const CAP_BELOW_MINIMUM_MESSAGE = "The network idle cap cannot be lower than the minimum wait";

/** The timing settings a website gets when the body leaves them out. */
const DEFAULT_TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 1 };

/**
 * Bodies that are not a plain JSON object. Express 5 leaves `req.body`
 * undefined when no JSON was sent, and a client can send null, an array, or a
 * bare scalar, so both validators must reject every one of these before
 * reading a field.
 */
const nonObjectBodies: { label: string; body: unknown }[] = [
  { label: "undefined (no body sent)", body: undefined },
  { label: "null", body: null },
  { label: "an array", body: [{ url: "https://example.com", name: "Example" }] },
  { label: "a string", body: "https://example.com" },
  { label: "a number", body: 42 },
];

describe("validateWebsiteInput", () => {
  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateWebsiteInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    { label: "missing", url: undefined },
    { label: "an empty string", url: "" },
    { label: "whitespace only", url: "   " },
    { label: "a number", url: 12345 },
    { label: "null", url: null },
  ])("requires a url (url is $label)", ({ url }) => {
    expect(validateWebsiteInput({ url, name: "Example" })).toEqual({
      isValid: false,
      errorMessage: URL_REQUIRED_MESSAGE,
    });
  });

  it("checks the url before the name, so an empty object reports the url", () => {
    expect(validateWebsiteInput({})).toEqual({
      isValid: false,
      errorMessage: URL_REQUIRED_MESSAGE,
    });
  });

  it.each([
    { label: "an unparseable string", url: "not a url" },
    { label: "a host without a scheme", url: "example.com" },
    { label: "an ftp address", url: "ftp://example.com/file.txt" },
    { label: "a mailto address", url: "mailto:someone@example.com" },
    { label: "a javascript: address", url: "javascript:alert(1)" },
  ])("rejects a url that is $label", ({ url }) => {
    expect(validateWebsiteInput({ url, name: "Example" })).toEqual({
      isValid: false,
      errorMessage: URL_INVALID_MESSAGE,
    });
  });

  it("checks the url format before the name", () => {
    expect(validateWebsiteInput({ url: "ftp://example.com" })).toEqual({
      isValid: false,
      errorMessage: URL_INVALID_MESSAGE,
    });
  });

  it("normalizes the url: trims it, lowercases the scheme and host, and adds the root slash", () => {
    const result = validateWebsiteInput({ url: "  HTTPS://Example.COM ", name: "Example" });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it("accepts an http url and keeps its path and query", () => {
    const result = validateWebsiteInput({
      url: "http://example.com/login?next=/home",
      name: "Example",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "http://example.com/login?next=/home", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it.each([
    { label: "missing", name: undefined },
    { label: "an empty string", name: "" },
    { label: "whitespace only", name: " \t " },
    { label: "a number", name: 7 },
    { label: "null", name: null },
  ])("requires a name (name is $label)", ({ name }) => {
    expect(validateWebsiteInput({ url: "https://example.com", name })).toEqual({
      isValid: false,
      errorMessage: NAME_REQUIRED_MESSAGE,
    });
  });

  it("trims the name", () => {
    const result = validateWebsiteInput({ url: "https://example.com", name: "  Example  " });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it.each([
    { label: "omitted", description: undefined },
    { label: "null", description: null },
    { label: "an empty string", description: "" },
    { label: "whitespace only", description: "   " },
  ])("stores the description as null when it is $label", ({ description }) => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      description,
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it.each([
    { label: "a number", description: 5 },
    { label: "a boolean", description: false },
    { label: "an object", description: { text: "a site" } },
    { label: "an array", description: ["a site"] },
  ])("rejects a description that is $label", ({ description }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", description }),
    ).toEqual({
      isValid: false,
      errorMessage: DESCRIPTION_NOT_TEXT_MESSAGE,
    });
  });

  it("trims a text description", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      description: "  a site to test  ",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: "a site to test", ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it("drops fields that are not part of a website", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      id: "client-chosen-id",
      deletedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS },
    });
  });

  it("fills in the default timing settings when they are omitted or null", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      networkIdleTimeoutMs: null,
      screenshotMinimumWaitMs: null,
    });

    expect(result).toEqual({
      isValid: true,
      input: {
        url: "https://example.com/",
        name: "Example",
        description: null,
        networkIdleTimeoutMs: DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
        screenshotMinimumWaitMs: DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
      },
    });
    expect(DEFAULT_TIMING_SETTINGS).toEqual({
      networkIdleTimeoutMs: DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
      screenshotMinimumWaitMs: DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
    });
  });

  it.each([
    { label: "both 0 (don't wait for idle, no minimum)", networkIdleTimeoutMs: 0, screenshotMinimumWaitMs: 0 },
    { label: "the largest allowed values", networkIdleTimeoutMs: 30000, screenshotMinimumWaitMs: 30000 },
    { label: "a cap equal to the minimum", networkIdleTimeoutMs: 1500, screenshotMinimumWaitMs: 1500 },
    { label: "a cap above the minimum", networkIdleTimeoutMs: 8000, screenshotMinimumWaitMs: 250 },
  ])("keeps timing settings that are $label", ({ networkIdleTimeoutMs, screenshotMinimumWaitMs }) => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      networkIdleTimeoutMs,
      screenshotMinimumWaitMs,
    });

    expect(result).toEqual({
      isValid: true,
      input: {
        url: "https://example.com/",
        name: "Example",
        description: null,
        networkIdleTimeoutMs,
        screenshotMinimumWaitMs,
      },
    });
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "above 30000", value: 30001 },
    { label: "a fraction", value: 1.5 },
    { label: "a numeric string", value: "5000" },
    { label: "a boolean", value: true },
    { label: "not a number", value: Number.NaN },
  ])("rejects a network idle cap that is $label", ({ value }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", networkIdleTimeoutMs: value }),
    ).toEqual({ isValid: false, errorMessage: NETWORK_IDLE_CAP_INVALID_MESSAGE });
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "above 30000", value: 30001 },
    { label: "a fraction", value: 0.5 },
    { label: "a numeric string", value: "300" },
    { label: "an object", value: { ms: 300 } },
  ])("rejects a minimum wait that is $label", ({ value }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", screenshotMinimumWaitMs: value }),
    ).toEqual({ isValid: false, errorMessage: MINIMUM_WAIT_INVALID_MESSAGE });
  });

  it.each([
    { label: "explicitly below the minimum", body: { networkIdleTimeoutMs: 200, screenshotMinimumWaitMs: 300 } },
    { label: "omitted (5000) with a minimum above it", body: { screenshotMinimumWaitMs: 6000 } },
    { label: "0 with the default minimum (1)", body: { networkIdleTimeoutMs: 0 } },
  ])("rejects a network idle cap that is $label", ({ body }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", ...body }),
    ).toEqual({ isValid: false, errorMessage: CAP_BELOW_MINIMUM_MESSAGE });
  });
});

describe("validateTitleDescriptionInput", () => {
  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateTitleDescriptionInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    { label: "missing", title: undefined },
    { label: "an empty string", title: "" },
    { label: "whitespace only", title: "   " },
    { label: "a number", title: 3 },
    { label: "null", title: null },
  ])("requires a title (title is $label)", ({ title }) => {
    expect(validateTitleDescriptionInput({ title, description: "Steps" })).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it("checks the title before the description, so an empty object reports the title", () => {
    expect(validateTitleDescriptionInput({})).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it.each([
    { label: "missing", description: undefined },
    { label: "an empty string", description: "" },
    { label: "whitespace only", description: "\n  " },
    { label: "a number", description: 9 },
    { label: "null", description: null },
  ])("requires a description (description is $label)", ({ description }) => {
    expect(validateTitleDescriptionInput({ title: "Sign up", description })).toEqual({
      isValid: false,
      errorMessage: DESCRIPTION_REQUIRED_MESSAGE,
    });
  });

  it("trims both the title and the description", () => {
    const result = validateTitleDescriptionInput({
      title: "  Sign up  ",
      description: "  Create an account and land on the dashboard  ",
    });

    expect(result).toEqual({
      isValid: true,
      input: { title: "Sign up", description: "Create an account and land on the dashboard" },
    });
  });

  it("drops fields that are not a title or a description", () => {
    const result = validateTitleDescriptionInput({
      title: "Log in",
      description: "Enter credentials",
      websiteId: "someone-elses-website",
    });

    expect(result).toEqual({
      isValid: true,
      input: { title: "Log in", description: "Enter credentials" },
    });
  });
});
