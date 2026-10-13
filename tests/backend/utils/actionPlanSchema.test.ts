import { describe, it, expect } from "vitest";
import {
  ARIA_ROLES,
  ActionPlanSchema,
  CREDENTIAL_PLACEHOLDERS,
  DIALOG_RESPONSES,
  MAX_PLAN_STEPS,
  MAX_PLAN_TEXT_LENGTH,
  MAX_SCROLL_PIXELS,
  PLAN_KEYS,
  PLAN_STEP_ACTIONS,
  PLAN_STEP_RULES,
  PlanTargetSchema,
  buildAllowedPlanOrigins,
  findActionPlanProblems,
  parseActionPlan,
  planUsesCredentialPlaceholders,
  readHttpOrigin,
  validateActionPlan,
  type ActionPlan,
  type PlanStep,
  type PlanTarget,
} from "../../../server/utils/actionPlanSchema.js";

/** The website's own origin plus its login page's, as `buildAllowedPlanOrigins` would build them. */
const ALLOWED_ORIGINS = ["https://shop.example.com", "https://auth.example.com"];

/** What a URL on another site is told. */
const OTHER_ORIGIN_PROBLEM =
  "must be on this website (https://shop.example.com or https://auth.example.com), not https://evil.example";

/** What a URL that is not an absolute http/https address is told. */
const NOT_HTTP_PROBLEM = "must be an absolute http:// or https:// address";

/** What a text holding a placeholder marker is told. */
const PLACEHOLDER_PROBLEM =
  "may not contain {{ - credential placeholders are only allowed as a whole fill value";

/** What a text longer than `MAX_PLAN_TEXT_LENGTH` is told. */
const TOO_LONG_PROBLEM = `must be at most ${String(MAX_PLAN_TEXT_LENGTH)} characters`;

/** What an `uploadFile` value with a folder in it is told. */
const FILE_NAME_PROBLEM = "must be a file name inside the uploads folder, with no folder path";

/** What a `scroll` value that is not a whole, in-range, non-zero number is told. */
const PIXELS_PROBLEM = `must be a whole number of pixels from -${String(MAX_SCROLL_PIXELS)} to ${String(MAX_SCROLL_PIXELS)} (not 0); negative scrolls up`;

/** A text exactly as long as a plan field may be. */
const LONGEST_ALLOWED_TEXT = "a".repeat(MAX_PLAN_TEXT_LENGTH);

/** A text one character longer than a plan field may be. */
const TOO_LONG_TEXT = "a".repeat(MAX_PLAN_TEXT_LENGTH + 1);

/** The sign-in button, found by role and name. */
const SIGN_IN_BUTTON: PlanTarget = { role: "button", name: "Sign in" };

/** The email field, found by its label. */
const EMAIL_FIELD: PlanTarget = { label: "Email" };

/**
 * Builds one step, defaulting to "no target, no value".
 * @param action - The step's action
 * @param fields - The step's target and value, when it has them
 * @returns The step
 */
function buildStep(
  action: PlanStep["action"],
  fields: { target?: PlanTarget | null; value?: string | null } = {},
): PlanStep {
  return { action, target: fields.target ?? null, value: fields.value ?? null };
}

/**
 * Builds a plan on the website's own origin, with a name and the given steps.
 * @param steps - The plan's steps
 * @param overrides - Fields to replace
 * @returns The plan
 */
function buildPlan(steps: PlanStep[], overrides: Partial<ActionPlan> = {}): ActionPlan {
  return { name: "Log in", startUrl: "https://shop.example.com/", steps, ...overrides };
}

/**
 * Checks a plan holding only one step against every rule.
 * @param step - The one step
 * @returns The plan's problems (empty when the step is valid)
 */
function findSingleStepProblems(step: PlanStep): string[] {
  return findActionPlanProblems(buildPlan([step]), ALLOWED_ORIGINS);
}

/** A plan that passes every rule: log in, check the result. */
const VALID_PLAN: ActionPlan = buildPlan([
  buildStep("click", { target: SIGN_IN_BUTTON }),
  buildStep("fill", { target: EMAIL_FIELD, value: CREDENTIAL_PLACEHOLDERS.username }),
  buildStep("fill", { target: { label: "Password" }, value: CREDENTIAL_PLACEHOLDERS.password }),
  buildStep("press", { value: "Enter" }),
  buildStep("expectVisible", { target: { text: "Welcome back" } }),
]);

