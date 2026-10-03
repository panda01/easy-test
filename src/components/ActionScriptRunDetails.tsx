import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import { actionScriptRunFailureScreenshotApiUrl } from "../utils/routePaths";

/** Props for `ActionScriptRunDetails`. */
export interface ActionScriptRunDetailsProps {
  /** The owning website's cuid, for the failure screenshot url. */
  websiteId: string;
  /** The run to show. */
  run: ActionScriptRunRecord;
}

/**
 * One script run in full: its outcome line ("Failed · exit code 1 · 4.2 s"),
 * when it ran, the script's output (its step log), and - when the script
 * failed and saved one - the failure screenshot.
 *
 * The outcome is a `role="status"` alert: it is a result to read, not an
 * error the user must act on.
 * @param props - The website and the run to show
 * @returns The rendered run
 */
export default function ActionScriptRunDetails(props: ActionScriptRunDetailsProps): ReactElement {
  const { websiteId, run } = props;
  const ranAtText = new Date(run.createdAt).toLocaleString();
  const runHasOutput = run.output !== "";
  const runHasFailureScreenshot = run.failureScreenshotFileName !== null;
  const runFailedWithoutScreenshot = !run.succeeded && !runHasFailureScreenshot;

  return (
    <Box>
      <Alert role="status" severity={run.succeeded ? "success" : "error"}>
        {describeActionScriptRunOutcome(run)} · {formatRunDuration(run.durationMs)}
      </Alert>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, mb: 2 }}>
        Ran {ranAtText}
      </Typography>

      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
        Output
      </Typography>
      {run.outputWasTruncated && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          The output was long, so only its end is kept.
        </Typography>
      )}
      {runHasOutput ? (
        <CodeBlock code={run.output} label="Run output" />
      ) : (
        <Typography color="text.secondary">The script printed nothing.</Typography>
      )}

      {runHasFailureScreenshot && (
        <>
          <Typography variant="subtitle2" component="h4" sx={{ mt: 2, mb: 1 }}>
            Failure screenshot
          </Typography>
          <Box
            component="img"
            src={actionScriptRunFailureScreenshotApiUrl(
              websiteId,
              run.actionId,
              run.actionScriptId,
              run.id,
            )}
            alt={`Failure screenshot of the run at ${ranAtText}`}
            sx={{
              display: "block",
              width: "100%",
              height: "auto",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
            }}
          />
        </>
      )}
      {runFailedWithoutScreenshot && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No failure screenshot was captured for this run.
        </Typography>
      )}
    </Box>
  );
}
