import { type ReactElement, useState } from "react";
import Container from "@mui/material/Container";
import ActionScriptRunsSection from "../components/ActionScriptRunsSection";
import ActionScriptsSection from "../components/ActionScriptsSection";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import WebsiteItemSummary from "../components/WebsiteItemSummary";
import { type ActionScriptRunRecord, useActionScriptRuns } from "../hooks/useActionScriptRuns";
import { type ActionScriptRecord, useActionScripts } from "../hooks/useActionScripts";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnToHereState } from "../hooks/useReturnNavigation";
import { type ScriptModelOption, useScriptModels } from "../hooks/useScriptModels";
import { type ActionPlan } from "../utils/actionPlanSteps";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  actionScriptComparePath,
  actionScriptEditsApiUrl,
  actionScriptRunRefinementsApiUrl,
  actionScriptRunsApiUrl,
  actionScriptsApiUrl,
  websiteDetailPath,
} from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

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
 * An action's own page (`/websites/:websiteId/actions/:itemId`): its title,
 * description, who it runs as, and timestamps with Edit and Delete buttons,
 * then its plan versions and their runs.
 *
 * - The Model and Effort dropdowns list every model Anthropic offers (live)
 *   and the chosen model's own effort levels; they start on the server's
 *   default (Claude Opus 5.5 at high).
 * - "Convert to script" asks the server to have Claude turn the action into a
 *   JSON step plan with that model and level; each conversion is saved as a
 *   new, immutable version, which becomes the selected one.
 * - The selected version (the newest unless the user picked another) shows
 *   where it came from, an "Out of date" warning when the action's title,
 *   description, or credential changed since, its summary, assumptions,
 *   steps, the pages Claude was shown, and its JSON, followed by its runs.
 *   "Edit steps" opens the step editor; saving there creates a NEW version,
 *   which becomes the selected one. "Compare versions" opens two versions
 *   side by side.
 * - "Run script" runs the selected version (a browser window opens on this
 *   computer and logs in first when the action has a credential) and shows
 *   the recorded result.
 * - A failed run of a version Claude wrote shows "Refine" (with an optional
 *   note): the model that wrote the version fixes the plan from the run's
 *   error, failure screenshot, and failing page, and the result is saved as
 *   a new version, which becomes the selected one. Versions saved from the
 *   step editor have no model, so their runs cannot be refined.
 *
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

  const returnToHereState = useReturnToHereState();
  const deletion = useWebsiteItemDeletion(ACTION_KIND, websiteId, actionId);

  const {
    scripts,
    isLoading: scriptsAreLoading,
    errorMessage: scriptsErrorMessage,
    addCreatedScript,
    recordFinishedRun,
  } = useActionScripts(websiteId, actionId);
  const [pickedScriptId, setPickedScriptId] = useState<string | null>(null);
  const selectedScriptIndex = Math.max(
    scripts.findIndex((script) => script.id === pickedScriptId),
    0,
  );
  const selectedScript = scripts.at(selectedScriptIndex) ?? null;
  const selectedScriptVersionNumber = scripts.length - selectedScriptIndex;

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
   * succeeds, adds the new version to the list and selects it. A failure is
   * shown by the section from `convertErrorMessage`.
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
    const createdScript = result.data as ActionScriptRecord;
    addCreatedScript(createdScript);
    setPickedScriptId(createdScript.id);
  };

  /** Starts a conversion without returning its promise (the button expects a void callback). */
  const handleConvertClick = (): void => {
    void convertToScript();
  };

  /**
   * POSTs an edited plan as a new version of the action and, when it is
   * saved, adds it to the list and selects it (which closes the editor). A
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
    const createdScript = result.data as ActionScriptRecord;
    addCreatedScript(createdScript);
    setPickedScriptId(createdScript.id);
  };

  /**
   * Starts saving an edited plan without returning its promise (the editor expects a void callback).
   * @param sourceScript - The version that was edited
   * @param plan - The edited plan
   */
  const handleSaveEdit = (sourceScript: ActionScriptRecord, plan: ActionPlan): void => {
    void saveEditedPlan(sourceScript, plan);
  };

  /**
   * POSTs a refine of a failed run - Claude (the model that wrote the run's
   * version) fixes the plan from the run's error, screenshot, and failing
   * page - and, when the new version is saved, adds it to the list and
   * selects it. A failure is shown in the run's details from
   * `refineErrorMessage`.
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
    const createdScript = result.data as ActionScriptRecord;
    addCreatedScript(createdScript);
    setPickedScriptId(createdScript.id);
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

  const credentialName = action?.credential?.name ?? null;
  const loginDetailText =
    credentialName === null
      ? "Runs as: logged out (no credential)"
      : `Runs as: "${credentialName}" (logs in first)`;

  /**
   * POSTs a run of the selected script and, when it is recorded, adds it to
   * the history, selects it, and makes it the version's latest run (so the
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

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: action?.title ?? ACTION_KIND.singularTitle },
        ]}
      />

      <LoadStatusNotice
        isLoading={actionResource.isLoading}
        errorMessage={actionResource.errorMessage}
        loadingLabel={`Loading ${ACTION_KIND.singularLabel}`}
      />

      {action !== null && (
        <>
          <WebsiteItemSummary
            itemKind={ACTION_KIND}
            websiteId={websiteId}
            item={action}
            editLinkState={returnToHereState}
            deletion={deletion}
            detailText={loginDetailText}
          />

          <ActionScriptsSection
            scripts={scripts}
            isLoading={scriptsAreLoading}
            errorMessage={scriptsErrorMessage}
            selectedScriptId={selectedScript?.id ?? null}
            onSelectScript={setPickedScriptId}
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
            isSavingEdit={editSaveIsInFlight}
            saveEditErrorMessage={saveEditErrorMessage}
            onSaveEdit={handleSaveEdit}
          />

          {selectedScript !== null && (
            <ActionScriptRunsSection
              websiteId={websiteId}
              versionNumber={selectedScriptVersionNumber}
              runs={runs}
              isLoading={runsAreLoading}
              errorMessage={runsErrorMessage}
              selectedRunId={pickedRunId}
              onSelectRun={setPickedRunId}
              isRunning={runIsInFlight}
              runErrorMessage={runErrorMessage}
              onRunClick={handleRunClick}
              credentialName={credentialName}
              versionCanBeRefined={versionCanBeRefined}
              isRefining={refineIsInFlight}
              refineErrorMessage={refineErrorMessage}
              onRefine={handleRefine}
            />
          )}
        </>
      )}
    </Container>
  );
}
