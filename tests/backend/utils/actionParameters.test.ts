import { describe, it, expect } from "vitest";
import {
  applyParameterValues,
  chooseFreeKey,
  chooseNameParameterKey,
  decideRequired,
  expandAppliedPlan,
  findConfirmStepNumber,
  findTextUses,
  isCredentialPlaceholder,
  isInstanceAddress,
  labelFromTarget,
  listBindableTexts,
  listParameterSteps,
  looksSecret,
  readPageIdentity,
  readStoredTarget,
  readTargetIdentity,
  readTargetText,
  readUsedParameterValues,
  resolveVersionParameters,
  toParameterKey,
  type ActionParameterRecord,
  type ObjectBindingContext,
  type ObjectChoice,
  type VersionParameter,
} from "../../../server/utils/actionParameters.js";
import type { ActionPlan, PlanStep } from "../../../server/utils/actionPlanSchema.js";

/**
 * Builds a parameter row, defaulting to the detected "Project name" field.
 * @param overrides - Fields to replace
 * @returns The row
 */
function buildRow(overrides: Partial<ActionParameterRecord> = {}): ActionParameterRecord {
  return {
    id: "parameter-1",
    key: "projectName",
    kind: "text",
    source: "steps",
    foundBy: ["plan"],
    isSecret: false,
    label: "Project name",
    userLabel: null,
    fieldTarget: { label: "Project name" },
    fieldRole: null,
    inputType: null,
    placeholder: null,
    stepAction: "fill",
    pageUrl: null,
    containerName: null,
    besideKeys: [],
    fillAfterKey: null,
    userRequiredChoice: null,
    runIsRequired: null,
    runReadAt: null,
    crawlIsRequired: null,
    crawlReadAt: null,
    objectTypeKey: null,
    matchText: null,
    matchFields: [],
    ...overrides,
  };
}

/**
 * Builds a plan.
 * @param steps - Its steps
 * @param startUrl - Where it starts
 * @returns The plan
 */
function buildPlan(steps: PlanStep[], startUrl = "https://example.com/projects/new"): ActionPlan {
  return { name: "A plan", startUrl, steps };
}

/** Types a name and a code, picks a size, creates, then checks the heading. */
const CREATE_PLAN = buildPlan([
  { action: "fill", target: { label: "Project name" }, value: "Apollo 7" },
  { action: "fill", target: { placeholder: "Code" }, value: "AP7" },
  { action: "selectOption", target: { label: "Size" }, value: "Small" },
  { action: "fill", target: { label: "Password" }, value: "{{credential.password}}" },
  { action: "click", target: { role: "button", name: "Create project" }, value: null },
  { action: "expectVisible", target: { role: "heading", name: "Apollo 7" }, value: null },
  { action: "click", target: { text: "Apollo 7" }, value: null },
]);

/** The Project type's patterns, with no known instances. */
const PROJECT_CONTEXT: ObjectBindingContext = {
  instancePatternKey: "/projects/{project}",
  createPatternKeys: ["/projects/new"],
  instances: [],
};

/**
 * Builds an object choice.
 * @param name - The object's name
 * @param url - Its page, or null
 * @returns The choice
 */
function buildChoice(name: string, url: string | null): ObjectChoice {
  return {
    name,
    url,
    source: "crawl",
    createdObjectId: null,
    createdByActionTitle: null,
    createdAt: null,
    seenOnCrawl: true,
  };
}

