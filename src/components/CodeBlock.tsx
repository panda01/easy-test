import { type ReactElement } from "react";
import Box from "@mui/material/Box";

/** Props for `CodeBlock`. */
export interface CodeBlockProps {
  /** The text to show exactly as written (whitespace and line breaks kept). */
  code: string;
  /** Accessible name of the block, e.g. "Script code". */
  label: string;
}

/**
 * A read-only, monospace, scrollable block for code or program output. Text
 * keeps its whitespace and does not wrap; long blocks scroll inside the box.
 * @param props - The text and its accessible name
 * @returns The rendered block
 */
export default function CodeBlock(props: CodeBlockProps): ReactElement {
  const { code, label } = props;
  return (
    <Box
      component="pre"
      aria-label={label}
      sx={{
        m: 0,
        p: 2,
        maxHeight: 480,
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      {code}
    </Box>
  );
}
