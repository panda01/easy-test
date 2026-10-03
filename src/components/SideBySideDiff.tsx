import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { type DiffCell, buildSideBySideDiffRows } from "../utils/buildSideBySideDiff";

/** Props for `SideBySideDiff`. */
export interface SideBySideDiffProps {
  /** The section's name, e.g. "Code"; also its heading and accessible name. */
  label: string;
  /** The older text, shown on the left. */
  leftText: string;
  /** The newer text, shown on the right. */
  rightText: string;
}

/**
 * Picks a cell's background: red-tinted for a removed line, green-tinted for
 * an added one, grey filler opposite them, and none when unchanged.
 * @param theme - The MUI theme
 * @param kind - The cell's kind
 * @returns The background color
 */
function cellBackground(theme: Theme, kind: DiffCell["kind"]): string {
  const cellIsRemoved = kind === "removed";
  if (cellIsRemoved) {
    return alpha(theme.palette.error.main, 0.15);
  }
  const cellIsAdded = kind === "added";
  if (cellIsAdded) {
    return alpha(theme.palette.success.main, 0.15);
  }
  const cellIsFiller = kind === "empty";
  return cellIsFiller ? theme.palette.action.hover : "transparent";
}

/**
 * Picks the stronger background for the changed words inside a line.
 * @param theme - The MUI theme
 * @param kind - The cell's kind (removed or added)
 * @returns The word highlight color
 */
function changedWordBackground(theme: Theme, kind: DiffCell["kind"]): string {
  const cellIsRemoved = kind === "removed";
  const highlightColor = cellIsRemoved ? theme.palette.error.main : theme.palette.success.main;
  return alpha(highlightColor, 0.45);
}

/**
 * Renders one side of one row: the line number, then the text, with changed
 * words highlighted.
 * @param props - The cell to render
 * @param props.cell - The cell
 * @returns The line-number cell and the text cell
 */
function DiffCellView(props: { cell: DiffCell }): ReactElement {
  const { cell } = props;
  return (
    <>
      <Box
        sx={{ color: "text.secondary", textAlign: "right", pr: 1, userSelect: "none" }}
        data-diff-kind={cell.kind}
      >
        {cell.lineNumber ?? ""}
      </Box>
      <Box
        data-diff-kind={cell.kind}
        sx={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          px: 1,
          bgcolor: (theme) => cellBackground(theme, cell.kind),
        }}
      >
        {cell.segments.map((segment, segmentIndex) => (
          <Box
            component="span"
            key={segmentIndex}
            data-changed-word={segment.isChanged ? "true" : undefined}
            sx={
              segment.isChanged
                ? { bgcolor: (theme) => changedWordBackground(theme, cell.kind), borderRadius: 0.5 }
                : undefined
            }
          >
            {segment.text}
          </Box>
        ))}
      </Box>
    </>
  );
}

/**
 * One section of a side-by-side comparison, like a code review diff: the
 * older text on the left and the newer on the right, with removed lines
 * tinted red, added lines tinted green, the changed words inside a replaced
 * line highlighted, and blank filler keeping the two sides aligned. Says "No
 * differences" when the texts are the same. Long lines wrap rather than
 * scrolling sideways.
 * @param props - The section's label and the two texts
 * @returns The rendered section
 */
export default function SideBySideDiff(props: SideBySideDiffProps): ReactElement {
  const { label, leftText, rightText } = props;
  const rows = buildSideBySideDiffRows(leftText, rightText);
  const textsAreIdentical = leftText === rightText;

  return (
    <Box component="section" aria-label={label} sx={{ mt: 4 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {textsAreIdentical && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No differences.
        </Typography>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "3em minmax(0, 1fr) 3em minmax(0, 1fr)",
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.6,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {rows.map((row, rowIndex) => (
          <Box key={rowIndex} sx={{ display: "contents" }} data-diff-row="">
            <DiffCellView cell={row.left} />
            <DiffCellView cell={row.right} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
