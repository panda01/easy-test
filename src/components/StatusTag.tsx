import { type ReactElement } from "react";
import Chip from "@mui/material/Chip";
import { nocturneTokens, statusColors } from "../theme/nocturneTheme";

/** Which tint a `StatusTag` takes. */
export type StatusTagTone = "stale" | "loggedIn" | "failed" | "accent" | "neutral";

/** The fill and text color of each tag tone, from the mockups. */
const TAG_TONE_COLORS: Record<StatusTagTone, { backgroundColor: string; color: string }> = {
  stale: { backgroundColor: statusColors.staleTagBackground, color: statusColors.staleTagText },
  loggedIn: {
    backgroundColor: statusColors.loggedInTagBackground,
    color: statusColors.loggedInTagText,
  },
  failed: {
    backgroundColor: statusColors.failedBannerBackground,
    color: statusColors.failedBannerText,
  },
  accent: { backgroundColor: nocturneTokens.accentRamp[800], color: nocturneTokens.accentRamp[100] },
  neutral: { backgroundColor: nocturneTokens.neutral[800], color: nocturneTokens.neutral[100] },
};

/** Props for `StatusTag`. */
export interface StatusTagProps {
  /** The tag's text, e.g. "Out of date". */
  label: string;
  /** Which tint it takes. */
  tone: StatusTagTone;
  /** True for the tighter padding the mockups use inside list rows. */
  isCompact?: boolean;
}

/**
 * A small tinted label - Nocturne's `.tag` - such as the "Out of date" tag on
 * a version or action, or a crawl's "Logged in as “Admin”".
 * @param props - The text, the tint, and whether it is compact
 * @returns The tag
 */
export default function StatusTag(props: StatusTagProps): ReactElement {
  const { label, tone, isCompact = false } = props;
  const toneColors = TAG_TONE_COLORS[tone];
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        ...toneColors,
        flex: "none",
        "& .MuiChip-label": isCompact
          ? { paddingTop: "1px", paddingBottom: "1px", paddingLeft: "7px", paddingRight: "7px" }
          : {},
      }}
    />
  );
}
