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
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  actionScriptComparePath,
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
 * description, and timestamps with Edit and Delete buttons, then its scripts
 * and their runs.
 *
 * - The Model and Effort dropdowns list every model Anthropic offers (live)
 *   and the chosen model's own effort levels; they start on the server's
 *   default (Claude Opus 5.5 at high).
 * - "Convert to script" asks the server to have Claude turn the action into a
 *   Playwright script with that model and level; each conversion is saved as
 *   a new, immutable version, which becomes the selected one.
 * - The selected version (the newest unless the user picked another) shows
 *   its model, effort, an "Out of date" warning when the action's title or
 *   description changed since, its summary, assumptions, rule warnings, and
 *   code, followed by its runs. "Compare versions" opens two versions side by
 *   side.
 * - "Run script" runs the selected version (a browser window opens on this
 *   computer) and shows the recorded result.
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

  const { scripts, isLoading: scriptsAreLoading, errorMessage: scriptsErrorMessage, addCreatedScript } =
    useActionScripts(websiteId, actionId);
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
   * POSTs a run of the selected script and, when it is recorded, adds it to
   * the history and selects it. A failed RUN is still a recorded run; only a
   * failed REQUEST is shown from `runErrorMessage`.
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
            currentAction={action}
            comparePath={actionScriptComparePath(websiteId, actionId)}
            compareLinkState={returnToHereState}
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
            />
          )}
        </>
      )}
    </Container>
  );
}
