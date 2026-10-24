import {
  createCreatedObject,
  findActionForWebsite,
  findActionParameterSyncInputs,
  findLatestCrawlPagesMatching,
  findNewestActionPlan,
  listActionIdsForWebsite,
  listActionParametersForAction,
  listChoosableCreatedObjects,
  listCreatedObjectsToCheck,
  listWebObjectsForWebsite,
  markCreatedObjectDeletedByRun,
  readCrawlRunPagesMatching,
  saveCreatedObjectChecks,
  saveSyncedActionParameters,
  type ActionWithCredential,
  type CrawledPageFields,
  type CreatedObjectCheck,
  type WebObjectWithPatterns,
} from "./dbService.js";
import type { ActionPlanRunResult, PlanParameterRun } from "./actionPlanRunnerService.js";
import {
  OBJECT_PARAMETER_KEY,
  applyParameterValues,
  chooseNameParameterKey,
  findConfirmStepNumber,
  isInstanceAddress,
  listBindableTexts,
  readPageIdentity,
  resolveVersionParameters,
  type AppliedParameterValues,
  type ObjectBindingContext,
  type ObjectChoice,
  type ParameterUseField,
  type VersionParameter,
} from "../utils/actionParameters.js";
import type { ActionPlan } from "../utils/actionPlanSchema.js";
import { detectActionParameters, type RunFieldReading } from "../utils/detectActionParameters.js";
import { urlMatchesPatternKey } from "../utils/detectPagePatterns.js";
import { normalizeFieldName } from "../utils/formFields.js";
import { readAriaSnapshotOutline } from "../utils/readAriaSnapshotFields.js";
import {
  resolveActionObjectRole,
  type ObjectTypeCandidate,
  type ResolvedActionRole,
} from "../utils/scoreActionObjectRole.js";
import { describeError } from "../utils/describeError.js";

/** Everything about one version's parameters - what the parameters route answers with. */
export interface VersionParametersView {
  /** What the action does with an object (its kind, type, and whether it deletes). */
  role: ResolvedActionRole;
  /** The version's parameters, in step order. */
  parameters: VersionParameter[];
  /** The objects an Object action can be run on (empty for other actions). */
  objectChoices: ObjectChoice[];
  /** A Create action's confirm step in this version, or null. */
  confirmStepNumber: number | null;
  /** The parameter that names what a Create action makes, or null. */
  nameParameterKey: string | null;
  /** The texts of the steps the user can make a parameter of. */
  bindableTexts: { text: string; fields: ParameterUseField[] }[];
  /** Things the user should check, in plain words. */
  warnings: string[];
}

/** A run's values, ready to run - or why they cannot be. */
export type PreparedParameterRun =
  | {
      /** True: the values fit the version. */
      isReady: true;
      /** The plan with the values in, the steps to skip and add, and the values to store. */
      applied: AppliedParameterValues;
      /** What the runner does differently. */
      parameterRun: PlanParameterRun;
    }
  | {
      /** False: a value does not fit. */
      isReady: false;
      /** Why, for a 400 answer. */
      errorMessage: string;
    };

/** The version that ran, and what a run's follow-up needs about it. */
export interface RunFollowUp {
  /** The website's cuid. */
  websiteId: string;
  /** The action that ran. */
  action: ActionWithCredential;
  /** The version that ran. */
  actionScriptId: string;
  /** Its plan (as stored, before the values went in). */
  plan: ActionPlan;
  /** The recorded run's cuid. */
  actionScriptRunId: string;
  /** The version's parameters view the run started from. */
  view: VersionParametersView;
  /** The values the run used. */
  applied: AppliedParameterValues;
  /** What the runner reported. */
  runResult: ActionPlanRunResult;
}

/**
 * Turns the website's web objects into the object type detection's
 * candidates: each type's name, and the patterns of its own page and its
 * create page.
 * @param webObjects - The website's web objects
 * @returns One candidate per web object
 */
