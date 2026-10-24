import { describe, it, expect } from "vitest";
import { readAriaSnapshotOutline, unquoteSnapshotText } from "../../../server/utils/readAriaSnapshotFields.js";

/** A dialog, a form, page-level fields, and links - the shapes real snapshots have. */
const SNAPSHOT = [
  '- banner:',
  '  - link "Home":',
  '    - /url: /',
  '  - searchbox "Search"',
  '- dialog "Create school Close":',
  '  - heading "Create school" [level=2]',
  '  - textbox "School name":',
  '    - /placeholder: e.g. Forge Athletics',
  '  - textbox "Original owner" [disabled]: Owner 1',
  '  - combobox "Size":',
  '    - option "Small" [selected]',
  '  - textbox:',
  '    - /placeholder: ""',
  '- form "Sign \\"up\\"":',
  '  - spinbutton "Seats": "5"',
  '  - listbox "Tags"',
  '- list:',
  '  - listitem:',
  '    - link "Apollo 7":',
  '      - /url: /projects/abc',
  '    - link "No address"',
  '    - link "":',
  '      - /url: /blank',
  '- text: "plain"',
].join("\n");

describe("readAriaSnapshotOutline", () => {
  it("reads every field with its name, placeholder, disabled flag, and dialog or form", () => {
    const { fields } = readAriaSnapshotOutline(SNAPSHOT);

    expect(fields).toEqual([
      { role: "searchbox", name: "Search", placeholder: null, isDisabled: false, containerNumber: 0, containerName: null },
      {
        role: "textbox",
        name: "School name",
        placeholder: "e.g. Forge Athletics",
        isDisabled: false,
        containerNumber: 1,
        containerName: "Create school Close",
      },
      { role: "textbox", name: "Original owner", placeholder: null, isDisabled: true, containerNumber: 1, containerName: "Create school Close" },
      { role: "combobox", name: "Size", placeholder: null, isDisabled: false, containerNumber: 1, containerName: "Create school Close" },
      { role: "textbox", name: null, placeholder: null, isDisabled: false, containerNumber: 1, containerName: "Create school Close" },
      { role: "spinbutton", name: "Seats", placeholder: null, isDisabled: false, containerNumber: 2, containerName: 'Sign "up"' },
      { role: "listbox", name: "Tags", placeholder: null, isDisabled: false, containerNumber: 2, containerName: 'Sign "up"' },
    ]);
  });

  it("reads the named links that have an address", () => {
    expect(readAriaSnapshotOutline(SNAPSHOT).links).toEqual([
      { name: "Home", href: "/" },
      { name: "Apollo 7", href: "/projects/abc" },
    ]);
  });

  it("reads an empty snapshot as nothing", () => {
    expect(readAriaSnapshotOutline("")).toEqual({ fields: [], links: [] });
  });
});

describe("unquoteSnapshotText", () => {
  it("unescapes a double-quoted scalar and leaves any other as written", () => {
    expect(unquoteSnapshotText(' "a \\"b\\"" ')).toBe('a "b"');
    expect(unquoteSnapshotText("plain text ")).toBe("plain text");
    expect(unquoteSnapshotText('"bad \\q escape"')).toBe("bad \\q escape");
    expect(unquoteSnapshotText('"')).toBe('"');
  });
});
