import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import { nocturneTokens } from "../theme/nocturneTheme";

/** Props for `StatusDot`. */
export interface StatusDotProps {
  /** The dot's color, e.g. one of `statusColors`. */
  color: string;
  /** True for something in progress: the dot gets the accent glow ring the mockups give a running crawl. */
  isGlowing?: boolean;
  /** True to draw only the dot's outline - the mockups' "not run" legend mark. */
  isHollow?: boolean;
  /** The dot's diameter in px (default 7). */
  size?: number;
}

/**
 * The small round status mark the mockups put before a crawl, a run, or a
 * site map page. It is decoration only (`aria-hidden`): the text beside it
 * always says the same thing in words.
 * @param props - The dot's color, glow, outline, and size
 * @returns The dot
 */
export default function StatusDot(props: StatusDotProps): ReactElement {
  const { color, isGlowing = false, isHollow = false, size = 7 } = props;
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: "inline-block",
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: isHollow ? "transparent" : color,
        border: isHollow ? `1px solid ${color}` : "none",
        boxShadow: isGlowing ? `0 0 0 4px ${nocturneTokens.accentRamp[800]}` : "none",
      }}
    />
  );
}