describe("keys, labels, and targets", () => {
  it("turns labels into camelCase keys", () => {
    expect(toParameterKey("School name")).toBe("schoolName");
    expect(toParameterKey("e.g. Studio A")).toBe("eGStudioA");
    expect(toParameterKey("2nd line")).toBe("field2ndLine");
    expect(toParameterKey("***")).toBe("value");
  });

  it("numbers a key that is taken", () => {
    expect(chooseFreeKey("name", new Set())).toBe("name");
    expect(chooseFreeKey("name", new Set(["name", "name2"]))).toBe("name3");
  });

  it("reads a target's text, and labels a field from the plan", () => {
    expect(readTargetText({ label: "Email" })).toBe("Email");
    expect(readTargetText({ role: "textbox", name: "" })).toBeNull();
    expect(readTargetText({ role: "textbox", name: "Email" })).toBe("Email");
    expect(readTargetText({ placeholder: "Code" })).toBe("Code");
    expect(readTargetText({ text: "Open" })).toBe("Open");
    expect(readTargetText({ altText: "Logo" })).toBe("Logo");
    expect(readTargetText({ title: "Help" })).toBe("Help");
    expect(readTargetText({ css: "#x" })).toBeNull();
    expect(labelFromTarget({ css: "#x" }, 4)).toBe("Value for step 4");
    expect(labelFromTarget({ label: " Email " }, 4)).toBe("Email");
  });

  it("identifies the same field across target kinds, by CSS, or by role", () => {
    expect(readTargetIdentity({ label: "Project name" })).toBe(readTargetIdentity({ role: "textbox", name: "project-name" }));
    expect(readTargetIdentity({ css: "#name" })).toBe("css:#name");
    expect(readTargetIdentity({ role: "textbox", name: "" })).toBe("role:textbox");
    expect(readTargetIdentity({ label: " " })).toBe("unknown");
  });

  it("reads a stored target back, or null", () => {
    expect(readStoredTarget({ label: "Email" })).toEqual({ label: "Email" });
    expect(readStoredTarget({ nope: 1 })).toBeNull();
  });

  it("spots secrets and credential placeholders", () => {
    expect(looksSecret("password", [null])).toBe(true);
    expect(looksSecret("text", ["API key"])).toBe(true);
    expect(looksSecret("text", ["Pin"])).toBe(true);
    expect(looksSecret(null, ["Project name", null])).toBe(false);
    expect(isCredentialPlaceholder("{{credential.username}}")).toBe(true);
    expect(isCredentialPlaceholder("Apollo")).toBe(false);
  });

  it("lists the fill and select steps with a literal - never a credential placeholder or blank", () => {
    const plan = buildPlan([
      ...CREATE_PLAN.steps,
      { action: "fill", target: { label: "Notes" }, value: "" },
      { action: "fill", target: null, value: "x" },
    ]);
    expect(listParameterSteps(plan).map((parameterStep) => parameterStep.stepNumber)).toEqual([1, 2, 3]);
  });

  it("reads page identities the way the crawler records pages", () => {
    expect(readPageIdentity("https://example.com/projects/1?x=1#y")).toBe("https://example.com/projects/1");
    expect(readPageIdentity("/projects/2", "https://example.com/projects")).toBe("https://example.com/projects/2");
    expect(readPageIdentity("mailto:x@example.com")).toBeNull();
  });

  it("tells an instance page from a create page", () => {
    expect(isInstanceAddress("https://example.com/projects/abc", PROJECT_CONTEXT)).toBe(true);
    expect(isInstanceAddress("https://example.com/projects/new", PROJECT_CONTEXT)).toBe(false);
    expect(isInstanceAddress("https://example.com/projects/abc", { ...PROJECT_CONTEXT, instancePatternKey: null })).toBe(false);
  });
});

