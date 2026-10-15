import { type ReactElement } from "react";
import { type SxProps, type Theme } from "@mui/material/styles";
import { CheckCircleOutlineIcon, HighlightOffIcon, NotRunIcon } from "./icons";
import { statusColors } from "../theme/nocturneTheme";
import {
  type LatestRunOutcome,
  describeScriptRunStatus,
  findScriptRunStatus,
} from "../utils/describeScriptRunStatus";

/** Props for `ScriptRunStatusIcon`. */
export interface ScriptRunStatusIconProps {
  /** The version's newest run, or null when it has not been run (or there is no version yet). */
  latestRun: LatestRunOutcome | null;
  /** The icon's size in px; the mockups use 18 in lists and 15 in the version list. */
  size?: number;
}

/**
 * Shows whether a script version works, judged by its most recent run, in
 * the redesign's one status language: a green outlined check when it passed,
 * a red outlined X when it failed, and a grey dashed circle when there are no
 * runs yet. The icon's accessible name (also its hover title) says the same
 * in words.
 * @param props - The version's newest run, or null, and the icon's size
 * @returns The status icon
 */
export default function ScriptRunStatusIcon(props: ScriptRunStatusIconProps): ReactElement {
  const { latestRun, size = 18 } = props;
  const status = findScriptRunStatus(latestRun);
  const statusText = describeScriptRunStatus(status);
  const iconSx: SxProps<Theme> = { fontSize: size, display: "block" };

  switch (status) {
    case "passed":
      return (
        <CheckCircleOutlineIcon
          titleAccess={statusText}
          sx={{ ...iconSx, color: statusColors.passed }}
        />
      );
    case "failed":
      return (
        <HighlightOffIcon titleAccess={statusText} sx={{ ...iconSx, color: statusColors.failed }} />
      );
    case "notRun":
      return <NotRunIcon titleAccess={statusText} sx={{ ...iconSx, color: statusColors.notRun }} />;
  }
}