describe("ARIA_ROLES", () => {
  it("lists all 82 of Playwright's ARIA roles, once each", () => {
    expect(ARIA_ROLES).toHaveLength(82);
    expect(new Set(ARIA_ROLES).size).toBe(ARIA_ROLES.length);
  });

  it("includes the roles plans use most", () => {
    expect(ARIA_ROLES).toEqual(
      expect.arrayContaining(["button", "textbox", "link", "heading", "checkbox", "combobox", "dialog"]),
    );
  });

  it("is what a role target accepts", () => {
    for (const role of ARIA_ROLES) {
      expect(PlanTargetSchema.safeParse({ role, name: "" }).success).toBe(true);
    }
    expect(PlanTargetSchema.safeParse({ role: "spaceship", name: "" }).success).toBe(false);
  });
});

describe("PLAN_STEP_RULES", () => {
  it("has exactly one rule per allowed step action", () => {
    expect([...PLAN_STEP_RULES.keys()]).toEqual([...PLAN_STEP_ACTIONS]);
  });

  it("finds no rule for inherited object properties such as constructor", () => {
    expect(PLAN_STEP_RULES.get("constructor" as PlanStep["action"])).toBeUndefined();
    expect(PLAN_STEP_RULES.get("__proto__" as PlanStep["action"])).toBeUndefined();
  });
});

describe("CREDENTIAL_PLACEHOLDERS", () => {
  it("names the username and password placeholders", () => {
    expect(CREDENTIAL_PLACEHOLDERS).toEqual({
      username: "{{credential.username}}",
      password: "{{credential.password}}",
    });
  });
});

