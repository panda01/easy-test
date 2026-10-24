import { type ChangeEvent, type ReactElement, type ReactNode, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ActionScriptRunOutput, { describeOutputLineCount } from "./ActionScriptRunOutput";
import DisclosureRow from "./DisclosureRow";
import { CheckCircleOutlineIcon, HighlightOffIcon } from "./icons";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";
import { readUsedParameterValues } from "../utils/actionParameters";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
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
  /** True while a "Run" request is in flight; refining is blocked meanwhile. */
  isRunning: boolean;
  /** Why the last "Refine" request failed, or null. */
  refineErrorMessage: string | null;
  /** Called with this run and the trimmed note (null when blank) when the user clicks Refine. */
  onRefine: (failedRun: ActionScriptRunRecord, note: string | null) => void;
  /** The number the refined version will get, for "Refine into Version 6". */
  refinedVersionNumber: number;
  /** True for the phone card: no "Refine with Claude" heading or counter, Refine beside `runAgainButton`, and no output log (the page lists it below). */
  isCompact: boolean;
  /** The phone card's "Run again" button, shown beside Refine; ignored on desktop. */
  runAgainButton?: ReactNode;
}

/**
 * Says what a run did to the record of created objects: the object a Create
 * run made, why one was not recorded, or the objects a deleting run deleted.
 * @param run - The run
 * @returns The lines to show (empty for a run that touched no object)
 */
