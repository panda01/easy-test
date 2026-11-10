import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import ActionScriptDetails from "../components/ActionScriptDetails";
import ActionScriptParameters from "../components/ActionScriptParameters";
import ActionScriptRunHistory from "../components/ActionScriptRunHistory";
import ActionScriptRunOutput, { describeOutputLineCount } from "../components/ActionScriptRunOutput";
import ActionScriptRunsSection from "../components/ActionScriptRunsSection";
import ActionScriptsSection from "../components/ActionScriptsSection";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import DisclosureRow from "../components/DisclosureRow";
import LoadStatusNotice from "../components/LoadStatusNotice";
import LoginActionSection from "../components/LoginActionSection";
import MoreActionsMenu from "../components/MoreActionsMenu";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import { useActionParameters } from "../hooks/useActionParameters";
import { type ActionScriptRunRecord, useActionScriptRuns } from "../hooks/useActionScriptRuns";
import { type ActionScriptRecord, useActionScripts } from "../hooks/useActionScripts";
import { type AutoRefineJobRecord, useAutoRefineJob } from "../hooks/useAutoRefineJob";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useLoginChoices } from "../hooks/useLoginChoices";
import { useLoginRuns } from "../hooks/useLoginRuns";
import { useNow } from "../hooks/useNow";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { type ReturnState, useReturnToHereState } from "../hooks/useReturnNavigation";
import { type ScriptModelOption, useScriptModels } from "../hooks/useScriptModels";
import { type WebsiteItemDeletion, useWebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { useWebObjects } from "../hooks/useWebObjects";
import { type WebsiteItemRecord, useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { nocturneTokens } from "../theme/nocturneTheme";
import { describeObjectRole } from "../utils/actionObjectRole";
import {
  type NewParameterRequestBody,
  type ParameterChoicesRequestBody,
  type ParameterValues,
  type VersionParametersRecord,
  buildInheritedRunValues,
  buildStepParameterTags,
  listChangedParameterValues,
  listParametersToFix,
} from "../utils/actionParameters";
import { type ActionPlan } from "../utils/actionPlanSteps";
import { findVersionNumberOfScriptId } from "../utils/findVersionNumberOfScriptId";
import { isLoginActionRecord } from "../utils/describeActionLogin";
import { type LoginActionOption } from "../components/TitleDescriptionForm";
import {
  WEBSITE_LIST_PATH,
  actionParameterApiUrl,
  actionScriptComparePath,
  actionScriptParametersApiUrl,
  actionScriptEditsApiUrl,
  actionScriptRunRefinementsApiUrl,
  actionScriptRunsApiUrl,
  actionScriptsApiUrl,
  autoRefineJobStopApiUrl,
  autoRefineJobsApiUrl,
  loginRunsApiUrl,
  newDeleteActionPath,
  websiteDetailPath,
  websiteItemApiUrl,
  websiteItemDetailPath,
  websiteItemEditPath,
} from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** The query parameter naming the shown version by its number. */
const VERSION_QUERY_PARAMETER = "version";

/** The query parameter naming the shown version by its id (a link from another action's run, which knows no number); wins over `version`. */
const SCRIPT_QUERY_PARAMETER = "script";

/** The query parameter naming the run to show first, by its id (a link from the Create run a cleanup run belongs to). */
const RUN_QUERY_PARAMETER = "run";

/** The effort level a newly picked model starts on when it offers it. */
const PREFERRED_EFFORT = "high";

/** The message under "Auto-refine" for a version saved from the step editor, which no model wrote. */
const EDITED_VERSION_CANNOT_BE_AUTO_REFINED_REASON = "Saved from the step editor, so Claude cannot refine it";

/** What "Convert to script" answers: the new version, plus - for a Create action - what happened to its delete action. */
type ConversionResponse = ActionScriptRecord & {
  /** The delete action's first version, converted in the same request, or null when none was made. */
  deleteActionScript?: ActionScriptRecord | null;
  /** Why the delete action could not be converted, or null. */
  deleteActionConversionError?: string | null;
};

/**
 * Words what a conversion did about the action's delete action, for a note
 * under the header, or null when there is nothing to say (not a Create action,
 * or its delete action already had a version).
 * @param conversion - The conversion response
 * @returns The note, or null
 */
function describeDeleteActionConversion(conversion: ConversionResponse): string | null {
  const deleteActionWasConverted = (conversion.deleteActionScript ?? null) !== null;
  if (deleteActionWasConverted) {
    return "Its delete action was converted too, so the first run can clean up after itself.";
  }
  const conversionError = conversion.deleteActionConversionError ?? null;
  if (conversionError !== null) {
    return `Its delete action could not be converted: ${conversionError}. Convert it from its own page before running.`;
  }
  return null;
}

/**
 * The run form's values, remembered with the version they were typed for, so
 * values typed for one version never carry over to another.
 */
interface RunFormState {
  /** The version the values belong to, or null before anything was typed. */
  scriptId: string | null;
  /** The typed or picked values, by parameter key. */
  values: ParameterValues;
  /** Whether the next run of a Create action cleans up afterwards (on by default). */
  cleanUpAfterwards: boolean;
}

/**
 * What the page last saw of the watched auto-refine job, to notice what the
 * next poll adds: a version, a run, or the job's end.
 */
interface SeenJobProgress {
  jobId: string;
  createdScriptCount: number;
  runCount: number;
  wasRunning: boolean;
}

/**
 * Reads the counts the page compares each polled job against.
 * @param job - The polled job
 * @returns Its id, how many versions and runs it has made, and whether it is running
 */
function readJobProgress(job: AutoRefineJobRecord): SeenJobProgress {
  return {
    jobId: job.id,
    createdScriptCount: job.createdActionScriptIds.length,
    runCount: job.actionScriptRunIds.length,
    wasRunning: job.status === "running",
  };
}

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
  /** What the action does with an object, in one line ("Reads a Project (detected, High)"), or null for none. */
  objectRoleLine: string | null;
  /** True when the action's kind is Create, so it needs a Delete action to clean up after it. */
  isCreateAction: boolean;
  /** The owning website's cuid, for the links to the other actions. */
  websiteId: string;
  /** The website's login page and Login action, for how the action logs in. */
  loginContext: ActionLoginContext;
}

/**
 * The cleanup links under an action's role line: for a Create action, the
 * Delete action that cleans up after it (or a warning with "Add its delete
 * action" when it has none - its runs fail until then); for a Delete action,
 * the Create actions it cleans up after.
 * @param props - The action, whether it is a Create action, and the website for the links
 * @returns The links, the warning, or null when there is nothing to show
 */
function ActionCleanupLinks(props: Pick<ActionHeaderProps, "action" | "isCreateAction" | "websiteId">): ReactElement | null {
  const { action, isCreateAction, websiteId } = props;
  const deleteAction = action.deleteAction ?? null;
  const createActions = action.createActions ?? [];
  const createActionHasNoDeleteAction = isCreateAction && deleteAction === null;
  if (createActionHasNoDeleteAction) {
    return (
      <Alert
        severity="warning"
        sx={{ mt: 1 }}
        action={
          <Button component={RouterLink} to={newDeleteActionPath(websiteId, action.id)} color="inherit" size="small">
            Add its delete action
          </Button>
        }
      >
        Runs fail until this action has a delete action to clean up what it makes.
      </Alert>
    );
  }
  const thereIsNothingToLink = deleteAction === null && createActions.length === 0;
  if (thereIsNothingToLink) return null;
  return (
    <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[300], mt: "4px" }}>
      {deleteAction !== null && (
        <>
          Cleaned up by{" "}
          <Link component={RouterLink} to={websiteItemDetailPath(ACTION_KIND, websiteId, deleteAction.id)}>
            {deleteAction.title}
          </Link>
        </>
      )}
      {createActions.length > 0 && (
        <>
          Cleans up after{" "}
          {createActions.map((createAction, index) => (
            <span key={createAction.id}>
              {index > 0 && ", "}
              <Link component={RouterLink} to={websiteItemDetailPath(ACTION_KIND, websiteId, createAction.id)}>
                {createAction.title}
              </Link>
            </span>
          ))}
        </>
      )}
    </Typography>
  );
}

