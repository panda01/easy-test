import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import StatusDot from "./StatusDot";
import { nocturneTokens, runStatusColors } from "../theme/nocturneTheme";
import { type ActionStatusCounts } from "../utils/describeActionStatus";

/** Props for `ActionStatusBar`. */
export interface ActionStatusBarProps {
  /** How many of the website's actions pass, fail, or have not been run. */
  counts: ActionStatusCounts;
  /** True to put a colored dot before each legend entry (the desktop dashboard); false for plain text (mobile). */
  legendHasDots: boolean;
}

/** One status's part of the bar and the legend. */
interface StatusBarSegment {
  /** Which status it counts. */
  statusKey: keyof ActionStatusCounts;
  /** How many actions have it. */
  count: number;
  /** The legend's words after the count. */
  legendText: string;
  /** The bar segment's fill. */
  barColor: string;
  /** The legend dot's color. */
  dotColor: string;
}

/**
 * A website's actions at a glance, as the dashboard draws them: a thin bar
 * split in proportion into passed (green), failed (red), and not run (grey),
 * with the counts in words underneath ("4 passed · 2 failed · 1 not run").
 * The bar is decoration (`aria-hidden`); the legend carries the meaning.
 * @param props - The counts, and whether the legend has dots
 * @returns The bar and its legend
 */
export default function ActionStatusBar(props: ActionStatusBarProps): ReactElement {
  const { counts, legendHasDots } = props;
  const segments: StatusBarSegment[] = [
    {
      statusKey: "passed",
      count: counts.passed,
      legendText: "passed",
      barColor: runStatusColors.passed,
      dotColor: runStatusColors.passed,
    },
    {
      statusKey: "failed",
      count: counts.failed,
      legendText: "failed",
      barColor: runStatusColors.failed,
      dotColor: runStatusColors.failed,
    },
    {
      statusKey: "notRun",
      count: counts.notRun,
      legendText: "not run",
      barColor: nocturneTokens.neutral[700],
      dotColor: nocturneTokens.neutral[500],
    },
  ];
  const segmentsWithActions = segments.filter((segment) => segment.count > 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: legendHasDots ? "8px" : "10px" }}>
      <Box
        aria-hidden="true"
        sx={{ display: "flex", height: 4, borderRadius: "2px", overflow: "hidden", gap: "2px" }}
      >
        {segmentsWithActions.map((segment) => (
          <Box
            key={segment.statusKey}
            sx={{ flex: segment.count, backgroundColor: segment.barColor }}
          />
        ))}
      </Box>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          columnGap: legendHasDots ? "14px" : "12px",
          fontSize: legendHasDots ? 12.5 : 12,
          color: nocturneTokens.neutral[300],
        }}
      >
        {segments.map((segment) => (
          <Box
            key={segment.statusKey}
            component="span"
            sx={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            {legendHasDots && (
              <StatusDot color={segment.dotColor} isHollow={segment.statusKey === "notRun"} />
            )}
            {segment.count} {segment.legendText}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