describe("findConfirmStepNumber", () => {
  it("finds the first button click after the last typed parameter", () => {
    expect(findConfirmStepNumber(CREATE_PLAN)).toBe(5);
  });

  it("accepts a text or title click, or Enter", () => {
    const typed = { action: "fill" as const, target: { label: "Name" }, value: "x" };
    expect(findConfirmStepNumber(buildPlan([typed, { action: "click", target: { text: "Save" }, value: null }]))).toBe(2);
    expect(findConfirmStepNumber(buildPlan([typed, { action: "click", target: { title: "Save" }, value: null }]))).toBe(2);
    expect(findConfirmStepNumber(buildPlan([typed, { action: "press", target: null, value: "Enter" }]))).toBe(2);
  });

  it("finds none without a typed parameter, or without a button after it", () => {
    expect(findConfirmStepNumber(buildPlan([{ action: "click", target: { role: "button", name: "Go" }, value: null }]))).toBeNull();
    expect(
      findConfirmStepNumber(
        buildPlan([
          { action: "click", target: { role: "button", name: "Too early" }, value: null },
          { action: "fill", target: { label: "Name" }, value: "x" },
          { action: "click", target: { role: "link", name: "Not a button" }, value: null },
          { action: "press", target: null, value: "Tab" },
        ]),
      ),
    ).toBeNull();
  });
});

describe("decideRequired", () => {
  it("puts the object first, then the user's choice, the run, the crawl, and the default", () => {
    expect(decideRequired(buildRow({ kind: "object", userRequiredChoice: "optional" }), true)).toEqual({
      isRequired: true,
      requiredReason: "object",
    });
    expect(decideRequired(buildRow({ userRequiredChoice: "optional", runIsRequired: true }), true)).toEqual({
      isRequired: false,
      requiredReason: "you",
    });
    expect(decideRequired(buildRow({ runIsRequired: false, crawlIsRequired: true }), true)).toEqual({
      isRequired: false,
      requiredReason: "run",
    });
    expect(decideRequired(buildRow({ crawlIsRequired: false }), true)).toEqual({ isRequired: false, requiredReason: "crawl" });
    expect(decideRequired(buildRow(), true)).toEqual({ isRequired: true, requiredReason: "default" });
    expect(decideRequired(buildRow(), false)).toEqual({ isRequired: false, requiredReason: "default" });
  });
});

describe("findTextUses", () => {
  it("finds the fields that hold a text exactly - or, in an address, contain it", () => {
    const plan = buildPlan(
      [
        { action: "goto", target: null, value: "https://example.com/projects/AP7/edit" },
        { action: "fill", target: { label: "Code" }, value: "AP7" },
        { action: "click", target: { role: "link", name: "AP7" }, value: null },
        { action: "click", target: { text: "AP7" }, value: null },
        { action: "click", target: { label: "AP7" }, value: null },
      ],
      "https://example.com/projects/AP7",
    );
    expect(findTextUses(plan, "AP7", ["value", "targetName", "targetText", "url"])).toEqual([
      { stepNumber: 0, field: "url" },
      { stepNumber: 1, field: "url" },
      { stepNumber: 2, field: "value" },
      { stepNumber: 3, field: "targetName" },
      { stepNumber: 4, field: "targetText" },
    ]);
    expect(findTextUses(plan, "AP7", ["value"])).toEqual([{ stepNumber: 2, field: "value" }]);
  });
});

