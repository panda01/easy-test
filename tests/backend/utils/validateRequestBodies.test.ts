import { describe, it, expect } from "vitest";
import {
  validateScriptModelChoiceInput,
  DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
  DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
  validateWebsiteInput,
  validateTitleDescriptionInput,
  validateCredentialInput,
  validateCrawlRunStartInput,
} from "../../../server/utils/validateRequestBodies.js";
import { CRAWL_BUTTON_MODES } from "../../../server/utils/crawlButtonModes.js";

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
const LOGIN_URL_INVALID_MESSAGE = "The login page URL must be a valid http:// or https:// address";
const BUTTON_MODE_INVALID_MESSAGE =
  "The button mode must be one of: linksOnly, allButRisky, openOnly";

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
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
    });
  });

  it("accepts an http url and keeps its path and query", () => {
    const result = validateWebsiteInput({
      url: "http://example.com/login?next=/home",
      name: "Example",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "http://example.com/login?next=/home", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
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
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
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
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
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
      input: { url: "https://example.com/", name: "Example", description: "a site to test", ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
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
      input: { url: "https://example.com/", name: "Example", description: null, ...DEFAULT_TIMING_SETTINGS, loginUrl: null },
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
        loginUrl: null,
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
        loginUrl: null,
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

  it.each([
    { label: "omitted", loginUrl: undefined },
    { label: "null", loginUrl: null },
    { label: "an empty string", loginUrl: "" },
    { label: "whitespace only", loginUrl: "   " },
  ])(
    "stores the login page URL as null (the website doesn't require login) when it is $label",
    ({ loginUrl }) => {
      const result = validateWebsiteInput({ url: "https://example.com", name: "Example", loginUrl });

      expect(result).toEqual({
        isValid: true,
        input: {
          url: "https://example.com/",
          name: "Example",
          description: null,
          ...DEFAULT_TIMING_SETTINGS,
          loginUrl: null,
        },
      });
    },
  );

  it("normalizes the login page URL: trims it, lowercases the scheme and host, and keeps its path", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      loginUrl: "  HTTPS://Example.COM/Login?next=/home  ",
    });

    expect(result).toEqual({
      isValid: true,
      input: {
        url: "https://example.com/",
        name: "Example",
        description: null,
        ...DEFAULT_TIMING_SETTINGS,
        loginUrl: "https://example.com/Login?next=/home",
      },
    });
  });

  it.each([
    { label: "an unparseable string", loginUrl: "not a url" },
    { label: "a host without a scheme", loginUrl: "example.com/login" },
    { label: "an ftp address", loginUrl: "ftp://example.com/login" },
    { label: "a javascript: address", loginUrl: "javascript:alert(1)" },
    { label: "a number", loginUrl: 42 },
    { label: "a boolean", loginUrl: true },
    { label: "an object", loginUrl: { href: "https://example.com/login" } },
  ])("rejects a login page URL that is $label", ({ loginUrl }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", loginUrl }),
    ).toEqual({ isValid: false, errorMessage: LOGIN_URL_INVALID_MESSAGE });
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

describe("validateScriptModelChoiceInput", () => {
  it("accepts a model with an effort level, trimming both", () => {
    expect(validateScriptModelChoiceInput({ modelId: " claude-opus-5-5 ", effort: " high " })).toEqual({
      isValid: true,
      input: { modelId: "claude-opus-5-5", effort: "high" },
    });
  });

  it.each([
    ["null", null],
    ["left out", undefined],
  ])("accepts a model with the effort %s, as Standard (null)", (_label, effort) => {
    expect(validateScriptModelChoiceInput({ modelId: "claude-haiku-4-5-20251001", effort })).toEqual({
      isValid: true,
      input: { modelId: "claude-haiku-4-5-20251001", effort: null },
    });
  });

  it.each([
    ["no body", undefined],
    ["an array", []],
    ["a string", "claude-opus-5-5"],
  ])("rejects %s", (_label, body) => {
    expect(validateScriptModelChoiceInput(body)).toEqual({
      isValid: false,
      errorMessage: "The request body must be a JSON object",
    });
  });

  it.each([
    ["missing", {}],
    ["blank", { modelId: "   " }],
    ["not a string", { modelId: 5 }],
  ])("rejects a model id that is %s", (_label, body) => {
    expect(validateScriptModelChoiceInput(body)).toEqual({
      isValid: false,
      errorMessage: "A model is required",
    });
  });

  it.each([
    ["blank", "  "],
    ["not a string", 3],
  ])("rejects an effort level that is %s", (_label, effort) => {
    expect(validateScriptModelChoiceInput({ modelId: "claude-opus-5-5", effort })).toEqual({
      isValid: false,
      errorMessage:
        "The effort level must be a non-blank string, or null for a model with no effort setting",
    });
  });
});

describe("validateCredentialInput", () => {
  /** A complete, valid credential create body. */
  const validCredentialBody = {
    name: "  Admin  ",
    description: "  The site's admin account  ",
    username: "  admin@example.com  ",
    password: "  correct horse  ",
    loginUrl: "  HTTPS://Example.com/login  ",
    usernameSelector: "  #email  ",
    passwordSelector: "  #password  ",
    submitSelector: "  button.sign-in  ",
  };

  it("trims every field except the password, and normalizes the login page URL", () => {
    expect(validateCredentialInput(validCredentialBody, { passwordIsRequired: true })).toEqual({
      isValid: true,
      input: {
        credential: {
          name: "Admin",
          description: "The site's admin account",
          username: "admin@example.com",
          loginUrl: "https://example.com/login",
          usernameSelector: "#email",
          passwordSelector: "#password",
          submitSelector: "button.sign-in",
        },
        password: "  correct horse  ",
      },
    });
  });

  it.each([
    ["left out", undefined],
    ["null", null],
    ["blank", "   "],
  ])("stores the description and the selectors as null when they are %s", (_label, value) => {
    const body = {
      name: "Admin",
      username: "admin",
      password: "secret",
      loginUrl: "https://example.com/login",
      description: value,
      usernameSelector: value,
      passwordSelector: value,
      submitSelector: value,
    };

    const validation = validateCredentialInput(body, { passwordIsRequired: true });

    expect(validation).toEqual({
      isValid: true,
      input: {
        credential: {
          name: "Admin",
          description: null,
          username: "admin",
          loginUrl: "https://example.com/login",
          usernameSelector: null,
          passwordSelector: null,
          submitSelector: null,
        },
        password: "secret",
      },
    });
  });

  it.each([
    ["left out", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "stores the login page URL as null (use the website's) when it is %s",
    (_label, loginUrl) => {
      const body = { ...validCredentialBody, loginUrl };

      const validation = validateCredentialInput(body, { passwordIsRequired: true });

      expect(validation.isValid).toBe(true);
      expect(validation.isValid && validation.input.credential.loginUrl).toBeNull();
    },
  );

  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateCredentialInput(body, { passwordIsRequired: true })).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    ["the name is missing", { name: undefined }, NAME_REQUIRED_MESSAGE],
    ["the name is blank", { name: "  " }, NAME_REQUIRED_MESSAGE],
    ["the description is not text", { description: 5 }, DESCRIPTION_NOT_TEXT_MESSAGE],
    ["the username is missing", { username: undefined }, "A username is required"],
    ["the username is blank", { username: " " }, "A username is required"],
    ["the password is not text", { password: 1234 }, "The password must be text"],
    ["the password is only spaces", { password: "   " }, "The password cannot be only spaces"],
    ["the login page URL is not text", { loginUrl: 42 }, LOGIN_URL_INVALID_MESSAGE],
    [
      "the login page URL is not http or https",
      { loginUrl: "ftp://example.com/login" },
      LOGIN_URL_INVALID_MESSAGE,
    ],
    [
      "the login page URL does not parse",
      { loginUrl: "not a url" },
      LOGIN_URL_INVALID_MESSAGE,
    ],
    [
      "the username selector is not text",
      { usernameSelector: ["#email"] },
      "The username field selector must be text",
    ],
    [
      "the password selector is not text",
      { passwordSelector: 7 },
      "The password field selector must be text",
    ],
    [
      "the submit selector is not text",
      { submitSelector: true },
      "The submit button selector must be text",
    ],
  ])("rejects a body where %s", (_label, override, errorMessage) => {
    const body = { ...validCredentialBody, ...override };

    expect(validateCredentialInput(body, { passwordIsRequired: true })).toEqual({
      isValid: false,
      errorMessage,
    });
  });

  it.each([
    ["left out", undefined],
    ["null", null],
    ["empty", ""],
  ])("requires a password when creating, rejecting one that is %s", (_label, password) => {
    const body = { ...validCredentialBody, password };

    expect(validateCredentialInput(body, { passwordIsRequired: true })).toEqual({
      isValid: false,
      errorMessage: "A password is required",
    });
  });

  it.each([
    ["left out", undefined],
    ["null", null],
    ["empty", ""],
  ])("keeps the saved password when replacing with a password that is %s", (_label, password) => {
    const body = { ...validCredentialBody, password };

    const validation = validateCredentialInput(body, { passwordIsRequired: false });

    expect(validation.isValid).toBe(true);
    expect(validation.isValid && validation.input.password).toBeNull();
  });

  it("takes a new password when replacing with one", () => {
    const body = { ...validCredentialBody, password: "new password" };

    const validation = validateCredentialInput(body, { passwordIsRequired: false });

    expect(validation.isValid && validation.input.password).toBe("new password");
  });
});

describe("validateCrawlRunStartInput", () => {
  it.each([
    ["no body at all (undefined)", undefined],
    ["a null body", null],
    ["an empty object", {}],
    ["a null credential id", { credentialId: null }],
  ])("crawls logged out, following links only, for %s", (_label, body) => {
    expect(validateCrawlRunStartInput(body)).toEqual({
      isValid: true,
      input: { credentialId: null, buttonMode: "linksOnly" },
    });
  });

  it("takes a trimmed credential id", () => {
    expect(validateCrawlRunStartInput({ credentialId: "  credential-1  " })).toEqual({
      isValid: true,
      input: { credentialId: "credential-1", buttonMode: "linksOnly" },
    });
  });

  it.each(CRAWL_BUTTON_MODES)("takes the button mode %s", (buttonMode) => {
    expect(validateCrawlRunStartInput({ credentialId: "credential-1", buttonMode })).toEqual({
      isValid: true,
      input: { credentialId: "credential-1", buttonMode },
    });
  });

  it("takes a button mode for a logged-out crawl", () => {
    expect(validateCrawlRunStartInput({ credentialId: null, buttonMode: "openOnly" })).toEqual({
      isValid: true,
      input: { credentialId: null, buttonMode: "openOnly" },
    });
  });

  it("defaults the button mode to linksOnly when it is null", () => {
    expect(validateCrawlRunStartInput({ buttonMode: null })).toEqual({
      isValid: true,
      input: { credentialId: null, buttonMode: "linksOnly" },
    });
  });

  it.each([
    ["an unknown mode", "clickEverything"],
    ["a mode in the wrong case", "LinksOnly"],
    ["a mode with spaces around it", " openOnly "],
    ["an empty string", ""],
    ["a number", 2],
    ["a boolean", true],
  ])("rejects a button mode that is %s", (_label, buttonMode) => {
    expect(validateCrawlRunStartInput({ buttonMode })).toEqual({
      isValid: false,
      errorMessage: BUTTON_MODE_INVALID_MESSAGE,
    });
  });

  it("checks the credential id before the button mode", () => {
    expect(validateCrawlRunStartInput({ credentialId: "  ", buttonMode: "clickEverything" })).toEqual({
      isValid: false,
      errorMessage: "The credential id must be a non-blank string, or null to crawl logged out",
    });
  });

  it.each([
    ["an array", []],
    ["a number", 3],
    ["a string", "credential-1"],
  ])("rejects a body that is %s", (_label, body) => {
    expect(validateCrawlRunStartInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    ["blank", "   "],
    ["a number", 42],
  ])("rejects a credential id that is %s", (_label, credentialId) => {
    expect(validateCrawlRunStartInput({ credentialId })).toEqual({
      isValid: false,
      errorMessage: "The credential id must be a non-blank string, or null to crawl logged out",
    });
  });
});
