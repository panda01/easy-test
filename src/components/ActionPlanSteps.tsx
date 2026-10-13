import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ActionPlan, describePlanStep } from "../utils/actionPlanSteps";

/** Props for `ActionPlanSteps`. */
export interface ActionPlanStepsProps {
  /** The plan to show. */
  plan: ActionPlan;
}

/**
 * A plan, read-only, as numbered sentences: where it starts, then each step
 * ("Click button "Sign in"", "Type the credential's password into the field
 * labelled "Password"", ...). Typed credential placeholders are named, never
 * shown as their real values (the client never has those anyway).
 * @param props - The plan
 * @returns The numbered step list
 */
export default function ActionPlanSteps(props: ActionPlanStepsProps): ReactElement {
  const { plan } = props;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        Starts at {plan.startUrl}
      </Typography>
      <Box component="ol" aria-label="Plan steps" sx={{ mt: 1, mb: 0, pl: 3 }}>
        {plan.steps.map((step, stepIndex) => (
          <Typography
            component="li"
            key={`${String(stepIndex)}-${step.action}`}
            variant="body2"
            sx={{ py: 0.25 }}
          >
            {describePlanStep(step)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
