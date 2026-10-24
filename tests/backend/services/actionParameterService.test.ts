import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ActionWithCredential,
  CreatedObjectWithSources,
  WebObjectWithPatterns,
} from "../../../server/services/dbService.js";
import type { ActionPlanRunResult } from "../../../server/services/actionPlanRunnerService.js";
import type { ActionPlan } from "../../../server/utils/actionPlanSchema.js";
import type { ActionParameterRecord, AppliedParameterValues, ObjectChoice } from "../../../server/utils/actionParameters.js";
import type { FormField } from "../../../server/utils/formFields.js";

/**
 * The database is replaced: this spec is about what the service reads,
 * decides, and saves. Detection, binding, and scoring run for real - their
 * own specs cover their rules.
 */
const { mockDbService } = vi.hoisted(() => ({
  mockDbService: {
    createCreatedObject: vi.fn(),
    findActionForWebsite: vi.fn(),
    findActionParameterSyncInputs: vi.fn(),
    findLatestCrawlPagesMatching: vi.fn(),
    findNewestActionPlan: vi.fn(),
    listActionIdsForWebsite: vi.fn(),
    listActionParametersForAction: vi.fn(),
    listChoosableCreatedObjects: vi.fn(),
    listCreatedObjectsToCheck: vi.fn(),
    listWebObjectsForWebsite: vi.fn(),
    markCreatedObjectDeletedByRun: vi.fn(),
    readCrawlRunPagesMatching: vi.fn(),
    saveCreatedObjectChecks: vi.fn(),
    saveSyncedActionParameters: vi.fn(),
  },
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);

import {
  checkCreatedObjectsAfterCrawl,
  ensureActionParametersSynced,
  followUpRecordedRun,
  loadActionRole,
  loadObjectChoices,
  loadVersionParameters,
  prepareParameterRun,
  readPlanUrls,
  syncActionParameters,
  syncActionParametersQuietly,
  syncWebsiteActionParameters,
  toObjectTypeCandidates,
  type RunFollowUp,
  type VersionParametersView,
} from "../../../server/services/actionParameterService.js";

const WEBSITE_ID = "website-1";
const CRAWLED_AT = new Date("2026-10-01T00:00:00.000Z");

/**
 * Builds an action, defaulting to "Create a project", already synced, run
 * logged out, every role choice left on detect.
 * @param overrides - Fields to replace
 * @returns The action
 */
function buildAction(overrides: Partial<ActionWithCredential> = {}): ActionWithCredential {
  return {
    id: "action-1",
    websiteId: WEBSITE_ID,
    credentialId: null,
    title: "Create a project",
    description: "",
    userActionKind: null,
    userObjectTypeKey: null,
    userNameParameterKey: null,
    userDeletesObject: null,
    parametersSyncedAt: new Date("2026-10-02T00:00:00.000Z"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    deletedAt: null,
    credential: null,
    ...overrides,
  };
}

/**
 * Builds a web object with its patterns.
 * @param instancePatternKey - Its own page's pattern
 * @param detectedName - Its detected name
 * @param patterns - Its other patterns, by key and role
 * @returns The web object
 */
function buildWebObject(
  instancePatternKey: string,
  detectedName: string,
  patterns: { key: string; role: string }[] = [],
): WebObjectWithPatterns {
  const createdAt = new Date("2026-09-30T00:00:00.000Z");
  return {
    id: `web-object-${detectedName}`,
    websiteId: WEBSITE_ID,
    crawlRunId: "crawl-1",
    parentWebObjectId: null,
    instancePatternKey,
    detectedName,
    name: null,
    instanceCount: 2,
    skippedLinkCount: 0,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    crawlRun: { id: "crawl-1", createdAt },
    pagePatterns: [{ key: instancePatternKey, role: "instance" }, ...patterns].map((pattern, patternIndex) => ({
      id: `pattern-${detectedName}-${String(patternIndex)}`,
      websiteId: WEBSITE_ID,
      crawlRunId: "crawl-1",
      webObjectId: `web-object-${detectedName}`,
      key: pattern.key,
      segments: [],
      role: pattern.role,
      viewName: null,
      detectedBy: "url",
      pageCount: 1,
      sortOrder: patternIndex,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    })),
  };
}

/** Projects: their own pages, and a create page. */
const PROJECT_OBJECT = buildWebObject("/projects/{project}", "Project", [{ key: "/projects/new", role: "create" }]);

/** Types a project's name, creates it, then checks its heading. */
const CREATE_PLAN: ActionPlan = {
  name: "Create a project",
  startUrl: "https://example.com/projects/new",
  steps: [
    { action: "fill", target: { label: "Project name" }, value: "Apollo 7" },
    { action: "click", target: { role: "button", name: "Create project" }, value: null },
    { action: "expectVisible", target: { role: "heading", name: "Apollo 7" }, value: null },
  ],
};

/** Opens the Mercury project from the list. */
const OPEN_PLAN: ActionPlan = {
  name: "Open a project",
  startUrl: "https://example.com/projects",
  steps: [{ action: "click", target: { role: "link", name: "Mercury" }, value: null }],
};

/** The projects list as the crawl saw it: two projects, the create link, and a repeat. */
const PROJECTS_LIST_SNAPSHOT = [
  '- list:',
  '  - link "Mercury":',
  '    - /url: /projects/m',
  '  - link "Apollo 7":',
  '    - /url: /projects/a7',
  '  - link "New project":',
  '    - /url: /projects/new',
  '  - link "Mercury again":',
  '    - /url: /projects/m',
].join("\n");

/**
 * Builds a parameter row, defaulting to the detected "Project name" field.
 * @param overrides - Fields to replace
 * @returns The row
 */
function buildRow(overrides: Partial<ActionParameterRecord> = {}): ActionParameterRecord {
  return {
    id: "parameter-1",
    key: "projectName",
    kind: "text",
    source: "steps",
    foundBy: ["plan"],
    isSecret: false,
    label: "Project name",
    userLabel: null,
    fieldTarget: { label: "Project name" },
    fieldRole: null,
    inputType: null,
    placeholder: null,
    stepAction: "fill",
    pageUrl: null,
    containerName: null,
    besideKeys: [],
    fillAfterKey: null,
    userRequiredChoice: null,
    runIsRequired: null,
    runReadAt: null,
    crawlIsRequired: null,
    crawlReadAt: null,
    objectTypeKey: null,
    matchText: null,
    matchFields: [],
    ...overrides,
  };
}

/** The object row of an Object action on projects. */
const OBJECT_ROW = buildRow({
  id: "parameter-object",
  key: "object",
  kind: "object",
  label: "Project",
  fieldTarget: null,
  stepAction: null,
  objectTypeKey: "/projects/{project}",
});

/**
 * Builds a created object as its reads return it.
 * @param overrides - Fields to replace
 * @returns The row
 */
function buildCreatedObject(overrides: Partial<CreatedObjectWithSources> = {}): CreatedObjectWithSources {
  const createdAt = new Date("2026-10-03T00:00:00.000Z");
  return {
    id: "created-1",
    websiteId: WEBSITE_ID,
    actionId: "action-1",
    actionScriptId: "script-1",
    actionScriptRunId: "run-1",
    objectTypeKey: "/projects/{project}",
    objectTypeName: "Project",
    name: "Apollo 7",
    url: "https://example.com/projects/a7",
    lastSeenAt: null,
    notSeenSince: null,
    deletedOnSiteAt: null,
    deletedByActionScriptRunId: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    action: { id: "action-1", title: "Create a project", deletedAt: null },
    deletedByActionScriptRun: null,
    ...overrides,
  };
}

/**
 * Builds a runner result, defaulting to a passed run with nothing read.
 * @param overrides - Fields to replace
 * @returns The result
 */
function buildRunResult(overrides: Partial<ActionPlanRunResult> = {}): ActionPlanRunResult {
  return {
    succeeded: true,
    timedOut: false,
    errorMessage: null,
    failedStepNumber: null,
    output: "",
    outputWasTruncated: false,
    failureScreenshotWasCaptured: false,
    failingPageUrl: null,
    failingPageAriaSnapshot: null,
    durationMs: 10,
    fieldReadings: [],
    confirmStepSucceeded: null,
    pageUrlAfterConfirm: null,
    finalPageUrl: null,
    ...overrides,
  };
}

/**
 * Builds the values a run used.
 * @param usedValues - The stored values
 * @returns The applied values, with the plan unchanged
 */
function buildApplied(usedValues: AppliedParameterValues["usedValues"]): AppliedParameterValues {
  return { plan: CREATE_PLAN, skippedStepNumbers: [], insertedSteps: [], usedValues, secretValues: [], problems: [] };
}

/**
 * Builds a crawled choice.
 * @param name - The object's name
 * @param url - Its page
 * @returns The choice
 */
function buildCrawledChoice(name: string, url: string): ObjectChoice {
  return { name, url, source: "crawl", createdObjectId: null, createdByActionTitle: null, createdAt: null, seenOnCrawl: true };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockDbService.findActionParameterSyncInputs.mockResolvedValue({ versions: [], failingPageSnapshots: [], reservedKeys: [] });
  mockDbService.listWebObjectsForWebsite.mockResolvedValue([PROJECT_OBJECT]);
  mockDbService.findLatestCrawlPagesMatching.mockResolvedValue({ crawlRunId: null, crawledAt: null, pages: [] });
  mockDbService.findNewestActionPlan.mockResolvedValue(null);
  mockDbService.listActionParametersForAction.mockResolvedValue([]);
  mockDbService.listChoosableCreatedObjects.mockResolvedValue([]);
  mockDbService.listCreatedObjectsToCheck.mockResolvedValue([]);
  mockDbService.readCrawlRunPagesMatching.mockResolvedValue([]);
  mockDbService.listActionIdsForWebsite.mockResolvedValue([]);
  mockDbService.findActionForWebsite.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("role inputs", () => {
  it("turns web objects into type candidates: the saved name, else the detected one, and the own and create pages", () => {
    const namedObject = { ...buildWebObject("/teams/{team}", "Team", [{ key: "/teams", role: "collection" }]), name: "Squad" };
    expect(toObjectTypeCandidates([PROJECT_OBJECT, namedObject])).toEqual([
      { objectTypeKey: "/projects/{project}", name: "Project", addressPatternKeys: ["/projects/{project}", "/projects/new"] },
      { objectTypeKey: "/teams/{team}", name: "Squad", addressPatternKeys: ["/teams/{team}"] },
    ]);
  });

  it("lists the addresses a plan opens", () => {
    expect(readPlanUrls(null)).toEqual([]);
    expect(
      readPlanUrls({
        ...OPEN_PLAN,
        steps: [...OPEN_PLAN.steps, { action: "goto", target: null, value: "https://example.com/projects/m" }],
      }),
    ).toEqual(["https://example.com/projects", "https://example.com/projects/m"]);
  });

  it("works out an action's role from the web objects and its newest version", async () => {
    mockDbService.findNewestActionPlan.mockResolvedValue(CREATE_PLAN);

    const role = await loadActionRole(WEBSITE_ID, buildAction({ title: "Make it", description: "" }));

    expect(mockDbService.findNewestActionPlan).toHaveBeenCalledWith(WEBSITE_ID, "action-1");
    // The title says "make" (create); the create page decides the type on its own.
    expect(role).toMatchObject({ kind: "create", objectTypeKey: "/projects/{project}", objectTypeName: "Project" });
  });
});

describe("syncActionParameters", () => {
  const projectFormFields: FormField[] = [
    { role: "textbox", inputType: "text", label: "Project name", placeholder: null, isRequired: true, containerNumber: 1, containerName: null },
    { role: "textbox", inputType: "textarea", label: "Description", placeholder: null, isRequired: false, containerNumber: 1, containerName: null },
  ];

  beforeEach(() => {
    mockDbService.findActionParameterSyncInputs.mockResolvedValue({
      versions: [{ id: "script-1", plan: CREATE_PLAN, contextPageUrls: ["https://example.com/projects?page=2"] }],
      failingPageSnapshots: [],
      reservedKeys: ["mission"],
    });
    mockDbService.findLatestCrawlPagesMatching.mockResolvedValue({
      crawlRunId: "crawl-1",
      crawledAt: CRAWLED_AT,
      pages: [{ url: "https://example.com/projects/new", title: null, ariaSnapshot: null, formFields: projectFormFields }],
    });
  });

  it("reads only the pages the versions visit from the action's crawl, and saves what detection finds", async () => {
    await syncActionParameters(WEBSITE_ID, buildAction({ credentialId: "credential-1" }));

    const [crawlWebsiteId, crawlCredentialId, keepPage] = mockDbService.findLatestCrawlPagesMatching.mock.calls[0] as [
      string,
      string | null,
      (pageUrl: string) => boolean,
    ];
    expect([crawlWebsiteId, crawlCredentialId]).toEqual([WEBSITE_ID, "credential-1"]);
    expect(keepPage("https://example.com/projects/new")).toBe(true);
    expect(keepPage("https://example.com/projects")).toBe(true);
    expect(keepPage("https://example.com/teams")).toBe(false);

    const [savedWebsiteId, savedActionId, detectedRows, readTimes] = mockDbService.saveSyncedActionParameters.mock.calls[0] as [
      string,
      string,
      { key: string; source: string; crawlIsRequired: boolean | null }[],
      unknown,
    ];
    expect([savedWebsiteId, savedActionId]).toEqual([WEBSITE_ID, "action-1"]);
    expect(detectedRows.map((row) => [row.key, row.source, row.crawlIsRequired])).toEqual([
      ["projectName", "steps", true],
      ["description", "page", false],
    ]);
    expect(readTimes).toEqual({ crawlReadAt: CRAWLED_AT, runReadAt: null });
  });

  it("passes a run's readings to detection and stamps when they were read", async () => {
    const readAt = new Date("2026-10-04T00:00:00.000Z");

    await syncActionParameters(WEBSITE_ID, buildAction(), {
      plan: CREATE_PLAN,
      readAt,
      readings: [
        {
          stepNumber: 1,
          pageUrl: "https://example.com/projects/new",
          fields: [{ ...projectFormFields[0], isRequired: false }, { ...projectFormFields[1], isRequired: true }],
          targetFieldIndex: 0,
        },
      ],
    });

    const [, , detectedRows, readTimes] = mockDbService.saveSyncedActionParameters.mock.calls[0] as [
      string,
      string,
      { key: string; runIsRequired: boolean | null | undefined }[],
      unknown,
    ];
    expect(detectedRows.map((row) => [row.key, row.runIsRequired])).toEqual([
      ["projectName", false],
      ["description", true],
    ]);
    expect(readTimes).toEqual({ crawlReadAt: CRAWLED_AT, runReadAt: readAt });
  });

  it("syncs a never-synced action once, before its first read", async () => {
    await ensureActionParametersSynced(WEBSITE_ID, buildAction());
    expect(mockDbService.saveSyncedActionParameters).not.toHaveBeenCalled();

    await ensureActionParametersSynced(WEBSITE_ID, buildAction({ parametersSyncedAt: null }));
    expect(mockDbService.saveSyncedActionParameters).toHaveBeenCalledTimes(1);
  });

  it("logs a failed sync instead of failing the request that caused it", async () => {
    mockDbService.findActionParameterSyncInputs.mockRejectedValue(new Error("database down"));

    await expect(syncActionParametersQuietly(WEBSITE_ID, buildAction())).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith("[parameters] action action-1 could not sync its parameters: database down");
  });

  it("syncs every action of a website after a crawl, going on past one that fails or is gone", async () => {
    mockDbService.listActionIdsForWebsite.mockResolvedValue(["action-1", "action-2", "action-gone"]);
    mockDbService.findActionForWebsite.mockImplementation((_websiteId: string, actionId: string) =>
      Promise.resolve(actionId === "action-gone" ? null : buildAction({ id: actionId })),
    );
    mockDbService.findActionParameterSyncInputs.mockRejectedValueOnce(new Error("locked"));

    await syncWebsiteActionParameters(WEBSITE_ID);

    expect(mockDbService.saveSyncedActionParameters).toHaveBeenCalledTimes(1);
    expect(mockDbService.saveSyncedActionParameters.mock.calls[0][1]).toBe("action-2");
    expect(console.error).toHaveBeenCalledWith("[parameters] action action-1 could not sync its parameters: locked");
  });

  it("logs a website sync that cannot even list its actions", async () => {
    mockDbService.listActionIdsForWebsite.mockRejectedValue(new Error("database down"));

    await expect(syncWebsiteActionParameters(WEBSITE_ID)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[parameters] website website-1 could not sync its actions' parameters: database down",
    );
  });
});

describe("loadObjectChoices", () => {
  const projectContext = { instancePatternKey: "/projects/{project}", createPatternKeys: ["/projects/new"], instances: [] };

  beforeEach(() => {
    mockDbService.findLatestCrawlPagesMatching.mockResolvedValue({
      crawlRunId: "crawl-1",
      crawledAt: CRAWLED_AT,
      pages: [{ url: "https://example.com/projects", title: "Projects", ariaSnapshot: PROJECTS_LIST_SNAPSHOT, formFields: [] }],
    });
  });

  it("lists the created objects first - marked when the crawl also saw them - then the crawled ones", async () => {
    mockDbService.listChoosableCreatedObjects.mockResolvedValue([
      buildCreatedObject(),
      buildCreatedObject({ id: "created-2", name: "Gemini", url: null }),
      buildCreatedObject({ id: "created-3", name: "mercury", url: null }),
    ]);

    const choices = await loadObjectChoices(WEBSITE_ID, "credential-1", projectContext, [PROJECT_OBJECT]);

    expect(mockDbService.listChoosableCreatedObjects).toHaveBeenCalledWith(WEBSITE_ID, "/projects/{project}");
    expect(choices.map((choice) => [choice.name, choice.source, choice.seenOnCrawl, choice.createdObjectId])).toEqual([
      ["Apollo 7", "created", true, "created-1"],
      ["Gemini", "created", false, "created-2"],
      ["mercury", "created", true, "created-3"],
    ]);
    expect(choices[0]).toMatchObject({ createdByActionTitle: "Create a project", url: "https://example.com/projects/a7" });
  });

  it("reads each crawled instance once, by its link, never the create page", async () => {
    const choices = await loadObjectChoices(WEBSITE_ID, null, projectContext, [PROJECT_OBJECT]);

    expect(choices).toEqual([
      buildCrawledChoice("Mercury", "https://example.com/projects/m"),
      buildCrawledChoice("Apollo 7", "https://example.com/projects/a7"),
    ]);
  });

  it("reads the type's instance pages and its list page: the crawled collection, else the pattern's parent", async () => {
    await loadObjectChoices(WEBSITE_ID, null, projectContext, [PROJECT_OBJECT]);
    const keepPage = mockDbService.findLatestCrawlPagesMatching.mock.calls[0][2] as (pageUrl: string) => boolean;
    expect(keepPage("https://example.com/projects")).toBe(true);
    expect(keepPage("https://example.com/projects/m")).toBe(true);
    expect(keepPage("https://example.com/teams")).toBe(false);

    const objectWithACollection = buildWebObject("/projects/{project}", "Project", [{ key: "/all-projects", role: "collection" }]);
    await loadObjectChoices(WEBSITE_ID, null, projectContext, [objectWithACollection]);
    const collectionKeepPage = mockDbService.findLatestCrawlPagesMatching.mock.calls[1][2] as (pageUrl: string) => boolean;
    expect(collectionKeepPage("https://example.com/all-projects")).toBe(true);
    expect(collectionKeepPage("https://example.com/projects")).toBe(false);
  });

  it("lists nothing for an action with no type", async () => {
    expect(await loadObjectChoices(WEBSITE_ID, null, { ...projectContext, instancePatternKey: null }, [])).toEqual([]);
    expect(mockDbService.findLatestCrawlPagesMatching).not.toHaveBeenCalled();
  });
});

describe("loadVersionParameters", () => {
  it("builds a Create version's view: its parameters, confirm step, name parameter, and texts", async () => {
    mockDbService.listActionParametersForAction.mockResolvedValue([buildRow()]);
    mockDbService.findNewestActionPlan.mockResolvedValue(CREATE_PLAN);

    const view = await loadVersionParameters(WEBSITE_ID, buildAction(), { plan: CREATE_PLAN });

    expect(mockDbService.findActionParameterSyncInputs).not.toHaveBeenCalled();
    expect(mockDbService.findLatestCrawlPagesMatching).not.toHaveBeenCalled();
    expect(view.role.kind).toBe("create");
    expect(view.parameters.map((parameter) => [parameter.key, parameter.defaultValue])).toEqual([["projectName", "Apollo 7"]]);
    expect(view).toMatchObject({ objectChoices: [], confirmStepNumber: 2, nameParameterKey: "projectName", warnings: [] });
    expect(view.bindableTexts.map((bindableText) => bindableText.text)).toEqual(["Apollo 7", "Create project"]);
  });

  it("syncs a never-synced action before reading its rows", async () => {
    await loadVersionParameters(WEBSITE_ID, buildAction({ parametersSyncedAt: null }), { plan: CREATE_PLAN });

    expect(mockDbService.saveSyncedActionParameters).toHaveBeenCalledTimes(1);
  });

  it("warns about a Create version with no confirm step, or with nothing to name the object", async () => {
    const typeOnlyPlan: ActionPlan = { ...CREATE_PLAN, steps: [CREATE_PLAN.steps[0]] };
    mockDbService.listActionParametersForAction.mockResolvedValue([buildRow()]);
    const noConfirmView = await loadVersionParameters(WEBSITE_ID, buildAction(), { plan: typeOnlyPlan });
    expect(noConfirmView.warnings).toEqual(["No confirm step found, so created objects can't be recorded"]);

    mockDbService.listActionParametersForAction.mockResolvedValue([]);
    const unnamedView = await loadVersionParameters(WEBSITE_ID, buildAction(), { plan: CREATE_PLAN });
    expect(unnamedView.warnings).toEqual(["No parameter names the new object, so created objects are recorded without a name"]);
  });

  it("gives an Object version its choices, and binds the object the steps name", async () => {
    mockDbService.listActionParametersForAction.mockResolvedValue([OBJECT_ROW]);
    mockDbService.findLatestCrawlPagesMatching.mockResolvedValue({
      crawlRunId: "crawl-1",
      crawledAt: CRAWLED_AT,
      pages: [{ url: "https://example.com/projects", title: null, ariaSnapshot: PROJECTS_LIST_SNAPSHOT, formFields: [] }],
    });
    const openAction = buildAction({ title: "Open a project" });

    const view = await loadVersionParameters(WEBSITE_ID, openAction, { plan: OPEN_PLAN });

    expect(view.objectChoices.map((choice) => choice.name)).toEqual(["Mercury", "Apollo 7"]);
    expect(view.parameters).toEqual([
      expect.objectContaining({ key: "object", defaultValue: "Mercury", isRequired: true, requiredReason: "object" }),
    ]);
    expect(view).toMatchObject({ confirmStepNumber: null, nameParameterKey: null, warnings: [] });

    const namesNothingView = await loadVersionParameters(WEBSITE_ID, openAction, {
      plan: { ...OPEN_PLAN, steps: [{ action: "click", target: { role: "link", name: "Settings" }, value: null }] },
    });
    expect(namesNothingView.warnings).toEqual([
      'Nothing in this version\'s steps names a Project - add it as "A value in the steps"',
    ]);
  });
});

describe("prepareParameterRun", () => {
  /**
   * Builds a Create version's view from the real loader.
   * @returns The view
   */
  async function loadCreateView(): Promise<VersionParametersView> {
    mockDbService.listActionParametersForAction.mockResolvedValue([buildRow()]);
    return loadVersionParameters(WEBSITE_ID, buildAction(), { plan: CREATE_PLAN });
  }

  it("refuses keys the version does not have, naming the ones it does", async () => {
    const view = await loadCreateView();

    expect(prepareParameterRun(view, CREATE_PLAN, { code: "x" })).toEqual({
      isReady: false,
      errorMessage: 'Unknown parameter "code"; this version\'s parameters are: projectName',
    });
    expect(prepareParameterRun({ ...view, parameters: [] }, CREATE_PLAN, { code: "x", size: "y" })).toEqual({
      isReady: false,
      errorMessage: 'Unknown parameters "code", "size"; this version\'s parameters are: none',
    });
  });

  it("refuses values that do not fit, with every reason", async () => {
    const view = await loadCreateView();

    expect(prepareParameterRun(view, CREATE_PLAN, { projectName: " " })).toEqual({
      isReady: false,
      errorMessage: '"Project name" is required',
    });
  });

  it("returns the run's plan and what the runner does differently", async () => {
    const view = await loadCreateView();

    const prepared = prepareParameterRun(view, CREATE_PLAN, { projectName: "Voyager" });

    expect(prepared.isReady).toBe(true);
    if (!prepared.isReady) return;
    expect(prepared.applied.plan.steps[0].value).toBe("Voyager");
    expect(prepared.parameterRun).toEqual({
      skippedStepNumbers: [],
      insertedSteps: [],
      secretValues: [],
      readFieldsAfterStepNumbers: [1],
      confirmStepNumber: 2,
    });
  });
});

describe("followUpRecordedRun", () => {
  /**
   * Builds a follow-up for a version view.
   * @param view - The view the run started from
   * @param applied - The values it used
   * @param runResult - What the runner reported
   * @returns The follow-up
   */
  function buildFollowUp(view: VersionParametersView, applied: AppliedParameterValues, runResult: ActionPlanRunResult): RunFollowUp {
    return {
      websiteId: WEBSITE_ID,
      action: buildAction({ title: view.role.kind === "create" ? "Create a project" : "Delete a project" }),
      actionScriptId: "script-1",
      plan: CREATE_PLAN,
      actionScriptRunId: "run-9",
      view,
      applied,
      runResult,
    };
  }

  /**
   * Loads a real view for an action.
   * @param title - The action's title (it decides the kind)
   * @returns The view
   */
  async function loadView(title: string): Promise<VersionParametersView> {
    mockDbService.listActionParametersForAction.mockResolvedValue([buildRow()]);
    return loadVersionParameters(WEBSITE_ID, buildAction({ title }), { plan: CREATE_PLAN });
  }

  it("syncs with the run's readings, then records what a Create run made, at the first instance address", async () => {
    const view = await loadView("Create a project");
    const fieldReadings = [{ stepNumber: 1, pageUrl: "https://example.com/projects/new", fields: [], targetFieldIndex: -1 }];

    await followUpRecordedRun(
      buildFollowUp(
        view,
        buildApplied([{ key: "projectName", label: "Project name", value: "Voyager" }]),
        buildRunResult({
          succeeded: false,
          confirmStepSucceeded: true,
          fieldReadings,
          pageUrlAfterConfirm: "https://example.com/projects/new",
          finalPageUrl: "https://example.com/projects/v1?tab=1",
        }),
      ),
    );

    expect(mockDbService.findActionParameterSyncInputs).toHaveBeenCalledWith(WEBSITE_ID, "action-1");
    expect(mockDbService.saveSyncedActionParameters).toHaveBeenCalledWith(
      WEBSITE_ID,
      "action-1",
      expect.any(Array),
      expect.objectContaining({ runReadAt: expect.any(Date) as Date }),
    );
    expect(mockDbService.createCreatedObject).toHaveBeenCalledWith(WEBSITE_ID, {
      actionId: "action-1",
      actionScriptId: "script-1",
      actionScriptRunId: "run-9",
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      name: "Voyager",
      url: "https://example.com/projects/v1?tab=1",
    });
  });

  it("records an object with no instance address under the action's type, and names a nameless one", async () => {
    const view = await loadView("Create a project");

    await followUpRecordedRun(
      buildFollowUp({ ...view, nameParameterKey: null }, buildApplied([]), buildRunResult({ confirmStepSucceeded: true })),
    );

    expect(mockDbService.createCreatedObject).toHaveBeenCalledWith(
      WEBSITE_ID,
      expect.objectContaining({ objectTypeKey: "/projects/{project}", objectTypeName: "Project", name: "Unnamed Project", url: null }),
    );
  });

  it("names an object of no known type plainly", async () => {
    mockDbService.listWebObjectsForWebsite.mockResolvedValue([]);
    const view = await loadView("Create a widget");

    await followUpRecordedRun(buildFollowUp(view, buildApplied([]), buildRunResult({ confirmStepSucceeded: true })));

    expect(mockDbService.createCreatedObject).toHaveBeenCalledWith(
      WEBSITE_ID,
      expect.objectContaining({ objectTypeKey: null, objectTypeName: null, name: "Unnamed object" }),
    );
  });

  it("records nothing when the confirm step errored or never ran", async () => {
    const view = await loadView("Create a project");

    await followUpRecordedRun(buildFollowUp(view, buildApplied([]), buildRunResult({ confirmStepSucceeded: false })));
    await followUpRecordedRun(buildFollowUp(view, buildApplied([]), buildRunResult({ confirmStepSucceeded: null })));

    expect(mockDbService.createCreatedObject).not.toHaveBeenCalled();
  });

  it("marks the created object a passed deleting run ran on, matched by name", async () => {
    const view = await loadView("Delete a project");
    const deleteView: VersionParametersView = {
      ...view,
      objectChoices: [
        { ...buildCrawledChoice("Apollo 7", "https://example.com/projects/a7"), source: "created", createdObjectId: "created-1" },
        buildCrawledChoice("Mercury", "https://example.com/projects/m"),
      ],
    };
    expect(deleteView.role).toMatchObject({ kind: "object", deletesObject: true });

    await followUpRecordedRun(
      buildFollowUp(deleteView, buildApplied([{ key: "object", label: "Project", value: "apollo 7" }]), buildRunResult()),
    );
    expect(mockDbService.markCreatedObjectDeletedByRun).toHaveBeenCalledWith(WEBSITE_ID, "created-1", "run-9");

    mockDbService.markCreatedObjectDeletedByRun.mockClear();
    await followUpRecordedRun(
      buildFollowUp(deleteView, buildApplied([{ key: "object", label: "Project", value: "Mercury" }]), buildRunResult()),
    );
    await followUpRecordedRun(
      buildFollowUp(
        deleteView,
        buildApplied([{ key: "object", label: "Project", value: "Apollo 7" }]),
        buildRunResult({ succeeded: false }),
      ),
    );
    expect(mockDbService.markCreatedObjectDeletedByRun).not.toHaveBeenCalled();
  });

  it("logs each step that fails and still does the rest", async () => {
    const view = await loadView("Create a project");
    mockDbService.findActionParameterSyncInputs.mockRejectedValue(new Error("locked"));
    mockDbService.createCreatedObject.mockRejectedValue(new Error("duplicate run"));

    await expect(
      followUpRecordedRun(buildFollowUp(view, buildApplied([]), buildRunResult({ confirmStepSucceeded: true }))),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith("[parameters] run run-9 could not sync its parameters: locked");
    expect(console.error).toHaveBeenCalledWith("[parameters] run run-9 could not record the object it created: duplicate run");
  });
});

describe("checkCreatedObjectsAfterCrawl", () => {
  it("marks the objects the list page shows - by address or link name - as seen, and the others not seen", async () => {
    mockDbService.listCreatedObjectsToCheck.mockResolvedValue([
      buildCreatedObject(),
      buildCreatedObject({ id: "created-2", name: "mercury", url: null }),
      buildCreatedObject({ id: "created-3", name: "Gone", url: "https://example.com/projects/gone" }),
      buildCreatedObject({ id: "created-4", objectTypeKey: "/schools/{school}", name: "Forge" }),
    ]);
    mockDbService.readCrawlRunPagesMatching.mockImplementation(
      (_websiteId: string, _crawlRunId: string, keepPage: (pageUrl: string) => boolean) =>
        Promise.resolve(
          keepPage("https://example.com/projects")
            ? [{ url: "https://example.com/projects", title: null, ariaSnapshot: PROJECTS_LIST_SNAPSHOT, formFields: [] }]
            : [],
        ),
    );

    await checkCreatedObjectsAfterCrawl(WEBSITE_ID, "crawl-2", CRAWLED_AT);

    expect(mockDbService.readCrawlRunPagesMatching).toHaveBeenCalledTimes(2);
    // The schools list was not reached, so Forge is left alone.
    expect(mockDbService.saveCreatedObjectChecks).toHaveBeenCalledWith(
      WEBSITE_ID,
      [
        { createdObjectId: "created-1", isListed: true },
        { createdObjectId: "created-2", isListed: true },
        { createdObjectId: "created-3", isListed: false },
      ],
      CRAWLED_AT,
    );
  });

  it("logs a check that fails instead of failing the crawl", async () => {
    mockDbService.listCreatedObjectsToCheck.mockRejectedValue(new Error("database down"));

    await expect(checkCreatedObjectsAfterCrawl(WEBSITE_ID, "crawl-2", CRAWLED_AT)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[parameters] website website-1 could not check its created objects after crawl crawl-2: database down",
    );
  });
});