export function toObjectTypeCandidates(webObjects: WebObjectWithPatterns[]): ObjectTypeCandidate[] {
  return webObjects.map((webObject) => ({
    objectTypeKey: webObject.instancePatternKey,
    name: webObject.name ?? webObject.detectedName,
    addressPatternKeys: [
      webObject.instancePatternKey,
      ...webObject.pagePatterns.filter((pattern) => pattern.role === "create").map((pattern) => pattern.key),
    ],
  }));
}

/**
 * Lists the addresses a plan opens: its start URL and every `goto`.
 * @param plan - A plan, or null
 * @returns The addresses (empty for null)
 */
export function readPlanUrls(plan: ActionPlan | null): string[] {
  if (plan === null) return [];
  const gotoUrls = plan.steps.flatMap((step) => (step.action === "goto" && step.value !== null ? [step.value] : []));
  return [plan.startUrl, ...gotoUrls];
}

/**
 * Works out an action's object role (see `resolveActionObjectRole`) from its
 * choices, the website's web objects, and its newest version's addresses.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @param webObjects - The website's web objects
 * @returns The role
 */
export async function resolveRoleForAction(
  websiteId: string,
  action: ActionWithCredential,
  webObjects: WebObjectWithPatterns[],
): Promise<ResolvedActionRole> {
  const newestPlan = await findNewestActionPlan(websiteId, action.id);
  return resolveActionObjectRole(action, toObjectTypeCandidates(webObjects), readPlanUrls(newestPlan));
}

/**
 * Works out an action's object role, reading the website's web objects.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @returns The role
 */
export async function loadActionRole(websiteId: string, action: ActionWithCredential): Promise<ResolvedActionRole> {
  const webObjects = await listWebObjectsForWebsite(websiteId);
  return resolveRoleForAction(websiteId, action, webObjects);
}

/**
 * Lists the page identities a set of versions visits: their start URLs,
 * `goto` addresses, and the crawled pages Claude was shown.
 * @param versions - The versions
 * @returns The identities (see `readPageIdentity`)
 */
function listVisitedPageIdentities(versions: { plan: ActionPlan; contextPageUrls: string[] }[]): Set<string> {
  const visitedIdentities = new Set<string>();
  for (const version of versions) {
    for (const url of [...readPlanUrls(version.plan), ...version.contextPageUrls]) {
      const pageIdentity = readPageIdentity(url);
      if (pageIdentity !== null) visitedIdentities.add(pageIdentity);
    }
  }
  return visitedIdentities;
}

/**
 * Keeps an action's parameter rows up to date, with no LLM: reads its live
 * versions, the latest crawl's pages they visit (snapshots and form fields),
 * its failed runs' page snapshots, and - when a run triggered the sync - that
 * run's field readings; detects the rows the action should have (see
 * `detectActionParameters`); and saves them (see
 * `saveSyncedActionParameters`), never touching the user's choices.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @param runReadings - The readings of the run that triggered the sync, with its plan and when it ended; omitted otherwise
 * @param runReadings.plan - The plan the run ran (as stored, before its values went in)
 * @param runReadings.readings - The fields the runner read around each step it typed into
 * @param runReadings.readAt - When the run ended
 * @returns Resolves once saved (or the action turned out to be deleted)
 */