describe("resolveVersionParameters", () => {
  it("binds each steps row to the steps that type its field, plus later steps that repeat the value", () => {
    const parameters = resolveVersionParameters(
      CREATE_PLAN,
      [buildRow(), buildRow({ id: "parameter-2", key: "code", label: "Code", fieldTarget: { placeholder: "Code" }, userLabel: "Short code", crawlIsRequired: false })],
      "create",
      PROJECT_CONTEXT,
    );

    expect(parameters.map((parameter) => [parameter.key, parameter.label, parameter.defaultValue, parameter.isRequired])).toEqual([
      ["projectName", "Project name", "Apollo 7", true],
      ["code", "Short code", "AP7", false],
    ]);
    expect(parameters[0].uses).toEqual([
      { stepNumber: 1, field: "value" },
      { stepNumber: 6, field: "targetName" },
      { stepNumber: 7, field: "targetText" },
    ]);
    expect(parameters[1].detectedLabel).toBe("Code");
  });

  it("never binds the echoes of a secret, or of a short or letterless value", () => {
    const plan = buildPlan([
      { action: "fill", target: { label: "PIN" }, value: "1234" },
      { action: "fill", target: { label: "Initials" }, value: "AB" },
      { action: "expectVisible", target: { text: "1234" }, value: null },
      { action: "expectVisible", target: { text: "AB" }, value: null },
    ]);
    const parameters = resolveVersionParameters(
      plan,
      [buildRow({ key: "pin", fieldTarget: { label: "PIN" }, isSecret: true }), buildRow({ id: "p2", key: "initials", fieldTarget: { label: "Initials" } })],
      "parameters",
      PROJECT_CONTEXT,
    );
    expect(parameters.map((parameter) => parameter.uses)).toEqual([[{ stepNumber: 1, field: "value" }], [{ stepNumber: 2, field: "value" }]]);
  });

  it("lets the user's value row take over the text it names, and leaves out rows that fit nothing", () => {
    const parameters = resolveVersionParameters(
      CREATE_PLAN,
      [
        buildRow(),
        buildRow({ id: "you-1", key: "mission", source: "you", label: "Mission", fieldTarget: null, matchText: "Apollo 7", matchFields: ["value", "targetName"], userRequiredChoice: "required" }),
        buildRow({ id: "you-2", key: "absent", source: "you", label: "Absent", fieldTarget: null, matchText: "Gemini", matchFields: ["value"] }),
        buildRow({ id: "gone", key: "gone", fieldTarget: { label: "Not in this version" } }),
      ],
      "create",
      PROJECT_CONTEXT,
    );

    // The user's row took the typed value, so the detected row has no field
    // of its own left in this version and is left out.
    expect(parameters.map((parameter) => parameter.key)).toEqual(["mission"]);
    expect(parameters[0]).toMatchObject({ source: "you", defaultValue: "Apollo 7", requiredReason: "you" });
    expect(parameters[0].uses).toEqual([{ stepNumber: 1, field: "value" }, { stepNumber: 6, field: "targetName" }]);
  });

  it("adds page fields after the last step of the parameters they sit beside, and the user's fields after their anchor", () => {
    const parameters = resolveVersionParameters(
      CREATE_PLAN,
      [
        buildRow(),
        buildRow({ id: "p2", key: "code", fieldTarget: { placeholder: "Code" } }),
        buildRow({ id: "page-1", key: "description", source: "page", label: "Description", fieldTarget: { label: "Description" }, besideKeys: ["projectName", "code"] }),
        buildRow({ id: "page-2", key: "size", source: "page", label: "Size", fieldTarget: { label: "Size" }, stepAction: "selectOption", besideKeys: ["projectName"] }),
        buildRow({ id: "page-3", key: "orphan", source: "page", label: "Orphan", fieldTarget: { label: "Orphan" }, besideKeys: ["missing"] }),
        buildRow({ id: "you-1", key: "notes", source: "you", label: "Notes", fieldTarget: { label: "Notes" }, stepAction: null, fillAfterKey: "projectName", userRequiredChoice: "optional" }),
      ],
      "create",
      PROJECT_CONTEXT,
    );

    expect(parameters.map((parameter) => parameter.key)).toEqual(["projectName", "notes", "code", "description"]);
    expect(parameters.find((parameter) => parameter.key === "description")?.addedField).toEqual({
      target: { label: "Description" },
      stepAction: "fill",
      afterStepNumber: 2,
    });
    expect(parameters.find((parameter) => parameter.key === "notes")).toMatchObject({
      isRequired: false,
      defaultValue: "",
      addedField: { target: { label: "Notes" }, stepAction: "fill", afterStepNumber: 1 },
    });
  });

  it("binds an Object action's object to the link that names a known instance, and its echoes", () => {
    const plan = buildPlan(
      [
        { action: "click", target: { role: "link", name: "Mercury" }, value: null },
        { action: "expectVisible", target: { role: "heading", name: "Mercury" }, value: null },
        { action: "click", target: { role: "link", name: "Unknown" }, value: null },
      ],
      "https://example.com/projects",
    );
    const objectRow = buildRow({ key: "object", kind: "object", label: "Project", fieldTarget: null, objectTypeKey: "/projects/{project}" });
    const context = { ...PROJECT_CONTEXT, instances: [buildChoice("Mercury", "https://example.com/projects/m")] };

    const [objectParameter] = resolveVersionParameters(plan, [objectRow], "object", context);

    expect(objectParameter).toMatchObject({ key: "object", kind: "object", isRequired: true, requiredReason: "object", defaultValue: "Mercury" });
    expect(objectParameter.uses).toEqual([
      { stepNumber: 1, field: "targetName" },
      { stepNumber: 2, field: "targetName" },
    ]);
    expect(resolveVersionParameters(plan, [objectRow], "create", context)).toEqual([]);
  });

  it("binds the object to a start URL or goto that opens an instance page, named by the known instance", () => {
    const plan = buildPlan(
      [
        { action: "goto", target: null, value: "https://example.com/projects/g" },
        { action: "click", target: { text: "Gemini" }, value: null },
      ],
      "https://example.com/projects/m",
    );
    const objectRow = buildRow({ key: "object", kind: "object", label: "Project", fieldTarget: null });
    const context = {
      ...PROJECT_CONTEXT,
      instances: [buildChoice("Mercury", "https://example.com/projects/m"), buildChoice("Gemini", null)],
    };

    const [objectParameter] = resolveVersionParameters(plan, [objectRow], "object", context);

    expect(objectParameter.defaultValue).toBe("Mercury");
    expect(objectParameter.uses).toEqual([
      { stepNumber: 0, field: "url" },
      { stepNumber: 1, field: "url" },
      { stepNumber: 2, field: "targetText" },
    ]);

    const [gotoOnlyParameter] = resolveVersionParameters(
      buildPlan([{ action: "goto", target: null, value: "https://example.com/projects/unknown" }], "https://example.com/"),
      [objectRow],
      "object",
      context,
    );
    expect(gotoOnlyParameter.defaultValue).toBe("");
  });

  it("leaves the object out when nothing in the version names an instance", () => {
    const objectRow = buildRow({ key: "object", kind: "object", fieldTarget: null });
    expect(resolveVersionParameters(CREATE_PLAN, [objectRow], "object", PROJECT_CONTEXT)).toEqual([]);
  });
});

