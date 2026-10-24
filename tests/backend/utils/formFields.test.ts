// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FORM_FIELD_SELECTOR,
  FORM_FIELD_SELECTORS,
  cleanRawFormFields,
  interpretRequiredReading,
  matchFieldToTarget,
  matchFormField,
  normalizeFieldName,
  readRawFormFields,
  readStoredFormFields,
  tidyFieldText,
  type FormField,
  type RawFormField,
} from "../../../server/utils/formFields.js";

/**
 * Builds a tidy form field, defaulting to a required "Email" text box in the
 * first form.
 * @param overrides - Fields to replace
 * @returns The field
 */
function buildField(overrides: Partial<FormField> = {}): FormField {
  return {
    role: "textbox",
    inputType: "text",
    label: "Email",
    placeholder: null,
    isRequired: true,
    containerNumber: 1,
    containerName: null,
    ...overrides,
  };
}

/**
 * Builds a field as the browser reports it.
 * @param overrides - Fields to replace
 * @returns The raw field
 */
function buildRawField(overrides: Partial<RawFormField> = {}): RawFormField {
  return {
    tagName: "input",
    typeAttribute: null,
    roleAttribute: null,
    allowsMultiple: false,
    label: "",
    placeholder: null,
    isRequired: false,
    containerNumber: 0,
    containerName: null,
    ...overrides,
  };
}

describe("readRawFormFields (runs inside the browser)", () => {
  beforeEach(() => {
    // jsdom lays nothing out, so every element reports no box; a box is
    // given to everything except elements marked hidden for the test.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      const elementIsHidden = this.hasAttribute("data-hidden");
      return (elementIsHidden ? [] : [{}]) as unknown as DOMRectList;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads every visible field under an element, with its names, flags, and form", () => {
    document.body.innerHTML = `
      <header><input type="search" placeholder="Search"></header>
      <form aria-label="New project">
        <label>Project name <input name="name" required></label>
        <label for="size">Size</label><select id="size"><option>Small</option></select>
        <span id="notes-label">Notes</span><textarea aria-labelledby="notes-label missing-id"></textarea>
        <input aria-label="Code" aria-required="true">
        <input type="hidden" name="secret">
        <input type="checkbox" aria-label="Agree">
        <input data-hidden aria-label="Invisible">
        <div aria-hidden="true"><input aria-label="Hidden helper"></div>
      </form>
      <div role="dialog" aria-labelledby="dialog-title"><h2 id="dialog-title">Invite</h2><input title="Email address"></div>
      <section><h3>Settings</h3><div role="combobox" aria-label="Theme"></div></section>
      <dialog open><h2>Rename</h2><input name="unnamed"></dialog>
    `;

    const fieldRead = readRawFormFields(document.body, FORM_FIELD_SELECTORS);

    expect(fieldRead.startFieldIndex).toBe(-1);
    expect(fieldRead.fields.map((field) => [field.label, field.containerNumber, field.containerName])).toEqual([
      ["", 0, null],
      ["Project name", 1, "New project"],
      ["Size", 1, "New project"],
      ["Notes", 1, "New project"],
      ["Code", 1, "New project"],
      ["Email address", 2, "Invite"],
      ["Theme", 0, null],
      ["", 3, "Rename"],
    ]);
    expect(fieldRead.fields[0]).toMatchObject({ typeAttribute: "search", placeholder: "Search" });
    expect(fieldRead.fields[1].isRequired).toBe(true);
    expect(fieldRead.fields[4].isRequired).toBe(true);
    expect(fieldRead.fields[3].isRequired).toBe(false);
    expect(fieldRead.fields[6]).toMatchObject({ tagName: "div", roleAttribute: "combobox" });
  });

  it("started from a field, reads only that field's form and says which field it was", () => {
    document.body.innerHTML = `
      <input aria-label="Outside">
      <form><input aria-label="First"><select multiple aria-label="Tags"></select></form>
    `;
    const tagsField = document.querySelector("select");
    if (tagsField === null) throw new Error("no select");

    const fieldRead = readRawFormFields(tagsField, FORM_FIELD_SELECTORS);

    expect(fieldRead.fields.map((field) => field.label)).toEqual(["First", "Tags"]);
    expect(fieldRead.startFieldIndex).toBe(1);
    expect(fieldRead.fields[1].allowsMultiple).toBe(true);
  });

  it("started from a field in no form, reads the whole page", () => {
    document.body.innerHTML = `<input aria-label="Alone"><input aria-label="Other">`;
    const aloneField = document.querySelector("input");
    if (aloneField === null) throw new Error("no input");

    const fieldRead = readRawFormFields(aloneField, FORM_FIELD_SELECTORS);

    expect(fieldRead.fields.map((field) => field.label)).toEqual(["Alone", "Other"]);
    expect(fieldRead.startFieldIndex).toBe(0);
  });

  it("selects text-like inputs, text areas, selects, and field roles - never buttons, boxes, or files", () => {
    expect(FORM_FIELD_SELECTOR).toContain("textarea");
    expect(FORM_FIELD_SELECTOR).toContain("[role=listbox]");
    expect(FORM_FIELD_SELECTOR).toContain(":not([type=file])");
  });
});