export async function syncActionParameters(
  websiteId: string,
  action: ActionWithCredential,
  runReadings?: { plan: ActionPlan; readings: RunFieldReading[]; readAt: Date },
): Promise<void> {
  const syncInputs = await findActionParameterSyncInputs(websiteId, action.id);
  const webObjects = await listWebObjectsForWebsite(websiteId);
  const newestPlan = syncInputs.versions.at(0)?.plan ?? null;
  const role = resolveActionObjectRole(action, toObjectTypeCandidates(webObjects), readPlanUrls(newestPlan));
  const visitedIdentities = listVisitedPageIdentities(syncInputs.versions);
  const crawl = await findLatestCrawlPagesMatching(websiteId, action.credentialId, (pageUrl) =>
    visitedIdentities.has(pageUrl),
  );
  const detectedRows = detectActionParameters({
    versionPlans: syncInputs.versions.map((version) => version.plan),
    pages: crawl.pages,
    failingPageSnapshots: syncInputs.failingPageSnapshots,
    runReadings: runReadings === undefined ? null : { plan: runReadings.plan, readings: runReadings.readings },
    role,
    reservedKeys: syncInputs.reservedKeys,
  });
  await saveSyncedActionParameters(websiteId, action.id, detectedRows, {
    crawlReadAt: crawl.crawledAt,
    runReadAt: runReadings?.readAt ?? null,
  });
}

/**
 * Syncs an action's parameter rows the first time they are needed - an
 * action from before parameters existed has never been synced.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @returns Resolves once its rows exist
 */
export async function ensureActionParametersSynced(websiteId: string, action: ActionWithCredential): Promise<void> {
  const actionWasNeverSynced = action.parametersSyncedAt === null;
  if (actionWasNeverSynced) await syncActionParameters(websiteId, action);
}

/**
 * Syncs an action's parameters after something changed, without ever
 * failing the request that changed it: a failure is logged, and the next
 * read or run syncs again.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @returns Resolves once synced or the failure is logged
 */
export async function syncActionParametersQuietly(websiteId: string, action: ActionWithCredential): Promise<void> {
  try {
    await syncActionParameters(websiteId, action);
  } catch (syncError: unknown) {
    console.error(`[parameters] action ${action.id} could not sync its parameters: ${describeError(syncError)}`);
  }
}

/**
 * Syncs the parameters of every active action of a website - after a crawl,
 * whose new pages, fields, and object types they read. NEVER rejects: each
 * failure is logged and the next action is synced.
 * @param websiteId - The crawled website's cuid
 * @returns Resolves once every action was synced or its failure logged
 */
export async function syncWebsiteActionParameters(websiteId: string): Promise<void> {
  try {
    for (const actionId of await listActionIdsForWebsite(websiteId)) {
      const action = await findActionForWebsite(websiteId, actionId);
      if (action !== null) await syncActionParametersQuietly(websiteId, action);
    }
  } catch (syncError: unknown) {
    console.error(`[parameters] website ${websiteId} could not sync its actions' parameters: ${describeError(syncError)}`);
  }
}

/**
 * Builds what binding an object needs about its type: its own-page pattern
 * (the type's key) and its create patterns.
 * @param objectTypeKey - The type's key, or null
 * @param webObjects - The website's web objects
 * @returns The context, with no instances yet
 */
function buildObjectContext(objectTypeKey: string | null, webObjects: WebObjectWithPatterns[]): ObjectBindingContext {
  const webObject = webObjects.find((candidate) => candidate.instancePatternKey === objectTypeKey);
  return {
    instancePatternKey: objectTypeKey,
    createPatternKeys: (webObject?.pagePatterns ?? [])
      .filter((pattern) => pattern.role === "create")
      .map((pattern) => pattern.key),
    instances: [],
  };
}

/**
 * Reads the instances of a type the latest crawl saw: every link on its list
 * pages and instance pages whose address is an instance's own page, named by
 * the link's text.
 * @param pages - The crawled pages read for the type
 * @param context - The type's patterns
 * @returns One choice per instance address, in page order
 */
