import { type ReactElement, type ReactNode, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ActionPlanEditor from "./ActionPlanEditor";
import ActionPlanSteps, { type HighlightedRunFields } from "./ActionPlanSteps";
import CodeBlock from "./CodeBlock";
import DisclosureRow from "./DisclosureRow";
import { type ActionScriptRecord } from "../hooks/useActionScripts";
import { type ScriptModelOption } from "../hooks/useScriptModels";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";
import { type ActionPlan, formatPlanJson } from "../utils/actionPlanSteps";
import { describeScriptModelBriefly } from "../utils/describeScriptModel";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";

const HEADING_ID = "action-script-details-heading";

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
  /** The live model list, for the model's display name (may be empty). */
  catalogModels: ScriptModelOption[];
  /** True while an edited plan is being saved as a new version. */
  isSavingEdit: boolean;
  /** Why the last save of an edited plan failed, or null. */
  saveEditErrorMessage: string | null;
  /** Called with the edited plan when the editor's "Save as new version" is clicked. */
  onSaveEdit: (plan: ActionPlan) => void;
  /** The run shown beside the steps, whose progress the steps are marked by; null for none. */
  highlightedRun: HighlightedRunFields | null;
  /** True for the phone layout (2c): a "Steps" heading, compact steps, and no caption or summary. */
  isPhoneLayout: boolean;
  /** Rows the phone layout lists before this version's own (its "Run history" and "Output log"); omit for none. */
  leadingDisclosures?: ReactNode;
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
 * @returns e.g. "Claude Opus 5.5 · high effort", "Edited from Version 2", or "Refined from Version 4 · Claude Opus 5.5 · high effort"
 */
function describeVersionOrigin(
  script: ActionScriptRecord,
  editedFromVersionNumber: number | null,
  refinedFromVersionNumber: number | null,
  catalogModels: ScriptModelOption[],
): string {
  const versionWasEdited = script.editedFromActionScriptId !== null;
  if (versionWasEdited) {
    return `Edited from ${describeSourceVersion(editedFromVersionNumber)}`;
  }
  const modelText =
    script.modelId === null
      ? "unknown model"
      : describeScriptModelBriefly(script.modelId, script.effort, catalogModels);
  const versionWasRefined = script.refinement !== null;
  if (versionWasRefined) {
    return `Refined from ${describeSourceVersion(refinedFromVersionNumber)} · ${modelText}`;
  }
  return modelText;
}

/**
 * One saved plan version, as the steps column of the mockup draws it:
 * "Version N" with "Edit steps", where it came from and how long ago, Claude's
 * summary, the steps (marked by the run shown beside them, see
 * `ActionPlanSteps`), and collapsed rows for the assumptions Claude made, the
 * crawled pages it was shown, and the plan's JSON. On a phone it is headed
 * "Steps", without the caption or summary, and the page's run rows come
 * first among the collapsed rows.
 *
 * "Edit steps" swaps the step list for the step editor (`ActionPlanEditor`);
 * saving there creates a NEW version, which the page then selects - this
 * component is keyed by the version's id, so the new version starts with the
 * editor closed. Cancel closes the editor without saving.
 * @param props - The version, its numbers, the model list, the edit callbacks, the run to mark by, and the layout
 * @returns The rendered version
 */
export default function ActionScriptDetails(props: ActionScriptDetailsProps): ReactElement {
  const {
    script,
    versionNumber,
    editedFromVersionNumber,
    refinedFromVersionNumber,
    catalogModels,
    isSavingEdit,
    saveEditErrorMessage,
    onSaveEdit,
    highlightedRun,
    isPhoneLayout,
    leadingDisclosures,
  } = props;
  const [isEditing, setIsEditing] = useState(false);
  // The page keeps the last save error until the next save starts, so the
  // editor only shows it once THIS editing session has tried to save - never a
  // stale error from an editor that was cancelled and opened again.
  const [saveWasAttemptedInThisEditor, setSaveWasAttemptedInThisEditor] = useState(false);
  const scriptHasAssumptions = script.assumptions.length > 0;
  const claudeWasShownPages = script.contextPageUrls.length > 0;
  const versionOriginText = describeVersionOrigin(
    script,
    editedFromVersionNumber,
    refinedFromVersionNumber,
    catalogModels,
  );

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
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "10px", mb: isPhoneLayout ? "6px" : "4px" }}>
        <Typography
          id={HEADING_ID}
          variant={isPhoneLayout ? "h5" : "h4"}
          component="h2"
          sx={{ m: 0, mr: "auto" }}
        >
          {isPhoneLayout ? "Steps" : `Version ${String(versionNumber)}`}
        </Typography>
        {!isEditing && (
          <Button
            onClick={handleEditClick}
            variant={isPhoneLayout ? "text" : "outlined"}
            color={isPhoneLayout ? "primary" : "secondary"}
            sx={{ minHeight: isPhoneLayout ? 40 : 36 }}
          >
            Edit steps
          </Button>
        )}
      </Box>

      {!isPhoneLayout && (
        <>
          <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400], mb: 2 }}>
            {versionOriginText} ·{" "}
            <span title={formatFullDateTime(script.createdAt)}>
              {formatRelativeTime(script.createdAt, new Date())}
            </span>
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: nocturneTokens.neutral[300], mb: "18px", maxWidth: 620 }}>
            {script.summary}
          </Typography>
        </>
      )}

      {isEditing ? (
        <ActionPlanEditor
          initialPlan={script.plan}
          isSaving={isSavingEdit}
          saveErrorMessage={saveWasAttemptedInThisEditor ? saveEditErrorMessage : null}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      ) : (
        <ActionPlanSteps plan={script.plan} highlightedRun={highlightedRun} isCompact={isPhoneLayout} />
      )}

      <Box sx={{ mt: "18px", display: "flex", flexDirection: "column" }}>
        {leadingDisclosures}
        <DisclosureRow label="Assumptions" detail={String(script.assumptions.length)}>
          {scriptHasAssumptions ? (
            <Box component="ul" aria-label="Assumptions" sx={{ m: 0, pl: "26px", fontSize: 13.5 }}>
              {script.assumptions.map((assumption, assumptionIndex) => (
                <li key={`${String(assumptionIndex)}-${assumption}`}>{assumption}</li>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
              No assumptions recorded.
            </Typography>
          )}
        </DisclosureRow>
        <DisclosureRow label="Pages given to Claude" detail={String(script.contextPageUrls.length)}>
          {claudeWasShownPages ? (
            <Box
              component="ul"
              aria-label="Pages given to Claude"
              sx={{
                m: 0,
                pl: "26px",
                fontFamily: MONOSPACE_FONT_FAMILY,
                fontSize: 12.5,
                lineHeight: 1.8,
                color: nocturneTokens.neutral[300],
                overflowWrap: "anywhere",
              }}
            >
              {script.contextPageUrls.map((pageUrl) => (
                <li key={pageUrl}>{pageUrl}</li>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
              None - the website had not been crawled. Crawl it, then convert again for a better plan.
            </Typography>
          )}
        </DisclosureRow>
        <DisclosureRow label="Plan JSON">
          <CodeBlock code={formatPlanJson(script.plan)} label="Plan JSON" />
        </DisclosureRow>
      </Box>
    </Box>
  );
}
