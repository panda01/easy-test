import { type ChangeEvent, type ReactElement, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import { actionScriptRunFailureScreenshotApiUrl } from "../utils/routePaths";

/** The longest note the server accepts with a refine request (its `MAX_REFINE_NOTE_LENGTH`). */
export const MAX_REFINE_NOTE_LENGTH = 2000;

/** Props for `ActionScriptRunDetails`. */
export interface ActionScriptRunDetailsProps {
  /** The owning website's cuid, for the failure screenshot url. */
  websiteId: string;
  /** The run to show. */
  run: ActionScriptRunRecord;
  /** True when the run's version was written by Claude (not saved from the step editor), so a failed run can be refined. */
  versionCanBeRefined: boolean;
  /** True while a "Refine" request is in flight. */
  isRefining: boolean;
  /** True while a "Run script" request is in flight; "Refine" is disabled meanwhile. */
  isRunning: boolean;
  /** Why the last "Refine" request failed, or null. */
  refineErrorMessage: string | null;
  /** Called with this run and the trimmed note (null when blank) when the user clicks "Refine". */
  onRefine: (failedRun: ActionScriptRunRecord, note: string | null) => void;
}

/**
 * Turns the note field's text into what the refine request sends: the
 * trimmed note, or null when nothing but whitespace was typed.
 * @param noteText - The note field's text as typed
 * @returns The trimmed note, or null when it is blank
 */
function noteToSend(noteText: string): string | null {
  const trimmedNote = noteText.trim();
  const noteIsBlank = trimmedNote === "";
  return noteIsBlank ? null : trimmedNote;
}

/**
 * One plan run in full: its outcome line ("Failed at step 3 · 4.2 s"), why
 * it stopped, when it ran and who it was logged in as, the page it failed
 * on, the step log, and - when the run failed and saved one - the failure
 * screenshot.
 *
 * A failed run of a version Claude wrote also gets a "Refine" area: an
 * optional note for Claude and a "Refine" button that asks the model that
 * wrote the version to fix it from the run's error, screenshot, and failing
 * page (the result is saved as a new version). A refine error is shown only
 * once THIS run's details have tried to refine - the page keeps the last
 * error until the next request, and this component is keyed by the run's id,
 * so picking another run never shows a stale error. "Refine" is disabled
 * while a refine or a run is in flight; the note field only while refining,
 * since it is what is being sent.
 *
 * The outcome is a `role="status"` alert: it is a result to read, not an
 * error the user must act on.
 * @param props - The website, the run to show, and the refine state and callback
 * @returns The rendered run
 */
export default function ActionScriptRunDetails(props: ActionScriptRunDetailsProps): ReactElement {
  const {
    websiteId,
    run,
    versionCanBeRefined,
    isRefining,
    isRunning,
    refineErrorMessage,
    onRefine,
  } = props;
  const [noteText, setNoteText] = useState("");
  const [refineWasAttemptedForThisRun, setRefineWasAttemptedForThisRun] = useState(false);
  const ranAtText = new Date(run.createdAt).toLocaleString();
  const runHasOutput = run.output !== "";
  const runHasFailureScreenshot = run.failureScreenshotFileName !== null;
  const runFailedWithoutScreenshot = !run.succeeded && !runHasFailureScreenshot;
  const runHasAnErrorMessage = run.errorMessage !== null;
  const runHasAFailingPageUrl = run.failingPageUrl !== null;
  const refineAreaIsShown = runHasAnErrorMessage && versionCanBeRefined;
  const refineIsBlocked = isRefining || isRunning;
  const refineErrorIsShown = refineWasAttemptedForThisRun && refineErrorMessage !== null;
  const loginText =
    run.credentialName === null ? "logged out" : `logged in as "${run.credentialName}"`;

  /**
   * Keeps the note in sync with its field.
   * @param event - The note field's change event
   */
  const handleNoteChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setNoteText(event.target.value);
  };

  /** Asks the page to refine this run, remembering that this run's details tried (so a failure is shown here). */
  const handleRefineClick = (): void => {
    setRefineWasAttemptedForThisRun(true);
    onRefine(run, noteToSend(noteText));
  };

  return (
    <Box>
      <Alert role="status" severity={run.succeeded ? "success" : "error"}>
        {describeActionScriptRunOutcome(run)} · {formatRunDuration(run.durationMs)}
        {runHasAnErrorMessage && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {run.errorMessage}
          </Typography>
        )}
      </Alert>
      <Box sx={{ mt: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary" component="p">
          Ran {ranAtText} · {loginText}
        </Typography>
        {runHasAFailingPageUrl && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ overflowWrap: "anywhere" }}
          >
            Failing page: {run.failingPageUrl}
          </Typography>
        )}
      </Box>

      {refineAreaIsShown && (
        <Box sx={{ mb: 3 }}>
          <TextField
            label="Note for Claude (optional)"
            value={noteText}
            onChange={handleNoteChange}
            disabled={isRefining}
            slotProps={{ htmlInput: { maxLength: MAX_REFINE_NOTE_LENGTH } }}
            multiline
            minRows={2}
            fullWidth
          />
          <Button
            onClick={handleRefineClick}
            disabled={refineIsBlocked}
            variant="contained"
            sx={{ mt: 1 }}
          >
            {isRefining ? "Refining…" : "Refine"}
          </Button>
          {isRefining && (
            <>
              <LinearProgress aria-label="Refining script" sx={{ mt: 2 }} />
              <Typography variant="caption" color="text.secondary" component="p">
                This can take a few minutes.
              </Typography>
            </>
          )}
          {refineErrorIsShown && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Could not refine: {refineErrorMessage}
            </Alert>
          )}
        </Box>
      )}

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
        <Typography color="text.secondary">The run logged nothing.</Typography>
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
