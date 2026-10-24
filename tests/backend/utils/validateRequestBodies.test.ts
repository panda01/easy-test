import { describe, it, expect } from "vitest";
import {
  validateScriptModelChoiceInput,
  DEFAULT_NETWORK_IDLE_TIMEOUT_MS,
  DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS,
  validateWebsiteInput,
  validateTitleDescriptionInput,
  validateActionInput,
  validateActionPlanEditInput,
  validateActionPlanRefineInput,
  MAX_REFINE_NOTE_LENGTH,
  validateCredentialInput,
  validateCrawlRunStartInput,
  validateWebObjectRenameInput,
  MAX_WEB_OBJECT_NAME_LENGTH,
  MAX_OBJECT_TYPE_KEY_LENGTH,
  MAX_PARAMETER_TEXT_LENGTH,
  MAX_RUN_PARAMETER_VALUES,
  validateRunParameterValuesInput,
  validateActionParameterChoicesInput,
  validateNewActionParameterInput,
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

/** What an action body leaves as "detect" when it names no object role choice. */
const DETECT_EVERY_ROLE_CHOICE = { userActionKind: null, userObjectTypeKey: null, userNameParameterKey: null, userDeletesObject: null };

describe("validateActionInput", () => {
  const CREDENTIAL_ID_INVALID_MESSAGE =
    "The credential id must be a non-blank string, or null to run logged out";

  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateActionInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it("checks the title exactly as validateTitleDescriptionInput does", () => {
    expect(validateActionInput({ title: "  ", description: "Steps", credentialId: "c-1" })).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it("checks the description exactly as validateTitleDescriptionInput does", () => {
    expect(validateActionInput({ title: "Log in", description: 7, credentialId: "c-1" })).toEqual({
      isValid: false,
      errorMessage: DESCRIPTION_REQUIRED_MESSAGE,
    });
  });

  it("checks the title and description before the credential id", () => {
    expect(validateActionInput({ title: "", description: "Steps", credentialId: 5 })).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it.each([
    ["left out", undefined],
    ["null", null],
  ])("runs logged out (credentialId null) when the credential id is %s", (_label, credentialId) => {
    expect(
      validateActionInput({ title: " Log in ", description: " Enter credentials ", credentialId }),
    ).toEqual({
      isValid: true,
      input: { title: "Log in", description: "Enter credentials", credentialId: null, ...DETECT_EVERY_ROLE_CHOICE },
    });
  });

  it("takes a trimmed credential id", () => {
    expect(
      validateActionInput({
        title: "Log in",
        description: "Enter credentials",
        credentialId: "  credential-1  ",
      }),
    ).toEqual({
      isValid: true,
      input: { title: "Log in", description: "Enter credentials", credentialId: "credential-1", ...DETECT_EVERY_ROLE_CHOICE },
    });
  });

  it.each([
    ["an empty string", ""],
    ["blank", "   "],
    ["a number", 42],
    ["a boolean", false],
    ["an object", { id: "credential-1" }],
    ["an array", ["credential-1"]],
  ])("rejects a credential id that is %s", (_label, credentialId) => {
    expect(
      validateActionInput({ title: "Log in", description: "Enter credentials", credentialId }),
    ).toEqual({
      isValid: false,
      errorMessage: CREDENTIAL_ID_INVALID_MESSAGE,
    });
  });

  it("drops fields that are not part of an action", () => {
    expect(
      validateActionInput({
        title: "Log in",
        description: "Enter credentials",
        credentialId: "credential-1",
        websiteId: "someone-elses-website",
        credential: { id: "credential-2", name: "Other" },
      }),
    ).toEqual({
      isValid: true,
      input: { title: "Log in", description: "Enter credentials", credentialId: "credential-1", ...DETECT_EVERY_ROLE_CHOICE },
    });
  });
});

describe("validateActionPlanEditInput", () => {
  /** The origins a plan for an example.com action may open. */
  const ALLOWED_ORIGINS = ["https://example.com", "https://auth.example.com"];

  /** A valid plan: open the site, fill the email from the credential, click Sign in. */
  const validPlan = {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [
      { action: "goto", target: null, value: "https://auth.example.com/login" },
      { action: "fill", target: { label: "Email" }, value: "{{credential.username}}" },
      { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    ],
  };

  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateActionPlanEditInput(body, ALLOWED_ORIGINS)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    ["left out", {}],
    ["null", { plan: null }],
  ])("requires a plan (plan is %s)", (_label, body) => {
    expect(validateActionPlanEditInput(body, ALLOWED_ORIGINS)).toEqual({
      isValid: false,
      errorMessage: "A plan is required",
    });
  });

  it("returns a valid plan, typed, with nothing else from the body", () => {
    const validation = validateActionPlanEditInput(
      { plan: validPlan, modelId: "claude-opus-5-5" },
      ALLOWED_ORIGINS,
    );

    expect(validation).toEqual({ isValid: true, input: { plan: validPlan } });
  });

  it("returns the plan's fields in written order, whatever order they were sent in", () => {
    const shuffledPlan = {
      steps: [{ value: null, target: { name: "Sign in", role: "button" }, action: "click" }],
      startUrl: "https://example.com/",
      name: "Log in",
    };

    const validation = validateActionPlanEditInput({ plan: shuffledPlan }, ALLOWED_ORIGINS);

    expect(validation.isValid).toBe(true);
    const plan = validation.isValid ? validation.input.plan : null;
    expect(Object.keys(plan ?? {})).toEqual(["name", "startUrl", "steps"]);
    expect(Object.keys(plan?.steps[0] ?? {})).toEqual(["action", "target", "value"]);
  });

  it("rejects a plan that is not shaped like a plan, saying where", () => {
    const validation = validateActionPlanEditInput(
      { plan: { ...validPlan, steps: [{ action: "evaluate", target: null, value: "1 + 1" }] } },
      ALLOWED_ORIGINS,
    );

    expect(validation.isValid).toBe(false);
    const errorMessage = validation.isValid ? "" : validation.errorMessage;
    expect(errorMessage).toMatch(/^The plan does not have the expected shape - steps\.0\.action: /);
  });

  it("rejects a plan with a field no plan has", () => {
    const validation = validateActionPlanEditInput(
      { plan: { ...validPlan, script: "await page.evaluate(() => 1)" } },
      ALLOWED_ORIGINS,
    );

    expect(validation.isValid).toBe(false);
    const errorMessage = validation.isValid ? "" : validation.errorMessage;
    expect(errorMessage).toMatch(/^The plan does not have the expected shape - plan: /);
  });

  it("rejects a plan that breaks the step rules, listing every problem", () => {
    const planThatLeavesTheSite = {
      name: "Log in",
      startUrl: "https://example.com/",
      steps: [
        { action: "goto", target: null, value: "https://evil.example/steal" },
        { action: "press", target: null, value: "F12" },
      ],
    };

    expect(validateActionPlanEditInput({ plan: planThatLeavesTheSite }, ALLOWED_ORIGINS)).toEqual({
      isValid: false,
      errorMessage: [
        "Step 1 (goto): must be on this website (https://example.com or https://auth.example.com), not https://evil.example",
        "Step 2 (press): must be one of: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown",
      ].join("; "),
    });
  });

  it("checks the plan against the origins it is given", () => {
    const validation = validateActionPlanEditInput({ plan: validPlan }, ["https://example.com"]);

    expect(validation).toEqual({
      isValid: false,
      errorMessage:
        "Step 1 (goto): must be on this website (https://example.com), not https://auth.example.com",
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

describe("validateActionPlanRefineInput", () => {
  const NOTE_NOT_TEXT_MESSAGE = "The note must be text";
  const NOTE_TOO_LONG_MESSAGE = "The note must be at most 2000 characters";

  it("allows at most 2000 characters in a note", () => {
    expect(MAX_REFINE_NOTE_LENGTH).toBe(2000);
  });

  it("refines without a note when no body was sent at all (undefined)", () => {
    expect(validateActionPlanRefineInput(undefined)).toEqual({
      isValid: true,
      input: { note: null },
    });
  });

  it.each([
    ["an empty object", {}],
    ["a null note", { note: null }],
    ["an empty note", { note: "" }],
    ["a note of only spaces and newlines", { note: "  \n\t  " }],
  ])("refines without a note for %s", (_label, body) => {
    expect(validateActionPlanRefineInput(body)).toEqual({
      isValid: true,
      input: { note: null },
    });
  });

  it("takes the note trimmed", () => {
    expect(
      validateActionPlanRefineInput({ note: "  The Sign in button is now called Log in \n" }),
    ).toEqual({
      isValid: true,
      input: { note: "The Sign in button is now called Log in" },
    });
  });

  it("ignores fields other than the note", () => {
    expect(validateActionPlanRefineInput({ note: "Try again", modelId: "claude-opus-5-5" })).toEqual({
      isValid: true,
      input: { note: "Try again" },
    });
  });

  it("accepts a note of exactly 2000 characters", () => {
    const longestNote = "n".repeat(MAX_REFINE_NOTE_LENGTH);

    expect(validateActionPlanRefineInput({ note: longestNote })).toEqual({
      isValid: true,
      input: { note: longestNote },
    });
  });

  it("measures the note after trimming, so spaces around it do not count", () => {
    const longestNote = "n".repeat(MAX_REFINE_NOTE_LENGTH);

    expect(validateActionPlanRefineInput({ note: `   ${longestNote}   ` })).toEqual({
      isValid: true,
      input: { note: longestNote },
    });
  });

  it("rejects a note of 2001 characters", () => {
    expect(validateActionPlanRefineInput({ note: "n".repeat(MAX_REFINE_NOTE_LENGTH + 1) })).toEqual({
      isValid: false,
      errorMessage: NOTE_TOO_LONG_MESSAGE,
    });
  });

  it.each([
    ["a number", 42],
    ["a boolean", true],
    ["an array", ["Try again"]],
    ["an object", { text: "Try again" }],
  ])("rejects a note that is %s", (_label, note) => {
    expect(validateActionPlanRefineInput({ note })).toEqual({
      isValid: false,
      errorMessage: NOTE_NOT_TEXT_MESSAGE,
    });
  });

  it.each([
    ["a null body", null],
    ["an array", []],
    ["a string", "Try again"],
    ["a number", 3],
  ])("rejects a body that is %s", (_label, body) => {
    expect(validateActionPlanRefineInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
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

describe("validateWebObjectRenameInput", () => {
  it("accepts a name, trimmed", () => {
    expect(validateWebObjectRenameInput({ name: "  Test step  " })).toEqual({
      isValid: true,
      input: { name: "Test step" },
    });
  });

  it.each([
    ["a null name", { name: null }],
    ["a blank name", { name: "   " }],
    ["no name at all", {}],
  ])("resets to the detected name for %s", (_label, body) => {
    expect(validateWebObjectRenameInput(body)).toEqual({ isValid: true, input: { name: null } });
  });

  it(`accepts a name of exactly ${String(MAX_WEB_OBJECT_NAME_LENGTH)} characters and refuses a longer one`, () => {
    const longestName = "n".repeat(MAX_WEB_OBJECT_NAME_LENGTH);

    expect(validateWebObjectRenameInput({ name: longestName })).toEqual({
      isValid: true,
      input: { name: longestName },
    });
    expect(validateWebObjectRenameInput({ name: `${longestName}n` })).toEqual({
      isValid: false,
      errorMessage: "The name must be at most 100 characters",
    });
  });

  it("refuses a name that is not text", () => {
    expect(validateWebObjectRenameInput({ name: 5 })).toEqual({
      isValid: false,
      errorMessage: "The name must be text, or null to use the detected name",
    });
  });

  it.each([undefined, null, [], "Test step"])("refuses a body that is not a JSON object (%j)", (body) => {
    expect(validateWebObjectRenameInput(body)).toEqual({
      isValid: false,
      errorMessage: "The request body must be a JSON object",
    });
  });
});

describe("validateActionInput: object role choices", () => {
  const BASE_ACTION = { title: "Create a project", description: "Adds one", credentialId: null };

  it("takes each choice, and treats detect, null, and left out as detect", () => {
    expect(
      validateActionInput({
        ...BASE_ACTION,
        userActionKind: "create",
        userObjectTypeKey: " /projects/{project} ",
        userNameParameterKey: " projectName ",
        userDeletesObject: false,
      }),
    ).toEqual({
      isValid: true,
      input: {
        title: "Create a project",
        description: "Adds one",
        credentialId: null,
        userActionKind: "create",
        userObjectTypeKey: "/projects/{project}",
        userNameParameterKey: "projectName",
        userDeletesObject: false,
      },
    });
    expect(validateActionInput({ ...BASE_ACTION, userActionKind: "detect", userObjectTypeKey: "  " })).toMatchObject({
      isValid: true,
      input: DETECT_EVERY_ROLE_CHOICE,
    });
  });

  it.each([
    [{ userActionKind: "destroy" }, "The action kind must be one of: detect, parameters, object, create"],
    [{ userObjectTypeKey: 5 }, "The object type must be text, or null"],
    [{ userObjectTypeKey: "k".repeat(MAX_OBJECT_TYPE_KEY_LENGTH + 1) }, "The object type must be at most 500 characters"],
    [{ userNameParameterKey: ["a"] }, "The name parameter must be text, or null"],
    [{ userDeletesObject: "yes" }, '"Deletes the object" must be true, false, or null to detect it'],
  ])("refuses a bad choice (%j)", (badChoice, errorMessage) => {
    expect(validateActionInput({ ...BASE_ACTION, ...badChoice })).toEqual({ isValid: false, errorMessage });
  });
});

describe("validateRunParameterValuesInput", () => {
  it("treats no body, and no values, as running with the version's own values", () => {
    expect(validateRunParameterValuesInput(undefined)).toEqual({ isValid: true, input: { parameterValues: {} } });
    expect(validateRunParameterValuesInput({})).toEqual({ isValid: true, input: { parameterValues: {} } });
    expect(validateRunParameterValuesInput({ parameterValues: null })).toEqual({ isValid: true, input: { parameterValues: {} } });
  });

  it("takes text values as typed - spaces and blanks included", () => {
    expect(validateRunParameterValuesInput({ parameterValues: { projectName: " Apollo 7 ", notes: "" } })).toEqual({
      isValid: true,
      input: { parameterValues: { projectName: " Apollo 7 ", notes: "" } },
    });
  });

  it.each([
    [[], "The request body must be a JSON object"],
    [{ parameterValues: ["a"] }, "The parameter values must be an object of text values, by key"],
    [{ parameterValues: { projectName: 7 } }, 'The value for "projectName" must be text'],
    [{ parameterValues: { projectName: "x".repeat(1001) } }, 'The value for "projectName" must be at most 1000 characters'],
    [{ parameterValues: { password: "{{credential.password}}" } }, 'The value for "password" may not contain {{'],
  ])("refuses %j", (body, errorMessage) => {
    expect(validateRunParameterValuesInput(body)).toEqual({ isValid: false, errorMessage });
  });

  it(`refuses more than ${String(MAX_RUN_PARAMETER_VALUES)} values`, () => {
    const tooManyValues = Object.fromEntries(
      Array.from({ length: MAX_RUN_PARAMETER_VALUES + 1 }, (_unused, index) => [`key${String(index)}`, "x"]),
    );
    expect(validateRunParameterValuesInput({ parameterValues: tooManyValues })).toEqual({
      isValid: false,
      errorMessage: "A run may have at most 100 parameter values",
    });
  });
});

describe("validateActionParameterChoicesInput", () => {
  it("takes a trimmed label and a required choice, and null for either", () => {
    expect(validateActionParameterChoicesInput({ userLabel: " Name ", userRequiredChoice: "optional" })).toEqual({
      isValid: true,
      input: { userLabel: "Name", userRequiredChoice: "optional" },
    });
    expect(validateActionParameterChoicesInput({ userLabel: "  " })).toEqual({
      isValid: true,
      input: { userLabel: null, userRequiredChoice: null },
    });
  });

  it.each([
    [null, "The request body must be a JSON object"],
    [{ userLabel: 3 }, "The label must be text, or null"],
    [{ userLabel: "l".repeat(MAX_PARAMETER_TEXT_LENGTH + 1) }, "The label must be at most 100 characters"],
    [{ userRequiredChoice: "sometimes" }, "Required must be one of: required, optional, or null to let the page decide"],
  ])("refuses %j", (body, errorMessage) => {
    expect(validateActionParameterChoicesInput(body)).toEqual({ isValid: false, errorMessage });
  });
});

describe("validateNewActionParameterInput", () => {
  it("takes a value in the steps, required by default, and an object one always required", () => {
    expect(validateNewActionParameterInput({ addKind: "value", label: " Code ", matchText: "AP7" })).toEqual({
      isValid: true,
      input: {
        addKind: "value",
        label: "Code",
        requiredChoice: "required",
        valueKind: "text",
        objectTypeKey: null,
        matchText: "AP7",
      },
    });
    expect(
      validateNewActionParameterInput({
        addKind: "value",
        label: "Project",
        requiredChoice: "optional",
        valueKind: "object",
        objectTypeKey: "/projects/{project}",
        matchText: "Mercury",
      }),
    ).toMatchObject({ isValid: true, input: { requiredChoice: "required", valueKind: "object", objectTypeKey: "/projects/{project}" } });
    expect(
      validateNewActionParameterInput({ addKind: "value", label: "Code", requiredChoice: "optional", objectTypeKey: "/x", matchText: "AP7" }),
    ).toMatchObject({ isValid: true, input: { requiredChoice: "optional", objectTypeKey: null } });
  });

  it("takes a field the steps don't fill, optional by default", () => {
    expect(
      validateNewActionParameterInput({
        addKind: "field",
        label: "Notes",
        fieldTarget: { role: "textbox", name: "Notes" },
        fillAfterKey: " projectName ",
      }),
    ).toEqual({
      isValid: true,
      input: {
        addKind: "field",
        label: "Notes",
        requiredChoice: "optional",
        fieldTarget: { role: "textbox", name: "Notes" },
        stepAction: "fill",
        fillAfterKey: "projectName",
      },
    });
    expect(
      validateNewActionParameterInput({
        addKind: "field",
        label: "Size",
        requiredChoice: "required",
        fieldTarget: { placeholder: "Size" },
        stepAction: "selectOption",
        fillAfterKey: "projectName",
      }),
    ).toMatchObject({ isValid: true, input: { requiredChoice: "required", stepAction: "selectOption" } });
  });

  it.each([
    [undefined, "The request body must be a JSON object"],
    [{ addKind: "value", matchText: "x" }, "A label is required"],
    [{ addKind: "value", label: 5 }, "The label must be text, or null"],
    [{ addKind: "value", label: "L", requiredChoice: "maybe" }, "Required must be one of: required, optional"],
    [{ addKind: "value", label: "L", valueKind: "number", matchText: "x" }, "The value kind must be text or object"],
    [{ addKind: "value", label: "L", objectTypeKey: 5, matchText: "x" }, "The object type must be text, or null"],
    [{ addKind: "value", label: "L", valueKind: "object", matchText: "x" }, "An object parameter needs its object type"],
    [{ addKind: "value", label: "L", matchText: "  " }, "Pick the value in the steps to make a parameter of"],
    [{ addKind: "value", label: "L", matchText: "{{x" }, "The value may not contain {{"],
    [{ addKind: "field", label: "L", fieldTarget: { css: "#x" }, fillAfterKey: "a" }, "The field must be found by its label, its placeholder, or its role and name"],
    [{ addKind: "field", label: "L", fieldTarget: { text: "x" }, fillAfterKey: "a" }, "The field must be found by its label, its placeholder, or its role and name"],
    [{ addKind: "field", label: "L", fieldTarget: { label: " " }, fillAfterKey: "a" }, "The field's label, placeholder, or name may not be blank"],
    [{ addKind: "field", label: "L", fieldTarget: { label: "{{x" }, fillAfterKey: "a" }, "The field's label, placeholder, or name may not contain {{"],
    [{ addKind: "field", label: "L", fieldTarget: { label: "N" }, stepAction: "click", fillAfterKey: "a" }, "The field must be filled in (fill) or picked from (selectOption)"],
    [{ addKind: "field", label: "L", fieldTarget: { label: "N" }, fillAfterKey: 4 }, "The parameter to fill it after must be text, or null"],
    [{ addKind: "field", label: "L", fieldTarget: { label: "N" } }, "Pick the parameter this field is filled in after"],
    [{ addKind: "other", label: "L" }, "The parameter kind must be value or field"],
  ])("refuses %j", (body, errorMessage) => {
    expect(validateNewActionParameterInput(body)).toEqual({ isValid: false, errorMessage });
  });
});
