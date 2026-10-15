import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { type ActionPlan, describePlanStepParts } from "../utils/actionPlanSteps";

/** The parts of a run the step list marks the steps by. */
export interface HighlightedRunFields {
  /** True when the run passed. */
  succeeded: boolean;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** Why the run stopped, or null when it passed. */
  errorMessage: string | null;
}

/** Props for `ActionPlanSteps`. */
export interface ActionPlanStepsProps {
  /** The plan to show. */
  plan: ActionPlan;
  /** The run whose progress the list marks (the run shown beside it), or null to mark nothing. */
  highlightedRun: HighlightedRunFields | null;
  /** True for the phone list: tighter rows, and no "Failed here" note (the run card above says it). */
  isCompact: boolean;
}

/** How a step is drawn against the highlighted run. */
type StepRunState = "unmarked" | "reached" | "failed" | "notReached";

/**
 * Decides how one step is drawn against the highlighted run: every step of a
 * passed run was reached; a failed run reached the steps before the one it
 * failed at, failed at that one, and never reached the rest (all of them,
 * when it failed before the first step); with no run, nothing is marked.
 * @param stepNumber - The step's 1-based number
 * @param highlightedRun - The run, or null
 * @returns The step's state
 */
function findStepRunState(stepNumber: number, highlightedRun: HighlightedRunFields | null): StepRunState {
  if (highlightedRun === null) return "unmarked";
  if (highlightedRun.succeeded) return "reached";
  const { failedStepNumber } = highlightedRun;
  if (failedStepNumber === null) return "notReached";
  if (stepNumber < failedStepNumber) return "reached";
  if (stepNumber === failedStepNumber) return "failed";
  return "notReached";
}

/** The step number's color in each state. */
const STEP_NUMBER_COLORS: Record<StepRunState, string> = {
  unmarked: nocturneTokens.neutral[500],
  reached: statusColors.passed,
  failed: statusColors.failed,
  notReached: nocturneTokens.neutral[600],
};

/**
 * Takes the first line of a run's error, for the short "Failed here" note
 * (the run panel beside the list shows the whole error).
 * @param errorMessage - The run's error, or null
 * @returns Its first line, or an empty string
 */
function firstLineOf(errorMessage: string | null): string {
  return (errorMessage ?? "").split("\n")[0].trim();
}

/**
 * A plan, read-only: where it starts, then the steps as a numbered list, each
 * with its verb muted ("Click button "Week"", "Type the credential's password
 * into the field labelled "Password""). Typed credential placeholders are
 * named, never shown as their real values (the client never has those
 * anyway).
 *
 * Against the run shown beside it, the list reads like the mockup: the steps
 * the run got through have green numbers, the step it failed at is tinted red
 * with "Failed here — <the error's first line>", and the steps it never
 * reached are dimmed. With no run, the steps are unmarked.
 * @param props - The plan, the run to mark it by, and the layout
 * @returns The numbered step list
 */
export default function ActionPlanSteps(props: ActionPlanStepsProps): ReactElement {
  const { plan, highlightedRun, isCompact } = props;
  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400], mb: 1, overflowWrap: "anywhere" }}>
        Starts at {plan.startUrl}
      </Typography>
      <Box component="ol" aria-label="Plan steps" sx={{ m: 0, p: 0, display: "flex", flexDirection: "column" }}>
        {plan.steps.map((step, stepIndex) => {
          const stepNumber = stepIndex + 1;
          const stepRunState = findStepRunState(stepNumber, highlightedRun);
          const stepFailedHere = stepRunState === "failed";
          const { verb, rest } = describePlanStepParts(step);
          return (
            <Box
              component="li"
              key={`${String(stepIndex)}-${step.action}`}
              sx={{
                listStyle: "none",
                display: "grid",
                gridTemplateColumns: isCompact ? "22px minmax(0,1fr)" : "28px minmax(0,1fr)",
                gap: isCompact ? 1 : "10px",
                padding: isCompact ? "8px" : "9px 10px",
                borderRadius: `${String(nocturneTokens.radius.medium)}px`,
                backgroundColor: stepFailedHere ? statusColors.failedStepBackground : "transparent",
                boxShadow: stepFailedHere ? `inset 0 0 0 1px ${statusColors.failedStepRing}` : "none",
                opacity: stepRunState === "notReached" ? 0.5 : 1,
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  fontFamily: MONOSPACE_FONT_FAMILY,
                  fontSize: 12,
                  lineHeight: isCompact ? "21px" : "22px",
                  color: STEP_NUMBER_COLORS[stepRunState],
                  textAlign: "right",
                }}
              >
                {stepNumber}
              </Box>
              <Box
                sx={{
                  fontSize: isCompact ? 13.5 : 14,
                  lineHeight: isCompact ? "21px" : "22px",
                  overflowWrap: "anywhere",
                }}
              >
                <Box component="span" sx={{ color: nocturneTokens.neutral[400] }}>
                  {verb}
                </Box>{" "}
                {rest}
                {stepFailedHere && !isCompact && (
                  <Box sx={{ fontSize: 12.5, color: statusColors.failedStepNote, mt: "2px" }}>
                    Failed here — {firstLineOf(highlightedRun?.errorMessage ?? null)}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