function readCrawledInstances(pages: CrawledPageFields[], context: ObjectBindingContext): ObjectChoice[] {
  const choicesByIdentity = new Map<string, ObjectChoice>();
  for (const page of pages) {
    const links = page.ariaSnapshot === null ? [] : readAriaSnapshotOutline(page.ariaSnapshot).links;
    for (const link of links) {
      const linkIdentity = readPageIdentity(link.href, page.url);
      const linkIsANewInstance =
        linkIdentity !== null && isInstanceAddress(linkIdentity, context) && !choicesByIdentity.has(linkIdentity);
      if (!linkIsANewInstance) continue;
      choicesByIdentity.set(linkIdentity, {
        name: link.name,
        url: linkIdentity,
        source: "crawl",
        createdObjectId: null,
        createdByActionTitle: null,
        createdAt: null,
        seenOnCrawl: true,
      });
    }
  }
  return [...choicesByIdentity.values()];
}

/**
 * Lists the objects of a type an Object action can be run on: the ones
 * Create actions made (still choosable - see `listChoosableCreatedObjects`),
 * newest first, then the ones the latest crawl saw that are not among them.
 * A created one the crawl also saw is marked `seenOnCrawl`.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The action's credential (picks the crawl), or null
 * @param context - The type's patterns
 * @param webObjects - The website's web objects (for the type's list page)
 * @returns The choices
 */
export async function loadObjectChoices(
  websiteId: string,
  credentialId: string | null,
  context: ObjectBindingContext,
  webObjects: WebObjectWithPatterns[],
): Promise<ObjectChoice[]> {
  const { instancePatternKey } = context;
  if (instancePatternKey === null) return [];
  const listPatternKeys = listTypeListPatternKeys(instancePatternKey, webObjects);
  const crawl = await findLatestCrawlPagesMatching(
    websiteId,
    credentialId,
    (pageUrl) =>
      urlMatchesPatternKey(pageUrl, instancePatternKey) ||
      listPatternKeys.some((listPatternKey) => urlMatchesPatternKey(pageUrl, listPatternKey)),
  );
  const crawledChoices = readCrawledInstances(crawl.pages, context);
  const createdObjects = await listChoosableCreatedObjects(websiteId, instancePatternKey);
  const createdChoices: ObjectChoice[] = createdObjects.map((createdObject) => {
    const createdIdentity = createdObject.url === null ? null : readPageIdentity(createdObject.url);
    const crawlListsIt = crawledChoices.some(
      (crawledChoice) =>
        (createdIdentity !== null && crawledChoice.url === createdIdentity) ||
        normalizeFieldName(crawledChoice.name) === normalizeFieldName(createdObject.name),
    );
    return {
      name: createdObject.name,
      url: createdObject.url,
      source: "created",
      createdObjectId: createdObject.id,
      createdByActionTitle: createdObject.action.title,
      createdAt: createdObject.createdAt,
      seenOnCrawl: crawlListsIt,
    };
  });
  const crawledChoicesNotCreated = crawledChoices.filter(
    (crawledChoice) =>
      !createdChoices.some(
        (createdChoice) =>
          (createdChoice.url !== null && readPageIdentity(createdChoice.url) === crawledChoice.url) ||
          normalizeFieldName(createdChoice.name) === normalizeFieldName(crawledChoice.name),
      ),
  );
  return [...createdChoices, ...crawledChoicesNotCreated];
}

/**
 * Lists the patterns of a type's list page: its `collection` patterns from
 * the crawl, or else its own-page pattern with the last segment (the
 * variable) dropped - `/projects` for `/projects/{project}`.
 * @param objectTypeKey - The type's key
 * @param webObjects - The website's web objects
 * @returns The list page patterns (empty when the type has none)
 */
function listTypeListPatternKeys(objectTypeKey: string, webObjects: WebObjectWithPatterns[]): string[] {
  const webObject = webObjects.find((candidate) => candidate.instancePatternKey === objectTypeKey);
  const collectionKeys = (webObject?.pagePatterns ?? [])
    .filter((pattern) => pattern.role === "collection")
    .map((pattern) => pattern.key);
  if (collectionKeys.length > 0) return collectionKeys;
  const derivedListKey = objectTypeKey.replace(/\/\{[^}]+\}$/, "");
  const typeHasAListPage = derivedListKey !== objectTypeKey && derivedListKey !== "";
  return typeHasAListPage ? [derivedListKey] : [];
}

