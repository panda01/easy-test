import { describe, it, expect } from "vitest";
import {
  CREDENTIAL_PLACEHOLDERS,
  MAX_PLAN_STEPS,
  PLAN_STEP_ACTIONS,
  PLAN_TARGET_KINDS,
  type ActionPlan,
  type PlanStep,
  type PlanStepAction,
  type PlanTarget,
  type PlanTargetKind,
  type PlanValueKind,
  buildPlanTarget,
  changePlanStepAction,
  describePlanStep,
  describePlanStepParts,
  describePlanTarget,
  findPlanProblems,
  formatPlanJson,
  readPlanStepRule,
  readPlanTargetKind,
  readPlanTargetText,
  startingValueFor,
} from "../../src/utils/actionPlanSteps";

/** A click on the "Sign in" button: a step with no problems. */
const CLICK_SIGN_IN: PlanStep = {
  action: "click",
  target: { role: "button", name: "Sign in" },
  value: null,
};

/**
 * Builds a plan that has no problems by default: named, starting at an
 * https address, with one click step.
 * @param overrides - Fields to replace in the default plan
 * @returns The plan
 */
function buildPlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [CLICK_SIGN_IN],
    ...overrides,
  };
}

/**
 * Checks a plan that has a single step and returns that step's problems.
 * @param step - The only step of an otherwise valid plan
 * @returns The problems `findPlanProblems` reports
 */
function findSingleStepProblems(step: PlanStep): string[] {
  return findPlanProblems(buildPlan({ steps: [step] }));
}

/** One target of every kind, with what each reader should report for it. */
const TARGET_CASES: { kind: PlanTargetKind; target: PlanTarget; text: string; description: string }[] = [
  { kind: "role", target: { role: "button", name: "Sign in" }, text: "Sign in", description: 'button "Sign in"' },
  { kind: "label", target: { label: "Email" }, text: "Email", description: 'the field labelled "Email"' },
  {
    kind: "placeholder",
    target: { placeholder: "Search…" },
    text: "Search…",
    description: 'the field with placeholder "Search…"',
  },
  { kind: "text", target: { text: "Welcome back" }, text: "Welcome back", description: 'the text "Welcome back"' },
  { kind: "altText", target: { altText: "Logo" }, text: "Logo", description: 'the image "Logo"' },
  { kind: "title", target: { title: "Help" }, text: "Help", description: 'the element titled "Help"' },
  {
    kind: "css",
    target: { css: "#main > .spinner" },
    text: "#main > .spinner",
    description: 'the element matching CSS "#main > .spinner"',
  },
];

describe("readPlanStepRule", () => {
  it("has a rule for every step action, with a label and a value label only for actions that take a value", () => {
    for (const action of PLAN_STEP_ACTIONS) {
      const rule = readPlanStepRule(action);
      expect(rule.label).not.toBe("");
      const actionTakesAValue = rule.value !== "none";
      expect(rule.valueLabel !== "").toBe(actionTakesAValue);
    }
  });

  it("describes what each kind of action needs", () => {
    expect(readPlanStepRule("goto")).toEqual({
      label: "Go to address",
      target: "none",
      value: "url",
      valueLabel: "URL",
    });
    expect(readPlanStepRule("click")).toEqual({
      label: "Click",
      target: "required",
      value: "none",
      valueLabel: "",
    });
    expect(readPlanStepRule("press")).toEqual({
      label: "Press key",
      target: "optional",
      value: "key",
      valueLabel: "Key",
    });
    expect(readPlanStepRule("fill").value).toBe("text");
    expect(readPlanStepRule("scroll").value).toBe("pixels");
    expect(readPlanStepRule("respondToNextDialog").value).toBe("dialogResponse");
  });

  it("throws for a name that is not a step action, even one every object inherits", () => {
    expect(() => readPlanStepRule("constructor" as PlanStepAction)).toThrow(
      'No rule for step action "constructor"',
    );
    expect(() => readPlanStepRule("typeSlowly" as PlanStepAction)).toThrow(
      'No rule for step action "typeSlowly"',
    );
  });
});