describe("cleanRawFormFields", () => {
  it("works out each field's role and input type, and tidies its texts", () => {
    expect(
      cleanRawFormFields([
        buildRawField({ label: "  Project   name * ", placeholder: "", isRequired: true, containerNumber: 1, containerName: " New project " }),
        buildRawField({ tagName: "select", label: "Size" }),
        buildRawField({ tagName: "select", allowsMultiple: true, label: "Tags" }),
        buildRawField({ tagName: "textarea", label: "Notes" }),
        buildRawField({ typeAttribute: "NUMBER", label: "Seats" }),
        buildRawField({ typeAttribute: "search", label: "Find" }),
        buildRawField({ tagName: "div", roleAttribute: "combobox", label: "Theme" }),
        buildRawField({ tagName: "div", roleAttribute: "button", label: "Odd" }),
      ]),
    ).toEqual([
      buildField({ label: "Project name", placeholder: null, isRequired: true, containerNumber: 1, containerName: "New project" }),
      buildField({ role: "combobox", inputType: "select", label: "Size", isRequired: false, containerNumber: 0 }),
      buildField({ role: "listbox", inputType: "select", label: "Tags", isRequired: false, containerNumber: 0 }),
      buildField({ inputType: "textarea", label: "Notes", isRequired: false, containerNumber: 0 }),
      buildField({ role: "spinbutton", inputType: "number", label: "Seats", isRequired: false, containerNumber: 0 }),
      buildField({ role: "searchbox", inputType: "search", label: "Find", isRequired: false, containerNumber: 0 }),
      buildField({ role: "combobox", inputType: null, label: "Theme", isRequired: false, containerNumber: 0 }),
      buildField({ role: "textbox", inputType: null, label: "Odd", isRequired: false, containerNumber: 0 }),
    ]);
  });

  it("tidies text: spaces, a trailing required marker, NULs, and the length cap", () => {
    expect(tidyFieldText(null)).toBeNull();
    expect(tidyFieldText("   ")).toBeNull();
    expect(tidyFieldText("Name\u0000 **")).toBe("Name");
    expect(tidyFieldText("x".repeat(250))).toHaveLength(200);
    expect(normalizeFieldName("  Project NAME *")).toBe("project name");
  });
});

describe("readStoredFormFields", () => {
  it("keeps only entries shaped like a form field", () => {
    expect(readStoredFormFields("nope")).toEqual([]);
    expect(
      readStoredFormFields([buildField(), null, "x", { role: "button", isRequired: true, containerNumber: 0 }, { role: "textbox", isRequired: "yes", containerNumber: 0 }, { role: "textbox", isRequired: true }]),
    ).toEqual([buildField()]);
  });
});

describe("matchFormField", () => {
  const fields = [
    buildField({ label: "Project name" }),
    buildField({ label: null, placeholder: "e.g. Studio A" }),
    buildField({ label: "Room name", placeholder: "Room" }),
    buildField({ label: "Description" }),
    buildField({ label: "Description of the room" }),
  ];

  it("matches a label, placeholder, or role and name exactly, ignoring case and a required marker", () => {
    expect(matchFormField({ label: "project NAME *" }, fields)).toBe(0);
    expect(matchFormField({ placeholder: "e.g. Studio A" }, fields)).toBe(1);
    expect(matchFormField({ role: "textbox", name: "e.g. Studio A" }, fields)).toBe(1);
    expect(matchFormField({ role: "textbox", name: "Room name" }, fields)).toBe(2);
    // A field with a label is named by it, not its placeholder.
    expect(matchFormField({ role: "textbox", name: "Room" }, fields)).toBe(-1);
    expect(matchFormField({ label: "Description" }, fields)).toBe(3);
  });

  it("falls back to the one field whose name contains the text, and to none when several do", () => {
    expect(matchFormField({ label: "Project" }, fields)).toBe(0);
    expect(matchFormField({ label: "name" }, fields)).toBe(-1);
  });

  it("never matches a target that does not name a field", () => {
    expect(matchFormField({ text: "Project name" }, fields)).toBe(-1);
    expect(matchFormField({ css: "#name" }, fields)).toBe(-1);
    expect(matchFormField({ role: "textbox", name: "" }, fields)).toBe(-1);
    expect(matchFormField({ label: " * " }, fields)).toBe(-1);
    expect(matchFieldToTarget({ label: "x" }, [], () => ({ label: null, placeholder: null }))).toBe(-1);
  });
});

describe("interpretRequiredReading", () => {
  it("reads a flag as required, no flag as optional only when the form flags another field", () => {
    const flaggedForm = [buildField({ isRequired: true }), buildField({ label: "Notes", isRequired: false })];
    const unflaggedForm = [buildField({ isRequired: false }), buildField({ label: "Notes", isRequired: false, containerNumber: 1 })];
    const otherFormFlagged = [buildField({ isRequired: false, containerNumber: 2 }), buildField({ isRequired: true, containerNumber: 1 })];

    expect(interpretRequiredReading(flaggedForm, 0)).toBe(true);
    expect(interpretRequiredReading(flaggedForm, 1)).toBe(false);
    expect(interpretRequiredReading(unflaggedForm, 0)).toBeNull();
    expect(interpretRequiredReading(otherFormFlagged, 0)).toBeNull();
    expect(interpretRequiredReading(flaggedForm, 9)).toBeNull();
  });
});
