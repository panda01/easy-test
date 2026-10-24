import { describe, it, expect } from "vitest";
import { readAriaSnapshotLines,
  MAX_STRUCTURE_SKELETON_CHARACTERS,
  compareStructureSkeletons,
  summarizePageStructure,
} from "../../../server/utils/summarizePageStructure.js";

/** A blog post page with a header, navigation, and a few paragraphs. */
const BLOG_POST_SNAPSHOT = [
  "- banner:",
  '  - link "Home":',
  "    - /url: /",
  "  - navigation:",
  "    - list:",
  "      - listitem:",
  '        - link "Blog"',
  "      - listitem:",
  '        - link "About"',
  "- main:",
  '  - heading "My first post" [level=1]',
  "  - paragraph: Hello there",
  "  - paragraph: Another paragraph",
  '  - checkbox "Subscribe" [checked]',
  "  - 'quoted: text'",
].join("\n");

/**
 * Builds a snapshot of a list page with the given number of items.
 * @param itemCount - How many list items
 * @returns The YAML aria snapshot
 */
function buildListSnapshot(itemCount: number): string {
  const itemLines = Array.from({ length: itemCount }, (_, itemIndex) => [
    "    - listitem:",
    `      - link "Item ${String(itemIndex)}"`,
  ]).flat();
  return ["- main:", '  - heading "Items" [level=1]', "  - list:", ...itemLines].join("\n");
}

describe("summarizePageStructure", () => {
  it("keeps only the roles, a heading's level, and the nesting - no names, text, properties, or other attributes", () => {
    expect(summarizePageStructure(BLOG_POST_SNAPSHOT)).toBe(
      [
        "banner",
        "  link",
        "  navigation",
        "    list",
        "      listitem",
        "        link",
        "main",
        "  heading[level=1]",
        "  paragraph",
        "  checkbox",
        "  text",
      ].join("\n"),
    );
  });

  it("collapses repeated sibling subtrees, so a list of 3 items and a list of 30 have the same skeleton", () => {
    const shortListSkeleton = summarizePageStructure(buildListSnapshot(3));

    expect(summarizePageStructure(buildListSnapshot(30))).toBe(shortListSkeleton);
    expect(shortListSkeleton).toBe(
      ["main", "  heading[level=1]", "  list", "    listitem", "      link"].join("\n"),
    );
  });

  it("keeps siblings that differ, and a repeat that is not next to its twin", () => {
    const snapshot = ["- paragraph: a", "- img", "- paragraph: b"].join("\n");

    expect(summarizePageStructure(snapshot)).toBe(["paragraph", "img", "paragraph"].join("\n"));
  });

  it("skips continuation lines and entries without a role", () => {
    const snapshot = ["- text: a long text", "  that goes on", "- 123", "- button \"Go\""].join("\n");

    expect(summarizePageStructure(snapshot)).toBe(["text", "button"].join("\n"));
  });

  it("returns an empty skeleton for a snapshot with no entries", () => {
    expect(summarizePageStructure("")).toBe("");
  });

  it(`cuts a skeleton longer than ${String(MAX_STRUCTURE_SKELETON_CHARACTERS)} characters at the last whole line`, () => {
    const distinctLines = Array.from({ length: 4000 }, (_, lineIndex) =>
      lineIndex % 2 === 0 ? "- paragraph: x" : `- heading "h" [level=${String(lineIndex)}]`,
    );

    const skeleton = summarizePageStructure(distinctLines.join("\n"));

    expect(skeleton.length).toBeLessThanOrEqual(MAX_STRUCTURE_SKELETON_CHARACTERS);
    expect(skeleton.length).toBeGreaterThan(MAX_STRUCTURE_SKELETON_CHARACTERS - 30);
    expect(skeleton.split("\n").every((line) => line === "paragraph" || line.startsWith("heading[level="))).toBe(true);
  });
});

describe("compareStructureSkeletons", () => {
  it("rates two identical skeletons 1, and two empty skeletons 1", () => {
    const skeleton = summarizePageStructure(BLOG_POST_SNAPSHOT);

    expect(compareStructureSkeletons(skeleton, skeleton)).toBe(1);
    expect(compareStructureSkeletons("", "")).toBe(1);
  });

  it("rates skeletons with nothing in common 0", () => {
    expect(compareStructureSkeletons("main\n  textbox", "banner\n  table")).toBe(0);
  });

  it("rates the share of role paths both have, over the paths either has", () => {
    const formSkeleton = ["main", "  heading[level=1]", "  textbox", "  button"].join("\n");
    const tableSkeleton = ["main", "  heading[level=1]", "  table", "  button"].join("\n");

    // Shared: main, main>heading, main>button. Either: those 3 plus textbox and table.
    expect(compareStructureSkeletons(formSkeleton, tableSkeleton)).toBeCloseTo(3 / 5);
  });

  it("compares a role by where it sits, not just by its name", () => {
    expect(compareStructureSkeletons("banner\n  link", "main\n  link")).toBe(0);
  });
});

describe("readAriaSnapshotLines", () => {
  it("reads each entry line with its depth, property lines included, and skips continuation lines", () => {
    expect(readAriaSnapshotLines('- link "Home":\n  - /url: /\n  continued text\n    - text: deep')).toEqual([
      { depth: 0, entryText: 'link "Home":' },
      { depth: 1, entryText: "/url: /" },
      { depth: 2, entryText: "text: deep" },
    ]);
  });
});
