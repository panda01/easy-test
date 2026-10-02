import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ScreenshotRunRecord } from "../hooks/useScreenshotRuns";
import { describeScreenshotRunOutcome, formatRunDuration } from "../utils/describeScreenshotRun";
import { screenshotRunImageApiUrl } from "../utils/routePaths";

/** Props for `ScreenshotRunDetails`. */
export interface ScreenshotRunDetailsProps {
  /** The owning website's cuid, for the screenshot image url. */
  websiteId: string;
  /** The run to show. */
  run: ScreenshotRunRecord;
}

/**
 * One screenshot run in full: its outcome line ("Failed · HTTP 404 · 1.2 s")
 * with the failure reason, when and where it was taken, and its screenshot -
 * or a note that none was captured, because navigation never reached a page.
 *
 * The outcome is a `role="status"` alert: it is a result to read, not an
 * error the user must act on.
 * @param props - The website and the run to show
 * @returns The rendered run
 */
export default function ScreenshotRunDetails(props: ScreenshotRunDetailsProps): ReactElement {
  const { websiteId, run } = props;
  const takenAtText = new Date(run.createdAt).toLocaleString();
  const runHasErrorMessage = run.errorMessage !== null;
  const runHasScreenshot = run.screenshotFileName !== null;

  return (
    <Box>
      <Alert role="status" severity={run.succeeded ? "success" : "error"}>
        {describeScreenshotRunOutcome(run)} · {formatRunDuration(run.durationMs)}
        {runHasErrorMessage && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {run.errorMessage}
          </Typography>
        )}
      </Alert>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        Taken {takenAtText} · {run.requestedUrl}
      </Typography>

      {runHasScreenshot ? (
        <Box
          component="img"
          src={screenshotRunImageApiUrl(websiteId, run.id)}
          alt={`Screenshot of ${run.requestedUrl} taken ${takenAtText}`}
          sx={{
            display: "block",
            width: "100%",
            height: "auto",
            aspectRatio: "16 / 9",
            mt: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        />
      ) : (
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No screenshot was captured for this run.
        </Typography>
      )}
    </Box>
  );
}
