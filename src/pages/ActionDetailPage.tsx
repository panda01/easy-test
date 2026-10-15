import { type ReactElement, type ReactNode, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ActionScriptDetails from "../components/ActionScriptDetails";
import ActionScriptRunHistory from "../components/ActionScriptRunHistory";
import ActionScriptRunOutput, { describeOutputLineCount } from "../components/ActionScriptRunOutput";
import ActionScriptRunsSection from "../components/ActionScriptRunsSection";
import ActionScriptsSection from "../components/ActionScriptsSection";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import DisclosureRow from "../components/DisclosureRow";
import LoadStatusNotice from "../components/LoadStatusNotice";
import MoreActionsMenu from "../components/MoreActionsMenu";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import { type ActionScriptRunRecord, useActionScriptRuns } from "../hooks/useActionScriptRuns";
import { type ActionScriptRecord, useActionScripts } from "../hooks/useActionScripts";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { type ReturnState, useReturnToHereState } from "../hooks/useReturnNavigation";
import { type ScriptModelOption, useScriptModels } from "../hooks/useScriptModels";
import { type WebsiteItemDeletion, useWebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { type WebsiteItemRecord, useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { nocturneTokens } from "../theme/nocturneTheme";
import { type ActionPlan } from "../utils/actionPlanSteps";
import {
  WEBSITE_LIST_PATH,
  actionScriptComparePath,
  actionScriptEditsApiUrl,
  actionScriptRunRefinementsApiUrl,
  actionScriptRunsApiUrl,
  actionScriptsApiUrl,
  websiteDetailPath,
  websiteItemEditPath,
} from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** The query parameter naming the shown version by its number. */
const VERSION_QUERY_PARAMETER = "version";

/** The effort level a newly picked model starts on when it offers it. */
const PREFERRED_EFFORT = "high";

/** The model and effort level "Convert to script" sends. */
interface ScriptModelChoice {
  /** The model's id. */
  modelId: string;
  /** The effort level, or null for a model with no effort setting ("Standard"). */
  effort: string | null;
}

/**
 * Chooses the effort level to keep when the user switches model: the current
 * level when the new model offers it, otherwise `high` when offered,
 * otherwise the new model's highest level, otherwise null (no effort
 * setting). Mirrors the server's `chooseEffortForModel`; the client never
 * imports server code.
 * @param model - The newly picked model
 * @param currentEffort - The level picked before the switch, or null
 * @returns The level to use with the new model
 */
function chooseEffortForModel(model: ScriptModelOption, currentEffort: string | null): string | null {
  const currentEffortIsOffered = currentEffort !== null && model.effortLevels.includes(currentEffort);
  if (currentEffortIsOffered) {
    return currentEffort;
  }
  const preferredEffortIsOffered = model.effortLevels.includes(PREFERRED_EFFORT);
  if (preferredEffortIsOffered) {
    return PREFERRED_EFFORT;
  }
  return model.effortLevels.at(-1) ?? null;
}

/**
 * Finds the version number of a listed version by its id - the version
 * another one was edited or refined from.
 * @param scripts - Every version, newest first
 * @param scriptId - The source version's id, or null when there is no source
 * @returns Its version number, or null when there is no source or it is no longer listed
 */
function findVersionNumberOfScriptId(scripts: ActionScriptRecord[], scriptId: string | null): number | null {
  const thereIsNoSourceVersion = scriptId === null;
  if (thereIsNoSourceVersion) return null;
  const sourceIndex = scripts.findIndex((listedScript) => listedScript.id === scriptId);
  const sourceIsNoLongerListed = sourceIndex === -1;
  return sourceIsNoLongerListed ? null : scripts.length - sourceIndex;
}

/**
 * Finds the shown version's position in the newest-first list from the
 * `?version=` number: the version with that number when there is one,
 * otherwise the newest (an old link, or a number not yet loaded).
 * @param requestedVersionText - The `?version=` value, or null
 * @param versionCount - How many versions there are
 * @returns The index into the newest-first list (0 for the newest)
 */
function findShownVersionIndex(requestedVersionText: string | null, versionCount: number): number {
  const requestedVersionNumber = Number(requestedVersionText);
  const requestedVersionExists =
    Number.isInteger(requestedVersionNumber) &&
    requestedVersionNumber >= 1 &&
    requestedVersionNumber <= versionCount;
  return requestedVersionExists ? versionCount - requestedVersionNumber : 0;
}

/** Props for `ActionHeader`. */
interface ActionHeaderProps {
  /** The action. */
  action: WebsiteItemRecord;
  /** Where Edit goes. */
  editPath: string;
  /** History state for the Edit link. */
  editLinkState: ReturnState;
  /** The delete dialog's state and handlers (see `useWebsiteItemDeletion`). */
  deletion: WebsiteItemDeletion;
  /** True for the phone layout: a smaller title, no description, and Edit / Delete behind "⋯". */
  isPhoneLayout: boolean;
}

/**
 * The top of an action's page, as the mockups draw it: the title, then the
 * description and who the action runs as ("Runs as **Admin**." or "Runs
 * logged out."), with Edit and Delete beside it - behind a "⋯" menu on a
 * phone, where the description is left out - and the delete confirmation
 * dialog.
 * @param props - The action, the edit link, the delete wiring, and the layout
 * @returns The rendered header
 */
function ActionHeader(props: ActionHeaderProps): ReactElement {
  const { action, editPath, editLinkState, deletion, isPhoneLayout } = props;
  const credentialName = action.credential?.name ?? null;
  const runsAsText: ReactNode =
    credentialName === null ? (
      "Runs logged out."
    ) : (
      <>
        Runs as{" "}
        <Box component="span" sx={{ color: "text.primary" }}>
          {credentialName}
        </Box>
        .
      </>
    );

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        mt: isPhoneLayout ? "6px" : 0,
        mb: isPhoneLayout ? 2 : 3,
      }}
    >
      <Box sx={{ mr: "auto", minWidth: 0 }}>
        <Typography variant={isPhoneLayout ? "h3" : "h2"} component="h1" sx={{ mb: isPhoneLayout ? "4px" : "6px" }}>
          {action.title}
        </Typography>
        <Typography sx={{ fontSize: isPhoneLayout ? 13 : 13.5, color: nocturneTokens.neutral[400], whiteSpace: "pre-wrap" }}>
          {!isPhoneLayout && `${action.description} `}
          {runsAsText}
        </Typography>
      </Box>
      {isPhoneLayout ? (
        <MoreActionsMenu editPath={editPath} editLinkState={editLinkState} onDeleteClick={deletion.openDeleteDialog} />
      ) : (
        <>
          <Button component={RouterLink} to={editPath} state={editLinkState} variant="outlined" color="secondary">
            Edit
          </Button>
          <Button onClick={deletion.openDeleteDialog} variant="outlined" color="secondary">
            Delete
          </Button>
        </>
      )}
      <ConfirmDeleteDialog
        isOpen={deletion.deleteDialogIsOpen}
        title={`Delete ${ACTION_KIND.singularLabel}?`}
        message={`"${action.title}" will be deleted.`}
        isDeleting={deletion.isDeleting}
        errorMessage={deletion.deleteErrorMessage}
        onCancel={deletion.closeDeleteDialog}
        onConfirm={deletion.confirmDelete}
      />
    </Box>
  );
}