/**
 * Builds everything about one version's parameters - what the run form and
 * the Parameters section show: the action's role, the version's parameters
 * (see `resolveVersionParameters`), the object choices of an Object action,
 * a Create action's confirm step and name parameter, the texts the user can
 * make a parameter of, and the warnings. The action's rows are synced first
 * when they never were.
 * @param websiteId - The owning website's cuid
 * @param action - The action
 * @param script - The version: its id and plan
 * @param script.plan - The version's plan
 * @returns The view
 */
export async function loadVersionParameters(
  websiteId: string,
  action: ActionWithCredential,
  script: { plan: ActionPlan },
): Promise<VersionParametersView> {
  await ensureActionParametersSynced(websiteId, action);
  const rows = await listActionParametersForAction(websiteId, action.id);
  const webObjects = await listWebObjectsForWebsite(websiteId);
  const role = await resolveRoleForAction(websiteId, action, webObjects);
  const objectContext = buildObjectContext(role.objectTypeKey, webObjects);
  const actionActsOnAnObject = role.kind === "object" && role.objectTypeKey !== null;
  const objectChoices = actionActsOnAnObject
    ? await loadObjectChoices(websiteId, action.credentialId, objectContext, webObjects)
    : [];
  const parameters = resolveVersionParameters(script.plan, rows, role.kind, { ...objectContext, instances: objectChoices });
  const actionCreates = role.kind === "create";
  const confirmStepNumber = actionCreates ? findConfirmStepNumber(script.plan) : null;
  const nameParameterKey = actionCreates
    ? chooseNameParameterKey(parameters, confirmStepNumber, action.userNameParameterKey)
    : null;

  const warnings = [...role.warnings];
  const versionBindsNoObject =
    actionActsOnAnObject && !parameters.some((parameter) => parameter.kind === "object");
  if (versionBindsNoObject) {
    warnings.push(
      `Nothing in this version's steps names a ${role.objectTypeName ?? "object"} - add it as "A value in the steps"`,
    );
  }
  if (actionCreates && confirmStepNumber === null) {
    warnings.push("No confirm step found, so created objects can't be recorded");
  }
  if (actionCreates && confirmStepNumber !== null && nameParameterKey === null) {
    warnings.push("No parameter names the new object, so created objects are recorded without a name");
  }
  return {
    role,
    parameters,
    objectChoices,
    confirmStepNumber,
    nameParameterKey,
    bindableTexts: listBindableTexts(script.plan),
    warnings,
  };
}

/**
 * Checks a run's values against a version's parameters and puts them in
 * (see `applyParameterValues`). A key that is not one of the version's
 * parameters, a blank required value, or an object with no known address
 * is a problem.
 * @param view - The version's parameters view
 * @param plan - The version's plan
 * @param parameterValues - The run's values, by key
 * @returns The run's plan and changes, or why the values do not fit
 */
export function prepareParameterRun(
  view: VersionParametersView,
  plan: ActionPlan,
  parameterValues: Readonly<Record<string, string>>,
): PreparedParameterRun {
  const knownKeys = new Set(view.parameters.map((parameter) => parameter.key));
  const unknownKeys = Object.keys(parameterValues).filter((parameterKey) => !knownKeys.has(parameterKey));
  if (unknownKeys.length > 0) {
    const knownKeyList = [...knownKeys].join(", ") || "none";
    return {
      isReady: false,
      errorMessage: `Unknown parameter${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map((unknownKey) => `"${unknownKey}"`).join(", ")}; this version's parameters are: ${knownKeyList}`,
    };
  }
  const applied = applyParameterValues(plan, view.parameters, parameterValues, view.objectChoices);
  if (applied.problems.length > 0) {
    return { isReady: false, errorMessage: applied.problems.join("; ") };
  }
  const readFieldsAfterStepNumbers = view.parameters.flatMap((parameter) =>
    parameter.kind === "object"
      ? []
      : parameter.uses.filter((use) => use.field === "value").map((use) => use.stepNumber),
  );
  return {
    isReady: true,
    applied,
    parameterRun: {
      skippedStepNumbers: applied.skippedStepNumbers,
      insertedSteps: applied.insertedSteps,
      secretValues: applied.secretValues,
      readFieldsAfterStepNumbers,
      confirmStepNumber: view.confirmStepNumber,
    },
  };
}

