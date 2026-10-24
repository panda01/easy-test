import { describe, it, expect } from "vitest";
import {
  detectActionParameters,
  type DetectionPage,
  type ParameterDetectionInput,
  type RunFieldReading,
} from "../../../server/utils/detectActionParameters.js";
import type { ActionPlan } from "../../../server/utils/actionPlanSchema.js";
import type { FormField } from "../../../server/utils/formFields.js";

/**
 * Builds a detection input for a Parameters action with no pages, snapshots,
 * readings, or reserved keys.
 * @param overrides - Fields to replace
 * @returns The input
 */
function buildInput(overrides: Partial<ParameterDetectionInput> = {}): ParameterDetectionInput {
  return {
    versionPlans: [],
    pages: [],
    failingPageSnapshots: [],
    runReadings: null,
    role: { kind: "parameters", objectTypeKey: null, objectTypeName: null },
    reservedKeys: [],
    ...overrides,
  };
}

/**
 * Builds a form field, defaulting to an optional text box in the "New
 * project" form.
 * @param overrides - Fields to replace
 * @returns The field
 */
function buildField(overrides: Partial<FormField> = {}): FormField {
  return {
    role: "textbox",
    inputType: "text",
    label: null,
    placeholder: null,
    isRequired: false,
    containerNumber: 1,
    containerName: "New project",
    ...overrides,
  };
}

/** "Create a school" as Claude wrote it: open the dialog, type the name by its placeholder, create, check the heading. */
const SCHOOL_PLAN: ActionPlan = {
  name: "Create a school",
  startUrl: "https://forge.example/schools",
  steps: [
    { action: "click", target: { role: "button", name: "Create school" }, value: null },
    { action: "fill", target: { placeholder: "e.g. Forge Athletics" }, value: "Forge Test School" },
    { action: "fill", target: { label: "Password" }, value: "{{credential.password}}" },
    { action: "click", target: { role: "button", name: "Create" }, value: null },
    { action: "expectVisible", target: { role: "heading", name: "Forge Test School" }, value: null },
  ],
};

/** The schools list as the crawler saw it - the dialog is closed. */
const SCHOOLS_PAGE: DetectionPage = {
  url: "https://forge.example/schools",
  ariaSnapshot: ['- main:', '  - heading "Schools" [level=1]', '  - searchbox "Search schools"'].join("\n"),
  formFields: [],
};

/** The page a failed run of "Create a school" stopped on, with the dialog open. */
const SCHOOL_DIALOG_SNAPSHOT = [
  '- main:',
  '  - searchbox "Search schools"',
  '- dialog "Create school":',
  '  - textbox "School name":',
  '    - /placeholder: e.g. Forge Athletics',
  '  - textbox "Mascot"',
  '  - combobox "Size":',
  '    - option "Small" [selected]',
  '  - textbox "Original owner" [disabled]: Owner 1',
  '  - textbox:',
  '    - /placeholder: ""',
  '  - textbox "Admin PIN"',
].join("\n");

/** Types a project's name and picks its size on the create page. */
const PROJECT_PLAN: ActionPlan = {
  name: "Create a project",
  startUrl: "https://example.com/projects/new",
  steps: [
    { action: "fill", target: { label: "Project name" }, value: "Apollo 7" },
    { action: "selectOption", target: { label: "Size" }, value: "Small" },
    { action: "click", target: { role: "button", name: "Create project" }, value: null },
  ],
};

/** The create page as the crawler read its fields. */
const PROJECT_PAGE: DetectionPage = {
  url: "https://example.com/projects/new",
  ariaSnapshot: null,
  formFields: [
    buildField({ role: "searchbox", inputType: "search", label: "Search", containerNumber: 0, containerName: null }),
    buildField({ label: "Project name", isRequired: true }),
    buildField({ role: "combobox", inputType: "select", label: "Size" }),
    buildField({ inputType: "textarea", label: "Description" }),
    buildField({ inputType: "password", label: "Secret code" }),
    buildField(),
  ],
};