/**
 * An action's own page (`/websites/:websiteId/actions/:itemId`), laid out as
 * the mockups do. On a wide window (1200 px and up) it has three columns:
 * - Versions: every saved version with its run status, whether it is out of
 *   date, and where it came from, plus the Model and Effort dropdowns and
 *   "Convert to new version" (Claude turns the action into a JSON step plan
 *   with that model; each conversion is saved as a new, immutable version,
 *   which becomes the shown one). The dropdowns list every model Anthropic
 *   offers (live) and start on the server's default (Claude Opus 5.5 at
 *   high).
 * - The shown version: where it came from, Claude's summary, its steps
 *   (marked by the run shown beside them: reached, failed here, not
 *   reached), and its assumptions, the pages Claude was shown, and its JSON.
 *   "Edit steps" opens the step editor; saving there creates a NEW version,
 *   which becomes the shown one. "Compare" opens two versions side by side.
 * - The latest run: "Run again" runs the shown version (a browser window
 *   opens on this computer and logs in first when the action has a
 *   credential), then its outcome, failure screenshot, "Refine with Claude",
 *   output log, and the version's other runs to pick from. Refine asks the
 *   model that wrote the version to fix the plan from the run's error,
 *   failure screenshot, and failing page, saving the result as a new
 *   version, which becomes the shown one. Versions saved from the step editor
 *   have no model, so their runs cannot be refined.
 *
 * Narrower (the phone layout, 2c), it is one column: a Version dropdown, the
 * latest run card (with "Run again" and "Refine" side by side), the steps,
 * then collapsed rows for the run history, the output log, and the rest.
 *
 * The shown version lives in the query string (`?version=5`, replaced rather
 * than pushed), so it survives a reload; without one, the newest is shown.
 * The page owns every request; the sections only take props. The owning
 * website is fetched only for the breadcrumb; the action request alone
 * decides loading / not-found.
 * @returns The rendered action detail page
 */