/**
 * Finds which object type an address is an instance of.
 * @param url - An address
 * @param webObjects - The website's web objects
 * @returns The matching web object, or undefined
 */
function findTypeOfAddress(url: string, webObjects: WebObjectWithPatterns[]): WebObjectWithPatterns | undefined {
  return webObjects.find((webObject) => isInstanceAddress(url, buildObjectContext(webObject.instancePatternKey, webObjects)));
}

/**
 * Records the object a Create run made - only when its confirm step
 * succeeded (whether or not later steps passed). It is named by the name
 * parameter's value; its address is the first of the page right after the
 * confirm step and the final page that is an instance page; its type is the
 * one that address is an instance of, else the action's.
 * @param followUp - The run and what it ran with
 * @returns Resolves once recorded (or nothing was to be)
 */
async function recordCreatedObject(followUp: RunFollowUp): Promise<void> {
  const { view, runResult, applied } = followUp;
  const confirmStepSucceeded = view.role.kind === "create" && runResult.confirmStepSucceeded === true;
  if (!confirmStepSucceeded) return;
  const webObjects = await listWebObjectsForWebsite(followUp.websiteId);
  const addressCandidates = [runResult.pageUrlAfterConfirm, runResult.finalPageUrl].flatMap((url) =>
    url === null ? [] : [url],
  );
  const addressedInstance = addressCandidates
    .map((url) => ({ url, webObject: findTypeOfAddress(url, webObjects) }))
    .find((candidate) => candidate.webObject !== undefined);
  const typeObject = addressedInstance?.webObject ?? webObjects.find((webObject) => webObject.instancePatternKey === view.role.objectTypeKey);
  const nameValue = applied.usedValues.find((usedValue) => usedValue.key === view.nameParameterKey)?.value ?? "";
  const objectTypeName = typeObject === undefined ? view.role.objectTypeName : (typeObject.name ?? typeObject.detectedName);
  await createCreatedObject(followUp.websiteId, {
    actionId: followUp.action.id,
    actionScriptId: followUp.actionScriptId,
    actionScriptRunId: followUp.actionScriptRunId,
    objectTypeKey: typeObject?.instancePatternKey ?? view.role.objectTypeKey,
    objectTypeName,
    name: nameValue.trim() === "" ? `Unnamed ${objectTypeName ?? "object"}` : nameValue,
    url: addressedInstance?.url ?? null,
  });
}

/**
 * Marks the created object a passed run of a deleting Object action ran on
 * as deleted on the site: the object value it ran with, matched to the
 * created objects by address (when the chosen one has one) or by name.
 * @param followUp - The run and what it ran with
 * @returns Resolves once marked (or nothing was to be)
 */
async function markDeletedObject(followUp: RunFollowUp): Promise<void> {
  const { view, runResult, applied } = followUp;
  const runDeletedAnObject = view.role.kind === "object" && view.role.deletesObject && runResult.succeeded;
  const objectTypeKey = view.role.objectTypeKey;
  if (!runDeletedAnObject || objectTypeKey === null) return;
  const chosenName = applied.usedValues.find((usedValue) => usedValue.key === OBJECT_PARAMETER_KEY)?.value ?? "";
  const chosenChoice = view.objectChoices.find(
    (choice) => choice.source === "created" && normalizeFieldName(choice.name) === normalizeFieldName(chosenName),
  );
  const createdObjectId = chosenChoice?.createdObjectId ?? null;
  if (createdObjectId === null) return;
  await markCreatedObjectDeletedByRun(followUp.websiteId, createdObjectId, followUp.actionScriptRunId);
}

