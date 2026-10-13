import { type ReactElement, useState } from "react";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ActionPlanEditor from "./ActionPlanEditor";
import ActionPlanSteps from "./ActionPlanSteps";
import CodeBlock from "./CodeBlock";
import { type ActionScriptRecord, type ActionScriptRefinementRecord } from "../hooks/useActionScripts";
import { type ScriptModelOption } from "../hooks/useScriptModels";
import { type ActionPlan, formatPlanJson } from "../utils/actionPlanSteps";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { describeScriptModel } from "../utils/describeScriptModel";
import {
  type CurrentActionText,
  describeChangedActionFields,
  findChangedActionFields,
} from "../utils/describeScriptStaleness";

/** Props for `ActionScriptDetails`. */
export interface ActionScriptDetailsProps {
  /** The plan version to show. */
  script: ActionScriptRecord;
  /** Its version number, counting the oldest as 1. */
  versionNumber: number;
  /** The version number of the version it was edited from; null for a generated version, or when that version is no longer listed. */
  editedFromVersionNumber: number | null;
  /** The version number of the version whose failed run it was refined from; null when it was not refined, or when that version is no longer listed. */
  refinedFromVersionNumber: number | null;
  /** The action as it is now, to tell whether this version is out of date. */
  currentAction: CurrentActionText;
  /** The live model list, for the model's display name (may be empty). */
  catalogModels: ScriptModelOption[];
  /** True while an edited plan is being saved as a new version. */
  isSavingEdit: boolean;
  /** Why the last save of an edited plan failed, or null. */
  saveEditErrorMessage: string | null;
  /** Called with the edited plan when the editor's "Save as new version" is clicked. */
  onSaveEdit: (plan: ActionPlan) => void;
}

/**
 * Names the version another one came from, for running text.
 * @param sourceVersionNumber - The source version's number, or null when it is no longer listed
 * @returns "Version 2", or "an earlier version" when the number is unknown
 */
function describeSourceVersion(sourceVersionNumber: number | null): string {
  const sourceVersionIsUnknown = sourceVersionNumber === null;
  return sourceVersionIsUnknown ? "an earlier version" : `Version ${String(sourceVersionNumber)}`;
}

/**
 * Describes where a version came from, for its caption, checked in this
 * order: the version it was edited from; the version it was refined from and
 * the model (and effort) that refined it; or the model (and effort) that
 * generated it.
 * @param script - The version
 * @param editedFromVersionNumber - The number of the version it was edited from, or null
 * @param refinedFromVersionNumber - The number of the version it was refined from, or null
 * @param catalogModels - The live model list
 * @returns e.g. "Generated 10/3/2026, 5:00 PM · Claude Opus 5.5 (claude-opus-5-5) · high effort" or "Refined 10/3/2026, 5:00 PM from Version 1 · Claude Opus 5.5 (claude-opus-5-5) · high effort"
 */
function describeVersionOrigin(
  script: ActionScriptRecord,
  editedFromVersionNumber: number | null,
  refinedFromVersionNumber: number | null,
  catalogModels: ScriptModelOption[],
): string {
  const createdAtText = new Date(script.createdAt).toLocaleString();
  const versionWasEdited = script.editedFromActionScriptId !== null;
  if (versionWasEdited) {
    return `Edited ${createdAtText} from ${describeSourceVersion(editedFromVersionNumber)}`;
  }
  const modelText =
    script.modelId === null ? "unknown model" : describeScriptModel(script.modelId, script.effort, catalogModels);
  const versionWasRefined = script.refinement !== null;
  if (versionWasRefined) {
    return `Refined ${createdAtText} from ${describeSourceVersion(refinedFromVersionNumber)} · ${modelText}`;
  }
  return `Generated ${createdAtText} · ${modelText}`;
}

/**
 * Describes what Claude was sent to refine a failed run: always the plan,
 * the error, and the step log, plus the failure screenshot when it was sent
 * and the failing page's snapshot when the run captured one (it is always
 * sent when there is one).
 * @param refinement - The version's refinement record
 * @returns e.g. "The plan, the error, and the step log, plus the failure screenshot and the failing page snapshot"
 */
function describeWhatClaudeWasSent(refinement: ActionScriptRefinementRecord): string {
  const alwaysSentText = "The plan, the error, and the step log";
  const extrasSent: string[] = [];
  if (refinement.screenshotWasSent) {
    extrasSent.push("the failure screenshot");
  }
  const failingPageSnapshotWasSent = refinement.actionScriptRun.failingPageAriaSnapshot !== null;
  if (failingPageSnapshotWasSent) {
    extrasSent.push("the failing page snapshot");
  }
  const noExtrasWereSent = extrasSent.length === 0;
  if (noExtrasWereSent) {
    return `${alwaysSentText} (no screenshot or failing page snapshot was available)`;
  }
  return `${alwaysSentText}, plus ${extrasSent.join(" and ")}`;
}