describe("parseActionPlan", () => {
  it("accepts a well-formed plan and returns it typed", () => {
    expect(parseActionPlan(VALID_PLAN)).toEqual({ isValid: true, input: VALID_PLAN });
  });

  it("restores the field order a database shuffled", () => {
    const shuffledPlan = { steps: VALID_PLAN.steps, startUrl: VALID_PLAN.startUrl, name: VALID_PLAN.name };

    const parsed = parseActionPlan(shuffledPlan);

    expect(parsed.isValid).toBe(true);
    if (parsed.isValid) {
      expect(Object.keys(parsed.input)).toEqual(["name", "startUrl", "steps"]);
    }
  });

  it("checks the structure only, so a plan that breaks the per-action rules still parses", () => {
    const planWithAStepMissingItsTarget = buildPlan([buildStep("click")], { name: "" });

    expect(parseActionPlan(planWithAStepMissingItsTarget).isValid).toBe(true);
  });

  it("names the whole plan when the value is not an object at all", () => {
    expect(parseActionPlan(null)).toEqual({
      isValid: false,
      errorMessage:
        "The plan does not have the expected shape - plan: Invalid input: expected object, received null",
    });
  });

  it("names each missing field by its path", () => {
    const parsed = parseActionPlan({ name: "Log in" });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      expect(parsed.errorMessage).toMatch(/^The plan does not have the expected shape - /);
      expect(parsed.errorMessage).toContain("startUrl:");
      expect(parsed.errorMessage).toContain("steps:");
    }
  });

  it.each(["evaluate", "__proto__", "constructor", "toString", ""])(
    "rejects the unknown action %j",
    (unknownAction) => {
      const parsed = parseActionPlan({
        ...VALID_PLAN,
        steps: [{ action: unknownAction, target: null, value: null }],
      });

      expect(parsed.isValid).toBe(false);
      if (!parsed.isValid) {
        expect(parsed.errorMessage).toContain("steps.0.action: Invalid option");
      }
    },
  );

  it("rejects an extra key on the plan", () => {
    const parsed = parseActionPlan({ ...VALID_PLAN, script: "process.exit()" });

    expect(parsed).toEqual({
      isValid: false,
      errorMessage: 'The plan does not have the expected shape - plan: Unrecognized key: "script"',
    });
  });

  it("rejects an extra key on a step", () => {
    const parsed = parseActionPlan({
      ...VALID_PLAN,
      steps: [{ action: "log", target: null, value: "Hi", code: "alert(1)" }],
    });

    expect(parsed).toEqual({
      isValid: false,
      errorMessage: 'The plan does not have the expected shape - steps.0: Unrecognized key: "code"',
    });
  });

  it("rejects an extra key on a target", () => {
    const parsed = parseActionPlan({
      ...VALID_PLAN,
      steps: [{ action: "click", target: { role: "button", name: "Go", exact: true }, value: null }],
    });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      expect(parsed.errorMessage).toContain("steps.0.target:");
    }
  });

  it("rejects a target that mixes two ways of finding an element", () => {
    const parsed = parseActionPlan({
      ...VALID_PLAN,
      steps: [{ action: "click", target: { label: "Email", text: "Email" }, value: null }],
    });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      expect(parsed.errorMessage).toContain("steps.0.target:");
    }
  });

  it("rejects a role Playwright does not know", () => {
    const parsed = parseActionPlan({
      ...VALID_PLAN,
      steps: [{ action: "click", target: { role: "spaceship", name: "Go" }, value: null }],
    });

    expect(parsed.isValid).toBe(false);
  });

  it("rejects the removed pause action as an unknown action", () => {
    const parsed = parseActionPlan({
      ...VALID_PLAN,
      steps: [{ action: "pause", target: null, value: "Solve the CAPTCHA" }],
    });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      expect(parsed.errorMessage).toContain("steps.0.action:");
    }
  });

  it("rejects a step whose target or value is missing instead of null", () => {
    const parsed = parseActionPlan({ ...VALID_PLAN, steps: [{ action: "log" }] });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      expect(parsed.errorMessage).toContain("steps.0.target:");
      expect(parsed.errorMessage).toContain("steps.0.value:");
    }
  });

  it("lists at most five issues", () => {
    const sevenUnknownSteps = Array.from({ length: 7 }, () => ({
      action: "evaluate",
      target: null,
      value: null,
    }));

    const parsed = parseActionPlan({ ...VALID_PLAN, steps: sevenUnknownSteps });

    expect(parsed.isValid).toBe(false);
    if (!parsed.isValid) {
      const listedIssues = parsed.errorMessage.split("; ");
      expect(listedIssues).toHaveLength(5);
      expect(parsed.errorMessage).toContain("steps.4.action");
      expect(parsed.errorMessage).not.toContain("steps.5.action");
    }
  });

  it.each<[string, PlanTarget]>([
    ["a role and name", { role: "button", name: "Sign in" }],
    ["a role with no name", { role: "navigation", name: "" }],
    ["a label", { label: "Email" }],
    ["a placeholder", { placeholder: "Search" }],
    ["visible text", { text: "Welcome back" }],
    ["alt text", { altText: "Company logo" }],
    ["a title", { title: "Close" }],
    ["a CSS selector", { css: "#main > .card" }],
  ])("accepts a target found by %s", (_targetKind, target) => {
    const parsed = parseActionPlan(buildPlan([buildStep("click", { target })]));

    expect(parsed.isValid).toBe(true);
  });
});

describe("ActionPlanSchema", () => {
  it("is the plan structure: a name, a start URL, and the steps", () => {
    expect(ActionPlanSchema.safeParse(VALID_PLAN).success).toBe(true);
    expect(ActionPlanSchema.safeParse({ ...VALID_PLAN, steps: "click it" }).success).toBe(false);
  });
});