/**
 * Does what follows a recorded run: syncs the action's parameters with the
 * run's field readings, records the object a Create run made, and marks the
 * object a deleting run deleted. NEVER rejects - the run is already
 * recorded; each failure is logged.
 * @param followUp - The run and what it ran with
 * @returns Resolves once done
 */
export async function followUpRecordedRun(followUp: RunFollowUp): Promise<void> {
  const steps: [string, () => Promise<void>][] = [
    [
      "sync its parameters",
      () =>
        syncActionParameters(followUp.websiteId, followUp.action, {
          plan: followUp.plan,
          readings: followUp.runResult.fieldReadings,
          readAt: new Date(),
        }),
    ],
    ["record the object it created", () => recordCreatedObject(followUp)],
    ["mark the object it deleted", () => markDeletedObject(followUp)],
  ];
  for (const [description, followUpStep] of steps) {
    try {
      await followUpStep();
    } catch (followUpError: unknown) {
      console.error(
        `[parameters] run ${followUp.actionScriptRunId} could not ${description}: ${describeError(followUpError)}`,
      );
    }
  }
}

/**
 * Checks a website's created objects against a crawl that just ended: for
 * each type whose list page the crawl reached, an object the list page (or
 * an instance page the crawl visited) shows - by address or by link name -
 * is marked seen, and any other is marked Not seen. A type whose list page
 * the crawl did not reach is left alone, as are objects a run deleted.
 * NEVER rejects: a failure is logged.
 * @param websiteId - The crawled website's cuid
 * @param crawlRunId - The crawl that just ended
 * @param crawledAt - When it started
 * @returns Resolves once checked or the failure is logged
 */
export async function checkCreatedObjectsAfterCrawl(
  websiteId: string,
  crawlRunId: string,
  crawledAt: Date,
): Promise<void> {
  try {
    const createdObjects = await listCreatedObjectsToCheck(websiteId);
    const objectTypeKeys = [...new Set(createdObjects.flatMap((createdObject) => createdObject.objectTypeKey ?? []))];
    const webObjects = await listWebObjectsForWebsite(websiteId);
    const checks: CreatedObjectCheck[] = [];
    for (const objectTypeKey of objectTypeKeys) {
      const listPatternKeys = listTypeListPatternKeys(objectTypeKey, webObjects);
      const listPages = await readCrawlRunPagesMatching(websiteId, crawlRunId, (pageUrl) =>
        listPatternKeys.some((listPatternKey) => urlMatchesPatternKey(pageUrl, listPatternKey)),
      );
      const crawlReachedTheListPage = listPages.length > 0;
      if (!crawlReachedTheListPage) continue;
      const context = buildObjectContext(objectTypeKey, webObjects);
      const listedInstances = readCrawledInstances(listPages, context);
      for (const createdObject of createdObjects.filter((candidate) => candidate.objectTypeKey === objectTypeKey)) {
        const createdIdentity = createdObject.url === null ? null : readPageIdentity(createdObject.url);
        const isListed = listedInstances.some(
          (listedInstance) =>
            (createdIdentity !== null && listedInstance.url === createdIdentity) ||
            normalizeFieldName(listedInstance.name) === normalizeFieldName(createdObject.name),
        );
        checks.push({ createdObjectId: createdObject.id, isListed });
      }
    }
    await saveCreatedObjectChecks(websiteId, checks, crawledAt);
  } catch (checkError: unknown) {
    console.error(
      `[parameters] website ${websiteId} could not check its created objects after crawl ${crawlRunId}: ${describeError(checkError)}`,
    );
  }
}
