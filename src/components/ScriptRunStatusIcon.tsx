import { type ReactElement } from "react";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { amber } from "@mui/material/colors";
import {
  type LatestRunOutcome,
  describeScriptRunStatus,
  findScriptRunStatus,
} from "../utils/describeScriptRunStatus";

/**
 * The yellow of the "not run yet" icon. The theme's `warning` color is orange
 * in dark mode, so the icon takes MUI's amber instead.
 */
const NOT_RUN_YET_COLOR = amber[400];

/** Props for `ScriptRunStatusIcon`. */
export interface ScriptRunStatusIconProps {
  /** The version's newest run, or null when it has not been run (or there is no version yet). */
  latestRun: LatestRunOutcome | null;
}

/**
 * Shows whether a script version works, judged by its most recent run: a
 * green check when it passed, a red X when it failed, and a yellow
 * exclamation when there are no runs yet. The icon's accessible name (also
 * its hover title) says the same in words.
 * @param props - The version's newest run, or null
 * @returns The status icon
 */
export default function ScriptRunStatusIcon(props: ScriptRunStatusIconProps): ReactElement {
  const { latestRun } = props;
  const status = findScriptRunStatus(latestRun);
  const statusText = describeScriptRunStatus(status);

  switch (status) {
    case "passed":
      return <CheckCircleIcon color="success" titleAccess={statusText} />;
    case "failed":
      return <CancelIcon color="error" titleAccess={statusText} />;
    case "notRun":
      return <ErrorIcon sx={{ color: NOT_RUN_YET_COLOR }} titleAccess={statusText} />;
  }
}
