import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionPlan } from "../../../server/utils/actionPlanSchema.js";

/**
 * `dbService` reads DATABASE_URL and constructs the PrismaPg adapter in its
 * MODULE BODY, so both have to be in place before the import below is
 * evaluated. `vi.hoisted` runs ahead of the hoisted imports, which is the only
 * hook early enough to do it.
 */
const {
  mockWebsiteDelegate,
  mockUseCaseDelegate,
  mockActionDelegate,
  mockScreenshotRunDelegate,
  mockActionScriptDelegate,
  mockActionScriptRunDelegate,
  mockActionScriptRefinementDelegate,
  mockCrawlRunDelegate,
  mockCrawledPageDelegate,
  mockCredentialDelegate,
  mockWebObjectDelegate,
  mockPagePatternDelegate,
  mockActionParameterDelegate,
  mockCreatedObjectDelegate,
  mockTransaction,
} = vi.hoisted(
  () => {
    process.env.DATABASE_URL = "postgresql://tester@localhost:5432/easy_test_unit?schema=public";

    /**
     * Builds a stand-in for one Prisma model delegate (`prisma.website`,
     * `prisma.useCase`, `prisma.action`, `prisma.screenshotRun`,
     * `prisma.actionScript`, `prisma.actionScriptRun`,
     * `prisma.actionScriptRefinement`, `prisma.crawlRun`,
     * `prisma.crawledPage`, `prisma.credential`, `prisma.webObject`,
     * `prisma.pagePattern`) carrying every method dbService calls.
     * @returns An object whose query methods are bare vitest mocks
     */
    function createMockModelDelegate() {
      return {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        createMany: vi.fn(),
      };
    }

    const websiteDelegate = createMockModelDelegate();
    const useCaseDelegate = createMockModelDelegate();
    const actionDelegate = createMockModelDelegate();
    const screenshotRunDelegate = createMockModelDelegate();
    const actionScriptDelegate = createMockModelDelegate();
    const actionScriptRunDelegate = createMockModelDelegate();
    const actionScriptRefinementDelegate = createMockModelDelegate();
    const crawlRunDelegate = createMockModelDelegate();
    const crawledPageDelegate = createMockModelDelegate();
    const credentialDelegate = createMockModelDelegate();
    const webObjectDelegate = createMockModelDelegate();
    const pagePatternDelegate = createMockModelDelegate();
    const actionParameterDelegate = createMockModelDelegate();
    const createdObjectDelegate = createMockModelDelegate();
    // The transaction-scoped client exposes the same delegates, so assertions
    // on a delegate hold whether a query ran inside or outside `$transaction`.
    const transactionClient = {
      website: websiteDelegate,
      useCase: useCaseDelegate,
      action: actionDelegate,
      screenshotRun: screenshotRunDelegate,
      actionScript: actionScriptDelegate,
      actionScriptRun: actionScriptRunDelegate,
      actionScriptRefinement: actionScriptRefinementDelegate,
      crawlRun: crawlRunDelegate,
      crawledPage: crawledPageDelegate,
      credential: credentialDelegate,
      webObject: webObjectDelegate,
      pagePattern: pagePatternDelegate,
      actionParameter: actionParameterDelegate,
      createdObject: createdObjectDelegate,
    };

    return {
      mockWebsiteDelegate: websiteDelegate,
      mockUseCaseDelegate: useCaseDelegate,
      mockActionDelegate: actionDelegate,
      mockScreenshotRunDelegate: screenshotRunDelegate,
      mockActionScriptDelegate: actionScriptDelegate,
      mockActionScriptRunDelegate: actionScriptRunDelegate,
      mockActionScriptRefinementDelegate: actionScriptRefinementDelegate,
      mockCrawlRunDelegate: crawlRunDelegate,
      mockCrawledPageDelegate: crawledPageDelegate,
      mockCredentialDelegate: credentialDelegate,
      mockWebObjectDelegate: webObjectDelegate,
      mockPagePatternDelegate: pagePatternDelegate,
      mockActionParameterDelegate: actionParameterDelegate,
      mockCreatedObjectDelegate: createdObjectDelegate,
      // Interactive-transaction form only: run the callback against the
      // transaction-scoped client and resolve with whatever it returns.
      mockTransaction: vi.fn(
        (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    };
  },
);

// The generated client and the driver adapter are both stubbed: this spec is
// about the query shapes dbService builds, not about Postgres itself. The real
// database round-trip is proven separately by the manual verification run.
// Both are instantiated with `new`, so the stubs have to be constructible -
// an arrow function is not, and vitest rejects it at construction time.
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {},
}));

vi.mock("../../../server/generated/prisma/client.js", () => ({
  PrismaClient: class MockPrismaClient {
    website = mockWebsiteDelegate;
    useCase = mockUseCaseDelegate;
    action = mockActionDelegate;
    screenshotRun = mockScreenshotRunDelegate;
    actionScript = mockActionScriptDelegate;
    actionScriptRun = mockActionScriptRunDelegate;
    actionScriptRefinement = mockActionScriptRefinementDelegate;
    crawlRun = mockCrawlRunDelegate;
    crawledPage = mockCrawledPageDelegate;
    credential = mockCredentialDelegate;
    webObject = mockWebObjectDelegate;
    pagePattern = mockPagePatternDelegate;
    actionParameter = mockActionParameterDelegate;
    createdObject = mockCreatedObjectDelegate;
    $transaction = mockTransaction;
  },
  // dbService writes Prisma.DbNull to clear a JSON column; a stand-in proves it was used.
  Prisma: { DbNull: "Prisma.DbNull" },
}));

import {
  isUniqueConstraintViolation,
  isRecordNotFound,
  createWebsite,
  listWebsitesWithSummaries,
  findWebsiteByUrl,
  findWebsiteById,
  updateWebsite,
  softDeleteWebsite,
  listUseCasesForWebsite,
  findUseCaseForWebsite,
  createUseCaseForWebsite,
  updateUseCaseForWebsite,
  softDeleteUseCaseForWebsite,
  listActionsForWebsite,
  findActionForWebsite,
  createActionForWebsite,
  updateActionForWebsite,
  softDeleteActionForWebsite,
  listScreenshotRunsForWebsite,
  findScreenshotRunForWebsite,
  createScreenshotRunForWebsite,
  listActionScriptsForAction,
  findActionScriptForAction,
  createActionScriptForAction,
  createRefinedActionScriptForAction,
  listActionScriptRunsForScript,
  findActionScriptRunForScript,
  createActionScriptRunForScript,
  listCrawlRunsForWebsite,
  findCrawlRunForWebsite,
  createCrawlRunForWebsite,
  recordCrawledPage,
  saveCrawledPageStructureSkeletons,
  finishCrawlRun,
  markRunningCrawlRunsInterrupted,
  listCrawledPageSummariesForRun,
  findCrawledPageForRun,
  markCrawlRunLoggedIn,
  listCredentialsForWebsite,
  findCredentialForWebsite,
  findCredentialWithPasswordForWebsite,
  createCredentialForWebsite,
  updateCredentialForWebsite,
  softDeleteCredentialForWebsite,
  adoptWebsiteLoginUrl,
  findLatestCrawledPagesForWebsite,
  replaceWebsiteWebObjects,
  listWebObjectsForWebsite,
  findWebObjectNamesForCrawlRun,
  renameWebObject,
  findActionScriptRunWithObjects,
  readCrawlRunPagesMatching,
  findLatestCrawlPagesMatching,
  toActionParameterRecord,
  listActionParametersForAction,
  findActionParameterSyncInputs,
  findNewestActionPlan,
  saveSyncedActionParameters,
  setActionParameterChoices,
  addUserActionParameter,
  removeUserActionParameter,
  listActionIdsForWebsite,
  createCreatedObject,
  listCreatedObjectsForWebsite,
  listChoosableCreatedObjects,
  removeCreatedObject,
  markCreatedObjectDeletedByRun,
  listCreatedObjectsToCheck,
  saveCreatedObjectChecks,
  type ActionParameter,
  type WebObjectInput,
} from "../../../server/services/dbService.js";
import type { DetectedParameter } from "../../../server/utils/detectActionParameters.js";

const sampleWebsite = {
  id: "cuid-1",
  url: "https://example.com",
  name: "Example",
  description: "a site to test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

const sampleUseCase = {
  id: "use-case-1",
  websiteId: "cuid-1",
  title: "Sign up",
  description: "Create an account",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  deletedAt: null,
};

/** An action that runs logged out, as every action read returns it (with `credential`). */
const sampleAction = {
  id: "action-1",
  websiteId: "cuid-1",
  credentialId: null,
  title: "Log in",
  description: "Enter credentials and submit",
  createdAt: new Date("2026-01-03T00:00:00.000Z"),
  updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  deletedAt: null,
  credential: null,
};

/** The same action linked to a credential, carrying that credential's id and name. */
const sampleLinkedAction = {
  ...sampleAction,
  credentialId: "credential-1",
  credential: { id: "credential-1", name: "Admin" },
};

/** What every action read includes: the id and name of the credential it runs as. */
const ACTION_CREDENTIAL_INCLUDE = { credential: { select: { id: true, name: true } } };

/** An action's object role choices all left on "detect", as every action write carries them. */
const DETECT_EVERY_ROLE_CHOICE = {
  userActionKind: null,
  userObjectTypeKey: null,
  userNameParameterKey: null,
  userDeletesObject: null,
};

const sampleScreenshotRun = {
  id: "screenshot-run-1",
  websiteId: "cuid-1",
  requestedUrl: "https://example.com",
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  screenshotFileName: "cuid-1/run.png",
  durationMs: 840,
  createdAt: new Date("2026-01-04T00:00:00.000Z"),
  updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  deletedAt: null,
};

/** A valid step plan, with its fields in the order they are written. */
const samplePlan: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com",
  steps: [
    { action: "fill", target: { label: "Email" }, value: "{{credential.username}}" },
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
  ],
};

/**
 * The same plan as Postgres `jsonb` hands it back: every object's keys
 * shuffled (jsonb keeps no key order).
 */
const samplePlanWithShuffledKeys = {
  steps: [
    { value: "{{credential.username}}", target: { label: "Email" }, action: "fill" },
    { value: null, target: { name: "Sign in", role: "button" }, action: "click" },
  ],
  startUrl: "https://example.com",
  name: "Log in",
};

const sampleActionScript = {
  id: "action-script-1",
  websiteId: "cuid-1",
  actionId: "action-1",
  websiteName: "Example",
  startUrl: "https://example.com",
  actionTitle: "Log in",
  actionDescription: "Enter credentials and submit",
  credentialId: "credential-1",
  credentialName: "Admin",
  summary: "Logs in",
  assumptions: ["The button says Sign in"],
  plan: samplePlan,
  contextPageUrls: ["https://example.com/", "https://example.com/login"],
  modelId: "claude-opus-5-5",
  effort: "high",
  editedFromActionScriptId: null,
  createdAt: new Date("2026-01-05T00:00:00.000Z"),
  updatedAt: new Date("2026-01-05T00:00:00.000Z"),
  deletedAt: null,
  // Every script read includes the refinement that produced it; this version was not refined.
  refinement: null,
  // ...and its newest run, as `latestRun`; this version has not been run.
  latestRun: null,
};

/**
 * What every action script read (and create) includes: the refinement that
 * produced the version - unless it was soft deleted - with a summary of the
 * failed run it came from, joined (never copied) from that run.
 */
const ACTION_SCRIPT_REFINEMENT_INCLUDE = {
  refinement: {
    where: { deletedAt: null },
    include: {
      actionScriptRun: {
        select: {
          id: true,
          errorMessage: true,
          failedStepNumber: true,
          timedOut: true,
          failingPageAriaSnapshot: true,
        },
      },
    },
  },
};

/** How a version's newest run is read: at most one, the newest active one, cut down to its outcome. */
const LATEST_ACTION_SCRIPT_RUN_QUERY = {
  where: { deletedAt: null },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { id: true, succeeded: true, failedStepNumber: true, timedOut: true, createdAt: true },
};

/** What every action script read (and create) includes: the refinement, and the newest run. */
const ACTION_SCRIPT_INCLUDE = {
  ...ACTION_SCRIPT_REFINEMENT_INCLUDE,
  runs: LATEST_ACTION_SCRIPT_RUN_QUERY,
};

/**
 * What the website's action list includes: the credential, the newest
 * version (with the action text it was generated from and its newest run),
 * and the count of active versions.
 */
const ACTION_LIST_INCLUDE = {
  ...ACTION_CREDENTIAL_INCLUDE,
  scripts: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      actionTitle: true,
      actionDescription: true,
      credentialId: true,
      runs: LATEST_ACTION_SCRIPT_RUN_QUERY,
    },
  },
  _count: { select: { scripts: { where: { deletedAt: null } } } },
};

/**
 * What the website list includes for each website's summary: its active
 * actions with their newest version's newest run, its newest script run, and
 * its newest crawl run.
 */
const WEBSITE_SUMMARY_INCLUDE = {
  actions: {
    where: { deletedAt: null },
    select: {
      scripts: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { runs: LATEST_ACTION_SCRIPT_RUN_QUERY },
      },
    },
  },
  actionScriptRuns: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true },
  },
  crawlRuns: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      visitedPageCount: true,
      pageLimit: true,
      createdAt: true,
      finishedAt: true,
    },
  },
};

/** A passed run, as `LATEST_ACTION_SCRIPT_RUN_QUERY` selects it. */
const samplePassedLatestRun = {
  id: "action-script-run-2",
  succeeded: true,
  failedStepNumber: null,
  timedOut: false,
  createdAt: new Date("2026-01-07T00:00:00.000Z"),
};

/** A failed run, as `LATEST_ACTION_SCRIPT_RUN_QUERY` selects it. */
const sampleFailedLatestRun = {
  id: "action-script-run-3",
  succeeded: false,
  failedStepNumber: 2,
  timedOut: false,
  createdAt: new Date("2026-01-08T00:00:00.000Z"),
};