describe("findActionPlanProblems", () => {
  it("finds nothing wrong with a valid plan", () => {
    expect(findActionPlanProblems(VALID_PLAN, ALLOWED_ORIGINS)).toEqual([]);
  });

  describe("the plan itself", () => {
    it("rejects a blank name", () => {
      expect(findActionPlanProblems({ ...VALID_PLAN, name: "   " }, ALLOWED_ORIGINS)).toEqual([
        "Name: may not be blank",
      ]);
    });

    it("rejects a name that is too long or holds a placeholder marker", () => {
      expect(findActionPlanProblems({ ...VALID_PLAN, name: TOO_LONG_TEXT }, ALLOWED_ORIGINS)).toEqual([
        `Name: ${TOO_LONG_PROBLEM}`,
      ]);
      expect(findActionPlanProblems({ ...VALID_PLAN, name: "Log in {{x}}" }, ALLOWED_ORIGINS)).toEqual([
        `Name: ${PLACEHOLDER_PROBLEM}`,
      ]);
    });

    it("accepts a start URL on the login page's origin", () => {
      const plan = { ...VALID_PLAN, startUrl: "https://auth.example.com/login" };

      expect(findActionPlanProblems(plan, ALLOWED_ORIGINS)).toEqual([]);
    });

    it("rejects a start URL on another site", () => {
      const plan = { ...VALID_PLAN, startUrl: "https://evil.example/phish" };

      expect(findActionPlanProblems(plan, ALLOWED_ORIGINS)).toEqual([`Start URL: ${OTHER_ORIGIN_PROBLEM}`]);
    });

    it.each(["not a url", "/relative/path", "ftp://shop.example.com/", "javascript:alert(1)", ""])(
      "rejects the start URL %j, which is not an absolute http/https address",
      (startUrl) => {
        expect(findActionPlanProblems({ ...VALID_PLAN, startUrl }, ALLOWED_ORIGINS)).toEqual([
          `Start URL: ${NOT_HTTP_PROBLEM}`,
        ]);
      },
    );

    it("rejects a plan with no steps", () => {
      expect(findActionPlanProblems(buildPlan([]), ALLOWED_ORIGINS)).toEqual([
        "Steps: a plan needs at least one step",
      ]);
    });

    it(`accepts ${String(MAX_PLAN_STEPS)} steps but not one more`, () => {
      const logStep = buildStep("log", { value: "Still going" });
      const longestPlan = buildPlan(Array<PlanStep>(MAX_PLAN_STEPS).fill(logStep));
      const tooLongPlan = buildPlan(Array<PlanStep>(MAX_PLAN_STEPS + 1).fill(logStep));

      expect(findActionPlanProblems(longestPlan, ALLOWED_ORIGINS)).toEqual([]);
      expect(findActionPlanProblems(tooLongPlan, ALLOWED_ORIGINS)).toEqual([
        "Steps: a plan may have at most 100 steps",
      ]);
    });

    it("reports every problem, each step by its 1-based number and action", () => {
      const plan = buildPlan(
        [
          buildStep("log", { value: "Start" }),
          buildStep("click"),
          buildStep("goto", { value: "https://evil.example/" }),
        ],
        { name: "", startUrl: "mailto:someone@example.com" },
      );

      expect(findActionPlanProblems(plan, ALLOWED_ORIGINS)).toEqual([
        "Name: may not be blank",
        `Start URL: ${NOT_HTTP_PROBLEM}`,
        "Step 2 (click): needs a target",
        `Step 3 (goto): ${OTHER_ORIGIN_PROBLEM}`,
      ]);
    });

    it("rejects every start URL when no origin is allowed", () => {
      expect(findActionPlanProblems(VALID_PLAN, [])).toEqual([
        "Start URL: must be on this website (), not https://shop.example.com",
      ]);
    });
  });

  describe("an action the rules do not know", () => {
    it.each(["evaluate", "constructor", "__proto__"])(
      "rejects %j even when the structure check was bypassed",
      (unknownAction) => {
        const step = { action: unknownAction, target: null, value: null } as unknown as PlanStep;

        expect(findSingleStepProblems(step)).toEqual([`Step 1 (${unknownAction}): is not an allowed action`]);
      },
    );
  });

  describe("targets", () => {
    it.each(["click", "doubleClick", "hover", "check", "uncheck", "scrollIntoView", "expectVisible", "expectHidden"] as const)(
      "requires a target for %s",
      (action) => {
        expect(findSingleStepProblems(buildStep(action))).toEqual([`Step 1 (${action}): needs a target`]);
        expect(findSingleStepProblems(buildStep(action, { target: SIGN_IN_BUTTON }))).toEqual([]);
      },
    );

    it("requires a target for fill, selectOption, and uploadFile", () => {
      expect(findSingleStepProblems(buildStep("fill", { value: "shoes" }))).toEqual([
        "Step 1 (fill): needs a target",
      ]);
      expect(findSingleStepProblems(buildStep("selectOption", { value: "Large" }))).toEqual([
        "Step 1 (selectOption): needs a target",
      ]);
      expect(findSingleStepProblems(buildStep("uploadFile", { value: "report.pdf" }))).toEqual([
        "Step 1 (uploadFile): needs a target",
      ]);
    });

    it("lets press go with or without a target", () => {
      expect(findSingleStepProblems(buildStep("press", { value: "Enter" }))).toEqual([]);
      expect(findSingleStepProblems(buildStep("press", { target: EMAIL_FIELD, value: "Enter" }))).toEqual([]);
    });

    it.each<[PlanStep["action"], string]>([
      ["goto", "https://shop.example.com/cart"],
      ["scroll", "600"],
      ["respondToNextDialog", "accept"],
      ["waitForUrl", "**/cart"],
      ["log", "Cart opened"],
    ])("rejects a target on %s", (action, value) => {
      expect(findSingleStepProblems(buildStep(action, { target: SIGN_IN_BUTTON, value }))).toEqual([
        `Step 1 (${action}): takes no target`,
      ]);
    });

    it.each<[string, PlanTarget]>([
      ["label", { label: "  " }],
      ["placeholder", { placeholder: "" }],
      ["text", { text: "\n" }],
      ["altText", { altText: " " }],
      ["title", { title: "" }],
      ["css", { css: "   " }],
    ])("rejects a blank %s", (fieldName, target) => {
      expect(findSingleStepProblems(buildStep("click", { target }))).toEqual([
        `Step 1 (click): the target's ${fieldName} may not be blank`,
      ]);
    });

    it("lets a role's name be empty or blank, meaning any name", () => {
      expect(findSingleStepProblems(buildStep("click", { target: { role: "navigation", name: "" } }))).toEqual([]);
      expect(findSingleStepProblems(buildStep("click", { target: { role: "navigation", name: "  " } }))).toEqual(
        [],
      );
    });

    it("rejects target text that holds a placeholder marker or is too long", () => {
      expect(
        findSingleStepProblems(buildStep("click", { target: { role: "button", name: "{{credential.username}}" } })),
      ).toEqual([`Step 1 (click): the target's name ${PLACEHOLDER_PROBLEM}`]);
      expect(findSingleStepProblems(buildStep("click", { target: { text: TOO_LONG_TEXT } }))).toEqual([
        `Step 1 (click): the target's text ${TOO_LONG_PROBLEM}`,
      ]);
      expect(findSingleStepProblems(buildStep("click", { target: { css: LONGEST_ALLOWED_TEXT } }))).toEqual([]);
    });

    it("checks the target before the value", () => {
      const step = buildStep("fill", { target: { label: "" }, value: "{{bad" });

      expect(findSingleStepProblems(step)).toEqual(["Step 1 (fill): the target's label may not be blank"]);
    });
  });

  describe("values", () => {
    it.each(["click", "doubleClick", "hover", "check", "uncheck", "scrollIntoView", "expectVisible", "expectHidden"] as const)(
      "rejects a value on %s",
      (action) => {
        expect(findSingleStepProblems(buildStep(action, { target: SIGN_IN_BUTTON, value: "x" }))).toEqual([
          `Step 1 (${action}): takes no value`,
        ]);
      },
    );

    it.each<[PlanStep["action"], PlanTarget | null]>([
      ["goto", null],
      ["fill", EMAIL_FIELD],
      ["press", null],
      ["selectOption", EMAIL_FIELD],
      ["scroll", null],
      ["uploadFile", SIGN_IN_BUTTON],
      ["respondToNextDialog", null],
      ["waitForUrl", null],
      ["log", null],
    ])("requires a value for %s", (action, target) => {
      expect(findSingleStepProblems(buildStep(action, { target, value: null }))).toEqual([
        `Step 1 (${action}): needs a value`,
      ]);
    });

    it.each<[PlanStep["action"], PlanTarget | null]>([
      ["goto", null],
      ["press", null],
      ["selectOption", EMAIL_FIELD],
      ["scroll", null],
      ["uploadFile", SIGN_IN_BUTTON],
      ["respondToNextDialog", null],
      ["waitForUrl", null],
      ["log", null],
    ])("rejects a blank value for %s", (action, target) => {
      expect(findSingleStepProblems(buildStep(action, { target, value: "   " }))).toEqual([
        `Step 1 (${action}): needs a value`,
      ]);
    });

    describe("url (goto)", () => {
      it("accepts the website's own origin and the login page's origin", () => {
        expect(findSingleStepProblems(buildStep("goto", { value: "https://shop.example.com/cart?x=1#top" }))).toEqual(
          [],
        );
        expect(findSingleStepProblems(buildStep("goto", { value: "https://auth.example.com/login" }))).toEqual([]);
      });

      it("rejects another origin, including another port or scheme of the same host", () => {
        expect(findSingleStepProblems(buildStep("goto", { value: "https://evil.example/" }))).toEqual([
          `Step 1 (goto): ${OTHER_ORIGIN_PROBLEM}`,
        ]);
        expect(findSingleStepProblems(buildStep("goto", { value: "http://shop.example.com/" }))).toEqual([
          "Step 1 (goto): must be on this website (https://shop.example.com or https://auth.example.com), not http://shop.example.com",
        ]);
        expect(findSingleStepProblems(buildStep("goto", { value: "https://shop.example.com:8443/" }))).toEqual([
          "Step 1 (goto): must be on this website (https://shop.example.com or https://auth.example.com), not https://shop.example.com:8443",
        ]);
      });

      it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "/cart", "cart"])(
        "rejects the non-http address %j",
        (url) => {
          expect(findSingleStepProblems(buildStep("goto", { value: url }))).toEqual([
            `Step 1 (goto): ${NOT_HTTP_PROBLEM}`,
          ]);
        },
      );
    });

    describe("text (fill)", () => {
      /**
       * Checks a `fill` step typing the given text into the email field.
       * @param text - The text to type
       * @returns The plan's problems
       */
      const findFillProblems = (text: string): string[] =>
        findSingleStepProblems(buildStep("fill", { target: EMAIL_FIELD, value: text }));

      it("accepts plain text, an empty text, and a blank text (which just clear the field)", () => {
        expect(findFillProblems("blue shoes")).toEqual([]);
        expect(findFillProblems("")).toEqual([]);
        expect(findFillProblems("   ")).toEqual([]);
      });

      it("accepts each credential placeholder as the whole value", () => {
        expect(findFillProblems(CREDENTIAL_PLACEHOLDERS.username)).toEqual([]);
        expect(findFillProblems(CREDENTIAL_PLACEHOLDERS.password)).toEqual([]);
      });

      it.each([
        "user: {{credential.username}}",
        "{{credential.password}} ",
        "{{credential.token}}",
        "{{",
        "a {{ b",
      ])("rejects %j, which uses {{ other than as a whole placeholder", (text) => {
        expect(findFillProblems(text)).toEqual([`Step 1 (fill): ${PLACEHOLDER_PROBLEM}`]);
      });

      it(`accepts ${String(MAX_PLAN_TEXT_LENGTH)} characters but not one more`, () => {
        expect(findFillProblems(LONGEST_ALLOWED_TEXT)).toEqual([]);
        expect(findFillProblems(TOO_LONG_TEXT)).toEqual([`Step 1 (fill): ${TOO_LONG_PROBLEM}`]);
      });
    });

    describe("key (press)", () => {
      it.each([...PLAN_KEYS])("accepts %s", (key) => {
        expect(findSingleStepProblems(buildStep("press", { value: key }))).toEqual([]);
      });

      it.each(["enter", "Control+A", "ControlOrMeta+A", "a", "F12"])("rejects %j", (key) => {
        expect(findSingleStepProblems(buildStep("press", { value: key }))).toEqual([
          `Step 1 (press): must be one of: ${PLAN_KEYS.join(", ")}`,
        ]);
      });
    });

    describe("dialogResponse (respondToNextDialog)", () => {
      it.each([...DIALOG_RESPONSES])("accepts %s", (response) => {
        expect(findSingleStepProblems(buildStep("respondToNextDialog", { value: response }))).toEqual([]);
      });

      it.each(["ok", "Accept", "cancel"])("rejects %j", (response) => {
        expect(findSingleStepProblems(buildStep("respondToNextDialog", { value: response }))).toEqual([
          "Step 1 (respondToNextDialog): must be one of: accept, dismiss",
        ]);
      });
    });

    describe("pixels (scroll)", () => {
      it.each(["1", "600", "-600", String(MAX_SCROLL_PIXELS), `-${String(MAX_SCROLL_PIXELS)}`])(
        "accepts %s",
        (pixels) => {
          expect(findSingleStepProblems(buildStep("scroll", { value: pixels }))).toEqual([]);
        },
      );

      it.each([
        "0",
        "-0",
        String(MAX_SCROLL_PIXELS + 1),
        `-${String(MAX_SCROLL_PIXELS + 1)}`,
        "1.5",
        "600px",
        "+600",
        "1e3",
        "down",
      ])("rejects %j", (pixels) => {
        expect(findSingleStepProblems(buildStep("scroll", { value: pixels }))).toEqual([
          `Step 1 (scroll): ${PIXELS_PROBLEM}`,
        ]);
      });
    });

    describe("fileName (uploadFile)", () => {
      /**
       * Checks an `uploadFile` step picking the given file.
       * @param fileName - The file's name
       * @returns The plan's problems
       */
      const findUploadProblems = (fileName: string): string[] =>
        findSingleStepProblems(buildStep("uploadFile", { target: SIGN_IN_BUTTON, value: fileName }));

      it("accepts a bare file name", () => {
        expect(findUploadProblems("report.pdf")).toEqual([]);
        expect(findUploadProblems(".hidden")).toEqual([]);
      });

      it.each(["docs/report.pdf", "../secrets.txt", "/etc/passwd", "..\\secrets.txt", "C:\\x.txt", ".", "..", "a\u0000b"])(
        "rejects %j",
        (fileName) => {
          expect(findUploadProblems(fileName)).toEqual([`Step 1 (uploadFile): ${FILE_NAME_PROBLEM}`]);
        },
      );

      it("also applies the plain text rules", () => {
        expect(findUploadProblems("{{credential.password}}")).toEqual([
          `Step 1 (uploadFile): ${PLACEHOLDER_PROBLEM}`,
        ]);
        expect(findUploadProblems(TOO_LONG_TEXT)).toEqual([`Step 1 (uploadFile): ${TOO_LONG_PROBLEM}`]);
      });
    });

    describe.each<[PlanStep["action"], PlanTarget | null, string]>([
      ["selectOption", EMAIL_FIELD, "Large"],
      ["waitForUrl", null, "**/order/*/confirmation"],
      ["log", null, "Cart opened"],
    ])("plain text (%s)", (action, target, goodValue) => {
      it("accepts plain text", () => {
        expect(findSingleStepProblems(buildStep(action, { target, value: goodValue }))).toEqual([]);
      });

      it("rejects a placeholder, even a whole one", () => {
        expect(
          findSingleStepProblems(buildStep(action, { target, value: CREDENTIAL_PLACEHOLDERS.password })),
        ).toEqual([`Step 1 (${action}): ${PLACEHOLDER_PROBLEM}`]);
      });

      it("rejects a text that is too long", () => {
        expect(findSingleStepProblems(buildStep(action, { target, value: TOO_LONG_TEXT }))).toEqual([
          `Step 1 (${action}): ${TOO_LONG_PROBLEM}`,
        ]);
      });
    });
  });
});

