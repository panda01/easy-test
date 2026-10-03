import { describe, it, expect } from "vitest";
import { type DiffCell, buildSideBySideDiffRows } from "../../src/utils/buildSideBySideDiff";

/**
 * Renders a cell as compact text: kind, line number, and the line with
 * changed words in brackets.
 * @param cell - One side of a row
 * @returns e.g. "removed 2 [b]"
 */
function describeCell(cell: DiffCell): string {
  const lineText = cell.segments
    .map((segment) => (segment.isChanged ? `[${segment.text}]` : segment.text))
    .join("");
  return `${cell.kind} ${String(cell.lineNumber ?? "-")} ${lineText}`.trimEnd();
}

/**
 * Describes every row of a diff as "left | right".
 * @param leftText - The older text
 * @param rightText - The newer text
 * @returns One string per row
 */
function describeRows(leftText: string, rightText: string): string[] {
  return buildSideBySideDiffRows(leftText, rightText).map(
    (row) => `${describeCell(row.left)} | ${describeCell(row.right)}`,
  );
}

describe("buildSideBySideDiffRows", () => {
  it("lines identical texts up as unchanged rows", () => {
    expect(describeRows("a\nb", "a\nb")).toEqual(["unchanged 1 a | unchanged 1 a", "unchanged 2 b | unchanged 2 b"]);
  });

  it("pairs a replaced line with its replacement, highlighting the changed words", () => {
    expect(describeRows("Log in", "Log in to the shop")).toEqual([
      "removed 1 Log in | added 1 Log in[ to the shop]",
    ]);
  });

  it("pads an added line with filler on the left, keeping line numbers per side", () => {
    expect(describeRows("a\nb\nc\n", "a\nB2\nc\nd\n")).toEqual([
      "unchanged 1 a | unchanged 1 a",
      "removed 2 [b] | added 2 [B2]",
      "unchanged 3 c | unchanged 3 c",
      "empty - | added 4 d",
    ]);
  });

  it("pads a removed line with filler on the right", () => {
    expect(describeRows("one\ntwo\nthree", "one\nthree")).toEqual([
      "unchanged 1 one | unchanged 1 one",
      "removed 2 two | empty -",
      "unchanged 3 three | unchanged 2 three",
    ]);
  });

  it("pairs runs of different lengths line by line, padding the shorter run", () => {
    expect(describeRows("x\ny\n", "p\n")).toEqual(["removed 1 [x] | added 1 [p]", "removed 2 y | empty -"]);
  });

  it("ignores a difference only in the final newline", () => {
    expect(describeRows("x\ny", "x\ny\n")).toEqual(["unchanged 1 x | unchanged 1 x", "unchanged 2 y | unchanged 2 y"]);
  });

  it("keeps blank lines as lines", () => {
    expect(describeRows("a\n\nb", "a\n\nb")).toHaveLength(3);
  });

  it("returns no rows for two empty texts", () => {
    expect(buildSideBySideDiffRows("", "")).toEqual([]);
  });
});