/** What the header needs to say how an action logs in, beyond the action itself. */
interface ActionLoginContext {
  /** The website's default login page, or null. */
  websiteLoginUrl: string | null;
  /** The website's Login action, null when it has none, or undefined while the action list loads. */
  websiteLoginAction: LoginActionOption | null | undefined;
}

/**
 * Says how an action logs in, for its page's header:
 * - the Login action: where it logs in ("Logs in at **https://…/login**.");
 * - any other action: as its credential, with the website's Login action
 *   ("Logs in as **Admin** with **Log in**."), with a warning when the
 *   website has no Login action, or not at all ("Runs logged out.").
 * @param action - The action, with its credential
 * @param context - The website's login page and Login action
 * @returns The sentence, with the names emphasised
 */
function describeActionLoginLine(action: WebsiteItemRecord, context: ActionLoginContext): ReactNode {
  /**
   * Emphasises one name in the sentence.
   * @param name - The credential's name or the Login action's title
   * @returns The name, in the primary text color
   */
  const emphasise = (name: string): ReactNode => (
    <Box component="span" sx={{ color: "text.primary" }}>
      {name}
    </Box>
  );
  if (isLoginActionRecord(action)) {
    const loginPage = action.loginUrl ?? context.websiteLoginUrl;
    return loginPage === null ? (
      "Has no login page yet - edit it to add one. Logs in as whichever credential an action or crawl picks."
    ) : (
      <>Logs in at {emphasise(loginPage)}, as whichever credential an action or crawl picks.</>
    );
  }
  const credentialName = action.credential?.name ?? null;
  if (credentialName === null) {
    return "Runs logged out.";
  }
  const websiteLoginAction = context.websiteLoginAction;
  if (websiteLoginAction === undefined) {
    return <>Logs in as {emphasise(credentialName)}.</>;
  }
  if (websiteLoginAction === null) {
    return (
      <>
        Logs in as {emphasise(credentialName)} - but this website has no login action yet, so its runs cannot log
        in.
      </>
    );
  }
  return (
    <>
      Logs in as {emphasise(credentialName)} with {emphasise(websiteLoginAction.title)}.
    </>
  );
}