describe("detectActionParameters", () => {
  it("finds a dialog's fields from a failed run's snapshot, which the crawler never opens", () => {
    const rows = detectActionParameters(
      buildInput({
        versionPlans: [SCHOOL_PLAN],
        pages: [SCHOOLS_PAGE],
        failingPageSnapshots: [{ url: "https://forge.example/schools", ariaSnapshot: SCHOOL_DIALOG_SNAPSHOT }],
      }),
    );

    expect(rows.map((row) => [row.key, row.source, row.kind, row.label])).toEqual([
      ["eGForgeAthletics", "steps", "text", "School name"],
      ["mascot", "page", "text", "Mascot"],
      ["size", "page", "option", "Size"],
      ["adminPin", "page", "text", "Admin PIN"],
    ]);
    expect(rows[0]).toEqual({
      key: "eGForgeAthletics",
      kind: "text",
      source: "steps",
      foundBy: ["plan", "snapshot"],
      isSecret: false,
      label: "School name",
      fieldTarget: { placeholder: "e.g. Forge Athletics" },
      fieldRole: "textbox",
      inputType: null,
      placeholder: "e.g. Forge Athletics",
      stepAction: "fill",
      pageUrl: "https://forge.example/schools",
      containerName: "Create school",
      besideKeys: [],
      fillAfterKey: null,
      crawlIsRequired: null,
      runIsRequired: undefined,
      objectTypeKey: null,
    });
    expect(rows[1]).toMatchObject({
      foundBy: ["snapshot"],
      fieldTarget: { label: "Mascot" },
      stepAction: "fill",
      besideKeys: ["eGForgeAthletics"],
      fillAfterKey: "eGForgeAthletics",
      containerName: "Create school",
      crawlIsRequired: null,
      runIsRequired: undefined,
    });
    expect(rows[2]).toMatchObject({ fieldRole: "combobox", stepAction: "selectOption" });
    expect(rows[3].isSecret).toBe(true);
  });

  it("reads the crawler's required flags, input types, and secrets, and leaves fields outside the form alone", () => {
    const rows = detectActionParameters(buildInput({ versionPlans: [PROJECT_PLAN], pages: [PROJECT_PAGE] }));

    expect(rows.map((row) => [row.key, row.source, row.crawlIsRequired])).toEqual([
      ["projectName", "steps", true],
      ["size", "steps", false],
      ["description", "page", false],
      ["secretCode", "page", false],
    ]);
    expect(rows[0]).toMatchObject({
      foundBy: ["plan", "crawl"],
      fieldRole: "textbox",
      inputType: "text",
      pageUrl: "https://example.com/projects/new",
      containerName: "New project",
    });
    expect(rows[1]).toMatchObject({ kind: "option", stepAction: "selectOption", fieldRole: "combobox", inputType: "select" });
    expect(rows[2]).toMatchObject({ besideKeys: ["projectName", "size"], fillAfterKey: "size", inputType: "textarea" });
    expect(rows[3].isSecret).toBe(true);
  });

  it("adds a run's readings: required flags for the field it typed into, and the fields beside it", () => {
    const reading: RunFieldReading = {
      stepNumber: 1,
      pageUrl: "https://example.com/projects/new",
      fields: [
        buildField({ label: "Project name", isRequired: true }),
        buildField({ inputType: "textarea", label: "Description", isRequired: true }),
        buildField({ inputType: "date", label: "Launch date" }),
      ],
      targetFieldIndex: 0,
    };

    const rows = detectActionParameters(
      buildInput({ versionPlans: [PROJECT_PLAN], pages: [PROJECT_PAGE], runReadings: { plan: PROJECT_PLAN, readings: [reading] } }),
    );
    const rowByKey = new Map(rows.map((row) => [row.key, row]));

    expect(rowByKey.get("projectName")).toMatchObject({ foundBy: ["plan", "run", "crawl"], runIsRequired: true, crawlIsRequired: true });
    // The run only read the form around step 1, so it says nothing of Size.
    expect(rowByKey.get("size")?.runIsRequired).toBeUndefined();
    expect(rowByKey.get("description")).toMatchObject({
      foundBy: ["run", "crawl"],
      runIsRequired: true,
      crawlIsRequired: false,
      besideKeys: ["projectName", "size"],
    });
    expect(rowByKey.get("launchDate")).toMatchObject({
      foundBy: ["run"],
      runIsRequired: false,
      crawlIsRequired: null,
      besideKeys: ["projectName"],
      fillAfterKey: "projectName",
    });
  });

  it("ignores a run's reading of a step that is not this field's", () => {
    const otherStepReading: RunFieldReading = {
      stepNumber: 2,
      pageUrl: "https://example.com/projects/new",
      fields: [buildField({ label: "Project name", isRequired: true })],
      targetFieldIndex: 0,
    };

    const [projectNameRow, sizeRow] = detectActionParameters(
      buildInput({ versionPlans: [PROJECT_PLAN], runReadings: { plan: PROJECT_PLAN, readings: [otherStepReading] } }),
    );

    expect(projectNameRow).toMatchObject({ foundBy: ["plan"], runIsRequired: undefined });
    // The runner typed step 2 (Size) into that field, so the reading is Size's.
    expect(sizeRow).toMatchObject({ foundBy: ["plan", "run"], runIsRequired: true });
  });

  it("makes one row per field across versions, keyed from the newest, around the user's keys", () => {
    const newerPlan: ActionPlan = {
      name: "Create a project",
      startUrl: "https://example.com/projects/new",
      steps: [
        { action: "fill", target: { role: "textbox", name: "Project name" }, value: "Apollo 8" },
        { action: "fill", target: { label: "Password" }, value: "hunter2" },
        { action: "fill", target: { label: "Username" }, value: "{{credential.username}}" },
      ],
    };
    const olderPlan: ActionPlan = {
      name: "Create a project",
      startUrl: "https://example.com/projects/new",
      steps: [
        { action: "fill", target: { label: "Project name" }, value: "Apollo 7" },
        { action: "fill", target: { label: "Code" }, value: "AP7" },
      ],
    };

    const rows = detectActionParameters(buildInput({ versionPlans: [newerPlan, olderPlan], reservedKeys: ["projectName"] }));

    expect(rows.map((row) => [row.key, row.label, row.isSecret])).toEqual([
      ["projectName2", "Project name", false],
      ["password", "Password", true],
      ["code", "Code", false],
    ]);
    expect(rows[0].fieldTarget).toEqual({ role: "textbox", name: "Project name" });
  });

  it("never makes a page row from a field named like a steps row, a user's key, or the object", () => {
    const page: DetectionPage = {
      url: "https://example.com/projects/new",
      ariaSnapshot: null,
      formFields: [
        buildField({ label: "Project name", isRequired: true }),
        buildField({ label: "Project name *" }),
        buildField({ label: "Mission" }),
        buildField({ label: "Object" }),
        buildField({ placeholder: "Short code" }),
      ],
    };

    const rows = detectActionParameters(
      buildInput({ versionPlans: [PROJECT_PLAN], pages: [page], reservedKeys: ["mission"] }),
    );

    expect(rows.filter((row) => row.source === "page").map((row) => [row.key, row.fieldTarget])).toEqual([
      ["shortCode", { placeholder: "Short code" }],
    ]);
  });

  it("adds the object row for an Object action with a type - named by the type - and for no other", () => {
    const objectRole = { kind: "object" as const, objectTypeKey: "/projects/{project}", objectTypeName: "Project" };

    const rows = detectActionParameters(buildInput({ versionPlans: [PROJECT_PLAN], role: objectRole }));

    expect(rows.map((row) => row.key)).toEqual(["projectName", "size", "object"]);
    expect(rows[2]).toMatchObject({
      kind: "object",
      source: "steps",
      label: "Project",
      fieldTarget: null,
      stepAction: null,
      objectTypeKey: "/projects/{project}",
    });
    expect(detectActionParameters(buildInput({ role: { ...objectRole, objectTypeName: null } }))[0].label).toBe("Object");
    expect(detectActionParameters(buildInput({ role: { ...objectRole, objectTypeKey: null } }))).toEqual([]);
    expect(detectActionParameters(buildInput({ role: { ...objectRole, kind: "create" } }))).toEqual([]);
  });

  it("finds nothing for a plan that types no literal", () => {
    expect(
      detectActionParameters(
        buildInput({
          versionPlans: [{ name: "Look", startUrl: "https://example.com/", steps: [{ action: "click", target: { text: "Open" }, value: null }] }],
          pages: [PROJECT_PAGE],
          failingPageSnapshots: [{ url: null, ariaSnapshot: SCHOOL_DIALOG_SNAPSHOT }],
        }),
      ),
    ).toEqual([]);
  });
});