export function describeRunObjectChanges(run: ActionScriptRunRecord): string[] {
  const lines: string[] = [];
  const { createdObject, confirmStepNumber, confirmStepSucceeded } = run;
  if (createdObject !== null) {
    lines.push(`Created ${createdObject.name}`);
  } else if (confirmStepNumber !== null && confirmStepSucceeded === false) {
    lines.push(`Not recorded: the confirm step (step ${String(confirmStepNumber)}) showed an error`);
  } else if (confirmStepNumber !== null && confirmStepSucceeded === null) {
    lines.push("Not recorded: stopped before the confirm step");
  }
  for (const deletedObject of run.deletedObjects) {
    lines.push(`Deleted ${deletedObject.name}`);
  }
  return lines;
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
 * One plan run in full, as the mockup's run panel draws it:
 * - a status banner: how it went ("Failed at step 9"), then its error, how
 *   long it took, and (on desktop) when it ran;
 * - the failure screenshot, when it saved one, and the page it failed on;
 * - what the run did to the record of created objects ("Created Apollo 7",
 *   "Not recorded: ...", "Deleted Apollo 7"), and the values it used ("Values
 *   used", secrets never stored);
 * - for a failed run of a version Claude wrote, "Refine with Claude": an
 *   optional note (with a 2,000-character counter on desktop) and a button
 *   that asks the model that wrote the version to fix it from the run's error,
 *   screenshot, and failing page - the result is saved as the next version
 *   ("Refine into Version 6");
 * - on desktop, the run's "Output log" as a collapsed row.
 *
 * A refine error is shown only once THIS run's details have tried to refine
 * - the page keeps the last error until the next request, and this
 * component is keyed by the run's id, so picking another run never shows a
 * stale error. Refine is disabled while a refine or a run is in flight; the
 * note field only while refining, since it is what is being sent.
 *
 * The banner is a `role="status"` alert: it is a result to read, not an
 * error the user must act on.
 * @param props - The website, the run, the refine state and callback, and the layout
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
    refinedVersionNumber,
    isCompact,
    runAgainButton,
  } = props;
  const [noteText, setNoteText] = useState("");
  const [refineWasAttemptedForThisRun, setRefineWasAttemptedForThisRun] = useState(false);
  const ranAtText = formatFullDateTime(run.createdAt);
  const runHasFailureScreenshot = run.failureScreenshotFileName !== null;
  const runFailedWithoutScreenshot = !run.succeeded && !runHasFailureScreenshot;
  const runHasAnErrorMessage = run.errorMessage !== null;
  const refineAreaIsShown = runHasAnErrorMessage && versionCanBeRefined;
  const refineIsBlocked = isRefining || isRunning;
  const refineErrorIsShown = refineWasAttemptedForThisRun && refineErrorMessage !== null;
  const usedValues = readUsedParameterValues(run.parameterValues);
  const objectChangeLines = describeRunObjectChanges(run);
  const bannerDetails = [
    run.errorMessage,
    formatRunDuration(run.durationMs),
    isCompact ? null : formatRelativeTime(run.createdAt, new Date()),
  ].filter((detail): detail is string => detail !== null);

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

  let refineButtonText = `Refine into Version ${String(refinedVersionNumber)}`;
  if (isRefining) {
    refineButtonText = "Refining…";
  } else if (isCompact) {
    refineButtonText = "Refine";
  }
  const refineButton = (
    <Button
      onClick={handleRefineClick}
      disabled={refineIsBlocked}
      variant="outlined"
      sx={{ minHeight: isCompact ? 44 : 36 }}
    >
      {refineButtonText}
    </Button>
  );
  const refineProgressAndError = (
    <>
      {isRefining && (
        <Box>
          <LinearProgress aria-label="Refining script" />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            This can take a few minutes.
          </Typography>
        </Box>
      )}
      {refineErrorIsShown && <Alert severity="error">Could not refine: {refineErrorMessage}</Alert>}
    </>
  );
  const noteField = (
    <TextField
      value={noteText}
      onChange={handleNoteChange}
      disabled={isRefining}
      placeholder={
        isCompact
          ? "What did you notice? (optional)"
          : "What did you notice? e.g. the toast says “Spot reserved”, not “Booking confirmed”"
      }
      slotProps={{ htmlInput: { maxLength: MAX_REFINE_NOTE_LENGTH, "aria-label": "Note for Claude (optional)" } }}
      multiline
      minRows={isCompact ? 2 : 3}
      fullWidth
      sx={{ "& .MuiInputBase-root": { fontSize: 13 } }}
    />
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: isCompact ? "12px" : 2 }}>
      <Alert
        role="status"
        severity={run.succeeded ? "success" : "error"}
        icon={run.succeeded ? <CheckCircleOutlineIcon /> : <HighlightOffIcon />}
      >
        <Box sx={{ fontSize: 14, fontWeight: 500 }}>{describeActionScriptRunOutcome(run)}</Box>
        <Box sx={{ fontSize: isCompact ? 12 : 12.5, opacity: 0.85, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <span title={ranAtText}>{bannerDetails.join(" · ")}</span>
        </Box>
      </Alert>

      {objectChangeLines.length > 0 && (
        <Box aria-label="Created objects" sx={{ fontSize: 13, color: nocturneTokens.neutral[300] }}>
          {objectChangeLines.map((objectChangeLine) => (
            <Box key={objectChangeLine}>{objectChangeLine}</Box>
          ))}
        </Box>
      )}
      {usedValues.length > 0 && (
        <DisclosureRow label="Values used" detail={String(usedValues.length)}>
          <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "4px 12px", fontSize: 13 }}>
            {usedValues.map((usedValue) => (
              <Box key={usedValue.key} sx={{ display: "contents" }}>
                <Box component="dt" sx={{ color: nocturneTokens.neutral[400] }}>
                  {usedValue.label}
                </Box>
                <Box component="dd" sx={{ m: 0, overflowWrap: "anywhere" }}>
                  {usedValue.value === "" ? "(left blank - its steps were skipped)" : usedValue.value}
                </Box>
              </Box>
            ))}
          </Box>
        </DisclosureRow>
      )}

      {(runHasFailureScreenshot || run.failingPageUrl !== null) && (
        <Box>
          {runHasFailureScreenshot && (
            <Box
              component="img"
              src={actionScriptRunFailureScreenshotApiUrl(websiteId, run.actionId, run.actionScriptId, run.id)}
              alt={`Failure screenshot of the run at ${ranAtText}`}
              sx={{
                display: "block",
                width: "100%",
                height: "auto",
                borderRadius: `${String(nocturneTokens.radius.medium)}px`,
                boxShadow: nocturneTokens.shadow.small,
              }}
            />
          )}
          {run.failingPageUrl !== null && (
            <Box
              sx={{
                fontFamily: MONOSPACE_FONT_FAMILY,
                fontSize: 12,
                color: nocturneTokens.neutral[400],
                mt: "6px",
                overflowWrap: "anywhere",
              }}
            >
              {run.failingPageUrl}
            </Box>
          )}
        </Box>
      )}
      {runFailedWithoutScreenshot && (
        <Typography color="text.secondary" sx={{ fontSize: 13 }}>
          No failure screenshot was captured for this run.
        </Typography>
      )}

      {isCompact ? (
        <>
          {refineAreaIsShown && noteField}
          <Box sx={{ display: "grid", gridTemplateColumns: refineAreaIsShown ? "1fr 1fr" : "1fr", gap: 1 }}>
            {runAgainButton}
            {refineAreaIsShown && refineButton}
          </Box>
          {refineProgressAndError}
        </>
      ) : (
        <>
          {refineAreaIsShown && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                pt: "14px",
                borderTop: `1px solid ${nocturneTokens.divider}`,
              }}
            >
              <Typography component="h3" sx={{ fontSize: 13.5, fontWeight: 500 }}>
                Refine with Claude
              </Typography>
              {noteField}
              <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Box component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[500], mr: "auto" }}>
                  Optional · {noteText.length.toLocaleString()} / {MAX_REFINE_NOTE_LENGTH.toLocaleString()}
                </Box>
                {refineButton}
              </Box>
              {refineProgressAndError}
            </Box>
          )}
          <DisclosureRow label="Output log" detail={describeOutputLineCount(run.output)}>
            <ActionScriptRunOutput run={run} />
          </DisclosureRow>
        </>
      )}
    </Box>
  );
}