describe("validateActionPlan", () => {
  it("returns a plan that passes both the structure and every rule", () => {
    expect(validateActionPlan(VALID_PLAN, ALLOWED_ORIGINS)).toEqual({ isValid: true, input: VALID_PLAN });
  });

  it("returns the structure error, without applying the rules, when the shape is wrong", () => {
    const planWithAnUnknownAction = {
      name: "",
      startUrl: "https://evil.example/",
      steps: [{ action: "__proto__", target: null, value: null }],
    };

    const validation = validateActionPlan(planWithAnUnknownAction, ALLOWED_ORIGINS);

    expect(validation).toEqual(parseActionPlan(planWithAnUnknownAction));
    expect(validation.isValid).toBe(false);
    if (!validation.isValid) {
      expect(validation.errorMessage).not.toContain("Name:");
    }
  });

  it("rejects an otherwise valid plan that still has a removed pause step", () => {
    const planWithAPauseStep = {
      ...VALID_PLAN,
      steps: [...VALID_PLAN.steps, { action: "pause", target: null, value: "Solve the CAPTCHA" }],
    };
    const pauseStepPath = `steps.${String(VALID_PLAN.steps.length)}.action:`;

    const validation = validateActionPlan(planWithAPauseStep, ALLOWED_ORIGINS);

    expect(validation.isValid).toBe(false);
    if (!validation.isValid) {
      expect(validation.errorMessage).toContain(pauseStepPath);
    }
  });

  it("joins every rule problem into one message", () => {
    const plan = buildPlan(
      [buildStep("click"), buildStep("goto", { value: "https://evil.example/" })],
      { name: " " },
    );

    expect(validateActionPlan(plan, ALLOWED_ORIGINS)).toEqual({
      isValid: false,
      errorMessage: `Name: may not be blank; Step 1 (click): needs a target; Step 2 (goto): ${OTHER_ORIGIN_PROBLEM}`,
    });
  });
});