describe("plan targets", () => {
  it("lists every way of finding an element, most user-like first", () => {
    expect(PLAN_TARGET_KINDS.map((targetKind) => targetKind.kind)).toEqual([
      "role",
      "label",
      "placeholder",
      "text",
      "altText",
      "title",
      "css",
    ]);
  });

  it.each(TARGET_CASES)("reads, builds, and describes a $kind target", ({ kind, target, text, description }) => {
    expect(readPlanTargetKind(target)).toBe(kind);
    expect(readPlanTargetText(target)).toBe(text);
    expect(buildPlanTarget(kind, text, "button")).toEqual(target);
    expect(describePlanTarget(target)).toBe(description);
  });

  it("uses the role only for a role target", () => {
    expect(buildPlanTarget("role", "Email", "textbox")).toEqual({ role: "textbox", name: "Email" });
    expect(buildPlanTarget("label", "Email", "textbox")).toEqual({ label: "Email" });
  });

  it("describes a role target with a blank name by its role alone", () => {
    expect(describePlanTarget({ role: "dialog", name: "" })).toBe("the dialog");
  });
});

describe("describePlanStep", () => {
  it.each<[string, PlanStep, string]>([
    ["goto", { action: "goto", target: null, value: "https://example.com/" }, "Go to https://example.com/"],
    ["click", CLICK_SIGN_IN, 'Click button "Sign in"'],
    ["doubleClick", { action: "doubleClick", target: { text: "Row 1" }, value: null }, 'Double-click the text "Row 1"'],
    ["hover", { action: "hover", target: { title: "Help" }, value: null }, 'Hover over the element titled "Help"'],
    [
      "fill (literal text)",
      { action: "fill", target: { label: "Search" }, value: "hello" },
      'Type "hello" into the field labelled "Search"',
    ],
    [
      "fill (username placeholder)",
      { action: "fill", target: { label: "Email" }, value: CREDENTIAL_PLACEHOLDERS.username },
      `Type the credential's username into the field labelled "Email"`,
    ],
    [
      "fill (password placeholder)",
      { action: "fill", target: { label: "Password" }, value: CREDENTIAL_PLACEHOLDERS.password },
      `Type the credential's password into the field labelled "Password"`,
    ],
    [
      "fill (no value)",
      { action: "fill", target: { placeholder: "Name" }, value: null },
      'Type "" into the field with placeholder "Name"',
    ],
    ["press (where the focus is)", { action: "press", target: null, value: "Enter" }, "Press Enter"],
    [
      "press (in an element)",
      { action: "press", target: { role: "textbox", name: "Search" }, value: "ArrowDown" },
      'Press ArrowDown in textbox "Search"',
    ],
    ["check", { action: "check", target: { role: "checkbox", name: "Remember me" }, value: null }, 'Check checkbox "Remember me"'],
    [
      "uncheck",
      { action: "uncheck", target: { role: "checkbox", name: "Newsletter" }, value: null },
      'Uncheck checkbox "Newsletter"',
    ],
    [
      "selectOption",
      { action: "selectOption", target: { role: "combobox", name: "Country" }, value: "Canada" },
      'Select "Canada" in combobox "Country"',
    ],
    ["scrollIntoView", { action: "scrollIntoView", target: { altText: "Logo" }, value: null }, 'Scroll to the image "Logo"'],
    ["scroll", { action: "scroll", target: null, value: "-600" }, "Scroll by -600 pixels"],
    [
      "uploadFile",
      { action: "uploadFile", target: { label: "Avatar" }, value: "photo.png" },
      'Upload "photo.png" with the field labelled "Avatar"',
    ],
    [
      "respondToNextDialog",
      { action: "respondToNextDialog", target: null, value: "dismiss" },
      'Answer the next browser dialog with "dismiss"',
    ],
    ["waitForUrl", { action: "waitForUrl", target: null, value: "**/dashboard" }, "Wait for the address **/dashboard"],
    [
      "expectVisible",
      { action: "expectVisible", target: { role: "heading", name: "Welcome" }, value: null },
      'Check that heading "Welcome" is visible',
    ],
    [
      "expectHidden",
      { action: "expectHidden", target: { css: ".spinner" }, value: null },
      'Check that the element matching CSS ".spinner" is hidden',
    ],
    ["log", { action: "log", target: null, value: "Signed in" }, "Note: Signed in"],
    ["a step with no value", { action: "log", target: null, value: null }, "Note: "],
  ])("describes %s", (_caseName, step, expectedSentence) => {
    expect(describePlanStep(step)).toBe(expectedSentence);
  });
});