/** The action text a listed newest version was generated from, as `ACTION_LIST_INCLUDE` selects it. */
const sampleNewestScriptText = {
  actionTitle: "Log in",
  actionDescription: "Enter credentials and submit",
  credentialId: null,
};

/**
 * Builds the row Prisma hands back for a script read with
 * `ACTION_SCRIPT_INCLUDE` from the script dbService should answer with: the
 * same fields without `latestRun`, plus the newest-run list it came from (the
 * one run, or empty when `latestRun` is null).
 * @param script - The script as dbService should return it
 * @returns The Prisma row for that script
 */
function toPrismaActionScriptRow<TScript extends { latestRun: unknown }>(
  script: TScript,
): Omit<TScript, "latestRun"> & { runs: unknown[] } {
  const { latestRun, ...scriptColumnsAndRefinement } = script;
  const newestRunList = latestRun === null ? [] : [latestRun];
  return { ...scriptColumnsAndRefinement, runs: newestRunList };
}

/** The facts a caller supplies when recording a refinement (see `ActionScriptRefinementInput`). */
const sampleRefinementInput = {
  sourceActionScriptId: "action-script-1",
  actionScriptRunId: "action-script-run-1",
  note: "The button is called Log in now",
  inputTokens: 2408,
  outputTokens: 989,
  cacheReadInputTokens: 9519,
  cacheCreationInputTokens: 1292,
  screenshotWasSent: true,
};

/** A version refined from a failed run of `sampleActionScript`, as the refined create answers with it. */
const sampleRefinedActionScript = {
  ...sampleActionScript,
  id: "action-script-2",
  summary: "Logs in with the renamed button",
  refinement: {
    ...sampleRefinementInput,
    id: "refinement-1",
    websiteId: "cuid-1",
    actionId: "action-1",
    refinedActionScriptId: "action-script-2",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
    updatedAt: new Date("2026-01-06T00:00:00.000Z"),
    deletedAt: null,
    actionScriptRun: {
      id: "action-script-run-1",
      errorMessage: 'Step 2 (click): button "Sign in" was not found within 10 seconds',
      failedStepNumber: 2,
      timedOut: false,
      failingPageAriaSnapshot: '- button "Log in"',
    },
  },
};

/**
 * Reads the keys of a returned plan and of each of its steps and targets, in
 * order, so a test can prove the plan's fields were put back in written order.
 * @param plan - A plan as dbService returned it
 * @returns The plan's keys, then each step's keys and its target's keys
 */
function readPlanKeyOrder(plan: unknown): {
  planKeys: string[];
  stepKeys: string[][];
  targetKeys: string[][];
} {
  const typedPlan = plan as { steps: { target: Record<string, unknown> | null }[] };
  return {
    planKeys: Object.keys(typedPlan),
    stepKeys: typedPlan.steps.map((step) => Object.keys(step)),
    targetKeys: typedPlan.steps.map((step) => Object.keys(step.target ?? {})),
  };
}

const sampleActionScriptRun = {
  id: "action-script-run-1",
  websiteId: "cuid-1",
  actionId: "action-1",
  actionScriptId: "action-script-1",
  succeeded: true,
  timedOut: false,
  errorMessage: null,
  failedStepNumber: null,
  credentialName: "Admin",
  output: "✔ Use case completed\n",
  outputWasTruncated: false,
  failureScreenshotFileName: null,
  failingPageUrl: null,
  failingPageAriaSnapshot: null,
  durationMs: 3100,
  createdAt: new Date("2026-01-06T00:00:00.000Z"),
  updatedAt: new Date("2026-01-06T00:00:00.000Z"),
  deletedAt: null,
};

const sampleCrawlRun = {
  id: "crawl-run-1",
  websiteId: "cuid-1",
  credentialId: "credential-1",
  isLoggedIn: false,
  credential: { id: "credential-1", name: "Admin" },
  startUrl: "https://example.com",
  status: "running",
  pageLimit: 50,
  visitedPageCount: 0,
  waitingUrlCount: 0,
  errorMessage: null,
  durationMs: null,
  finishedAt: null,
  createdAt: new Date("2026-01-07T00:00:00.000Z"),
  updatedAt: new Date("2026-01-07T00:00:00.000Z"),
  deletedAt: null,
};

/** The fields the crawler supplies for one page (see `CrawledPageInput`). */
const sampleCrawledPageInput = {
  parentPageId: "crawled-page-0",
  url: "https://example.com/about",
  requestedUrl: "https://example.com/about?ref=nav",
  finalUrl: "https://example.com/about",
  wasRedirected: false,
  foundByButtonText: null,
  buttonUrls: [],
  visitOrder: 1,
  depth: 1,
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  title: "About",
  ariaSnapshot: '- heading "About" [level=1]',
  linkedUrls: ["https://example.com/"],
  formFields: [
    {
      role: "textbox" as const,
      inputType: "email",
      label: "Email",
      placeholder: null,
      isRequired: true,
      containerNumber: 1,
      containerName: "Contact us",
    },
  ],
  durationMs: 950,
};

const sampleCrawledPage = {
  ...sampleCrawledPageInput,
  structureSkeleton: "heading[level=1]",
  id: "crawled-page-1",
  crawlRunId: "crawl-run-1",
  websiteId: "cuid-1",
  createdAt: new Date("2026-01-07T00:00:01.000Z"),
  updatedAt: new Date("2026-01-07T00:00:01.000Z"),
  deletedAt: null,
};

/** What the run reads include: the object a run created and the created objects it deleted. */
const ACTION_SCRIPT_RUN_OBJECTS_INCLUDE = {
  createdObject: { where: { deletedAt: null }, select: { id: true, name: true, url: true, objectTypeName: true } },
  deletedObjects: { where: { deletedAt: null }, select: { id: true, name: true, url: true, objectTypeName: true } },
};

/** What every crawl run read includes: the credential's id and name, deleted or not. */
const CRAWL_RUN_CREDENTIAL_INCLUDE = { credential: { select: { id: true, name: true } } };

/** What every credential read that can reach the API leaves out. */
const OMIT_ENCRYPTED_PASSWORD = { encryptedPassword: true };

/** The fields a caller supplies for a credential (see `CredentialInput`). */
const sampleCredentialInput = {
  name: "Admin",
  description: null,
  username: "admin@example.com",
  loginUrl: "https://example.com/login",
  usernameSelector: null,
  passwordSelector: "#password",
  submitSelector: null,
};

/** A credential without its encrypted password, as the summary reads return it. */
const sampleCredentialSummary = {
  ...sampleCredentialInput,
  id: "credential-1",
  websiteId: "cuid-1",
  createdAt: new Date("2026-01-08T00:00:00.000Z"),
  updatedAt: new Date("2026-01-08T00:00:00.000Z"),
  deletedAt: null,
};

/** The same credential with its encrypted password, as only the crawl start reads it. */
const sampleCredential = { ...sampleCredentialSummary, encryptedPassword: "iv.tag.ciphertext" };

/** What Prisma rejects with when an `update` matches no row. */
const recordNotFoundError = { code: "P2025", message: "Record to update not found." };

/** What Prisma rejects with when a write collides with a unique index. */
const uniqueConstraintError = { code: "P2002", message: "Unique constraint failed" };

/**
 * Reads the `deletedAt` value a mocked `updateMany` was asked to write.
 * @param updateManyMock - The `updateMany` mock of one model delegate
 * @param callIndex - Which recorded call to read; the first call by default
 * @returns The `data.deletedAt` argument of that call
 */
function readDeletedAtWrittenBy(
  updateManyMock: typeof mockWebsiteDelegate.updateMany,
  callIndex = 0,
): unknown {
  const [updateManyArguments] = updateManyMock.mock.calls[callIndex] as [
    { data: { deletedAt: unknown } },
  ];
  return updateManyArguments.data.deletedAt;
}

