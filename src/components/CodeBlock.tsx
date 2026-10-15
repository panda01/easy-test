import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";

/** Props for `CodeBlock`. */
export interface CodeBlockProps {
  /** The text to show exactly as written (whitespace and line breaks kept). */
  code: string;
  /** Accessible name of the block, e.g. "Script code". */
  label: string;
}

/**
 * A read-only, monospace, scrollable block for code or program output, on
 * Nocturne's dark code ground. Text keeps its whitespace and does not wrap;
 * long blocks scroll inside the box.
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
        padding: "14px 16px",
        maxHeight: 480,
        overflow: "auto",
        fontFamily: MONOSPACE_FONT_FAMILY,
        fontSize: 12.5,
        lineHeight: 1.65,
        color: nocturneTokens.neutral[300],
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        backgroundColor: nocturneTokens.neutral[900],
      }}
    >
      {code}
    </Box>
  );
}