describe("describePlanStepParts", () => {
  it.each<[string, PlanStep, string, string]>([
    ["goto", { action: "goto", target: null, value: "/calendar" }, "Go to", "/calendar"],
    ["click", CLICK_SIGN_IN, "Click", 'button "Sign in"'],
    ["hover", { action: "hover", target: { title: "Help" }, value: null }, "Hover over", 'the element titled "Help"'],
    [
      "fill",
      { action: "fill", target: { label: "Search" }, value: "hello" },
      "Type",
      '"hello" into the field labelled "Search"',
    ],
    ["scroll", { action: "scroll", target: null, value: "600" }, "Scroll by", "600 pixels"],
    ["waitForUrl", { action: "waitForUrl", target: null, value: "**/done" }, "Wait for", "the address **/done"],
    [
      "expectVisible",
      { action: "expectVisible", target: { role: "heading", name: "Open Yoga" }, value: null },
      "Check that",
      'heading "Open Yoga" is visible',
    ],
    ["log", { action: "log", target: null, value: "Signed in" }, "Note:", "Signed in"],
  ])("splits %s into its verb and the rest", (_caseName, step, expectedVerb, expectedRest) => {
    expect(describePlanStepParts(step)).toEqual({ verb: expectedVerb, rest: expectedRest });
  });

  it("joins back into exactly the sentence describePlanStep gives, for every action", () => {
    for (const action of PLAN_STEP_ACTIONS) {
      const step: PlanStep = { action, target: { role: "button", name: "Go" }, value: "x" };
      const { verb, rest } = describePlanStepParts(step);
      expect(describePlanStep(step)).toBe(`${verb} ${rest}`);
    }
  });
});