describe("chooseNameParameterKey", () => {
  /**
   * Builds a version parameter.
   * @param overrides - Fields to replace
   * @returns The parameter
   */
  function buildParameter(overrides: Partial<VersionParameter> = {}): VersionParameter {
    return {
      id: "p",
      key: "code",
      label: "Code",
      detectedLabel: "Code",
      userLabel: null,
      kind: "text",
      source: "steps",
      foundBy: ["plan"],
      isSecret: false,
      isRequired: true,
      requiredReason: "default",
      userRequiredChoice: null,
      defaultValue: "AP7",
      uses: [{ stepNumber: 1, field: "value" }],
      addedField: null,
      objectTypeKey: null,
      containerName: null,
      ...overrides,
    };
  }

  const code = buildParameter();
  const title = buildParameter({ key: "title", label: "Title" });
  const checked = buildParameter({ key: "checked", label: "Checked", uses: [{ stepNumber: 1, field: "value" }, { stepNumber: 5, field: "targetName" }] });

  it("takes the user's choice, then the one checked after confirming, then a name-like label, then the first", () => {
    expect(chooseNameParameterKey([code, title, checked], 3, "title")).toBe("title");
    expect(chooseNameParameterKey([code, title, checked], 3, "missing")).toBe("checked");
    expect(chooseNameParameterKey([code, title, checked], 6, null)).toBe("title");
    expect(chooseNameParameterKey([code, title, checked], null, null)).toBe("checked");
    expect(chooseNameParameterKey([code], null, null)).toBe("code");
    expect(chooseNameParameterKey([buildParameter({ isSecret: true })], null, null)).toBeNull();
  });
});