export default function ActionDetailPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const actionId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const actionResource = useWebsiteItem(ACTION_KIND, websiteId, actionId);
  const website = websiteResource.data;
  const action = actionResource.data;
  const isPhoneLayout = useIsNarrowerThan("lg");
  const [searchParams, setSearchParams] = useSearchParams();

  const returnToHereState = useReturnToHereState();
  const deletion = useWebsiteItemDeletion(ACTION_KIND, websiteId, actionId);

  const {
    scripts,
    isLoading: scriptsAreLoading,
    errorMessage: scriptsErrorMessage,
    addCreatedScript,
    recordFinishedRun,
  } = useActionScripts(websiteId, actionId);
  const selectedScriptIndex = findShownVersionIndex(searchParams.get(VERSION_QUERY_PARAMETER), scripts.length);
  const selectedScript = scripts.at(selectedScriptIndex) ?? null;
  const selectedScriptVersionNumber = scripts.length - selectedScriptIndex;
  const nextVersionNumber = scripts.length + 1;

  /**
   * Shows the version with the given number, replacing the query string
   * entry so version switches do not pile up in history.
   * @param versionNumber - The version's number, counting the oldest as 1
   */
  const showVersionNumber = (versionNumber: number): void => {
    setSearchParams({ [VERSION_QUERY_PARAMETER]: String(versionNumber) }, { replace: true });
  };

  /**
   * Shows the picked version.
   * @param actionScriptId - The picked version's id
   */
  const handleSelectScript = (actionScriptId: string): void => {
    const pickedIndex = scripts.findIndex((script) => script.id === actionScriptId);
    if (pickedIndex === -1) return;
    showVersionNumber(scripts.length - pickedIndex);
  };

  /**
   * Adds a version a request just saved and shows it. It is the newest, so
   * its number is one more than the count before it was added.
   * @param createdScript - The saved version
   */
  const addAndShowCreatedScript = (createdScript: ActionScriptRecord): void => {
    addCreatedScript(createdScript);
    showVersionNumber(nextVersionNumber);
  };

  const scriptModelsResource = useScriptModels();
  const scriptModelCatalog = scriptModelsResource.data;
  const catalogModels = scriptModelCatalog?.models ?? [];
  const [pickedModelChoice, setPickedModelChoice] = useState<ScriptModelChoice | null>(null);
  const defaultModelId = scriptModelCatalog?.defaultModelId ?? null;
  const defaultModelChoice: ScriptModelChoice | null =
    defaultModelId === null
      ? null
      : { modelId: defaultModelId, effort: scriptModelCatalog?.defaultEffort ?? null };
  const modelChoice = pickedModelChoice ?? defaultModelChoice;

  /**
   * Switches to another model, keeping the effort level when it offers it.
   * @param modelId - The picked model's id
   */
  const handleModelChange = (modelId: string): void => {
    const pickedModel = catalogModels.find((catalogModel) => catalogModel.id === modelId);
    if (pickedModel === undefined) return;
    setPickedModelChoice({
      modelId,
      effort: chooseEffortForModel(pickedModel, modelChoice?.effort ?? null),
    });
  };

  /**
   * Switches the effort level, keeping the model.
   * @param effort - The picked effort level
   */
  const handleEffortChange = (effort: string): void => {
    if (modelChoice === null) return;
    setPickedModelChoice({ modelId: modelChoice.modelId, effort });
  };

  const { runs, isLoading: runsAreLoading, errorMessage: runsErrorMessage, addFinishedRun } =
    useActionScriptRuns(websiteId, actionId, selectedScript?.id ?? null);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  const selectedRun = runs.find((run) => run.id === pickedRunId) ?? runs.at(0) ?? null;

  const {
    sendJsonRequest: sendConvertRequest,
    isSubmitting: conversionIsInFlight,
    errorMessage: convertErrorMessage,
  } = useJsonMutation();
  const {
    sendJsonRequest: sendRunRequest,
    isSubmitting: runIsInFlight,
    errorMessage: runErrorMessage,
  } = useJsonMutation();
  const {
    sendJsonRequest: sendEditRequest,
    isSubmitting: editSaveIsInFlight,
    errorMessage: saveEditErrorMessage,
  } = useJsonMutation();
  const {
    sendJsonRequest: sendRefineRequest,
    isSubmitting: refineIsInFlight,
    errorMessage: refineErrorMessage,
  } = useJsonMutation();

  /**
   * POSTs a conversion with the chosen model and effort level and, when it
   * succeeds, adds the new version to the list and shows it. A failure is
   * shown by the versions column from `convertErrorMessage`.
   * @returns Resolves once the request is done
   */
  const convertToScript = async (): Promise<void> => {
    if (modelChoice === null) return;
    const result = await sendConvertRequest(
      "POST",
      actionScriptsApiUrl(websiteId, actionId),
      modelChoice,
    );
    if (!result.succeeded) return;
    // The API is the contract for this shape; see useJsonResource.
    addAndShowCreatedScript(result.data as ActionScriptRecord);
  };

  /** Starts a conversion without returning its promise (the button expects a void callback). */
  const handleConvertClick = (): void => {
    void convertToScript();
  };

  /**
   * POSTs an edited plan as a new version of the action and, when it is
   * saved, adds it to the list and shows it (which closes the editor). A
   * failure is shown in the editor from `saveEditErrorMessage`.
   * @param sourceScript - The version that was edited
   * @param plan - The edited plan
   * @returns Resolves once the request is done
   */
  const saveEditedPlan = async (sourceScript: ActionScriptRecord, plan: ActionPlan): Promise<void> => {
    const result = await sendEditRequest(
      "POST",
      actionScriptEditsApiUrl(websiteId, actionId, sourceScript.id),
      { plan },
    );
    if (!result.succeeded) return;
    addAndShowCreatedScript(result.data as ActionScriptRecord);
  };

  /**
   * Starts saving the shown version's edited plan without returning its
   * promise (the editor expects a void callback).
   * @param plan - The edited plan
   */
  const handleSaveEdit = (plan: ActionPlan): void => {
    if (selectedScript === null) return;
    void saveEditedPlan(selectedScript, plan);
  };

  /**
   * POSTs a refine of a failed run - Claude (the model that wrote the run's
   * version) fixes the plan from the run's error, screenshot, and failing
   * page - and, when the new version is saved, adds it to the list and shows
   * it. A failure is shown in the run's details from `refineErrorMessage`.
   * @param failedRun - The failed run to refine
   * @param note - The user's note for Claude, or null when they gave none
   * @returns Resolves once the request is done
   */
  const refineFailedRun = async (failedRun: ActionScriptRunRecord, note: string | null): Promise<void> => {
    const result = await sendRefineRequest(
      "POST",
      actionScriptRunRefinementsApiUrl(websiteId, actionId, failedRun.actionScriptId, failedRun.id),
      { note },
    );
    if (!result.succeeded) return;
    addAndShowCreatedScript(result.data as ActionScriptRecord);
  };

  /**
   * Starts a refine without returning its promise (the run details expect a void callback).
   * @param failedRun - The failed run to refine
   * @param note - The user's note for Claude, or null when they gave none
   */
  const handleRefine = (failedRun: ActionScriptRunRecord, note: string | null): void => {
    void refineFailedRun(failedRun, note);
  };

  // A version saved from the step editor has no model to refine it with.
  const versionCanBeRefined = selectedScript !== null && selectedScript.modelId !== null;

  /**
   * POSTs a run of the shown script and, when it is recorded, adds it to the
   * history, shows it, and makes it the version's latest run (so the
   * version's status icon updates at once). A failed RUN is still a recorded
   * run; only a failed REQUEST is shown from `runErrorMessage`.
   * @returns Resolves once the request is done
   */
  const runSelectedScript = async (): Promise<void> => {
    const thereIsNoScriptToRun = selectedScript === null;
    if (thereIsNoScriptToRun) return;
    const result = await sendRunRequest(
      "POST",
      actionScriptRunsApiUrl(websiteId, actionId, selectedScript.id),
    );
    if (!result.succeeded) return;
    const finishedRun = result.data as ActionScriptRunRecord;
    addFinishedRun(finishedRun);
    recordFinishedRun(finishedRun);
    setPickedRunId(finishedRun.id);
  };

  /** Starts a run without returning its promise (the button expects a void callback). */
  const handleRunClick = (): void => {
    void runSelectedScript();
  };

  const breadcrumbs = (
    <PageBreadcrumbs
      crumbs={[
        { label: "Websites", to: WEBSITE_LIST_PATH },
        { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
        { label: action?.title ?? ACTION_KIND.singularTitle },
      ]}
    />
  );

  if (action === null) {
    return (
      <PageContainer>
        {breadcrumbs}
        <LoadStatusNotice
          isLoading={actionResource.isLoading}
          errorMessage={actionResource.errorMessage}
          loadingLabel={`Loading ${ACTION_KIND.singularLabel}`}
        />
      </PageContainer>
    );
  }

  const versionsColumn = (
    <ActionScriptsSection
      scripts={scripts}
      isLoading={scriptsAreLoading}
      errorMessage={scriptsErrorMessage}
      selectedScriptId={selectedScript?.id ?? null}
      onSelectScript={handleSelectScript}
      isConverting={conversionIsInFlight}
      convertErrorMessage={convertErrorMessage}
      onConvertClick={handleConvertClick}
      canConvert={modelChoice !== null}
      modelPicker={{
        models: catalogModels,
        selectedModelId: modelChoice?.modelId ?? null,
        selectedEffort: modelChoice?.effort ?? null,
        isLoading: scriptModelsResource.isLoading,
        errorMessage: scriptModelsResource.errorMessage,
        isDisabled: conversionIsInFlight,
        onModelChange: handleModelChange,
        onEffortChange: handleEffortChange,
      }}
      currentAction={{
        title: action.title,
        description: action.description,
        credentialId: action.credentialId ?? null,
      }}
      comparePath={actionScriptComparePath(websiteId, actionId)}
      compareLinkState={returnToHereState}
      isPhoneLayout={isPhoneLayout}
    />
  );

  const runPanel = selectedScript !== null && (
    <ActionScriptRunsSection
      websiteId={websiteId}
      versionNumber={selectedScriptVersionNumber}
      runs={runs}
      isLoading={runsAreLoading}
      errorMessage={runsErrorMessage}
      selectedRun={selectedRun}
      onSelectRun={setPickedRunId}
      isRunning={runIsInFlight}
      runErrorMessage={runErrorMessage}
      onRunClick={handleRunClick}
      versionCanBeRefined={versionCanBeRefined}
      isRefining={refineIsInFlight}
      refineErrorMessage={refineErrorMessage}
      onRefine={handleRefine}
      nextVersionNumber={nextVersionNumber}
      isPhoneLayout={isPhoneLayout}
    />
  );

  // The phone layout lists the run history and the output log among the
  // steps' collapsed rows, since its run card has no room for them.
  const phoneRunDisclosures = isPhoneLayout && runs.length > 0 && (
    <>
      <DisclosureRow label="Run history" detail={String(runs.length)}>
        <ActionScriptRunHistory
          runs={runs}
          selectedRunId={selectedRun?.id ?? null}
          onSelectRun={setPickedRunId}
          label={`Runs of version ${String(selectedScriptVersionNumber)}`}
        />
      </DisclosureRow>
      {selectedRun !== null && (
        <DisclosureRow label="Output log" detail={describeOutputLineCount(selectedRun.output)}>
          <ActionScriptRunOutput run={selectedRun} />
        </DisclosureRow>
      )}
    </>
  );

  const stepsColumn =
    selectedScript === null ? (
      <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
        {scriptsAreLoading ? "" : "Convert this action to create its first version."}
      </Typography>
    ) : (
      <ActionScriptDetails
        // Keyed by version, so showing (or saving) another version closes the editor.
        key={selectedScript.id}
        script={selectedScript}
        versionNumber={selectedScriptVersionNumber}
        editedFromVersionNumber={findVersionNumberOfScriptId(scripts, selectedScript.editedFromActionScriptId)}
        refinedFromVersionNumber={findVersionNumberOfScriptId(
          scripts,
          selectedScript.refinement?.sourceActionScriptId ?? null,
        )}
        catalogModels={catalogModels}
        isSavingEdit={editSaveIsInFlight}
        saveEditErrorMessage={saveEditErrorMessage}
        onSaveEdit={handleSaveEdit}
        highlightedRun={selectedRun}
        isPhoneLayout={isPhoneLayout}
        leadingDisclosures={phoneRunDisclosures}
      />
    );

  return (
    <PageContainer>
      {breadcrumbs}
      <ActionHeader
        action={action}
        editPath={websiteItemEditPath(ACTION_KIND, websiteId, actionId)}
        editLinkState={returnToHereState}
        deletion={deletion}
        isPhoneLayout={isPhoneLayout}
      />

      {isPhoneLayout ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {versionsColumn}
          {runPanel}
          {stepsColumn}
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "250px minmax(0,1fr) 440px",
            gap: 3,
            alignItems: "start",
          }}
        >
          {versionsColumn}
          <Box sx={{ minWidth: 0 }}>{stepsColumn}</Box>
          {runPanel}
        </Box>
      )}
    </PageContainer>
  );
}