describe("findPlanProblems", () => {
  it("finds nothing wrong with a named plan, an http(s) start URL, and valid steps", () => {
    expect(findPlanProblems(buildPlan())).toEqual([]);
    expect(findPlanProblems(buildPlan({ startUrl: "http://localhost:3000/login" }))).toEqual([]);
  });

  it("needs a name that is not blank", () => {
    expect(findPlanProblems(buildPlan({ name: "" }))).toEqual(["Name: may not be blank"]);
    expect(findPlanProblems(buildPlan({ name: "   " }))).toEqual(["Name: may not be blank"]);
  });

  it("needs an absolute http or https start URL", () => {
    const startUrlProblem = "Start URL: must be an absolute http:// or https:// address";
    expect(findPlanProblems(buildPlan({ startUrl: "" }))).toEqual([startUrlProblem]);
    expect(findPlanProblems(buildPlan({ startUrl: "example.com/login" }))).toEqual([startUrlProblem]);
    expect(findPlanProblems(buildPlan({ startUrl: "ftp://example.com/" }))).toEqual([startUrlProblem]);
  });

  it("needs at least one step and at most the maximum", () => {
    expect(findPlanProblems(buildPlan({ steps: [] }))).toEqual(["Steps: a plan needs at least one step"]);
    expect(findPlanProblems(buildPlan({ steps: Array<PlanStep>(MAX_PLAN_STEPS).fill(CLICK_SIGN_IN) }))).toEqual(
      [],
    );
    expect(
      findPlanProblems(buildPlan({ steps: Array<PlanStep>(MAX_PLAN_STEPS + 1).fill(CLICK_SIGN_IN) })),
    ).toEqual(["Steps: a plan may have at most 100 steps"]);
  });

  it("needs an element for an action that requires one, and refuses one where it takes none", () => {
    expect(findSingleStepProblems({ action: "click", target: null, value: null })).toEqual([
      "Step 1 (Click): needs an element to act on",
    ]);
    expect(
      findSingleStepProblems({ action: "goto", target: { label: "Home" }, value: "https://example.com/" }),
    ).toEqual(["Step 1 (Go to address): takes no element"]);
  });

  it("lets a press step act where the focus is, or on an element", () => {
    expect(findSingleStepProblems({ action: "press", target: null, value: "Enter" })).toEqual([]);
    expect(findSingleStepProblems({ action: "press", target: { label: "Search" }, value: "Enter" })).toEqual([]);
  });

  it("needs the text to find an element by, except a role target's name, which may be blank", () => {
    expect(findSingleStepProblems({ action: "click", target: { label: "  " }, value: null })).toEqual([
      "Step 1 (Click): needs the text to find the element by",
    ]);
    expect(findSingleStepProblems({ action: "click", target: { css: "" }, value: null })).toEqual([
      "Step 1 (Click): needs the text to find the element by",
    ]);
    expect(findSingleStepProblems({ action: "click", target: { role: "button", name: "" }, value: null })).toEqual(
      [],
    );
  });

  it("refuses a value on an action that takes none, and a missing value on one that needs it", () => {
    expect(findSingleStepProblems({ ...CLICK_SIGN_IN, value: "now" })).toEqual(["Step 1 (Click): takes no value"]);
    expect(findSingleStepProblems({ action: "goto", target: null, value: null })).toEqual([
      "Step 1 (Go to address): needs a value",
    ]);
  });

  it("needs a non-blank value, except for typed text, which may be empty", () => {
    expect(findSingleStepProblems({ action: "goto", target: null, value: "  " })).toEqual([
      "Step 1 (Go to address): needs a value (URL)",
    ]);
    expect(findSingleStepProblems({ action: "log", target: null, value: "" })).toEqual([
      "Step 1 (Log a note): needs a value (Message)",
    ]);
    expect(findSingleStepProblems({ action: "fill", target: { label: "Search" }, value: "" })).toEqual([]);
  });

  it("needs an absolute http or https address for a Go to step", () => {
    expect(findSingleStepProblems({ action: "goto", target: null, value: "https://example.com/account" })).toEqual(
      [],
    );
    expect(findSingleStepProblems({ action: "goto", target: null, value: "/account" })).toEqual([
      "Step 1 (Go to address): must be an absolute http:// or https:// address",
    ]);
    expect(findSingleStepProblems({ action: "goto", target: null, value: "javascript:alert(1)" })).toEqual([
      "Step 1 (Go to address): must be an absolute http:// or https:// address",
    ]);
  });

  it("needs one of the listed keys for a Press key step", () => {
    expect(findSingleStepProblems({ action: "press", target: null, value: "Escape" })).toEqual([]);
    expect(findSingleStepProblems({ action: "press", target: null, value: "Control+A" })).toEqual([
      "Step 1 (Press key): must be one of the listed keys",
    ]);
  });

  it("needs accept or dismiss to answer a dialog", () => {
    expect(findSingleStepProblems({ action: "respondToNextDialog", target: null, value: "accept" })).toEqual([]);
    expect(findSingleStepProblems({ action: "respondToNextDialog", target: null, value: "dismiss" })).toEqual([]);
    expect(findSingleStepProblems({ action: "respondToNextDialog", target: null, value: "OK" })).toEqual([
      "Step 1 (Answer next dialog): must be accept or dismiss",
    ]);
  });

  it("needs a whole, non-zero number of pixels within the limit to scroll", () => {
    const pixelsProblem = "Step 1 (Scroll by pixels): must be a whole number from -5000 to 5000, not 0";
    for (const validPixels of ["600", "-600", "5000", "-5000", "1"]) {
      expect(findSingleStepProblems({ action: "scroll", target: null, value: validPixels })).toEqual([]);
    }
    for (const invalidPixels of ["0", "-0", "5001", "-5001", "12.5", "1e3", "down"]) {
      expect(findSingleStepProblems({ action: "scroll", target: null, value: invalidPixels })).toEqual([
        pixelsProblem,
      ]);
    }
  });

  it("needs a bare file name, with no folder, to upload", () => {
    const fileNameProblem = "Step 1 (Upload file): must be a file name with no folder";
    const uploadStep: PlanStep = { action: "uploadFile", target: { label: "Avatar" }, value: "photo.png" };
    expect(findSingleStepProblems(uploadStep)).toEqual([]);
    for (const invalidFileName of ["photos/photo.png", "photos\\photo.png", ".", "..", "../secret.txt"]) {
      expect(findSingleStepProblems({ ...uploadStep, value: invalidFileName })).toEqual([fileNameProblem]);
    }
  });

  it("accepts any non-blank option label, URL pattern, or message", () => {
    expect(
      findSingleStepProblems({ action: "selectOption", target: { label: "Country" }, value: "Canada" }),
    ).toEqual([]);
    expect(findSingleStepProblems({ action: "waitForUrl", target: null, value: "**/dashboard" })).toEqual([]);
    expect(findSingleStepProblems({ action: "log", target: null, value: "Signed in" })).toEqual([]);
  });

  it("allows a credential placeholder only as a whole Type text value", () => {
    const placeholderProblem =
      "may not contain {{ - credential placeholders are only allowed as a whole text value";
    expect(
      findSingleStepProblems({ action: "fill", target: { label: "Email" }, value: CREDENTIAL_PLACEHOLDERS.username }),
    ).toEqual([]);
    expect(
      findSingleStepProblems({
        action: "fill",
        target: { label: "Password" },
        value: CREDENTIAL_PLACEHOLDERS.password,
      }),
    ).toEqual([]);
    expect(
      findSingleStepProblems({ action: "fill", target: { label: "Email" }, value: "me+{{credential.username}}" }),
    ).toEqual([`Step 1 (Type text): ${placeholderProblem}`]);
    expect(
      findSingleStepProblems({ action: "fill", target: { label: "Email" }, value: "{{credential.email}}" }),
    ).toEqual([`Step 1 (Type text): ${placeholderProblem}`]);
    expect(
      findSingleStepProblems({
        action: "selectOption",
        target: { label: "Account" },
        value: CREDENTIAL_PLACEHOLDERS.username,
      }),
    ).toEqual([`Step 1 (Select option): ${placeholderProblem}`]);
    expect(findSingleStepProblems({ action: "log", target: null, value: "{{credential.password}}" })).toEqual([
      `Step 1 (Log a note): ${placeholderProblem}`,
    ]);
  });

  it("reports every problem, numbering the steps from 1 and naming their actions", () => {
    expect(
      findPlanProblems({
        name: " ",
        startUrl: "nowhere",
        steps: [
          CLICK_SIGN_IN,
          { action: "hover", target: null, value: null },
          { action: "press", target: null, value: "F5" },
        ],
      }),
    ).toEqual([
      "Name: may not be blank",
      "Start URL: must be an absolute http:// or https:// address",
      "Step 2 (Hover): needs an element to act on",
      "Step 3 (Press key): must be one of the listed keys",
    ]);
  });
});