describe("applyParameterValues", () => {
  const nameParameter = resolveVersionParameters(CREATE_PLAN, [buildRow()], "create", PROJECT_CONTEXT)[0];
  const notesParameter: VersionParameter = {
    ...nameParameter,
    key: "notes",
    label: "Notes",
    source: "page",
    isRequired: false,
    defaultValue: "",
    uses: [],
    addedField: { target: { label: "Notes" }, stepAction: "fill", afterStepNumber: 1 },
  };

  it("writes a value into every step field of its parameter, and adds a step for an added field", () => {
    const applied = applyParameterValues(CREATE_PLAN, [nameParameter, notesParameter], { projectName: "Voyager", notes: "Hi" }, []);

    expect(applied.problems).toEqual([]);
    expect(applied.plan.steps[0].value).toBe("Voyager");
    expect(applied.plan.steps[5].target).toEqual({ role: "heading", name: "Voyager" });
    expect(applied.plan.steps[6].target).toEqual({ text: "Voyager" });
    expect(CREATE_PLAN.steps[0].value).toBe("Apollo 7");
    expect(applied.insertedSteps).toEqual([
      { afterStepNumber: 1, step: { action: "fill", target: { label: "Notes" }, value: "Hi" }, parameterKey: "notes" },
    ]);
    expect(applied.usedValues).toEqual([
      { key: "projectName", label: "Project name", value: "Voyager" },
      { key: "notes", label: "Notes", value: "Hi" },
    ]);
    expect(expandAppliedPlan(applied).steps.map((step) => step.value)).toEqual(["Voyager", "Hi", "AP7", "Small", "{{credential.password}}", null, null, null]);
  });

  it("keeps the version's values when none are given, and adds no step for a blank added field", () => {
    const applied = applyParameterValues(CREATE_PLAN, [nameParameter, notesParameter], {}, []);
    expect(applied.plan).toEqual(CREATE_PLAN);
    expect(applied.insertedSteps).toEqual([]);
    expect(applied.usedValues).toEqual([
      { key: "projectName", label: "Project name", value: "Apollo 7" },
      { key: "notes", label: "Notes", value: "" },
    ]);
  });

  it("refuses a blank required value, and skips every step of a blank optional one", () => {
    expect(applyParameterValues(CREATE_PLAN, [nameParameter], { projectName: "  " }, []).problems).toEqual([
      '"Project name" is required',
    ]);

    const applied = applyParameterValues(CREATE_PLAN, [{ ...nameParameter, isRequired: false }], { projectName: "" }, []);
    expect(applied.skippedStepNumbers).toEqual([1, 6, 7]);
    expect(expandAppliedPlan(applied).steps).toHaveLength(4);
  });

  it("refuses to leave a start-address value blank", () => {
    const addressParameter: VersionParameter = { ...nameParameter, isRequired: false, uses: [{ stepNumber: 0, field: "url" }] };
    expect(applyParameterValues(CREATE_PLAN, [addressParameter], { projectName: "" }, []).problems).toEqual([
      '"Project name" is in the start address, so it cannot be left blank',
    ]);
  });

  it("keeps secrets out of the stored values, and lists them to scrub", () => {
    const secretParameter: VersionParameter = { ...nameParameter, isSecret: true };
    const applied = applyParameterValues(CREATE_PLAN, [secretParameter, { ...notesParameter, isSecret: true }], { projectName: "hunter2" }, []);
    expect(applied.usedValues).toEqual([]);
    expect(applied.secretValues).toEqual(["hunter2"]);
  });

  it("replaces a user value inside an address", () => {
    const plan = buildPlan([{ action: "goto", target: null, value: "https://example.com/projects/AP7/edit" }], "https://example.com/projects/AP7");
    const codeParameter: VersionParameter = {
      ...nameParameter,
      key: "code",
      source: "you",
      defaultValue: "AP7",
      uses: [{ stepNumber: 0, field: "url" }, { stepNumber: 1, field: "url" }],
    };
    const applied = applyParameterValues(plan, [codeParameter], { code: "AP8" }, []);
    expect(applied.plan.startUrl).toBe("https://example.com/projects/AP8");
    expect(applied.plan.steps[0].value).toBe("https://example.com/projects/AP8/edit");
  });

  describe("the object", () => {
    const linkPlan = buildPlan(
      [
        { action: "goto", target: null, value: "https://example.com/projects/m" },
        { action: "click", target: { role: "link", name: "Mercury" }, value: null },
      ],
      "https://example.com/projects/m",
    );
    const objectParameter: VersionParameter = {
      ...nameParameter,
      key: "object",
      label: "Project",
      kind: "object",
      defaultValue: "Mercury",
      uses: [
        { stepNumber: 0, field: "url" },
        { stepNumber: 1, field: "url" },
        { stepNumber: 2, field: "targetName" },
      ],
    };
    const choices = [buildChoice("Gemini", "https://example.com/projects/g"), buildChoice("Apollo", null)];

    it("opens a listed object by its address and names it in the steps", () => {
      const applied = applyParameterValues(linkPlan, [objectParameter], { object: "gemini" }, choices);
      expect(applied.problems).toEqual([]);
      expect(applied.plan.startUrl).toBe("https://example.com/projects/g");
      expect(applied.plan.steps[0].value).toBe("https://example.com/projects/g");
      expect(applied.plan.steps[1].target).toEqual({ role: "link", name: "gemini" });
    });

    it("keeps the version's own object as it is", () => {
      expect(applyParameterValues(linkPlan, [objectParameter], { object: "Mercury" }, []).plan).toEqual(linkPlan);
    });

    it("refuses a typed name with no known address for a version that opens it by address", () => {
      expect(applyParameterValues(linkPlan, [objectParameter], { object: "Apollo" }, choices).problems).toEqual([
        'This version opens the Project by its address, so pick one of the listed ones - "Apollo" has no known address',
      ]);
      expect(applyParameterValues(linkPlan, [objectParameter], { object: "Voyager" }, choices).problems).toHaveLength(1);
    });

    it("takes any typed name for a version that only names it", () => {
      const nameOnlyParameter = { ...objectParameter, uses: [{ stepNumber: 2, field: "targetName" as const }] };
      const applied = applyParameterValues(linkPlan, [nameOnlyParameter], { object: "Voyager" }, choices);
      expect(applied.plan.steps[1].target).toEqual({ role: "link", name: "Voyager" });
    });
  });
});

describe("listBindableTexts", () => {
  it("lists each text of the steps once, with where it appears - never a credential placeholder", () => {
    expect(listBindableTexts(CREATE_PLAN)).toEqual([
      { text: "Apollo 7", fields: ["value", "targetName", "targetText"] },
      { text: "AP7", fields: ["value"] },
      { text: "Small", fields: ["value"] },
      { text: "Create project", fields: ["targetName"] },
    ]);
    expect(listBindableTexts(buildPlan([{ action: "goto", target: null, value: "https://example.com/a" }]))).toEqual([
      { text: "https://example.com/a", fields: ["url"] },
    ]);
  });
});

describe("readUsedParameterValues", () => {
  it("keeps only well-formed stored values", () => {
    expect(readUsedParameterValues(null)).toEqual([]);
    expect(readUsedParameterValues([{ key: "a", label: "A", value: "1" }, { key: "a" }, 5])).toEqual([{ key: "a", label: "A", value: "1" }]);
  });
});