describe("dbService", () => {
  beforeEach(() => {
    // resetAllMocks also drops any leftover mockResolvedValue / Once queue,
    // while `mockTransaction` keeps the implementation it was created with.
    vi.resetAllMocks();
  });

  describe("module load", () => {
    it("throws when DATABASE_URL is not defined, before any client is built", async () => {
      const originalDatabaseUrl = process.env.DATABASE_URL;
      vi.resetModules();
      delete process.env.DATABASE_URL;

      try {
        await expect(import("../../../server/services/dbService.js")).rejects.toThrow(
          /DATABASE_URL is not defined/,
        );
      } finally {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    });
  });

  describe("isUniqueConstraintViolation", () => {
    it("is true for an object carrying the P2002 code", () => {
      expect(isUniqueConstraintViolation(uniqueConstraintError)).toBe(true);
    });

    it("is true for an Error instance carrying the P2002 code", () => {
      const prismaLikeError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      expect(isUniqueConstraintViolation(prismaLikeError)).toBe(true);
    });

    it("is false for an object carrying a different code", () => {
      expect(isUniqueConstraintViolation(recordNotFoundError)).toBe(false);
    });

    it("is false for an object without a code", () => {
      expect(isUniqueConstraintViolation({ message: "P2002" })).toBe(false);
      expect(isUniqueConstraintViolation(new Error("P2002"))).toBe(false);
    });

    it("is false for values that are not objects", () => {
      expect(isUniqueConstraintViolation("P2002")).toBe(false);
      expect(isUniqueConstraintViolation(2002)).toBe(false);
      expect(isUniqueConstraintViolation(undefined)).toBe(false);
      expect(isUniqueConstraintViolation(null)).toBe(false);
    });
  });

  describe("isRecordNotFound", () => {
    it("is true for an object carrying the P2025 code", () => {
      expect(isRecordNotFound(recordNotFoundError)).toBe(true);
    });

    it("is false for an object carrying a different code", () => {
      expect(isRecordNotFound(uniqueConstraintError)).toBe(false);
    });

    it("is false for an object without a code", () => {
      expect(isRecordNotFound({})).toBe(false);
    });

    it("is false for values that are not objects", () => {
      expect(isRecordNotFound("P2025")).toBe(false);
      expect(isRecordNotFound(null)).toBe(false);
      expect(isRecordNotFound(undefined)).toBe(false);
    });
  });

  describe("websites", () => {
    it("createWebsite inserts the supplied fields and returns the created row", async () => {
      mockWebsiteDelegate.create.mockResolvedValue(sampleWebsite);

      const created = await createWebsite({
        url: "https://example.com",
        name: "Example",
        description: "a site to test",
      });

      expect(mockWebsiteDelegate.create).toHaveBeenCalledWith({
        data: { url: "https://example.com", name: "Example", description: "a site to test" },
      });
      expect(created).toBe(sampleWebsite);
    });

    it("createWebsite accepts an omitted description", async () => {
      mockWebsiteDelegate.create.mockResolvedValue(sampleWebsite);

      await createWebsite({ url: "https://example.com", name: "Example" });

      expect(mockWebsiteDelegate.create).toHaveBeenCalledWith({
        data: { url: "https://example.com", name: "Example" },
      });
    });

    it("createWebsite lets a unique-constraint rejection propagate to the caller", async () => {
      mockWebsiteDelegate.create.mockRejectedValue(uniqueConstraintError);

      await expect(
        createWebsite({ url: "https://example.com", name: "Example" }),
      ).rejects.toBe(uniqueConstraintError);
    });

    it("listWebsitesWithSummaries reads the active websites, newest first, with only the relations the summary needs", async () => {
      mockWebsiteDelegate.findMany.mockResolvedValue([]);

      const websites = await listWebsitesWithSummaries();

      expect(mockWebsiteDelegate.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: WEBSITE_SUMMARY_INCLUDE,
      });
      expect(websites).toEqual([]);
    });

    it("listWebsitesWithSummaries counts each action by its newest version's latest run and answers the newest run and crawl, never the relation lists", async () => {
      const latestCrawlRun = {
        id: "crawl-run-1",
        status: "finished",
        visitedPageCount: 46,
        pageLimit: 50,
        createdAt: new Date("2026-01-09T00:00:00.000Z"),
        finishedAt: new Date("2026-01-09T00:02:00.000Z"),
      };
      mockWebsiteDelegate.findMany.mockResolvedValue([
        {
          ...sampleWebsite,
          actions: [
            { scripts: [{ runs: [samplePassedLatestRun] }] },
            { scripts: [{ runs: [samplePassedLatestRun] }] },
            { scripts: [{ runs: [sampleFailedLatestRun] }] },
            { scripts: [{ runs: [] }] },
            { scripts: [] },
          ],
          actionScriptRuns: [{ createdAt: new Date("2026-01-10T00:00:00.000Z") }],
          crawlRuns: [latestCrawlRun],
        },
      ]);

      const [website] = await listWebsitesWithSummaries();

      expect(website).toEqual({
        ...sampleWebsite,
        summary: {
          actionCount: 5,
          passedActionCount: 2,
          failedActionCount: 1,
          notRunActionCount: 2,
          latestRunAt: new Date("2026-01-10T00:00:00.000Z"),
          latestCrawlRun,
        },
      });
      expect(website).not.toHaveProperty("actions");
      expect(website).not.toHaveProperty("actionScriptRuns");
      expect(website).not.toHaveProperty("crawlRuns");
    });

    it("listWebsitesWithSummaries answers zero counts and nulls for a website with no actions, runs, or crawls", async () => {
      mockWebsiteDelegate.findMany.mockResolvedValue([
        { ...sampleWebsite, actions: [], actionScriptRuns: [], crawlRuns: [] },
      ]);

      const [website] = await listWebsitesWithSummaries();

      expect(website.summary).toEqual({
        actionCount: 0,
        passedActionCount: 0,
        failedActionCount: 0,
        notRunActionCount: 0,
        latestRunAt: null,
        latestCrawlRun: null,
      });
    });

    it("findWebsiteByUrl looks up the active row with that url", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(sampleWebsite);

      const found = await findWebsiteByUrl("https://example.com");

      expect(mockWebsiteDelegate.findFirst).toHaveBeenCalledWith({
        where: { url: "https://example.com", deletedAt: null },
      });
      expect(found).toBe(sampleWebsite);
    });

    it("findWebsiteByUrl returns null when no row matches", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(null);

      expect(await findWebsiteByUrl("https://nope.example")).toBeNull();
    });

    it("findWebsiteById looks up the active row with that id", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(sampleWebsite);

      const found = await findWebsiteById("cuid-1");

      expect(mockWebsiteDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleWebsite);
    });

    it("findWebsiteById returns null when no active row matches", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(null);

      expect(await findWebsiteById("deleted-or-unknown")).toBeNull();
    });

    it("updateWebsite updates only an active row and returns the updated row", async () => {
      const updatedWebsite = { ...sampleWebsite, name: "Renamed" };
      mockWebsiteDelegate.update.mockResolvedValue(updatedWebsite);
      const replacement = { url: "https://example.com/", name: "Renamed", description: null };

      const updated = await updateWebsite("cuid-1", replacement);

      expect(mockWebsiteDelegate.update).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
        data: replacement,
      });
      expect(updated).toBe(updatedWebsite);
    });

    it("updateWebsite returns null when no active row matched (P2025)", async () => {
      mockWebsiteDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateWebsite("deleted-or-unknown", {
        url: "https://example.com/",
        name: "Example",
      });

      expect(updated).toBeNull();
    });

    it("updateWebsite rethrows a unique-constraint violation (P2002) for the caller to map", async () => {
      mockWebsiteDelegate.update.mockRejectedValue(uniqueConstraintError);

      await expect(
        updateWebsite("cuid-1", { url: "https://taken.example/", name: "Example" }),
      ).rejects.toBe(uniqueConstraintError);
    });

    it("updateWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockWebsiteDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateWebsite("cuid-1", { url: "https://example.com/", name: "Example" }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteWebsite stamps the website, its use cases, actions, screenshot runs, action scripts, action script runs, action script refinements, crawl runs, crawled pages, credentials, page patterns, and web objects inside one transaction", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 3 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockScreenshotRunDelegate.updateMany.mockResolvedValue({ count: 4 });
      mockActionScriptDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockActionScriptRunDelegate.updateMany.mockResolvedValue({ count: 5 });
      mockActionScriptRefinementDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockCrawledPageDelegate.updateMany.mockResolvedValue({ count: 30 });
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockPagePatternDelegate.updateMany.mockResolvedValue({ count: 9 });
      mockWebObjectDelegate.updateMany.mockResolvedValue({ count: 4 });

      const websiteWasDeleted = await softDeleteWebsite("cuid-1");

      expect(websiteWasDeleted).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
      expect(mockWebsiteDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockUseCaseDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockScreenshotRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptRefinementDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockCrawledPageDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockCredentialDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockPagePatternDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockWebObjectDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("softDeleteWebsite writes one shared deletedAt timestamp to all twelve tables", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockScreenshotRunDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionScriptDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionScriptRunDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionScriptRefinementDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockCrawledPageDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockPagePatternDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockWebObjectDelegate.updateMany.mockResolvedValue({ count: 0 });
      const millisecondsBeforeCall = Date.now();

      await softDeleteWebsite("cuid-1");

      const millisecondsAfterCall = Date.now();
      const websiteDeletedAt = readDeletedAtWrittenBy(mockWebsiteDelegate.updateMany);
      const useCaseDeletedAt = readDeletedAtWrittenBy(mockUseCaseDelegate.updateMany);
      const actionDeletedAt = readDeletedAtWrittenBy(mockActionDelegate.updateMany);
      const screenshotRunDeletedAt = readDeletedAtWrittenBy(mockScreenshotRunDelegate.updateMany);
      const actionScriptDeletedAt = readDeletedAtWrittenBy(mockActionScriptDelegate.updateMany);
      const actionScriptRunDeletedAt = readDeletedAtWrittenBy(
        mockActionScriptRunDelegate.updateMany,
      );
      const actionScriptRefinementDeletedAt = readDeletedAtWrittenBy(
        mockActionScriptRefinementDelegate.updateMany,
      );
      const crawlRunDeletedAt = readDeletedAtWrittenBy(mockCrawlRunDelegate.updateMany);
      const crawledPageDeletedAt = readDeletedAtWrittenBy(mockCrawledPageDelegate.updateMany);
      const credentialDeletedAt = readDeletedAtWrittenBy(mockCredentialDelegate.updateMany);
      const pagePatternDeletedAt = readDeletedAtWrittenBy(mockPagePatternDelegate.updateMany);
      const webObjectDeletedAt = readDeletedAtWrittenBy(mockWebObjectDelegate.updateMany);

      expect(websiteDeletedAt).toBeInstanceOf(Date);
      expect(useCaseDeletedAt).toBe(websiteDeletedAt);
      expect(actionDeletedAt).toBe(websiteDeletedAt);
      expect(screenshotRunDeletedAt).toBe(websiteDeletedAt);
      expect(actionScriptDeletedAt).toBe(websiteDeletedAt);
      expect(actionScriptRunDeletedAt).toBe(websiteDeletedAt);
      expect(actionScriptRefinementDeletedAt).toBe(websiteDeletedAt);
      expect(crawlRunDeletedAt).toBe(websiteDeletedAt);
      expect(crawledPageDeletedAt).toBe(websiteDeletedAt);
      expect(credentialDeletedAt).toBe(websiteDeletedAt);
      expect(pagePatternDeletedAt).toBe(websiteDeletedAt);
      expect(webObjectDeletedAt).toBe(websiteDeletedAt);
      const deletedAtMilliseconds = (websiteDeletedAt as Date).getTime();
      expect(deletedAtMilliseconds).toBeGreaterThanOrEqual(millisecondsBeforeCall);
      expect(deletedAtMilliseconds).toBeLessThanOrEqual(millisecondsAfterCall);
    });

    it("softDeleteWebsite returns false and touches no children when no active website matched", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 0 });

      const websiteWasDeleted = await softDeleteWebsite("deleted-or-unknown");

      expect(websiteWasDeleted).toBe(false);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockUseCaseDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockScreenshotRunDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionScriptDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionScriptRunDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionScriptRefinementDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockCrawlRunDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockCrawledPageDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockCredentialDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockPagePatternDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockWebObjectDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("adoptWebsiteLoginUrl saves a learned login URL only on an active website that has none", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });

      const websiteAdoptedTheUrl = await adoptWebsiteLoginUrl("cuid-1", "https://example.com/login");

      expect(websiteAdoptedTheUrl).toBe(true);
      expect(mockWebsiteDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "cuid-1", loginUrl: null, deletedAt: null },
        data: { loginUrl: "https://example.com/login" },
      });
    });

    it("adoptWebsiteLoginUrl returns false, changing nothing, when the website already has a login URL", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await adoptWebsiteLoginUrl("cuid-1", "https://example.com/other-login")).toBe(false);
    });

    it("softDeleteWebsite propagates a failure inside the transaction", async () => {
      const childUpdateError = new Error("deadlock detected");
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockRejectedValue(childUpdateError);

      await expect(softDeleteWebsite("cuid-1")).rejects.toBe(childUpdateError);
      expect(mockActionDelegate.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("use cases", () => {
    it("listUseCasesForWebsite returns the website's active use cases, newest first", async () => {
      mockUseCaseDelegate.findMany.mockResolvedValue([sampleUseCase]);

      const useCases = await listUseCasesForWebsite("cuid-1");

      expect(mockUseCaseDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(useCases).toEqual([sampleUseCase]);
    });

    it("findUseCaseForWebsite scopes the lookup to the website and to active rows", async () => {
      mockUseCaseDelegate.findFirst.mockResolvedValue(sampleUseCase);

      const found = await findUseCaseForWebsite("cuid-1", "use-case-1");

      expect(mockUseCaseDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleUseCase);
    });

    it("findUseCaseForWebsite returns null when no active use case of that website matches", async () => {
      mockUseCaseDelegate.findFirst.mockResolvedValue(null);

      expect(await findUseCaseForWebsite("cuid-1", "use-case-of-another-site")).toBeNull();
    });

    it("createUseCaseForWebsite inserts the title and description under the website", async () => {
      mockUseCaseDelegate.create.mockResolvedValue(sampleUseCase);

      const created = await createUseCaseForWebsite("cuid-1", {
        title: "Sign up",
        description: "Create an account",
      });

      expect(mockUseCaseDelegate.create).toHaveBeenCalledWith({
        data: { title: "Sign up", description: "Create an account", websiteId: "cuid-1" },
      });
      expect(created).toBe(sampleUseCase);
    });

    it("updateUseCaseForWebsite updates only an active use case of that website", async () => {
      const updatedUseCase = { ...sampleUseCase, title: "Sign up with Google" };
      mockUseCaseDelegate.update.mockResolvedValue(updatedUseCase);
      const replacement = { title: "Sign up with Google", description: "Use OAuth" };

      const updated = await updateUseCaseForWebsite("cuid-1", "use-case-1", replacement);

      expect(mockUseCaseDelegate.update).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
        data: replacement,
      });
      expect(updated).toBe(updatedUseCase);
    });

    it("updateUseCaseForWebsite returns null when no active use case matched (P2025)", async () => {
      mockUseCaseDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateUseCaseForWebsite("cuid-1", "missing", {
        title: "t",
        description: "d",
      });

      expect(updated).toBeNull();
    });

    it("updateUseCaseForWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockUseCaseDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateUseCaseForWebsite("cuid-1", "use-case-1", { title: "t", description: "d" }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteUseCaseForWebsite stamps deletedAt on the active use case of that website", async () => {
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 1 });

      const useCaseWasDeleted = await softDeleteUseCaseForWebsite("cuid-1", "use-case-1");

      expect(useCaseWasDeleted).toBe(true);
      expect(mockUseCaseDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("softDeleteUseCaseForWebsite returns false when no active use case matched", async () => {
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await softDeleteUseCaseForWebsite("cuid-1", "already-deleted")).toBe(false);
    });
  });

  describe("actions", () => {
    it("listActionsForWebsite returns the website's active actions, newest first, each with its credential's id and name", async () => {
      mockActionDelegate.findMany.mockResolvedValue([
        { ...sampleLinkedAction, scripts: [], _count: { scripts: 0 } },
        { ...sampleAction, scripts: [], _count: { scripts: 0 } },
      ]);

      const actions = await listActionsForWebsite("cuid-1");

      expect(mockActionDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: ACTION_LIST_INCLUDE,
      });
      expect(actions).toEqual([
        { ...sampleLinkedAction, newestScript: null },
        { ...sampleAction, newestScript: null },
      ]);
    });

    it("listActionsForWebsite answers each action's newest version - numbered by its active version count, with the text it was generated from - and its latest run as newestScript, never as scripts", async () => {
      mockActionDelegate.findMany.mockResolvedValue([
        {
          ...sampleAction,
          id: "action-passing",
          scripts: [{ id: "script-a", ...sampleNewestScriptText, runs: [samplePassedLatestRun] }],
          _count: { scripts: 6 },
        },
        {
          ...sampleAction,
          id: "action-failing",
          scripts: [{ id: "script-b", ...sampleNewestScriptText, runs: [sampleFailedLatestRun] }],
          _count: { scripts: 2 },
        },
        {
          ...sampleAction,
          id: "action-not-run",
          scripts: [{ id: "script-c", ...sampleNewestScriptText, runs: [] }],
          _count: { scripts: 1 },
        },
        { ...sampleAction, id: "action-without-versions", scripts: [], _count: { scripts: 0 } },
      ]);

      const actions = await listActionsForWebsite("cuid-1");

      expect(actions.map((action) => action.newestScript)).toEqual([
        { id: "script-a", versionNumber: 6, ...sampleNewestScriptText, latestRun: samplePassedLatestRun },
        { id: "script-b", versionNumber: 2, ...sampleNewestScriptText, latestRun: sampleFailedLatestRun },
        { id: "script-c", versionNumber: 1, ...sampleNewestScriptText, latestRun: null },
        null,
      ]);
      for (const action of actions) {
        expect(action).not.toHaveProperty("scripts");
        expect(action).not.toHaveProperty("_count");
      }
    });

    it("findActionForWebsite scopes the lookup to the website and to active rows, bringing the credential's id and name", async () => {
      mockActionDelegate.findFirst.mockResolvedValue(sampleLinkedAction);

      const found = await findActionForWebsite("cuid-1", "action-1");

      expect(mockActionDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        include: ACTION_CREDENTIAL_INCLUDE,
      });
      expect(found).toBe(sampleLinkedAction);
    });

    it("findActionForWebsite returns null when no active action of that website matches", async () => {
      mockActionDelegate.findFirst.mockResolvedValue(null);

      expect(await findActionForWebsite("cuid-1", "action-of-another-site")).toBeNull();
    });

    it("createActionForWebsite inserts the title, description, and credential under the website, answering with the credential's id and name", async () => {
      mockActionDelegate.create.mockResolvedValue(sampleLinkedAction);

      const created = await createActionForWebsite("cuid-1", {
        title: "Log in",
        description: "Enter credentials and submit",
        credentialId: "credential-1",
        ...DETECT_EVERY_ROLE_CHOICE,
      });

      expect(mockActionDelegate.create).toHaveBeenCalledWith({
        data: {
          title: "Log in",
          description: "Enter credentials and submit",
          credentialId: "credential-1",
          ...DETECT_EVERY_ROLE_CHOICE,
          websiteId: "cuid-1",
        },
        include: ACTION_CREDENTIAL_INCLUDE,
      });
      expect(created).toBe(sampleLinkedAction);
    });

    it("createActionForWebsite inserts an action that runs logged out with a null credential", async () => {
      mockActionDelegate.create.mockResolvedValue(sampleAction);

      const created = await createActionForWebsite("cuid-1", {
        title: "Log in",
        description: "Enter credentials and submit",
        credentialId: null,
        ...DETECT_EVERY_ROLE_CHOICE,
      });

      expect(mockActionDelegate.create).toHaveBeenCalledWith({
        data: {
          title: "Log in",
          description: "Enter credentials and submit",
          credentialId: null,
          ...DETECT_EVERY_ROLE_CHOICE,
          websiteId: "cuid-1",
        },
        include: ACTION_CREDENTIAL_INCLUDE,
      });
      expect(created).toBe(sampleAction);
    });

    it("updateActionForWebsite updates only an active action of that website, credential included", async () => {
      const updatedAction = { ...sampleLinkedAction, title: "Log out" };
      mockActionDelegate.update.mockResolvedValue(updatedAction);
      const replacement = {
        title: "Log out",
        description: "Open the menu and log out",
        credentialId: "credential-1",
        ...DETECT_EVERY_ROLE_CHOICE,
      };

      const updated = await updateActionForWebsite("cuid-1", "action-1", replacement);

      expect(mockActionDelegate.update).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: replacement,
        include: ACTION_CREDENTIAL_INCLUDE,
      });
      expect(updated).toBe(updatedAction);
    });

    it("updateActionForWebsite writes a null credential to unlink it", async () => {
      mockActionDelegate.update.mockResolvedValue(sampleAction);
      const replacement = { title: "Log in", description: "Enter credentials", credentialId: null, ...DETECT_EVERY_ROLE_CHOICE };

      await updateActionForWebsite("cuid-1", "action-1", replacement);

      expect(mockActionDelegate.update).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { title: "Log in", description: "Enter credentials", credentialId: null, ...DETECT_EVERY_ROLE_CHOICE },
        include: ACTION_CREDENTIAL_INCLUDE,
      });
    });

    it("updateActionForWebsite returns null when no active action matched (P2025)", async () => {
      mockActionDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateActionForWebsite("cuid-1", "missing", {
        title: "t",
        description: "d",
        credentialId: null,
        ...DETECT_EVERY_ROLE_CHOICE,
      });

      expect(updated).toBeNull();
    });

    it("updateActionForWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockActionDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateActionForWebsite("cuid-1", "action-1", {
          title: "t",
          description: "d",
          credentialId: null,
          ...DETECT_EVERY_ROLE_CHOICE,
        }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteActionForWebsite stamps the active action and its scripts, script runs, and script refinements inside one transaction", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionScriptDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockActionScriptRunDelegate.updateMany.mockResolvedValue({ count: 3 });
      mockActionScriptRefinementDelegate.updateMany.mockResolvedValue({ count: 1 });

      const actionWasDeleted = await softDeleteActionForWebsite("cuid-1", "action-1");

      expect(actionWasDeleted).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptDelegate.updateMany).toHaveBeenCalledWith({
        where: { actionId: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { actionId: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionScriptRefinementDelegate.updateMany).toHaveBeenCalledWith({
        where: { actionId: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("softDeleteActionForWebsite writes one shared deletedAt timestamp to the action, its scripts, their runs, and their refinements", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionScriptDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionScriptRunDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionScriptRefinementDelegate.updateMany.mockResolvedValue({ count: 0 });

      await softDeleteActionForWebsite("cuid-1", "action-1");

      const actionDeletedAt = readDeletedAtWrittenBy(mockActionDelegate.updateMany);
      expect(actionDeletedAt).toBeInstanceOf(Date);
      expect(readDeletedAtWrittenBy(mockActionScriptDelegate.updateMany)).toBe(actionDeletedAt);
      expect(readDeletedAtWrittenBy(mockActionScriptRunDelegate.updateMany)).toBe(actionDeletedAt);
      expect(readDeletedAtWrittenBy(mockActionScriptRefinementDelegate.updateMany)).toBe(
        actionDeletedAt,
      );
    });

    it("softDeleteActionForWebsite returns false and touches no scripts when no active action matched", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await softDeleteActionForWebsite("cuid-1", "already-deleted")).toBe(false);
      expect(mockActionScriptDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionScriptRunDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionScriptRefinementDelegate.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("screenshot runs", () => {
    it("listScreenshotRunsForWebsite returns the website's active runs, newest first", async () => {
      mockScreenshotRunDelegate.findMany.mockResolvedValue([sampleScreenshotRun]);

      const screenshotRuns = await listScreenshotRunsForWebsite("cuid-1");

      expect(mockScreenshotRunDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(screenshotRuns).toEqual([sampleScreenshotRun]);
    });

    it("findScreenshotRunForWebsite scopes the lookup to the website and to active rows", async () => {
      mockScreenshotRunDelegate.findFirst.mockResolvedValue(sampleScreenshotRun);

      const found = await findScreenshotRunForWebsite("cuid-1", "screenshot-run-1");

      expect(mockScreenshotRunDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "screenshot-run-1", websiteId: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleScreenshotRun);
    });

    it("findScreenshotRunForWebsite returns null when no active run of that website matches", async () => {
      mockScreenshotRunDelegate.findFirst.mockResolvedValue(null);

      expect(await findScreenshotRunForWebsite("cuid-1", "run-of-another-site")).toBeNull();
    });

    it("createScreenshotRunForWebsite inserts the run's outcome under the website", async () => {
      mockScreenshotRunDelegate.create.mockResolvedValue(sampleScreenshotRun);
      const runInput = {
        requestedUrl: "https://example.com",
        succeeded: false,
        httpStatus: null,
        errorMessage: "page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.com",
        screenshotFileName: null,
        durationMs: 12,
      };

      const created = await createScreenshotRunForWebsite("cuid-1", runInput);

      expect(mockScreenshotRunDelegate.create).toHaveBeenCalledWith({
        data: { ...runInput, websiteId: "cuid-1" },
      });
      expect(created).toBe(sampleScreenshotRun);
    });
  });
  describe("action scripts", () => {
    it("listActionScriptsForAction returns the action's active scripts, newest first, each with its refinement", async () => {
      mockActionScriptDelegate.findMany.mockResolvedValue([toPrismaActionScriptRow(sampleActionScript)]);

      const actionScripts = await listActionScriptsForAction("cuid-1", "action-1");

      expect(mockActionScriptDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", actionId: "action-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: ACTION_SCRIPT_INCLUDE,
      });
      expect(actionScripts).toEqual([sampleActionScript]);
    });

    it("listActionScriptsForAction passes a refined version's refinement and its failed-run summary through", async () => {
      mockActionScriptDelegate.findMany.mockResolvedValue([
        toPrismaActionScriptRow(sampleRefinedActionScript),
        toPrismaActionScriptRow(sampleActionScript),
      ]);

      const actionScripts = await listActionScriptsForAction("cuid-1", "action-1");

      expect(actionScripts).toEqual([sampleRefinedActionScript, sampleActionScript]);
      expect(actionScripts[0].refinement?.actionScriptRun.failedStepNumber).toBe(2);
      expect(actionScripts[1].refinement).toBeNull();
    });

    it("listActionScriptsForAction answers each version's newest run as latestRun, never as runs", async () => {
      mockActionScriptDelegate.findMany.mockResolvedValue([
        toPrismaActionScriptRow({ ...sampleActionScript, id: "script-passing", latestRun: samplePassedLatestRun }),
        toPrismaActionScriptRow({ ...sampleActionScript, id: "script-failing", latestRun: sampleFailedLatestRun }),
        toPrismaActionScriptRow({ ...sampleActionScript, id: "script-not-run" }),
      ]);

      const actionScripts = await listActionScriptsForAction("cuid-1", "action-1");

      expect(actionScripts.map((actionScript) => actionScript.latestRun)).toEqual([
        samplePassedLatestRun,
        sampleFailedLatestRun,
        null,
      ]);
      for (const actionScript of actionScripts) {
        expect(actionScript).not.toHaveProperty("runs");
      }
    });

    it("listActionScriptsForAction puts every stored plan's fields back in written order", async () => {
      mockActionScriptDelegate.findMany.mockResolvedValue([
        toPrismaActionScriptRow({ ...sampleActionScript, plan: samplePlanWithShuffledKeys }),
      ]);

      const [actionScript] = await listActionScriptsForAction("cuid-1", "action-1");

      expect(actionScript.plan).toEqual(samplePlan);
      expect(readPlanKeyOrder(actionScript.plan)).toEqual({
        planKeys: ["name", "startUrl", "steps"],
        stepKeys: [
          ["action", "target", "value"],
          ["action", "target", "value"],
        ],
        targetKeys: [["label"], ["role", "name"]],
      });
    });

    it("listActionScriptsForAction passes a stored plan that is not a valid plan through unchanged", async () => {
      const handEditedPlan = { name: "Log in", steps: "not a list" };
      mockActionScriptDelegate.findMany.mockResolvedValue([
        toPrismaActionScriptRow({ ...sampleActionScript, plan: handEditedPlan }),
      ]);

      const [actionScript] = await listActionScriptsForAction("cuid-1", "action-1");

      expect(actionScript.plan).toBe(handEditedPlan);
      expect(actionScript).toEqual({ ...sampleActionScript, plan: handEditedPlan });
    });

    it("findActionScriptForAction scopes the lookup to the website, the action, and active rows", async () => {
      mockActionScriptDelegate.findFirst.mockResolvedValue(toPrismaActionScriptRow(sampleActionScript));

      const found = await findActionScriptForAction("cuid-1", "action-1", "action-script-1");

      expect(mockActionScriptDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "action-script-1", websiteId: "cuid-1", actionId: "action-1", deletedAt: null },
        include: ACTION_SCRIPT_INCLUDE,
      });
      expect(found).toEqual(sampleActionScript);
    });

    it("findActionScriptForAction answers the version's newest run as latestRun, never as runs", async () => {
      const scriptWithFailedLatestRun = { ...sampleActionScript, latestRun: sampleFailedLatestRun };
      mockActionScriptDelegate.findFirst.mockResolvedValue(toPrismaActionScriptRow(scriptWithFailedLatestRun));

      const found = await findActionScriptForAction("cuid-1", "action-1", "action-script-1");

      expect(found).toEqual(scriptWithFailedLatestRun);
      expect(found).not.toHaveProperty("runs");
    });

    it("findActionScriptForAction answers a refined version with its refinement", async () => {
      mockActionScriptDelegate.findFirst.mockResolvedValue(toPrismaActionScriptRow(sampleRefinedActionScript));

      const found = await findActionScriptForAction("cuid-1", "action-1", "action-script-2");

      expect(found).toEqual(sampleRefinedActionScript);
    });

    it("findActionScriptForAction puts the stored plan's fields back in written order", async () => {
      mockActionScriptDelegate.findFirst.mockResolvedValue(
        toPrismaActionScriptRow({ ...sampleActionScript, plan: samplePlanWithShuffledKeys }),
      );

      const found = await findActionScriptForAction("cuid-1", "action-1", "action-script-1");

      expect(found?.plan).toEqual(samplePlan);
      expect(readPlanKeyOrder(found?.plan).planKeys).toEqual(["name", "startUrl", "steps"]);
      expect(readPlanKeyOrder(found?.plan).stepKeys[0]).toEqual(["action", "target", "value"]);
    });

    it("findActionScriptForAction passes a stored plan that is not a valid plan through unchanged", async () => {
      const handEditedPlan = { startUrl: 42 };
      mockActionScriptDelegate.findFirst.mockResolvedValue(
        toPrismaActionScriptRow({ ...sampleActionScript, plan: handEditedPlan }),
      );

      const found = await findActionScriptForAction("cuid-1", "action-1", "action-script-1");

      expect(found?.plan).toBe(handEditedPlan);
    });

    it("findActionScriptForAction returns null when no active script of that action matches", async () => {
      mockActionScriptDelegate.findFirst.mockResolvedValue(null);

      expect(await findActionScriptForAction("cuid-1", "action-1", "script-of-another")).toBeNull();
    });

    it("createActionScriptForAction inserts a generated version under the website and action", async () => {
      mockActionScriptDelegate.create.mockResolvedValue(toPrismaActionScriptRow(sampleActionScript));
      const scriptInput = {
        websiteName: "Example",
        startUrl: "https://example.com",
        actionTitle: "Log in",
        actionDescription: "Enter credentials and submit",
        credentialId: "credential-1",
        credentialName: "Admin",
        summary: "Logs in",
        assumptions: [],
        plan: samplePlan,
        contextPageUrls: ["https://example.com/", "https://example.com/login"],
        modelId: "claude-opus-5-5",
        effort: "high",
        editedFromActionScriptId: null,
      };

      const created = await createActionScriptForAction("cuid-1", "action-1", scriptInput);

      expect(mockActionScriptDelegate.create).toHaveBeenCalledWith({
        data: { ...scriptInput, websiteId: "cuid-1", actionId: "action-1" },
        include: ACTION_SCRIPT_INCLUDE,
      });
      expect(created).toEqual(sampleActionScript);
    });

    it("createActionScriptForAction inserts an edited version with no model, no effort, and its source's id", async () => {
      const editedScript = {
        ...sampleActionScript,
        id: "action-script-2",
        modelId: null,
        effort: null,
        editedFromActionScriptId: "action-script-1",
      };
      mockActionScriptDelegate.create.mockResolvedValue(toPrismaActionScriptRow(editedScript));
      const scriptInput = {
        websiteName: "Example",
        startUrl: "https://example.com",
        actionTitle: "Log in",
        actionDescription: "Enter credentials and submit",
        credentialId: null,
        credentialName: null,
        summary: "Logs in",
        assumptions: [],
        plan: samplePlan,
        contextPageUrls: [],
        modelId: null,
        effort: null,
        editedFromActionScriptId: "action-script-1",
      };

      const created = await createActionScriptForAction("cuid-1", "action-1", scriptInput);

      expect(mockActionScriptDelegate.create).toHaveBeenCalledWith({
        data: { ...scriptInput, websiteId: "cuid-1", actionId: "action-1" },
        include: ACTION_SCRIPT_INCLUDE,
      });
      expect(created).toEqual(editedScript);
    });

    it("createActionScriptForAction answers with the saved plan's fields in written order", async () => {
      mockActionScriptDelegate.create.mockResolvedValue(
        toPrismaActionScriptRow({ ...sampleActionScript, plan: samplePlanWithShuffledKeys }),
      );

      const created = await createActionScriptForAction("cuid-1", "action-1", {
        websiteName: "Example",
        startUrl: "https://example.com",
        actionTitle: "Log in",
        actionDescription: "Enter credentials and submit",
        credentialId: null,
        credentialName: null,
        summary: "Logs in",
        assumptions: [],
        plan: samplePlan,
        contextPageUrls: [],
        modelId: "claude-opus-5-5",
        effort: "high",
        editedFromActionScriptId: null,
      });

      expect(readPlanKeyOrder(created.plan).planKeys).toEqual(["name", "startUrl", "steps"]);
      expect(created.plan).toEqual(samplePlan);
    });

    describe("createRefinedActionScriptForAction", () => {
      /** The refined version's own fields: its source's snapshots and Claude's new plan. */
      const refinedScriptInput = {
        websiteName: "Example",
        startUrl: "https://example.com",
        actionTitle: "Log in",
        actionDescription: "Enter credentials and submit",
        credentialId: "credential-1",
        credentialName: "Admin",
        summary: "Logs in with the renamed button",
        assumptions: ["Refined: the button is called Log in now"],
        plan: samplePlan,
        contextPageUrls: ["https://example.com/login"],
        modelId: "claude-opus-5-5",
        effort: "high",
        editedFromActionScriptId: null,
      };

      it("inserts the version and its refinement in one nested create, both under the website and action", async () => {
        mockActionScriptDelegate.create.mockResolvedValue(toPrismaActionScriptRow(sampleRefinedActionScript));

        const created = await createRefinedActionScriptForAction(
          "cuid-1",
          "action-1",
          refinedScriptInput,
          sampleRefinementInput,
        );

        expect(mockActionScriptDelegate.create).toHaveBeenCalledTimes(1);
        expect(mockActionScriptDelegate.create).toHaveBeenCalledWith({
          data: {
            ...refinedScriptInput,
            websiteId: "cuid-1",
            actionId: "action-1",
            refinement: {
              create: { ...sampleRefinementInput, websiteId: "cuid-1", actionId: "action-1" },
            },
          },
          include: ACTION_SCRIPT_INCLUDE,
        });
        // One nested write is atomic on its own: no separate refinement insert, no transaction.
        expect(mockActionScriptRefinementDelegate.create).not.toHaveBeenCalled();
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(created).toEqual(sampleRefinedActionScript);
      });

      it("stores a refinement without a note, whose screenshot was not sent", async () => {
        mockActionScriptDelegate.create.mockResolvedValue(toPrismaActionScriptRow(sampleRefinedActionScript));
        const refinementWithoutNoteOrScreenshot = {
          ...sampleRefinementInput,
          note: null,
          screenshotWasSent: false,
        };

        await createRefinedActionScriptForAction(
          "cuid-1",
          "action-1",
          refinedScriptInput,
          refinementWithoutNoteOrScreenshot,
        );

        const [createArguments] = mockActionScriptDelegate.create.mock.calls[0] as [
          { data: { refinement: { create: Record<string, unknown> } } },
        ];
        expect(createArguments.data.refinement.create).toMatchObject({
          note: null,
          screenshotWasSent: false,
        });
      });

      it("answers with the saved plan's fields in written order", async () => {
        mockActionScriptDelegate.create.mockResolvedValue(
          toPrismaActionScriptRow({ ...sampleRefinedActionScript, plan: samplePlanWithShuffledKeys }),
        );

        const created = await createRefinedActionScriptForAction(
          "cuid-1",
          "action-1",
          refinedScriptInput,
          sampleRefinementInput,
        );

        expect(readPlanKeyOrder(created.plan).planKeys).toEqual(["name", "startUrl", "steps"]);
        expect(created.plan).toEqual(samplePlan);
        expect(created.refinement).toEqual(sampleRefinedActionScript.refinement);
      });

      it("lets a failed insert propagate, so neither row is written", async () => {
        const insertError = new Error("foreign key violation");
        mockActionScriptDelegate.create.mockRejectedValue(insertError);

        await expect(
          createRefinedActionScriptForAction(
            "cuid-1",
            "action-1",
            refinedScriptInput,
            sampleRefinementInput,
          ),
        ).rejects.toBe(insertError);
      });
    });
  });

  describe("action script runs", () => {
    it("listActionScriptRunsForScript returns the script's active runs, newest first", async () => {
      mockActionScriptRunDelegate.findMany.mockResolvedValue([sampleActionScriptRun]);

      const runs = await listActionScriptRunsForScript("cuid-1", "action-1", "action-script-1");

      expect(mockActionScriptRunDelegate.findMany).toHaveBeenCalledWith({
        where: {
          websiteId: "cuid-1",
          actionId: "action-1",
          actionScriptId: "action-script-1",
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        include: ACTION_SCRIPT_RUN_OBJECTS_INCLUDE,
      });
      expect(runs).toEqual([sampleActionScriptRun]);
    });

    it("findActionScriptRunForScript scopes the lookup to every parent and to active rows", async () => {
      mockActionScriptRunDelegate.findFirst.mockResolvedValue(sampleActionScriptRun);

      const found = await findActionScriptRunForScript(
        "cuid-1",
        "action-1",
        "action-script-1",
        "action-script-run-1",
      );

      expect(mockActionScriptRunDelegate.findFirst).toHaveBeenCalledWith({
        where: {
          id: "action-script-run-1",
          websiteId: "cuid-1",
          actionId: "action-1",
          actionScriptId: "action-script-1",
          deletedAt: null,
        },
      });
      expect(found).toBe(sampleActionScriptRun);
    });

    it("findActionScriptRunForScript returns null when no active run of that script matches", async () => {
      mockActionScriptRunDelegate.findFirst.mockResolvedValue(null);

      expect(
        await findActionScriptRunForScript("cuid-1", "action-1", "action-script-1", "other-run"),
      ).toBeNull();
    });

    it("createActionScriptRunForScript inserts the run's outcome, failing page included, under the website, action, and script", async () => {
      mockActionScriptRunDelegate.create.mockResolvedValue(sampleActionScriptRun);
      const runInput = {
        succeeded: false,
        timedOut: true,
        errorMessage: "The run hit the 5 minute time limit and was stopped",
        failedStepNumber: 2,
        credentialName: "Admin",
        output: "▶ Open the site\n",
        outputWasTruncated: false,
        failureScreenshotFileName: null,
        failingPageUrl: "https://example.com/login",
        failingPageAriaSnapshot: '- button "Log in"',
        durationMs: 305000,
        parameterValues: [{ key: "projectName", label: "Project name", value: "Apollo 7" }],
        finalPageUrl: "https://example.com/projects/1",
        confirmStepNumber: 3,
        confirmStepSucceeded: true,
      };

      const created = await createActionScriptRunForScript(
        "cuid-1",
        "action-1",
        "action-script-1",
        runInput,
      );

      expect(mockActionScriptRunDelegate.create).toHaveBeenCalledWith({
        data: {
          ...runInput,
          websiteId: "cuid-1",
          actionId: "action-1",
          actionScriptId: "action-script-1",
        },
      });
      expect(created).toBe(sampleActionScriptRun);
    });
  });

  describe("crawl runs", () => {
    it("listCrawlRunsForWebsite returns the website's active runs, newest first, each with its credential's id and name", async () => {
      mockCrawlRunDelegate.findMany.mockResolvedValue([sampleCrawlRun]);

      const crawlRuns = await listCrawlRunsForWebsite("cuid-1");

      expect(mockCrawlRunDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: CRAWL_RUN_CREDENTIAL_INCLUDE,
      });
      expect(crawlRuns).toEqual([sampleCrawlRun]);
    });

    it("findCrawlRunForWebsite scopes the lookup to the website and to active rows", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue(sampleCrawlRun);

      const found = await findCrawlRunForWebsite("cuid-1", "crawl-run-1");

      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", deletedAt: null },
        include: CRAWL_RUN_CREDENTIAL_INCLUDE,
      });
      expect(found).toBe(sampleCrawlRun);
    });

    it("findCrawlRunForWebsite returns null when no active run of that website matches", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue(null);

      expect(await findCrawlRunForWebsite("cuid-1", "other-run")).toBeNull();
    });

    it("createCrawlRunForWebsite inserts a running run under the website, with its credential", async () => {
      mockCrawlRunDelegate.create.mockResolvedValue(sampleCrawlRun);

      const created = await createCrawlRunForWebsite("cuid-1", {
        startUrl: "https://example.com",
        pageLimit: 50,
        credentialId: "credential-1",
      });

      expect(mockCrawlRunDelegate.create).toHaveBeenCalledWith({
        data: {
          startUrl: "https://example.com",
          pageLimit: 50,
          credentialId: "credential-1",
          websiteId: "cuid-1",
          status: "running",
        },
        include: CRAWL_RUN_CREDENTIAL_INCLUDE,
      });
      expect(created).toBe(sampleCrawlRun);
    });

    it("markCrawlRunLoggedIn sets isLoggedIn on the active running run only", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });

      const runWasMarked = await markCrawlRunLoggedIn("cuid-1", "crawl-run-1");

      expect(runWasMarked).toBe(true);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", status: "running", deletedAt: null },
        data: { isLoggedIn: true },
      });
    });

    it("markCrawlRunLoggedIn returns false when no active running run matched", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await markCrawlRunLoggedIn("cuid-1", "deleted-run")).toBe(false);
    });

    it("recordCrawledPage updates the running run's counters, then inserts the page, inside one transaction", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockCrawledPageDelegate.create.mockResolvedValue(sampleCrawledPage);

      const recorded = await recordCrawledPage(
        "cuid-1",
        "crawl-run-1",
        { visitedPageCount: 2, waitingUrlCount: 7 },
        sampleCrawledPageInput,
      );

      expect(recorded).toBe(sampleCrawledPage);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", status: "running", deletedAt: null },
        data: { visitedPageCount: 2, waitingUrlCount: 7 },
      });
      expect(mockCrawledPageDelegate.create).toHaveBeenCalledWith({
        data: { ...sampleCrawledPageInput, crawlRunId: "crawl-run-1", websiteId: "cuid-1" },
      });
      const counterUpdateOrder = mockCrawlRunDelegate.updateMany.mock.invocationCallOrder[0];
      const pageCreateOrder = mockCrawledPageDelegate.create.mock.invocationCallOrder[0];
      expect(counterUpdateOrder).toBeLessThan(pageCreateOrder);
    });

    it("recordCrawledPage writes no page and returns null when the run is no longer active and running", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });

      const recorded = await recordCrawledPage(
        "cuid-1",
        "deleted-run",
        { visitedPageCount: 3, waitingUrlCount: 0 },
        sampleCrawledPageInput,
      );

      expect(recorded).toBeNull();
      expect(mockCrawledPageDelegate.create).not.toHaveBeenCalled();
    });

    it("saveCrawledPageStructureSkeletons locks the running run, then writes each skeleton on its active page, inside one transaction", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockCrawledPageDelegate.updateMany.mockResolvedValue({ count: 1 });

      const skeletonsWereSaved = await saveCrawledPageStructureSkeletons("cuid-1", "crawl-run-1", [
        { crawledPageId: "crawled-page-1", structureSkeleton: "heading[level=1]" },
        { crawledPageId: "crawled-page-2", structureSkeleton: "heading[level=1]\nparagraph" },
      ]);

      expect(skeletonsWereSaved).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", status: "running", deletedAt: null },
        data: { updatedAt: expect.any(Date) },
      });
      expect(mockCrawledPageDelegate.updateMany.mock.calls).toEqual([
        [
          {
            where: { id: "crawled-page-1", crawlRunId: "crawl-run-1", websiteId: "cuid-1", deletedAt: null },
            data: { structureSkeleton: "heading[level=1]" },
          },
        ],
        [
          {
            where: { id: "crawled-page-2", crawlRunId: "crawl-run-1", websiteId: "cuid-1", deletedAt: null },
            data: { structureSkeleton: "heading[level=1]\nparagraph" },
          },
        ],
      ]);
      const runLockOrder = mockCrawlRunDelegate.updateMany.mock.invocationCallOrder[0];
      const firstPageUpdateOrder = mockCrawledPageDelegate.updateMany.mock.invocationCallOrder[0];
      expect(runLockOrder).toBeLessThan(firstPageUpdateOrder);
    });

    it("saveCrawledPageStructureSkeletons writes nothing and returns false when the run is no longer active and running", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });

      const skeletonsWereSaved = await saveCrawledPageStructureSkeletons("cuid-1", "deleted-run", [
        { crawledPageId: "crawled-page-1", structureSkeleton: "heading[level=1]" },
      ]);

      expect(skeletonsWereSaved).toBe(false);
      expect(mockCrawledPageDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("finishCrawlRun writes the outcome and finish time to the active running run only", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      const finish = {
        status: "stoppedAtPageLimit" as const,
        waitingUrlCount: 12,
        skippedSimilarUrlCount: 5,
        skippedSimilarUrlCountsByPattern: { "/websites/{website}": 5 },
        errorMessage: null,
        loginFailureScreenshotFileName: null,
        durationMs: 64000,
      };

      const runWasFinished = await finishCrawlRun("cuid-1", "crawl-run-1", finish);

      expect(runWasFinished).toBe(true);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", status: "running", deletedAt: null },
        data: { ...finish, finishedAt: expect.any(Date) },
      });
    });

    it("finishCrawlRun returns false when no active running run matched", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });

      const runWasFinished = await finishCrawlRun("cuid-1", "deleted-run", {
        status: "finished",
        waitingUrlCount: 0,
        skippedSimilarUrlCount: 0,
        skippedSimilarUrlCountsByPattern: {},
        errorMessage: null,
        loginFailureScreenshotFileName: null,
        durationMs: 10,
      });

      expect(runWasFinished).toBe(false);
    });

    it("markRunningCrawlRunsInterrupted flips every active running run to interrupted and counts them", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 2 });

      const interruptedRunCount = await markRunningCrawlRunsInterrupted();

      expect(interruptedRunCount).toBe(2);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { status: "running", deletedAt: null },
        data: { status: "interrupted", finishedAt: expect.any(Date) },
      });
    });

    it("listCrawledPageSummariesForRun lists the run's active pages in visiting order, without snapshots, links, or button pages", async () => {
      const {
        ariaSnapshot: _ariaSnapshot,
        linkedUrls: _linkedUrls,
        buttonUrls: _buttonUrls,
        formFields: _formFields,
        ...pageSummary
      } = sampleCrawledPage;
      mockCrawledPageDelegate.findMany.mockResolvedValue([pageSummary]);

      const pageSummaries = await listCrawledPageSummariesForRun("cuid-1", "crawl-run-1");

      expect(mockCrawledPageDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", crawlRunId: "crawl-run-1", deletedAt: null },
        orderBy: { visitOrder: "asc" },
        omit: { ariaSnapshot: true, linkedUrls: true, buttonUrls: true, formFields: true },
      });
      expect(pageSummaries).toEqual([pageSummary]);
    });

    it("findCrawledPageForRun scopes the lookup to the website, the run, and active rows", async () => {
      mockCrawledPageDelegate.findFirst.mockResolvedValue(sampleCrawledPage);

      const found = await findCrawledPageForRun("cuid-1", "crawl-run-1", "crawled-page-1");

      expect(mockCrawledPageDelegate.findFirst).toHaveBeenCalledWith({
        where: {
          id: "crawled-page-1",
          websiteId: "cuid-1",
          crawlRunId: "crawl-run-1",
          deletedAt: null,
        },
      });
      expect(found).toBe(sampleCrawledPage);
    });

    it("findCrawledPageForRun returns null when no active page of that run matches", async () => {
      mockCrawledPageDelegate.findFirst.mockResolvedValue(null);

      expect(await findCrawledPageForRun("cuid-1", "crawl-run-1", "other-page")).toBeNull();
    });
  });

  describe("web objects", () => {
    /** What every web object read includes: its active patterns in order, and its crawl's id and start. */
    const WEB_OBJECT_INCLUDE = {
      pagePatterns: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      crawlRun: { select: { id: true, createdAt: true } },
    };

    /** Two objects as a crawl's end hands them over: Website, then Action under it. */
    const detectedWebObjects: WebObjectInput[] = [
      {
        instancePatternKey: "/websites/{website}",
        detectedName: "Website",
        parentInstancePatternKey: null,
        instanceCount: 3,
        skippedLinkCount: 0,
        pagePatterns: [
          {
            key: "/websites/{website}",
            segments: [
              { kind: "static", value: "websites" },
              { kind: "variable", placeholder: "website", valueShape: "cuid" },
            ],
            role: "instance",
            viewName: null,
            detectedBy: "idShape",
            pageCount: 3,
          },
          {
            key: "/websites/new",
            segments: [
              { kind: "static", value: "websites" },
              { kind: "static", value: "new" },
            ],
            role: "create",
            viewName: null,
            detectedBy: "idShape",
            pageCount: 1,
          },
        ],
      },
      {
        instancePatternKey: "/websites/{website}/credentials/{credential}",
        detectedName: "Credential",
        parentInstancePatternKey: "/websites/{website}",
        instanceCount: 1,
        skippedLinkCount: 2,
        pagePatterns: [],
      },
    ];

    const sampleWebObject = {
      id: "web-object-1",
      websiteId: "cuid-1",
      crawlRunId: "crawl-run-1",
      parentWebObjectId: null,
      instancePatternKey: "/websites/{website}",
      detectedName: "Website",
      name: "Site",
      instanceCount: 3,
      skippedLinkCount: 0,
      sortOrder: 0,
      createdAt: new Date("2026-01-09T00:00:00.000Z"),
      updatedAt: new Date("2026-01-09T00:00:00.000Z"),
      deletedAt: null,
      pagePatterns: [],
      crawlRun: { id: "crawl-run-1", createdAt: new Date("2026-01-07T00:00:00.000Z") },
    };

    it("replaceWebsiteWebObjects locks the run, soft deletes the website's previous patterns and objects, then creates the new ones in order, parents first", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockPagePatternDelegate.updateMany.mockResolvedValue({ count: 5 });
      mockWebObjectDelegate.updateMany.mockResolvedValue({ count: 2 });
      mockWebObjectDelegate.create
        .mockResolvedValueOnce({ id: "web-object-website" })
        .mockResolvedValueOnce({ id: "web-object-credential" });
      mockPagePatternDelegate.createMany.mockResolvedValue({ count: 2 });

      const webObjectsWereReplaced = await replaceWebsiteWebObjects("cuid-1", "crawl-run-1", detectedWebObjects);

      expect(webObjectsWereReplaced).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockCrawlRunDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "crawl-run-1", websiteId: "cuid-1", deletedAt: null },
        data: { updatedAt: expect.any(Date) },
      });
      expect(mockPagePatternDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockWebObjectDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockWebObjectDelegate.create).toHaveBeenNthCalledWith(1, {
        data: {
          websiteId: "cuid-1",
          crawlRunId: "crawl-run-1",
          parentWebObjectId: null,
          instancePatternKey: "/websites/{website}",
          detectedName: "Website",
          instanceCount: 3,
          skippedLinkCount: 0,
          sortOrder: 0,
        },
        select: { id: true },
      });
      expect(mockWebObjectDelegate.create).toHaveBeenNthCalledWith(2, {
        data: {
          websiteId: "cuid-1",
          crawlRunId: "crawl-run-1",
          parentWebObjectId: "web-object-website",
          instancePatternKey: "/websites/{website}/credentials/{credential}",
          detectedName: "Credential",
          instanceCount: 1,
          skippedLinkCount: 2,
          sortOrder: 1,
        },
        select: { id: true },
      });
      // Only the object that has patterns writes any.
      expect(mockPagePatternDelegate.createMany).toHaveBeenCalledTimes(1);
      expect(mockPagePatternDelegate.createMany).toHaveBeenCalledWith({
        data: [
          {
            ...detectedWebObjects[0].pagePatterns[0],
            websiteId: "cuid-1",
            crawlRunId: "crawl-run-1",
            webObjectId: "web-object-website",
            sortOrder: 0,
          },
          {
            ...detectedWebObjects[0].pagePatterns[1],
            websiteId: "cuid-1",
            crawlRunId: "crawl-run-1",
            webObjectId: "web-object-website",
            sortOrder: 1,
          },
        ],
      });
      const lockOrder = mockCrawlRunDelegate.updateMany.mock.invocationCallOrder[0];
      const patternReplaceOrder = mockPagePatternDelegate.updateMany.mock.invocationCallOrder[0];
      const objectReplaceOrder = mockWebObjectDelegate.updateMany.mock.invocationCallOrder[0];
      const firstCreateOrder = mockWebObjectDelegate.create.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(patternReplaceOrder);
      expect(patternReplaceOrder).toBeLessThan(objectReplaceOrder);
      expect(objectReplaceOrder).toBeLessThan(firstCreateOrder);
      // The replaced rows share one timestamp with the run's lock.
      expect(readDeletedAtWrittenBy(mockWebObjectDelegate.updateMany)).toBe(
        readDeletedAtWrittenBy(mockPagePatternDelegate.updateMany),
      );
    });

    it("replaceWebsiteWebObjects writes nothing and returns false when the crawl run is no longer active", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 0 });

      const webObjectsWereReplaced = await replaceWebsiteWebObjects("cuid-1", "deleted-run", detectedWebObjects);

      expect(webObjectsWereReplaced).toBe(false);
      expect(mockPagePatternDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockWebObjectDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockWebObjectDelegate.create).not.toHaveBeenCalled();
    });

    it("replaceWebsiteWebObjects still clears the previous objects when the crawl found none", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockPagePatternDelegate.updateMany.mockResolvedValue({ count: 3 });
      mockWebObjectDelegate.updateMany.mockResolvedValue({ count: 1 });

      expect(await replaceWebsiteWebObjects("cuid-1", "crawl-run-1", [])).toBe(true);
      expect(mockWebObjectDelegate.updateMany).toHaveBeenCalledTimes(1);
      expect(mockWebObjectDelegate.create).not.toHaveBeenCalled();
    });

    it("replaceWebsiteWebObjects names no parent when the parent is not in the list", async () => {
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockWebObjectDelegate.create.mockResolvedValue({ id: "web-object-orphan" });

      await replaceWebsiteWebObjects("cuid-1", "crawl-run-1", [detectedWebObjects[1]]);

      expect(mockWebObjectDelegate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ parentWebObjectId: null }) }),
      );
    });

    it("replaceWebsiteWebObjects propagates a failure inside the transaction", async () => {
      const createError = new Error("unique constraint failed");
      mockCrawlRunDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockWebObjectDelegate.create.mockRejectedValue(createError);

      await expect(replaceWebsiteWebObjects("cuid-1", "crawl-run-1", detectedWebObjects)).rejects.toBe(createError);
    });

    it("listWebObjectsForWebsite returns the website's active objects in detection order, with their patterns and crawl", async () => {
      mockWebObjectDelegate.findMany.mockResolvedValue([sampleWebObject]);

      const webObjects = await listWebObjectsForWebsite("cuid-1");

      expect(mockWebObjectDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: WEB_OBJECT_INCLUDE,
      });
      expect(webObjects).toEqual([sampleWebObject]);
    });

    it("findWebObjectNamesForCrawlRun reads the names of the run's active objects only", async () => {
      const savedNames = [{ id: "web-object-1", instancePatternKey: "/websites/{website}", detectedName: "Website", name: null }];
      mockWebObjectDelegate.findMany.mockResolvedValue(savedNames);

      const webObjectNames = await findWebObjectNamesForCrawlRun("cuid-1", "crawl-run-1");

      expect(mockWebObjectDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", crawlRunId: "crawl-run-1", deletedAt: null },
        select: { id: true, instancePatternKey: true, detectedName: true, name: true },
      });
      expect(webObjectNames).toBe(savedNames);
    });

    it("renameWebObject writes the name to the website's active object and returns it with its patterns and crawl", async () => {
      mockWebObjectDelegate.update.mockResolvedValue(sampleWebObject);

      const renamed = await renameWebObject("cuid-1", "web-object-1", "Site");

      expect(mockWebObjectDelegate.update).toHaveBeenCalledWith({
        where: { id: "web-object-1", websiteId: "cuid-1", deletedAt: null },
        data: { name: "Site" },
        include: WEB_OBJECT_INCLUDE,
      });
      expect(renamed).toBe(sampleWebObject);
    });

    it("renameWebObject returns null when no active object of that website matched", async () => {
      mockWebObjectDelegate.update.mockRejectedValue(recordNotFoundError);

      expect(await renameWebObject("cuid-1", "replaced-object", null)).toBeNull();
    });

    it("renameWebObject propagates any other failure", async () => {
      const databaseError = new Error("connection reset");
      mockWebObjectDelegate.update.mockRejectedValue(databaseError);

      await expect(renameWebObject("cuid-1", "web-object-1", "Site")).rejects.toBe(databaseError);
    });
  });

  describe("findLatestCrawledPagesForWebsite", () => {
    /** What every crawl run lookup requires: active, finished, and with at least one page visited. */
    const FINISHED_RUN_WITH_PAGES_WHERE = {
      websiteId: "cuid-1",
      deletedAt: null,
      status: { not: "running" },
      visitedPageCount: { gt: 0 },
    };

    /**
     * Builds the page query expected for one picked run: its active,
     * successful pages that have a snapshot, in visiting order.
     * @param crawlRunId - The id of the run that was picked
     * @returns The arguments `crawledPage.findMany` should receive
     */
    const pagesQueryForRun = (crawlRunId: string) => ({
      where: {
        websiteId: "cuid-1",
        crawlRunId,
        deletedAt: null,
        succeeded: true,
        ariaSnapshot: { not: null },
      },
      orderBy: { visitOrder: "asc" },
      select: { url: true, title: true, depth: true, ariaSnapshot: true },
    });

    const startPageSnapshot = {
      url: "https://example.com/",
      title: "Home",
      depth: 0,
      ariaSnapshot: '- link "Log in"',
    };
    const loginPageSnapshot = {
      url: "https://example.com/login",
      title: "Log in",
      depth: 1,
      ariaSnapshot: '- textbox "Email"',
    };

    it("reads the pages of the newest run logged in as the action's credential", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue({ id: "logged-in-run" });
      mockCrawledPageDelegate.findMany.mockResolvedValue([startPageSnapshot, loginPageSnapshot]);

      const pages = await findLatestCrawledPagesForWebsite("cuid-1", "credential-1");

      expect(pages).toEqual([startPageSnapshot, loginPageSnapshot]);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledTimes(1);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledWith({
        where: { ...FINISHED_RUN_WITH_PAGES_WHERE, credentialId: "credential-1", isLoggedIn: true },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(mockCrawledPageDelegate.findMany).toHaveBeenCalledWith(
        pagesQueryForRun("logged-in-run"),
      );
    });

    it("reads the pages of the newest logged-out run for an action that runs logged out", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue({ id: "logged-out-run" });
      mockCrawledPageDelegate.findMany.mockResolvedValue([startPageSnapshot]);

      const pages = await findLatestCrawledPagesForWebsite("cuid-1", null);

      expect(pages).toEqual([startPageSnapshot]);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledTimes(1);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledWith({
        where: { ...FINISHED_RUN_WITH_PAGES_WHERE, credentialId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(mockCrawledPageDelegate.findMany).toHaveBeenCalledWith(
        pagesQueryForRun("logged-out-run"),
      );
    });

    it("falls back to the newest finished run of any kind when none was crawled the same way", async () => {
      mockCrawlRunDelegate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "any-kind-of-run" });
      mockCrawledPageDelegate.findMany.mockResolvedValue([startPageSnapshot]);

      const pages = await findLatestCrawledPagesForWebsite("cuid-1", "credential-1");

      expect(pages).toEqual([startPageSnapshot]);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledTimes(2);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenNthCalledWith(2, {
        where: FINISHED_RUN_WITH_PAGES_WHERE,
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(mockCrawledPageDelegate.findMany).toHaveBeenCalledWith(
        pagesQueryForRun("any-kind-of-run"),
      );
    });

    it("returns no pages, and reads none, when the website was never crawled", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue(null);

      const pages = await findLatestCrawledPagesForWebsite("cuid-1", null);

      expect(pages).toEqual([]);
      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledTimes(2);
      expect(mockCrawledPageDelegate.findMany).not.toHaveBeenCalled();
    });

    it("leaves out any page that comes back without a snapshot", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue({ id: "logged-out-run" });
      mockCrawledPageDelegate.findMany.mockResolvedValue([
        startPageSnapshot,
        { ...loginPageSnapshot, ariaSnapshot: null },
      ]);

      const pages = await findLatestCrawledPagesForWebsite("cuid-1", null);

      expect(pages).toEqual([startPageSnapshot]);
    });
  });

  describe("credentials", () => {
    it("listCredentialsForWebsite returns the website's active credentials, newest first, without passwords", async () => {
      mockCredentialDelegate.findMany.mockResolvedValue([sampleCredentialSummary]);

      const credentials = await listCredentialsForWebsite("cuid-1");

      expect(mockCredentialDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        omit: OMIT_ENCRYPTED_PASSWORD,
      });
      expect(credentials).toEqual([sampleCredentialSummary]);
    });

    it("findCredentialForWebsite scopes the lookup to the website and to active rows, without the password", async () => {
      mockCredentialDelegate.findFirst.mockResolvedValue(sampleCredentialSummary);

      const found = await findCredentialForWebsite("cuid-1", "credential-1");

      expect(mockCredentialDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "credential-1", websiteId: "cuid-1", deletedAt: null },
        omit: OMIT_ENCRYPTED_PASSWORD,
      });
      expect(found).toBe(sampleCredentialSummary);
    });

    it("findCredentialWithPasswordForWebsite is the one lookup that keeps the encrypted password", async () => {
      mockCredentialDelegate.findFirst.mockResolvedValue(sampleCredential);

      const found = await findCredentialWithPasswordForWebsite("cuid-1", "credential-1");

      expect(mockCredentialDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "credential-1", websiteId: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleCredential);
    });

    it("createCredentialForWebsite inserts the credential with its encrypted password, answering without it", async () => {
      mockCredentialDelegate.create.mockResolvedValue(sampleCredentialSummary);

      const created = await createCredentialForWebsite(
        "cuid-1",
        sampleCredentialInput,
        "iv.tag.ciphertext",
      );

      expect(mockCredentialDelegate.create).toHaveBeenCalledWith({
        data: { ...sampleCredentialInput, encryptedPassword: "iv.tag.ciphertext", websiteId: "cuid-1" },
        omit: OMIT_ENCRYPTED_PASSWORD,
      });
      expect(created).toBe(sampleCredentialSummary);
    });

    it("updateCredentialForWebsite replaces the password when a new one is given", async () => {
      mockCredentialDelegate.update.mockResolvedValue(sampleCredentialSummary);

      const updated = await updateCredentialForWebsite(
        "cuid-1",
        "credential-1",
        sampleCredentialInput,
        "new.encrypted.value",
      );

      expect(mockCredentialDelegate.update).toHaveBeenCalledWith({
        where: { id: "credential-1", websiteId: "cuid-1", deletedAt: null },
        data: { ...sampleCredentialInput, encryptedPassword: "new.encrypted.value" },
        omit: OMIT_ENCRYPTED_PASSWORD,
      });
      expect(updated).toBe(sampleCredentialSummary);
    });

    it("updateCredentialForWebsite leaves the saved password alone when none is given", async () => {
      mockCredentialDelegate.update.mockResolvedValue(sampleCredentialSummary);

      await updateCredentialForWebsite("cuid-1", "credential-1", sampleCredentialInput, null);

      expect(mockCredentialDelegate.update).toHaveBeenCalledWith({
        where: { id: "credential-1", websiteId: "cuid-1", deletedAt: null },
        data: sampleCredentialInput,
        omit: OMIT_ENCRYPTED_PASSWORD,
      });
    });

    it("updateCredentialForWebsite returns null when no active credential of that website matched", async () => {
      mockCredentialDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateCredentialForWebsite(
        "cuid-1",
        "deleted-credential",
        sampleCredentialInput,
        null,
      );

      expect(updated).toBeNull();
    });

    it("updateCredentialForWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockCredentialDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateCredentialForWebsite("cuid-1", "credential-1", sampleCredentialInput, null),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteCredentialForWebsite stamps deletedAt on the active credential and reports it", async () => {
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });

      const credentialWasDeleted = await softDeleteCredentialForWebsite("cuid-1", "credential-1");

      expect(credentialWasDeleted).toBe(true);
      expect(mockCredentialDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "credential-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("softDeleteCredentialForWebsite unlinks the credential from its website's actions inside the same transaction", async () => {
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 2 });

      await softDeleteCredentialForWebsite("cuid-1", "credential-1");

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
      expect(mockActionDelegate.updateMany).toHaveBeenCalledTimes(1);
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { credentialId: "credential-1", websiteId: "cuid-1" },
        data: { credentialId: null },
      });
      const credentialStampOrder = mockCredentialDelegate.updateMany.mock.invocationCallOrder[0];
      const actionUnlinkOrder = mockActionDelegate.updateMany.mock.invocationCallOrder[0];
      expect(credentialStampOrder).toBeLessThan(actionUnlinkOrder);
    });

    it("softDeleteCredentialForWebsite returns false and unlinks no actions when no active credential matched", async () => {
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await softDeleteCredentialForWebsite("cuid-1", "deleted-credential")).toBe(false);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockActionDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("softDeleteCredentialForWebsite propagates a failure inside the transaction", async () => {
      const unlinkError = new Error("deadlock detected");
      mockCredentialDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionDelegate.updateMany.mockRejectedValue(unlinkError);

      await expect(softDeleteCredentialForWebsite("cuid-1", "credential-1")).rejects.toBe(
        unlinkError,
      );
    });
  });

  describe("soft deletes and parameters", () => {
    it("softDeleteWebsite also stamps the website's action parameters and created objects with the same deletedAt", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      for (const delegate of [
        mockUseCaseDelegate,
        mockActionDelegate,
        mockScreenshotRunDelegate,
        mockActionScriptDelegate,
        mockActionScriptRunDelegate,
        mockActionScriptRefinementDelegate,
        mockCrawlRunDelegate,
        mockCrawledPageDelegate,
        mockCredentialDelegate,
        mockPagePatternDelegate,
        mockWebObjectDelegate,
        mockActionParameterDelegate,
        mockCreatedObjectDelegate,
      ]) {
        delegate.updateMany.mockResolvedValue({ count: 0 });
      }

      await softDeleteWebsite("cuid-1");

      const websiteDeletedAt = readDeletedAtWrittenBy(mockWebsiteDelegate.updateMany);
      expect(mockActionParameterDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: websiteDeletedAt },
      });
      expect(mockCreatedObjectDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: websiteDeletedAt },
      });
    });

    it("softDeleteActionForWebsite also stamps the action's parameters, but keeps its created objects", async () => {
      for (const delegate of [mockActionDelegate, mockActionScriptDelegate, mockActionScriptRunDelegate, mockActionScriptRefinementDelegate, mockActionParameterDelegate]) {
        delegate.updateMany.mockResolvedValue({ count: 1 });
      }

      await softDeleteActionForWebsite("cuid-1", "action-1");

      expect(mockActionParameterDelegate.updateMany).toHaveBeenCalledWith({
        where: { actionId: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: readDeletedAtWrittenBy(mockActionDelegate.updateMany) },
      });
      expect(mockCreatedObjectDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("findActionScriptRunWithObjects reads one active run with the objects it created and deleted", async () => {
      mockActionScriptRunDelegate.findFirst.mockResolvedValue(sampleActionScriptRun);

      const found = await findActionScriptRunWithObjects("cuid-1", "action-script-run-1");

      expect(mockActionScriptRunDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "action-script-run-1", websiteId: "cuid-1", deletedAt: null },
        include: ACTION_SCRIPT_RUN_OBJECTS_INCLUDE,
      });
      expect(found).toBe(sampleActionScriptRun);
    });
  });

  describe("crawled pages for parameters", () => {
    it("readCrawlRunPagesMatching reads every address first, then only the kept pages' snapshots and fields", async () => {
      mockCrawledPageDelegate.findMany
        .mockResolvedValueOnce([
          { id: "page-1", url: "https://example.com/projects" },
          { id: "page-2", url: "https://example.com/about" },
        ])
        .mockResolvedValueOnce([
          { url: "https://example.com/projects", title: "Projects", ariaSnapshot: "- heading", formFields: [{ junk: true }] },
        ]);

      const pages = await readCrawlRunPagesMatching("cuid-1", "crawl-run-1", (pageUrl) => pageUrl.endsWith("/projects"));

      expect(mockCrawledPageDelegate.findMany).toHaveBeenNthCalledWith(1, {
        where: { websiteId: "cuid-1", crawlRunId: "crawl-run-1", deletedAt: null, succeeded: true },
        orderBy: { visitOrder: "asc" },
        select: { id: true, url: true },
      });
      expect(mockCrawledPageDelegate.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ["page-1"] }, websiteId: "cuid-1", deletedAt: null },
        orderBy: { visitOrder: "asc" },
        select: { url: true, title: true, ariaSnapshot: true, formFields: true },
      });
      expect(pages).toEqual([{ url: "https://example.com/projects", title: "Projects", ariaSnapshot: "- heading", formFields: [] }]);
    });

    it("readCrawlRunPagesMatching reads no snapshots when no page is kept", async () => {
      mockCrawledPageDelegate.findMany.mockResolvedValueOnce([{ id: "page-2", url: "https://example.com/about" }]);

      const pages = await readCrawlRunPagesMatching("cuid-1", "crawl-run-1", () => false);

      expect(pages).toEqual([]);
      expect(mockCrawledPageDelegate.findMany).toHaveBeenCalledTimes(1);
    });

    it("findLatestCrawlPagesMatching reads the crawl done the way the action runs, with when it ran", async () => {
      mockCrawlRunDelegate.findFirst
        .mockResolvedValueOnce({ id: "crawl-run-7" })
        .mockResolvedValueOnce({ id: "crawl-run-7", createdAt: new Date("2026-02-02T00:00:00.000Z") });
      mockCrawledPageDelegate.findMany.mockResolvedValueOnce([]);

      const crawl = await findLatestCrawlPagesMatching("cuid-1", "credential-1", () => true);

      expect(mockCrawlRunDelegate.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: expect.objectContaining({ credentialId: "credential-1", isLoggedIn: true }),
      }));
      expect(crawl).toEqual({ crawlRunId: "crawl-run-7", crawledAt: new Date("2026-02-02T00:00:00.000Z"), pages: [] });
    });

    it("findLatestCrawlPagesMatching falls back to any crawl, and reads nothing when the website was never crawled", async () => {
      mockCrawlRunDelegate.findFirst.mockResolvedValue(null);

      const crawl = await findLatestCrawlPagesMatching("cuid-1", null, () => true);

      expect(mockCrawlRunDelegate.findFirst).toHaveBeenCalledTimes(2);
      expect(crawl).toEqual({ crawlRunId: null, crawledAt: null, pages: [] });
      expect(mockCrawledPageDelegate.findMany).not.toHaveBeenCalled();
    });
  });

  describe("action parameters", () => {
    /** A stored detected row: the project's name, typed by a step. */
    const storedParameterRow: ActionParameter = {
      id: "parameter-1",
      websiteId: "cuid-1",
      actionId: "action-1",
      key: "projectName",
      kind: "text",
      source: "steps",
      foundBy: ["plan", "crawl"],
      isSecret: false,
      label: "Project name",
      userLabel: null,
      fieldTarget: { label: "Project name" },
      fieldRole: "textbox",
      inputType: "text",
      placeholder: null,
      stepAction: "fill",
      pageUrl: "https://example.com/projects/new",
      containerName: "New project",
      besideKeys: [],
      fillAfterKey: null,
      userRequiredChoice: null,
      runIsRequired: null,
      runReadAt: null,
      crawlIsRequired: true,
      crawlReadAt: new Date("2026-02-02T00:00:00.000Z"),
      objectTypeKey: null,
      matchText: null,
      matchFields: [],
      createdAt: new Date("2026-02-02T00:00:00.000Z"),
      updatedAt: new Date("2026-02-02T00:00:00.000Z"),
      deletedAt: null,
    };

    /** A detected row as the sync hands it over. */
    const detectedRow: DetectedParameter = {
      key: "projectName",
      kind: "text",
      source: "steps",
      foundBy: ["plan"],
      isSecret: false,
      label: "Project name",
      fieldTarget: { label: "Project name" },
      fieldRole: null,
      inputType: null,
      placeholder: null,
      stepAction: "fill",
      pageUrl: null,
      containerName: null,
      besideKeys: [],
      fillAfterKey: null,
      crawlIsRequired: true,
      runIsRequired: undefined,
      objectTypeKey: null,
    };

    const READ_TIMES = { crawlReadAt: new Date("2026-03-03T00:00:00.000Z"), runReadAt: new Date("2026-03-04T00:00:00.000Z") };

    it("toActionParameterRecord parses the target and narrows every value column", () => {
      expect(toActionParameterRecord(storedParameterRow)).toMatchObject({
        key: "projectName",
        kind: "text",
        source: "steps",
        foundBy: ["plan", "crawl"],
        fieldTarget: { label: "Project name" },
        stepAction: "fill",
        userRequiredChoice: null,
        matchFields: [],
      });
      expect(
        toActionParameterRecord({
          ...storedParameterRow,
          kind: "weird",
          source: "weird",
          foundBy: ["plan", "weird"],
          fieldTarget: { nonsense: true },
          stepAction: "weird",
          userRequiredChoice: "optional",
          matchFields: ["value", "weird"],
        }),
      ).toMatchObject({
        kind: "text",
        source: "steps",
        foundBy: ["plan"],
        fieldTarget: null,
        stepAction: null,
        userRequiredChoice: "optional",
        matchFields: ["value"],
      });
    });

    it("listActionParametersForAction lists the action's active rows, oldest first, as records", async () => {
      mockActionParameterDelegate.findMany.mockResolvedValue([storedParameterRow]);

      const records = await listActionParametersForAction("cuid-1", "action-1");

      expect(mockActionParameterDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", actionId: "action-1", deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
      expect(records).toEqual([toActionParameterRecord(storedParameterRow)]);
    });

    it("findActionParameterSyncInputs reads the live versions (dropping unparseable plans), failed-run snapshots, and the user's keys", async () => {
      mockActionScriptDelegate.findMany.mockResolvedValue([
        { id: "script-2", plan: samplePlan, contextPageUrls: ["https://example.com/"] },
        { id: "script-1", plan: { broken: true }, contextPageUrls: [] },
      ]);
      mockActionScriptRunDelegate.findMany.mockResolvedValue([
        { failingPageUrl: "https://example.com/new", failingPageAriaSnapshot: "- dialog" },
        { failingPageUrl: null, failingPageAriaSnapshot: null },
      ]);
      mockActionParameterDelegate.findMany.mockResolvedValue([{ key: "notes" }]);

      const inputs = await findActionParameterSyncInputs("cuid-1", "action-1");

      expect(inputs).toEqual({
        versions: [{ id: "script-2", plan: samplePlan, contextPageUrls: ["https://example.com/"] }],
        failingPageSnapshots: [{ url: "https://example.com/new", ariaSnapshot: "- dialog" }],
        reservedKeys: ["notes"],
      });
      expect(mockActionScriptRunDelegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, where: expect.objectContaining({ failingPageAriaSnapshot: { not: null } }) }),
      );
      expect(mockActionParameterDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", actionId: "action-1", source: "you" },
        select: { key: true },
      });
    });

    it("findNewestActionPlan reads the newest version's plan, or null", async () => {
      mockActionScriptDelegate.findFirst
        .mockResolvedValueOnce({ plan: samplePlan })
        .mockResolvedValueOnce({ plan: { broken: true } })
        .mockResolvedValueOnce(null);

      expect(await findNewestActionPlan("cuid-1", "action-1")).toEqual(samplePlan);
      expect(await findNewestActionPlan("cuid-1", "action-1")).toBeNull();
      expect(await findNewestActionPlan("cuid-1", "action-1")).toBeNull();
      expect(mockActionScriptDelegate.findFirst).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", actionId: "action-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { plan: true },
      });
    });

    it("saveSyncedActionParameters writes nothing when the action is no longer active", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });

      const saved = await saveSyncedActionParameters("cuid-1", "action-1", [detectedRow], READ_TIMES);

      expect(saved).toBe(false);
      expect(mockActionParameterDelegate.findMany).not.toHaveBeenCalled();
    });

    it("saveSyncedActionParameters creates new rows, updates existing ones without the user's columns, and keeps the user's rows", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionParameterDelegate.findMany.mockResolvedValue([
        { ...storedParameterRow, foundBy: ["plan", "run"], deletedAt: new Date("2026-01-01T00:00:00.000Z") },
        { ...storedParameterRow, id: "parameter-yours", key: "code", source: "you" },
      ]);
      const objectRow: DetectedParameter = {
        ...detectedRow,
        key: "object",
        kind: "object",
        fieldTarget: null,
        stepAction: null,
        crawlIsRequired: null,
        runIsRequired: true,
        objectTypeKey: "/projects/{project}",
      };

      const saved = await saveSyncedActionParameters(
        "cuid-1",
        "action-1",
        [detectedRow, { ...detectedRow, key: "code" }, objectRow],
        READ_TIMES,
      );

      expect(saved).toBe(true);
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { parametersSyncedAt: expect.any(Date) },
      });
      expect(mockActionParameterDelegate.update).toHaveBeenCalledTimes(1);
      const [updateArguments] = mockActionParameterDelegate.update.mock.calls[0] as [{ where: unknown; data: Record<string, unknown> }];
      expect(updateArguments.where).toEqual({ id: "parameter-1" });
      expect(updateArguments.data).toMatchObject({
        foundBy: ["plan", "run"],
        crawlIsRequired: true,
        crawlReadAt: READ_TIMES.crawlReadAt,
        deletedAt: null,
      });
      expect(updateArguments.data).not.toHaveProperty("userLabel");
      expect(updateArguments.data).not.toHaveProperty("runIsRequired");
      expect(mockActionParameterDelegate.create).toHaveBeenCalledTimes(1);
      expect(mockActionParameterDelegate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          websiteId: "cuid-1",
          actionId: "action-1",
          key: "object",
          kind: "object",
          fieldTarget: "Prisma.DbNull",
          crawlReadAt: null,
          runIsRequired: true,
          runReadAt: READ_TIMES.runReadAt,
          objectTypeKey: "/projects/{project}",
        }),
      });
      expect(mockActionParameterDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("saveSyncedActionParameters soft deletes detected rows nothing produces, but keeps page fields a run found", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockActionParameterDelegate.findMany.mockResolvedValue([
        { ...storedParameterRow, id: "parameter-gone", key: "gone" },
        { ...storedParameterRow, id: "parameter-run-page", key: "tagline", source: "page", foundBy: ["run"] },
        { ...storedParameterRow, id: "parameter-crawl-page", key: "size", source: "page", foundBy: ["crawl"] },
        { ...storedParameterRow, id: "parameter-yours", key: "code", source: "you" },
        { ...storedParameterRow, id: "parameter-already-gone", key: "older", deletedAt: new Date() },
      ]);

      await saveSyncedActionParameters("cuid-1", "action-1", [], READ_TIMES);

      expect(mockActionParameterDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["parameter-gone", "parameter-crawl-page"] } },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("setActionParameterChoices saves the user's choices on an active row, or reports none", async () => {
      mockActionParameterDelegate.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      mockActionParameterDelegate.findFirst.mockResolvedValueOnce(storedParameterRow).mockResolvedValueOnce(null);
      const choices = { userLabel: "Name", userRequiredChoice: "optional" as const };

      expect(await setActionParameterChoices("cuid-1", "action-1", "projectName", choices)).toEqual(
        toActionParameterRecord(storedParameterRow),
      );
      expect(mockActionParameterDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", actionId: "action-1", key: "projectName", deletedAt: null },
        data: choices,
      });
      expect(await setActionParameterChoices("cuid-1", "action-1", "gone", choices)).toBeNull();

      mockActionParameterDelegate.updateMany.mockResolvedValueOnce({ count: 1 });
      expect(await setActionParameterChoices("cuid-1", "action-1", "raced", choices)).toBeNull();
    });

    it("addUserActionParameter keys a value or a field after its label, numbered when taken", async () => {
      mockActionParameterDelegate.findMany.mockResolvedValue([{ key: "code" }]);
      mockActionParameterDelegate.create.mockResolvedValue({ ...storedParameterRow, key: "code2", source: "you" });

      await addUserActionParameter("cuid-1", "action-1", {
        addKind: "value",
        label: "Code",
        requiredChoice: "optional",
        valueKind: "text",
        objectTypeKey: null,
        matchText: "AP7",
        matchFields: ["value"],
      });
      expect(mockActionParameterDelegate.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          key: "code2",
          source: "you",
          foundBy: ["you"],
          kind: "text",
          userRequiredChoice: "optional",
          objectTypeKey: null,
          matchText: "AP7",
          matchFields: ["value"],
        }),
      });

      await addUserActionParameter("cuid-1", "action-1", {
        addKind: "value",
        label: "Project",
        requiredChoice: "optional",
        valueKind: "object",
        objectTypeKey: "/projects/{project}",
        matchText: "Mercury",
        matchFields: ["targetName"],
      });
      expect(mockActionParameterDelegate.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ kind: "object", userRequiredChoice: "required", objectTypeKey: "/projects/{project}" }),
      });

      await addUserActionParameter("cuid-1", "action-1", {
        addKind: "field",
        label: "Size",
        requiredChoice: "optional",
        fieldTarget: { label: "Size" },
        stepAction: "selectOption",
        fillAfterKey: "projectName",
      });
      expect(mockActionParameterDelegate.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          key: "size",
          kind: "option",
          fieldTarget: { label: "Size" },
          stepAction: "selectOption",
          fillAfterKey: "projectName",
        }),
      });
      await addUserActionParameter("cuid-1", "action-1", {
        addKind: "field",
        label: "Notes",
        requiredChoice: "required",
        fieldTarget: { label: "Notes" },
        stepAction: "fill",
        fillAfterKey: "projectName",
      });
      expect(mockActionParameterDelegate.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ kind: "text", userRequiredChoice: "required" }),
      });
    });

    it("removeUserActionParameter removes only the user's own rows", async () => {
      mockActionParameterDelegate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "parameter-1", source: "steps" })
        .mockResolvedValueOnce({ id: "parameter-yours", source: "you" });

      expect(await removeUserActionParameter("cuid-1", "action-1", "gone")).toBe("notFound");
      expect(await removeUserActionParameter("cuid-1", "action-1", "projectName")).toBe("notYours");
      expect(await removeUserActionParameter("cuid-1", "action-1", "code")).toBe("removed");
      expect(mockActionParameterDelegate.update).toHaveBeenCalledWith({
        where: { id: "parameter-yours" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("listActionIdsForWebsite lists the website's active actions' ids", async () => {
      mockActionDelegate.findMany.mockResolvedValue([{ id: "action-1" }, { id: "action-2" }]);

      expect(await listActionIdsForWebsite("cuid-1")).toEqual(["action-1", "action-2"]);
      expect(mockActionDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        select: { id: true },
      });
    });
  });

  describe("created objects", () => {
    const CREATED_OBJECT_INCLUDE = {
      action: { select: { id: true, title: true, deletedAt: true } },
      deletedByActionScriptRun: {
        select: { id: true, actionId: true, actionScriptId: true, createdAt: true, action: { select: { title: true } } },
      },
    };

    it("createCreatedObject records one object under the website", async () => {
      const createdObjectInput = {
        actionId: "action-1",
        actionScriptId: "action-script-1",
        actionScriptRunId: "action-script-run-1",
        objectTypeKey: "/projects/{project}",
        objectTypeName: "Project",
        name: "Apollo 7",
        url: null,
      };
      mockCreatedObjectDelegate.create.mockResolvedValue({ id: "created-object-1" });

      expect(await createCreatedObject("cuid-1", createdObjectInput)).toEqual({ id: "created-object-1" });
      expect(mockCreatedObjectDelegate.create).toHaveBeenCalledWith({ data: { ...createdObjectInput, websiteId: "cuid-1" } });
    });

    it("lists the record, and the choosable objects of one type", async () => {
      mockCreatedObjectDelegate.findMany.mockResolvedValue([{ id: "created-object-1" }]);

      await listCreatedObjectsForWebsite("cuid-1");
      expect(mockCreatedObjectDelegate.findMany).toHaveBeenLastCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: CREATED_OBJECT_INCLUDE,
      });

      await listChoosableCreatedObjects("cuid-1", "/projects/{project}");
      expect(mockCreatedObjectDelegate.findMany).toHaveBeenLastCalledWith({
        where: {
          websiteId: "cuid-1",
          objectTypeKey: "/projects/{project}",
          deletedAt: null,
          notSeenSince: null,
          deletedOnSiteAt: null,
        },
        orderBy: { createdAt: "desc" },
        include: CREATED_OBJECT_INCLUDE,
      });

      await listCreatedObjectsToCheck("cuid-1");
      expect(mockCreatedObjectDelegate.findMany).toHaveBeenLastCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null, deletedOnSiteAt: null, objectTypeKey: { not: null } },
      });
    });

    it("removes an object from the record, and marks one a run deleted", async () => {
      mockCreatedObjectDelegate.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      expect(await removeCreatedObject("cuid-1", "created-object-1")).toBe(true);
      expect(mockCreatedObjectDelegate.updateMany).toHaveBeenLastCalledWith({
        where: { id: "created-object-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(await markCreatedObjectDeletedByRun("cuid-1", "created-object-1", "run-9")).toBe(false);
      expect(mockCreatedObjectDelegate.updateMany).toHaveBeenLastCalledWith({
        where: { id: "created-object-1", websiteId: "cuid-1", deletedAt: null, deletedOnSiteAt: null },
        data: { deletedOnSiteAt: expect.any(Date), deletedByActionScriptRunId: "run-9" },
      });
    });

    it("saveCreatedObjectChecks marks listed objects seen and the others Not seen, keeping the first miss", async () => {
      mockCreatedObjectDelegate.updateMany.mockResolvedValue({ count: 1 });
      const checkedAt = new Date("2026-05-05T00:00:00.000Z");

      await saveCreatedObjectChecks(
        "cuid-1",
        [
          { createdObjectId: "created-object-1", isListed: true },
          { createdObjectId: "created-object-2", isListed: false },
        ],
        checkedAt,
      );

      expect(mockCreatedObjectDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["created-object-1"] }, websiteId: "cuid-1", deletedAt: null },
        data: { lastSeenAt: checkedAt, notSeenSince: null },
      });
      expect(mockCreatedObjectDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["created-object-2"] }, websiteId: "cuid-1", deletedAt: null, notSeenSince: null },
        data: { notSeenSince: checkedAt },
      });

      mockCreatedObjectDelegate.updateMany.mockClear();
      await saveCreatedObjectChecks("cuid-1", [], checkedAt);
      expect(mockCreatedObjectDelegate.updateMany).not.toHaveBeenCalled();
    });
  });
});