describe("readHttpOrigin", () => {
  it("returns the origin of an http or https URL, lowercased and without the default port", () => {
    expect(readHttpOrigin("https://Shop.Example.com:443/cart?x=1#top")).toBe("https://shop.example.com");
    expect(readHttpOrigin("http://localhost:5173/login")).toBe("http://localhost:5173");
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "about:blank", "not a url", "/cart", ""])(
    "returns null for %j",
    (url) => {
      expect(readHttpOrigin(url)).toBeNull();
    },
  );
});

describe("buildAllowedPlanOrigins", () => {
  it("collects each distinct origin once, in order", () => {
    expect(
      buildAllowedPlanOrigins([
        "https://shop.example.com/",
        "https://shop.example.com/login",
        "https://auth.example.com/sign-in",
      ]),
    ).toEqual(["https://shop.example.com", "https://auth.example.com"]);
  });

  it("skips null entries", () => {
    expect(buildAllowedPlanOrigins(["https://shop.example.com/", null, null])).toEqual([
      "https://shop.example.com",
    ]);
    expect(buildAllowedPlanOrigins([null])).toEqual([]);
  });

  it("skips URLs that are not http or https", () => {
    expect(
      buildAllowedPlanOrigins(["ftp://files.example.com/", "not a url", "https://shop.example.com/"]),
    ).toEqual(["https://shop.example.com"]);
  });

  it("returns nothing for no URLs", () => {
    expect(buildAllowedPlanOrigins([])).toEqual([]);
  });
});

describe("planUsesCredentialPlaceholders", () => {
  it("is true when a fill types the username or the password", () => {
    expect(
      planUsesCredentialPlaceholders(
        buildPlan([buildStep("fill", { target: EMAIL_FIELD, value: CREDENTIAL_PLACEHOLDERS.username })]),
      ),
    ).toBe(true);
    expect(
      planUsesCredentialPlaceholders(
        buildPlan([
          buildStep("click", { target: SIGN_IN_BUTTON }),
          buildStep("fill", { target: EMAIL_FIELD, value: CREDENTIAL_PLACEHOLDERS.password }),
        ]),
      ),
    ).toBe(true);
  });

  it("is false when every fill types literal text", () => {
    expect(
      planUsesCredentialPlaceholders(buildPlan([buildStep("fill", { target: EMAIL_FIELD, value: "a@b.com" })])),
    ).toBe(false);
  });

  it("only counts fill steps", () => {
    expect(
      planUsesCredentialPlaceholders(buildPlan([buildStep("log", { value: CREDENTIAL_PLACEHOLDERS.password })])),
    ).toBe(false);
  });

  it("is false for a plan with no steps", () => {
    expect(planUsesCredentialPlaceholders(buildPlan([]))).toBe(false);
  });
});
