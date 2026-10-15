import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import StatusDot from "./StatusDot";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";

/** Props for `ActionScriptRunHistory`. */
export interface ActionScriptRunHistoryProps {
  /** Every run of the version, newest first. */
  runs: ActionScriptRunRecord[];
  /** The run shown in full, or null. */
  selectedRunId: string | null;
  /** Called with a run's id when the user picks it. */
  onSelectRun: (actionScriptRunId: string) => void;
  /** Names the list for screen readers, e.g. "Runs of version 5". */
  label: string;
}

/**
 * A version's runs, newest first, as the mockup's "Runs of version 5" list
 * draws them: a green or red dot, how the run went ("Failed at step 9"), and
 * when (the exact time on hover). Picking a row shows that run in full; the
 * shown run is marked (`aria-current`).
 * @param props - The runs, the shown run, the pick handler, and the list's name
 * @returns The run list
 */
export default function ActionScriptRunHistory(props: ActionScriptRunHistoryProps): ReactElement {
  const { runs, selectedRunId, onSelectRun, label } = props;
  const now = new Date();

  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
      {runs.map((run) => {
        const runIsSelected = run.id === selectedRunId;
        return (
          <Box component="li" key={run.id} sx={{ listStyle: "none" }}>
            <ButtonBase
              aria-current={runIsSelected ? "true" : undefined}
              onClick={() => {
                onSelectRun(run.id);
              }}
              sx={{
                width: "100%",
                minHeight: 36,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                py: 1,
                px: "6px",
                fontSize: 13,
                fontFamily: "inherit",
                textAlign: "left",
                borderRadius: `${String(nocturneTokens.radius.small)}px`,
                borderBottom: `1px solid ${nocturneTokens.rowRule}`,
                backgroundColor: runIsSelected ? nocturneTokens.accentRamp[900] : "transparent",
              }}
            >
              <StatusDot color={run.succeeded ? statusColors.passed : statusColors.failed} />
              <Box component="span" sx={{ mr: "auto" }}>
                {describeActionScriptRunOutcome(run)}
              </Box>
              <Box
                component="span"
                title={formatFullDateTime(run.createdAt)}
                sx={{ color: nocturneTokens.neutral[400], whiteSpace: "nowrap" }}
              >
                {formatRelativeTime(run.createdAt, now)}
              </Box>
            </ButtonBase>
          </Box>
        );
      })}
    </Box>
  );
}