/**
 * Describes the tokens the refine call used, split the way they are billed.
 * @param refinement - The version's refinement record
 * @returns e.g. "1,234 input · 5,678 read from cache · 0 written to cache · 910 output"
 */
function describeRefinementTokenUsage(refinement: ActionScriptRefinementRecord): string {
  return [
    `${refinement.inputTokens.toLocaleString()} input`,
    `${refinement.cacheReadInputTokens.toLocaleString()} read from cache`,
    `${refinement.cacheCreationInputTokens.toLocaleString()} written to cache`,
    `${refinement.outputTokens.toLocaleString()} output`,
  ].join(" · ");
}

/** Props for `RefinedFromDetails`. */
interface RefinedFromDetailsProps {
  /** The refined version's refinement record. */
  refinement: ActionScriptRefinementRecord;
  /** The number of the version it was refined from, or null when that version is no longer listed. */
  refinedFromVersionNumber: number | null;
}

/**
 * The "Refined from" block of a refined version: the version whose run
 * failed, that run's outcome and error (read from the run itself), the note
 * the user gave Claude, what Claude was sent, and the tokens the refine used.
 * @param props - The refinement record and the source version's number
 * @returns The rendered block
 */
function RefinedFromDetails(props: RefinedFromDetailsProps): ReactElement {
  const { refinement, refinedFromVersionNumber } = props;
  const failedRun = refinement.actionScriptRun;
  const failedRunHasAnErrorMessage = failedRun.errorMessage !== null;
  const userGaveANote = refinement.note !== null;
  // A refinement is only ever made from a failed run, so it never "Passed".
  const failedRunOutcomeText = describeActionScriptRunOutcome({
    succeeded: false,
    timedOut: failedRun.timedOut,
    failedStepNumber: failedRun.failedStepNumber,
  });

  return (
    <>
      <Typography variant="subtitle2" component="h4">
        Refined from
      </Typography>
      <Box component="dl" sx={{ mt: 0.5, mb: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          Version
        </Typography>
        <Typography component="dd" sx={{ ml: 0, mb: 1 }}>
          {describeSourceVersion(refinedFromVersionNumber)}
        </Typography>
        <Typography component="dt" variant="body2" color="text.secondary">
          Failed run
        </Typography>
        <Typography component="dd" sx={{ ml: 0, mb: 1 }}>
          {failedRunOutcomeText}
        </Typography>
        {failedRunHasAnErrorMessage && (
          <>
            <Typography component="dt" variant="body2" color="text.secondary">
              Error
            </Typography>
            <Typography
              component="dd"
              sx={{ ml: 0, mb: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {failedRun.errorMessage}
            </Typography>
          </>
        )}
        {userGaveANote && (
          <>
            <Typography component="dt" variant="body2" color="text.secondary">
              Your note
            </Typography>
            <Typography
              component="dd"
              sx={{ ml: 0, mb: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {refinement.note}
            </Typography>
          </>
        )}
        <Typography component="dt" variant="body2" color="text.secondary">
          Sent to Claude
        </Typography>
        <Typography component="dd" sx={{ ml: 0, mb: 1 }}>
          {describeWhatClaudeWasSent(refinement)}
        </Typography>
        <Typography component="dt" variant="body2" color="text.secondary">
          Tokens used
        </Typography>
        <Typography component="dd" sx={{ ml: 0 }}>
          {describeRefinementTokenUsage(refinement)}
        </Typography>
      </Box>
    </>
  );
}

/**
 * One saved plan version in full: where it came from (the model that
 * generated it, the version and model it was refined from, or the version it
 * was edited from) and who the browser is logged in as; a warning when the
 * action's title, description, or credential has changed since (convert
 * again to update it); for a refined version, what it was "Refined from" (the
 * source version, the failed run's outcome and error, the user's note, what
 * Claude was sent, and the tokens the refine used); the title and
 * description it was generated from; Claude's summary and assumptions; the
 * steps; the crawled pages Claude was shown; and the plan's JSON.
 *
 * "Edit steps" swaps the step list for the step editor (`ActionPlanEditor`);
 * saving there creates a NEW version, which the page then selects - this
 * component is keyed by the version's id, so the new version starts with the
 * editor closed. Cancel closes the editor without saving.
 * @param props - The version, its numbers, the current action, the model list, and the edit callbacks
 * @returns The rendered version
 */
export default function ActionScriptDetails(props: ActionScriptDetailsProps): ReactElement {
  const {
    script,
    versionNumber,
    editedFromVersionNumber,
    refinedFromVersionNumber,
    currentAction,
    catalogModels,
    isSavingEdit,
    saveEditErrorMessage,
    onSaveEdit,
  } = props;
  const [isEditing, setIsEditing] = useState(false);
  // The page keeps the last save error until the next save starts, so the
  // editor only shows it once THIS editing session has tried to save - never a
  // stale error from an editor that was cancelled and opened again.
  const [saveWasAttemptedInThisEditor, setSaveWasAttemptedInThisEditor] = useState(false);
  const scriptHasAssumptions = script.assumptions.length > 0;
  const claudeWasShownPages = script.contextPageUrls.length > 0;
  const changedActionFields = findChangedActionFields(script, currentAction);
  const scriptIsOutOfDate = changedActionFields.length > 0;
  const { refinement } = script;
  const versionOriginText = describeVersionOrigin(
    script,
    editedFromVersionNumber,
    refinedFromVersionNumber,
    catalogModels,
  );
  const loginText =
    script.credentialName === null
      ? "Runs logged out"
      : `Logs in as "${script.credentialName}" first`;

  /** Opens the step editor, with no save attempted yet. */
  const handleEditClick = (): void => {
    setSaveWasAttemptedInThisEditor(false);
    setIsEditing(true);
  };

  /**
   * Hands the edited plan to the page, remembering that this editing session
   * tried to save (so a failure is shown in it).
   * @param plan - The edited plan
   */
  const handleEditSave = (plan: ActionPlan): void => {
    setSaveWasAttemptedInThisEditor(true);
    onSaveEdit(plan);
  };

  /** Closes the step editor without saving. */
  const handleEditCancel = (): void => {
    setIsEditing(false);
  };

  return (
    <Box>
      <Typography variant="subtitle1" component="h3">
        Version {versionNumber}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
        {versionOriginText} · {loginText}
      </Typography>

      {scriptIsOutOfDate && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Out of date</AlertTitle>
          This version was generated from a different{" "}
          {describeChangedActionFields(changedActionFields)} than the action has now. Convert again
          to get a plan for the current action.
        </Alert>
      )}

      {refinement !== null && (
        <RefinedFromDetails
          refinement={refinement}
          refinedFromVersionNumber={refinedFromVersionNumber}
        />
      )}

      <Typography variant="subtitle2" component="h4">
        Generated from
      </Typography>
      <Box component="dl" sx={{ mt: 0.5, mb: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          Title
        </Typography>
        <Typography component="dd" sx={{ ml: 0, mb: 1 }}>
          {script.actionTitle}
        </Typography>
        <Typography component="dt" variant="body2" color="text.secondary">
          Description
        </Typography>
        <Typography component="dd" sx={{ ml: 0, whiteSpace: "pre-wrap" }}>
          {script.actionDescription}
        </Typography>
      </Box>

      <Typography variant="subtitle2" component="h4">
        Summary
      </Typography>
      <Typography sx={{ mb: 2 }}>{script.summary}</Typography>

      <Typography variant="subtitle2" component="h4">
        Assumptions
      </Typography>
      {scriptHasAssumptions ? (
        <List dense disablePadding aria-label="Assumptions" sx={{ mb: 2 }}>
          {script.assumptions.map((assumption, assumptionIndex) => (
            <ListItem key={`${String(assumptionIndex)}-${assumption}`} disableGutters>
              <ListItemText primary={assumption} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          No assumptions recorded.
        </Typography>
      )}

      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="subtitle2" component="h4">
          Steps
        </Typography>
        {!isEditing && (
          <Button size="small" startIcon={<EditIcon />} onClick={handleEditClick}>
            Edit steps
          </Button>
        )}
      </Stack>
      <Box sx={{ mb: 2 }}>
        {isEditing ? (
          <ActionPlanEditor
            initialPlan={script.plan}
            isSaving={isSavingEdit}
            saveErrorMessage={saveWasAttemptedInThisEditor ? saveEditErrorMessage : null}
            onSave={handleEditSave}
            onCancel={handleEditCancel}
          />
        ) : (
          <ActionPlanSteps plan={script.plan} />
        )}
      </Box>

      <Typography variant="subtitle2" component="h4">
        Pages given to Claude
      </Typography>
      {claudeWasShownPages ? (
        <List dense disablePadding aria-label="Pages given to Claude" sx={{ mb: 2 }}>
          {script.contextPageUrls.map((pageUrl) => (
            <ListItem key={pageUrl} disableGutters>
              <ListItemText primary={pageUrl} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          None - the website had not been crawled. Crawl it, then convert again for a better plan.
        </Typography>
      )}

      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
        Plan JSON
      </Typography>
      <CodeBlock code={formatPlanJson(script.plan)} label="Plan JSON" />
    </Box>
  );
}
