import { diffLines, diffWordsWithSpace } from "diff";

/**
 * What one side of a diff row shows:
 * - `unchanged`: the same line is on both sides;
 * - `removed`: a line only the left (older) text has;
 * - `added`: a line only the right (newer) text has;
 * - `empty`: filler opposite a removed or added line, so rows stay aligned.
 */
export type DiffCellKind = "unchanged" | "removed" | "added" | "empty";

/** A run of text within one line; `isChanged` marks the words that differ from the other side. */
export interface DiffSegment {
  /** The text of this run. */
  text: string;
  /** True for words that differ from the paired line on the other side. */
  isChanged: boolean;
}

/** One side of one row. */
export interface DiffCell {
  /** How this side relates to the other. */
  kind: DiffCellKind;
  /** The line's number in its own text, or null for an `empty` filler cell. */
  lineNumber: number | null;
  /** The line's text in runs; empty for an `empty` filler cell. */
  segments: DiffSegment[];
}

/** One row of the side-by-side view: the left (older) line and the right (newer) line. */
export interface SideBySideDiffRow {
  /** The left (older) side. */
  left: DiffCell;
  /** The right (newer) side. */
  right: DiffCell;
}

/** The filler cell shown opposite a line that only one side has. */
const EMPTY_CELL: DiffCell = { kind: "empty", lineNumber: null, segments: [] };

/**
 * Splits one change's text into its lines. A change's text normally ends with
 * a newline; that final, empty piece is not a line of its own.
 * @param changeText - The text of one line-diff change
 * @returns Its lines, without their newline characters
 */
function splitIntoLines(changeText: string): string[] {
  const lines = changeText.split("\n");
  const lastPieceIsEmpty = lines.at(-1) === "";
  if (lastPieceIsEmpty) {
    lines.pop();
  }
  return lines;
}

/**
 * Compares a removed line with the added line it was replaced by, word by
 * word, so the view can highlight just the words that changed.
 * @param removedLine - The line as the left side had it
 * @param addedLine - The line as the right side has it
 * @returns The left line's runs and the right line's runs
 */
function diffPairedLineWords(
  removedLine: string,
  addedLine: string,
): { leftSegments: DiffSegment[]; rightSegments: DiffSegment[] } {
  const wordChanges = diffWordsWithSpace(removedLine, addedLine);
  const leftSegments = wordChanges
    .filter((wordChange) => !wordChange.added)
    .map((wordChange) => ({ text: wordChange.value, isChanged: wordChange.removed }));
  const rightSegments = wordChanges
    .filter((wordChange) => !wordChange.removed)
    .map((wordChange) => ({ text: wordChange.value, isChanged: wordChange.added }));
  return { leftSegments, rightSegments };
}

/**
 * Lines up two texts for a side-by-side view, like a code review diff.
 *
 * The texts are compared line by line. Lines both have become `unchanged`
 * rows. A run of removed lines followed by a run of added lines is a
 * replacement: the two runs are paired up line by line (each pair also gets
 * a word-level comparison), and whichever run is longer is padded with
 * `empty` filler cells on the other side. Removed or added lines with no
 * counterpart are paired with filler.
 *
 * A difference only in whether the text ends with a newline is ignored, so it
 * never shows up as a changed last line.
 * @param leftText - The older text, shown on the left
 * @param rightText - The newer text, shown on the right
 * @returns One row per displayed line; empty when both texts are empty
 */
export function buildSideBySideDiffRows(leftText: string, rightText: string): SideBySideDiffRow[] {
  const lineChanges = diffLines(leftText, rightText, { ignoreNewlineAtEof: true });
  const rows: SideBySideDiffRow[] = [];
  let leftLineNumber = 0;
  let rightLineNumber = 0;
  let pendingRemovedLines: string[] = [];

  /**
   * Builds a whole-line cell for one side and advances that side's counter.
   * @param kind - The cell's kind
   * @param line - The line's text
   * @param side - Which side's line counter to advance
   * @returns The cell
   */
  const buildLineCell = (kind: DiffCellKind, line: string, side: "left" | "right"): DiffCell => {
    const cellIsOnTheLeft = side === "left";
    if (cellIsOnTheLeft) {
      leftLineNumber += 1;
    } else {
      rightLineNumber += 1;
    }
    const lineNumber = cellIsOnTheLeft ? leftLineNumber : rightLineNumber;
    return { kind, lineNumber, segments: [{ text: line, isChanged: false }] };
  };

  /** Shows removed lines that had no added lines to pair with. */
  const flushUnpairedRemovedLines = (): void => {
    for (const removedLine of pendingRemovedLines) {
      rows.push({ left: buildLineCell("removed", removedLine, "left"), right: EMPTY_CELL });
    }
    pendingRemovedLines = [];
  };

  /**
   * Pairs the pending removed lines with the added lines that replaced them.
   * @param addedLines - The added run's lines
   */
  const pairRemovedWithAddedLines = (addedLines: string[]): void => {
    const rowCount = Math.max(pendingRemovedLines.length, addedLines.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const removedLine = pendingRemovedLines.at(rowIndex);
      const addedLine = addedLines.at(rowIndex);
      const left = removedLine === undefined ? EMPTY_CELL : buildLineCell("removed", removedLine, "left");
      const right = addedLine === undefined ? EMPTY_CELL : buildLineCell("added", addedLine, "right");
      const bothSidesHaveALine = removedLine !== undefined && addedLine !== undefined;
      if (bothSidesHaveALine) {
        const { leftSegments, rightSegments } = diffPairedLineWords(removedLine, addedLine);
        left.segments = leftSegments;
        right.segments = rightSegments;
      }
      rows.push({ left, right });
    }
    pendingRemovedLines = [];
  };

  for (const lineChange of lineChanges) {
    const changeLines = splitIntoLines(lineChange.value);
    if (lineChange.removed) {
      pendingRemovedLines.push(...changeLines);
    } else if (lineChange.added) {
      pairRemovedWithAddedLines(changeLines);
    } else {
      flushUnpairedRemovedLines();
      for (const unchangedLine of changeLines) {
        rows.push({
          left: buildLineCell("unchanged", unchangedLine, "left"),
          right: buildLineCell("unchanged", unchangedLine, "right"),
        });
      }
    }
  }
  flushUnpairedRemovedLines();

  return rows;
}