describe("changePlanStepAction", () => {
  it("keeps the target and the value when the new action takes the same kinds", () => {
    expect(changePlanStepAction(CLICK_SIGN_IN, "doubleClick")).toEqual({
      action: "doubleClick",
      target: { role: "button", name: "Sign in" },
      value: null,
    });
    expect(changePlanStepAction({ action: "log", target: null, value: "Signed in" }, "log")).toEqual({
      action: "log",
      target: null,
      value: "Signed in",
    });
  });

  it("keeps the target but starts a new value when the value kind changes", () => {
    const fillEmail: PlanStep = { action: "fill", target: { label: "Email" }, value: "me@example.com" };
    expect(changePlanStepAction(fillEmail, "selectOption")).toEqual({
      action: "selectOption",
      target: { label: "Email" },
      value: "",
    });
    expect(changePlanStepAction(fillEmail, "click")).toEqual({
      action: "click",
      target: { label: "Email" },
      value: null,
    });
    expect(changePlanStepAction(fillEmail, "press")).toEqual({
      action: "press",
      target: { label: "Email" },
      value: "Enter",
    });
  });

  it("drops the target when the new action takes no element", () => {
    expect(changePlanStepAction(CLICK_SIGN_IN, "goto")).toEqual({ action: "goto", target: null, value: "" });
    expect(changePlanStepAction(CLICK_SIGN_IN, "respondToNextDialog")).toEqual({
      action: "respondToNextDialog",
      target: null,
      value: "accept",
    });
    expect(changePlanStepAction(CLICK_SIGN_IN, "scroll")).toEqual({
      action: "scroll",
      target: null,
      value: "600",
    });
  });

  it("starts a blank button target when the new action requires an element the step did not have", () => {
    expect(changePlanStepAction({ action: "goto", target: null, value: "https://example.com/" }, "click")).toEqual({
      action: "click",
      target: { role: "button", name: "" },
      value: null,
    });
    expect(changePlanStepAction({ action: "press", target: null, value: "Tab" }, "fill")).toEqual({
      action: "fill",
      target: { role: "button", name: "" },
      value: "",
    });
  });

  it("leaves an optional element out when the step had none", () => {
    expect(changePlanStepAction({ action: "log", target: null, value: "note" }, "press")).toEqual({
      action: "press",
      target: null,
      value: "Enter",
    });
  });
});

describe("startingValueFor", () => {
  it.each<[PlanValueKind, string | null]>([
    ["none", null],
    ["key", "Enter"],
    ["dialogResponse", "accept"],
    ["pixels", "600"],
    ["url", ""],
    ["text", ""],
    ["optionLabel", ""],
    ["fileName", ""],
    ["urlPattern", ""],
    ["message", ""],
  ])("starts a %s value as %j", (valueKind, expectedValue) => {
    expect(startingValueFor(valueKind)).toBe(expectedValue);
  });
});

describe("formatPlanJson", () => {
  it("prints the plan as two-space indented JSON, keeping each step's fields in their written order", () => {
    const plan: ActionPlan = {
      name: "Search",
      startUrl: "https://example.com/",
      steps: [{ action: "press", target: null, value: "Enter" }],
    };

    expect(formatPlanJson(plan)).toBe(
      [
        "{",
        '  "name": "Search",',
        '  "startUrl": "https://example.com/",',
        '  "steps": [',
        "    {",
        '      "action": "press",',
        '      "target": null,',
        '      "value": "Enter"',
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    );
  });
});