/**
 * The top of an action's page, as the mockups draw it: the title, then the
 * description and how the action logs in (see `describeActionLoginLine`),
 * then what it does with an object ("Creates a Project, named
 * by Project name") and its cleanup links (`ActionCleanupLinks`), with Edit
 * and Delete beside it - behind a "⋯" menu on a phone, where the description
 * is left out - and the delete confirmation dialog.
 * @param props - The action, the edit link, the delete wiring, and the layout
 * @returns The rendered header
 */
function ActionHeader(props: ActionHeaderProps): ReactElement {
  const {
    action,
    editPath,
    editLinkState,
    deletion,
    isPhoneLayout,
    objectRoleLine,
    isCreateAction,
    websiteId,
    loginContext,
  } = props;
  const runsAsText = describeActionLoginLine(action, loginContext);

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
        {objectRoleLine !== null && (
          <Typography sx={{ fontSize: isPhoneLayout ? 12.5 : 13, color: nocturneTokens.neutral[300], mt: "4px" }}>
            {objectRoleLine}
          </Typography>
        )}
        <ActionCleanupLinks action={action} isCreateAction={isCreateAction} websiteId={websiteId} />
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
 *   opens on this computer and logs in first when the action logs in with a
 *   Login action), then its outcome, failure screenshot, "Refine with Claude",
 *   output log, and the version's other runs to pick from. Refine asks the
 *   model that wrote the version to fix the plan from the run's error,
 *   failure screenshot, and failing page, saving the result as a new
 *   version, which becomes the shown one. Versions saved from the step editor
 *   have no model, so their runs cannot be refined.
 *
 * PARAMETERS: the shown version's parameters (see `useActionParameters`)
 * feed the run panel's values form, the steps' tags, the Parameters row
 * (change, add, and remove them, and pick what names a created object), and
 * the header's object role line. A run sends the values the user changed;
 * after it, and after any parameter change, the parameters are fetched
 * again.
 *
 * Narrower (the phone layout, 2c), it is one column: a Version dropdown, the
 * latest run card (with "Run again" and "Refine" side by side), the steps,
 * then collapsed rows for the run history, the output log, and the rest.
 *
 * The shown version lives in the query string (`?version=5`, replaced rather
 * than pushed), so it survives a reload; without one, the newest is shown.
 *
 * The LOGIN action has no steps, so its page shows only the header (where
 * it logs in) and `LoginActionSection`: "Run login" (as the credential
 * picked beside it) and its login runs. The website's credentials and Login
 * action are read for that select and for the header (see `useLoginChoices`).
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
  // An action saved on this page (its name parameter) replaces the fetched one.
  const [savedAction, setSavedAction] = useState<WebsiteItemRecord | null>(null);
  const action = savedAction !== null && savedAction.id === actionId ? savedAction : actionResource.data;
  const webObjectsResource = useWebObjects(websiteId);
  const objectTypes = (webObjectsResource.data ?? []).map((webObject) => ({
    key: webObject.instancePatternKey,
    name: webObject.name ?? webObject.detectedName,
  }));
  const isPhoneLayout = useIsNarrowerThan("lg");
  const [searchParams, setSearchParams] = useSearchParams();

  const returnToHereState = useReturnToHereState();
  const deletion = useWebsiteItemDeletion(ACTION_KIND, websiteId, actionId);

  // A Login action has no steps: its page shows its login runs instead.
  const actionIsALoginAction = action !== null && isLoginActionRecord(action);
  const loginRunsResource = useLoginRuns(websiteId, actionId, actionIsALoginAction);
  const { loginChoices } = useLoginChoices(websiteId, action !== null, website?.loginUrl ?? null, null);
  const loginContext: ActionLoginContext = {
    websiteLoginUrl: website?.loginUrl ?? null,
    websiteLoginAction: loginChoices === null ? undefined : loginChoices.loginAction,
  };
  const loginCredentials = loginChoices?.credentials ?? null;
  const [pickedLoginRunCredentialId, setPickedLoginRunCredentialId] = useState<string | null>(null);
  // The first credential is picked until the user picks another (or the
  // picked one is no longer offered).
  const pickedLoginRunCredentialIsOffered =
    loginCredentials?.some((credential) => credential.id === pickedLoginRunCredentialId) ?? false;
  const loginRunCredentialId = pickedLoginRunCredentialIsOffered
    ? pickedLoginRunCredentialId
    : (loginCredentials?.at(0)?.id ?? null);
  const {
    sendJsonRequest: sendLoginRunRequest,
    isSubmitting: loginRunIsInFlight,
    errorMessage: loginRunErrorMessage,
  } = useJsonMutation();
  const now = useNow(false);

  /**
   * Runs the Login action's login once ("Run login"), as the credential
   * picked beside the button, and, when the server recorded the run (passed
   * or failed), fetches the run list again so it shows first. A refused
   * request shows its reason under the button.
   * @returns Resolves once the request (and the reload) is done
   */
  const runLogin = async (): Promise<void> => {
    if (loginRunCredentialId === null) return;
    const result = await sendLoginRunRequest("POST", loginRunsApiUrl(websiteId, actionId), {
      credentialId: loginRunCredentialId,
    });
    if (result.succeeded) loginRunsResource.reload();
  };

  const {
    scripts,
    isLoading: scriptsAreLoading,
    errorMessage: scriptsErrorMessage,
    addCreatedScript,
    recordFinishedRun,
    reloadScripts,
  } = useActionScripts(websiteId, actionId);
  const requestedScriptId = searchParams.get(SCRIPT_QUERY_PARAMETER);
  const requestedScriptIndex = scripts.findIndex((script) => script.id === requestedScriptId);
  const aListedVersionWasRequestedById = requestedScriptIndex >= 0;
  const selectedScriptIndex = aListedVersionWasRequestedById
    ? requestedScriptIndex
    : findShownVersionIndex(searchParams.get(VERSION_QUERY_PARAMETER), scripts.length);
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

  const {
    runs,
    isLoading: runsAreLoading,
    errorMessage: runsErrorMessage,
    addFinishedRun,
    reloadRuns,
  } = useActionScriptRuns(websiteId, actionId, selectedScript?.id ?? null);
  const {
    view: parametersView,
    isLoading: parametersAreLoading,
    errorMessage: parametersErrorMessage,
    reloadParameters,
    showParameters,
  } = useActionParameters(websiteId, actionId, selectedScript?.id ?? null);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  // Until the user picks a run, a link may name the run to show first (`?run=`).
  const runIdToShow = pickedRunId ?? searchParams.get(RUN_QUERY_PARAMETER);
  const selectedRun = runs.find((run) => run.id === runIdToShow) ?? runs.at(0) ?? null;

  // The run form's values live here (not in the run panel) because the versions
  // column's "Auto-refine" sends them too.
  const [runFormState, setRunFormState] = useState<RunFormState>({
    scriptId: null,
    values: {},
    cleanUpAfterwards: true,
  });
  const runFormValuesAreForShownVersion = selectedScript !== null && runFormState.scriptId === selectedScript.id;
  const typedRunFormValues: ParameterValues = runFormValuesAreForShownVersion ? runFormState.values : {};
  const runFormCleanUpAfterwards = runFormValuesAreForShownVersion ? runFormState.cleanUpAfterwards : true;
  const shownParameters = parametersView?.parameters ?? [];
  // Required values start on what the version's newest successful run used;
  // anything typed replaces them.
  const inheritedRunFormValues = buildInheritedRunValues(shownParameters, runs);
  const runFormValues: ParameterValues = { ...inheritedRunFormValues, ...typedRunFormValues };
  const changedRunFormValues = listChangedParameterValues(shownParameters, runFormValues);
  const runFormParametersToFix = listParametersToFix(shownParameters, runFormValues);
  const actionKind = (parametersView?.role ?? action?.objectRole ?? null)?.kind ?? null;

  /**
   * Remembers a value the user typed or picked in the run form, for the shown version.
   * @param parameterKey - The parameter's key
   * @param value - Its new value
   */
  const handleRunFormValueChange = (parameterKey: string, value: string): void => {
    if (selectedScript === null) return;
    setRunFormState({
      scriptId: selectedScript.id,
      values: { ...typedRunFormValues, [parameterKey]: value },
      cleanUpAfterwards: runFormCleanUpAfterwards,
    });
  };

  /**
   * Remembers whether the next run of the shown version cleans up afterwards.
   * @param cleanUpAfterwards - The checkbox's new state
   */
  const handleRunFormCleanupChange = (cleanUpAfterwards: boolean): void => {
    if (selectedScript === null) return;
    setRunFormState({ scriptId: selectedScript.id, values: typedRunFormValues, cleanUpAfterwards });
  };

  const {
    sendJsonRequest: sendConvertRequest,
    isSubmitting: conversionIsInFlight,
    errorMessage: convertErrorMessage,
  } = useJsonMutation();
  // What the last conversion did about the delete action, shown under the header until dismissed.
  const [deleteActionConversionNote, setDeleteActionConversionNote] = useState<string | null>(null);
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
  const {
    sendJsonRequest: sendParameterRequest,
    isSubmitting: parameterSaveIsInFlight,
    errorMessage: parameterSaveErrorMessage,
  } = useJsonMutation();
  const {
    sendJsonRequest: sendAutoRefineStartRequest,
    isSubmitting: autoRefineStartIsInFlight,
    errorMessage: autoRefineStartErrorMessage,
  } = useJsonMutation();
  const { sendJsonRequest: sendAutoRefineStopRequest, isSubmitting: autoRefineStopIsInFlight } =
    useJsonMutation();

  const { job: autoRefineJob, pollErrorMessage: autoRefinePollErrorMessage, watchJob } = useAutoRefineJob(
    websiteId,
    actionId,
  );
  const autoRefineJobIsRunning = autoRefineJob !== null && autoRefineJob.status === "running";
  // True while "Convert and auto-refine" (an action with no version yet) is converting.
  const [autoRefineIsConverting, setAutoRefineIsConverting] = useState(false);
  const seenJobProgressRef = useRef<SeenJobProgress | null>(null);
  // Set when the job has made a version the list does not show yet: the count
  // the list must reach before the page switches to its newest version.
  const [versionCountToFollow, setVersionCountToFollow] = useState<number | null>(null);

  // Each poll of the job is compared with the last one seen: a new version
  // refetches the versions list (and the page will show the newest), a new
  // run refetches the shown version's runs (and shows the newest), and the
  // job's end refetches both plus the parameters the runs taught.
  useEffect(() => {
    if (autoRefineJob === null) return;
    const progress = readJobProgress(autoRefineJob);
    const lastSeen = seenJobProgressRef.current;
    seenJobProgressRef.current = progress;
    const thisJobWasNotSeenBefore = lastSeen === null || lastSeen.jobId !== progress.jobId;
    if (thisJobWasNotSeenBefore) return;

    const aVersionWasAdded = progress.createdScriptCount > lastSeen.createdScriptCount;
    const aRunWasAdded = progress.runCount > lastSeen.runCount;
    const theJobJustEnded = lastSeen.wasRunning && !progress.wasRunning;
    if (aVersionWasAdded) {
      setVersionCountToFollow(scripts.length + (progress.createdScriptCount - lastSeen.createdScriptCount));
      reloadScripts();
    }
    if (aRunWasAdded) {
      setPickedRunId(null);
      reloadRuns();
    }
    if (theJobJustEnded) {
      if (!aVersionWasAdded) reloadScripts();
      if (!aRunWasAdded) reloadRuns();
      reloadParameters();
    }
    // A changed `scripts.length` alone re-runs this with nothing new seen, so it refetches nothing.
  }, [autoRefineJob, scripts.length, reloadScripts, reloadRuns, reloadParameters]);

  // Once the refetched list has the version the job made, show it.
  useEffect(() => {
    const noVersionIsAwaited = versionCountToFollow === null;
    if (noVersionIsAwaited) return;
    const theListHasCaughtUp = scripts.length >= versionCountToFollow;
    if (!theListHasCaughtUp) return;
    setVersionCountToFollow(null);
    setSearchParams({ [VERSION_QUERY_PARAMETER]: String(scripts.length) }, { replace: true });
  }, [scripts.length, versionCountToFollow, setSearchParams]);

  /**
   * PUTs a parameter's new label and required choice, then fetches the
   * parameters again.
   * @param parameterKey - The parameter's key
   * @param choices - The new label and required choice
   * @returns True when saved
   */
  const changeParameter = async (parameterKey: string, choices: ParameterChoicesRequestBody): Promise<boolean> => {
    const result = await sendParameterRequest("PUT", actionParameterApiUrl(websiteId, actionId, parameterKey), choices);
    if (result.succeeded) reloadParameters();
    return result.succeeded;
  };

  /**
   * DELETEs one of the user's own parameters, then fetches the parameters again.
   * @param parameterKey - The parameter's key
   */
  const removeParameter = (parameterKey: string): void => {
    void sendParameterRequest("DELETE", actionParameterApiUrl(websiteId, actionId, parameterKey)).then((result) => {
      if (result.succeeded) reloadParameters();
    });
  };

  /**
   * POSTs a parameter the user adds to the shown version, and shows the
   * parameters the server answers with.
   * @param body - The new parameter
   * @returns True when added
   */
  const addParameter = async (body: NewParameterRequestBody): Promise<boolean> => {
    if (selectedScript === null) return false;
    const result = await sendParameterRequest(
      "POST",
      actionScriptParametersApiUrl(websiteId, actionId, selectedScript.id),
      body,
    );
    if (result.succeeded) showParameters(result.data as VersionParametersRecord);
    return result.succeeded;
  };

  /**
   * Saves which parameter names the objects a Create action makes - a PUT of
   * the whole action with only that choice changed - then fetches the
   * parameters again.
   * @param parameterKey - The parameter's key, or null for "Detect"
   */
  const changeNameParameter = (parameterKey: string | null): void => {
    if (action === null) return;
    const actionBody = {
      title: action.title,
      description: action.description,
      credentialId: action.credentialId ?? null,
      loginUrl: action.loginUrl ?? null,
      usernameSelector: action.usernameSelector ?? null,
      passwordSelector: action.passwordSelector ?? null,
      submitSelector: action.submitSelector ?? null,
      userActionKind: action.userActionKind ?? null,
      userObjectTypeKey: action.userObjectTypeKey ?? null,
      userNameParameterKey: parameterKey,
    };
    void sendParameterRequest("PUT", websiteItemApiUrl(ACTION_KIND, websiteId, actionId), actionBody).then(
      (result) => {
        if (!result.succeeded) return;
        setSavedAction(result.data as WebsiteItemRecord);
        reloadParameters();
      },
    );
  };

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
    // The API is the contract for this shape; see useJsonResource. A Create
    // action's conversion also reports whether its delete action was converted.
    const conversion = result.data as ConversionResponse;
    addAndShowCreatedScript(conversion);
    setDeleteActionConversionNote(describeDeleteActionConversion(conversion));
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
   * POSTs the start of an auto-refine job for a version with the given run
   * values, and watches the job the server answers with. A failure is shown
   * by the versions column from `autoRefineStartErrorMessage`.
   * @param actionScriptId - The version to run and refine
   * @param parameterValues - The run values to send with every run
   * @returns Resolves once the request is done
   */
  const startAutoRefineOfVersion = async (
    actionScriptId: string,
    parameterValues: ParameterValues,
  ): Promise<void> => {
    const result = await sendAutoRefineStartRequest(
      "POST",
      autoRefineJobsApiUrl(websiteId, actionId, actionScriptId),
      { parameterValues },
    );
    if (!result.succeeded) return;
    watchJob(result.data as AutoRefineJobRecord);
  };

  /**
   * Starts an auto-refine job for the shown version with the run form's
   * changed values - or, when the action has no version yet, converts it
   * first (with the picked model and effort, like "Convert to new version")
   * and starts the job for the version that made, with no run values (its
   * own defaults). A failed conversion is shown by the versions column from
   * `convertErrorMessage`, like any conversion.
   * @returns Resolves once the requests are done
   */
  const startAutoRefine = async (): Promise<void> => {
    const thereIsAVersionToRefine = selectedScript !== null;
    if (thereIsAVersionToRefine) {
      await startAutoRefineOfVersion(selectedScript.id, changedRunFormValues);
      return;
    }
    if (modelChoice === null) return;
    setAutoRefineIsConverting(true);
    try {
      const conversion = await sendConvertRequest("POST", actionScriptsApiUrl(websiteId, actionId), modelChoice);
      if (!conversion.succeeded) return;
      const createdScript = conversion.data as ActionScriptRecord;
      addAndShowCreatedScript(createdScript);
      await startAutoRefineOfVersion(createdScript.id, {});
    } finally {
      setAutoRefineIsConverting(false);
    }
  };

  /** Starts an auto-refine job without returning its promise (the button expects a void callback). */
  const handleAutoRefineStart = (): void => {
    void startAutoRefine();
  };

  /**
   * POSTs a stop request for the watched job, and shows the job as the server
   * answers with it (its `stopRequestedAt` set).
   * @returns Resolves once the request is done
   */
  const stopAutoRefine = async (): Promise<void> => {
    if (autoRefineJob === null) return;
    const result = await sendAutoRefineStopRequest(
      "POST",
      autoRefineJobStopApiUrl(websiteId, actionId, autoRefineJob.id),
    );
    if (!result.succeeded) return;
    watchJob(result.data as AutoRefineJobRecord);
  };

  /** Asks the job to stop without returning the promise (the button expects a void callback). */
  const handleAutoRefineStop = (): void => {
    void stopAutoRefine();
  };

  /**
   * Says why "Auto-refine" cannot start right now, when there is a reason worth
   * showing: the shown version was saved from the step editor, or the run
   * form has values to fix.
   * @returns The reason, or null when it can start or nothing needs explaining
   */
  const describeAutoRefineBlock = (): string | null => {
    if (selectedScript === null) return null;
    if (!versionCanBeRefined) return EDITED_VERSION_CANNOT_BE_AUTO_REFINED_REASON;
    const valuesNeedFixing = runFormParametersToFix.length > 0;
    if (valuesNeedFixing) return `Fill in ${runFormParametersToFix.join(", ")} to run`;
    return null;
  };
  const autoRefineBlockedReason = describeAutoRefineBlock();
  const anotherRequestIsInFlight = runIsInFlight || refineIsInFlight || editSaveIsInFlight;
  const thereAreNoVersionsYet = !scriptsAreLoading && scriptsErrorMessage === null && scripts.length === 0;
  // With no version yet the button converts first, so it needs a model, like Convert.
  const autoRefineCanStart = thereAreNoVersionsYet
    ? modelChoice !== null && !conversionIsInFlight
    : selectedScript !== null &&
      autoRefineBlockedReason === null &&
      parametersView !== null &&
      // The run list decides the inherited values, so the job waits for it.
      !runsAreLoading &&
      !anotherRequestIsInFlight;

  /**
   * POSTs a run of the shown script with the values the user changed and,
   * when it is recorded, adds it to the history, shows it, and makes it the
   * version's latest run (so the version's status icon updates at once) -
   * then fetches the parameters again (the run taught them new readings,
   * and may have created an object). A failed RUN is still a recorded run;
   * only a failed REQUEST is shown from `runErrorMessage`.
   * @param parameterValues - The changed values, by parameter key
   * @param cleanUpAfterwards - False when the user unticked "Clean up afterwards" for this run
   * @returns Resolves once the request is done
   */
  const runSelectedScript = async (parameterValues: ParameterValues, cleanUpAfterwards: boolean): Promise<void> => {
    const thereIsNoScriptToRun = selectedScript === null;
    if (thereIsNoScriptToRun) return;
    const result = await sendRunRequest(
      "POST",
      actionScriptRunsApiUrl(websiteId, actionId, selectedScript.id),
      { parameterValues, cleanUpAfterwards },
    );
    if (!result.succeeded) return;
    const finishedRun = result.data as ActionScriptRunRecord;
    addFinishedRun(finishedRun);
    recordFinishedRun(finishedRun);
    setPickedRunId(finishedRun.id);
    reloadParameters();
  };

  /**
   * Starts a run without returning its promise (the button expects a void callback).
   * @param parameterValues - The changed values, by parameter key
   * @param cleanUpAfterwards - Whether the run cleans up afterwards
   */
  const handleRunClick = (parameterValues: ParameterValues, cleanUpAfterwards: boolean): void => {
    void runSelectedScript(parameterValues, cleanUpAfterwards);
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

  if (actionIsALoginAction) {
    const websiteHasNoCredentials = loginCredentials !== null && loginCredentials.length === 0;
    // Until the website has loaded, its login page is not known yet - so a
    // Login action without its own page is not reported as having none.
    const websiteHasLoaded = website !== null;
    const loginActionHasNoLoginPage =
      websiteHasLoaded && (action.loginUrl ?? null) === null && website.loginUrl === null;
    const loginRunInputsAreLoading = !websiteHasLoaded || loginRunCredentialId === null;
    const loginRunBlockedReason = websiteHasNoCredentials
      ? "Save a credential on the website's Credentials tab first"
      : loginActionHasNoLoginPage
        ? "Edit this login action to give it a login page URL"
        : loginRunInputsAreLoading
          ? "Loading the website and its credentials"
          : null;
    return (
      <PageContainer>
        {breadcrumbs}
        <ActionHeader
          action={action}
          editPath={websiteItemEditPath(ACTION_KIND, websiteId, actionId)}
          editLinkState={returnToHereState}
          deletion={deletion}
          isPhoneLayout={isPhoneLayout}
          objectRoleLine={null}
          isCreateAction={false}
          websiteId={websiteId}
          loginContext={loginContext}
        />
        <LoginActionSection
          websiteId={websiteId}
          actionId={actionId}
          runs={loginRunsResource.data}
          isLoading={loginRunsResource.isLoading}
          errorMessage={loginRunsResource.errorMessage}
          runBlockedReason={loginRunBlockedReason}
          credentials={loginCredentials ?? []}
          selectedCredentialId={loginRunCredentialId}
          onSelectedCredentialChange={setPickedLoginRunCredentialId}
          isRunning={loginRunIsInFlight}
          runErrorMessage={loginRunErrorMessage}
          onRunLogin={() => {
            void runLogin();
          }}
          now={now}
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
      autoRefine={{
        shownVersionNumber: selectedScript === null ? null : selectedScriptVersionNumber,
        canStart: autoRefineCanStart,
        blockedReason: autoRefineBlockedReason,
        isStarting: autoRefineStartIsInFlight || autoRefineIsConverting,
        startErrorMessage: autoRefineStartErrorMessage,
        job: autoRefineJob,
        versionNumberOfScriptId: (scriptId) => findVersionNumberOfScriptId(scripts, scriptId),
        pollErrorMessage: autoRefinePollErrorMessage,
        onStart: handleAutoRefineStart,
        onStop: handleAutoRefineStop,
        isStopping: autoRefineStopIsInFlight,
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
      // Keyed by version, so the shown run and any refine error start over for
      // each version (the run form's values are the page's, kept per version).
      // The prefix keeps the key apart from the version details' own key - on
      // a phone both are children of the same column.
      key={`run-panel-${selectedScript.id}`}
      websiteId={websiteId}
      parametersView={parametersView}
      parametersErrorMessage={parametersErrorMessage}
      versionNumber={selectedScriptVersionNumber}
      runs={runs}
      isLoading={runsAreLoading}
      errorMessage={runsErrorMessage}
      selectedRun={selectedRun}
      onSelectRun={setPickedRunId}
      isRunning={runIsInFlight}
      runErrorMessage={runErrorMessage}
      onRunClick={handleRunClick}
      cleanupControl={
        actionKind === "create"
          ? {
              hasDeleteAction: (action.deleteAction ?? null) !== null,
              checked: runFormCleanUpAfterwards,
              onChange: handleRunFormCleanupChange,
            }
          : null
      }
      values={runFormValues}
      inheritedValues={inheritedRunFormValues}
      onValueChange={handleRunFormValueChange}
      isAutoRefining={autoRefineJobIsRunning}
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
        stepTags={buildStepParameterTags(parametersView)}
        parameterCount={parametersView?.parameters.length ?? null}
        parametersSection={
          <ActionScriptParameters
            view={parametersView}
            isLoading={parametersAreLoading}
            errorMessage={parametersErrorMessage}
            objectTypes={objectTypes}
            userNameParameterKey={action.userNameParameterKey ?? null}
            isSaving={parameterSaveIsInFlight}
            saveErrorMessage={parameterSaveErrorMessage}
            onChangeParameter={changeParameter}
            onRemoveParameter={removeParameter}
            onAddParameter={addParameter}
            onNameParameterChange={changeNameParameter}
          />
        }
      />
    );

  const nameParameterLabel =
    parametersView?.parameters.find((parameter) => parameter.key === parametersView.nameParameterKey)?.label ?? null;
  const objectRole = parametersView?.role ?? action.objectRole ?? null;
  const objectRoleLine =
    objectRole === null
      ? null
      : describeObjectRole(objectRole, {
          nameParameterLabel,
          confirmStepNumber: parametersView?.confirmStepNumber ?? null,
        });

  return (
    <PageContainer>
      {breadcrumbs}
      <ActionHeader
        action={action}
        editPath={websiteItemEditPath(ACTION_KIND, websiteId, actionId)}
        editLinkState={returnToHereState}
        deletion={deletion}
        isPhoneLayout={isPhoneLayout}
        objectRoleLine={objectRoleLine}
        isCreateAction={objectRole?.kind === "create"}
        websiteId={websiteId}
        loginContext={loginContext}
      />
      {deleteActionConversionNote !== null && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => {
            setDeleteActionConversionNote(null);
          }}
        >
          {deleteActionConversionNote}
        </Alert>
      )}

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
