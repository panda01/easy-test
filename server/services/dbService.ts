import {
  PrismaClient,
  type Prisma,
  type Website,
  type UseCase,
  type Action,
  type ScreenshotRun,
  type ActionScript,
  type ActionScriptRun,
  type ActionScriptRefinement,
  type CrawlRun,
  type CrawledPage,
  type Credential,
  type WebObject,
  type PagePattern,
} from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CrawlButtonMode } from "../utils/crawlButtonModes.js";
import { type ActionPlan, parseActionPlan } from "../utils/actionPlanSchema.js";
import type {
  PagePatternRole,
  PathSegment,
  PatternDetectionMethod,
} from "../utils/detectPagePatterns.js";
import type { NewStructureSkeleton } from "../utils/crawlPatternSampling.js";

export type {
  Website,
  UseCase,
  Action,
  ScreenshotRun,
  ActionScript,
  ActionScriptRun,
  ActionScriptRefinement,
  CrawlRun,
  CrawledPage,
  Credential,
  WebObject,
  PagePattern,
};

/**
 * `DATABASE_URL` is read at MODULE LOAD time, which means `../bootEnv.js` must
 * already have run. `server/server.ts` guarantees that by importing it first;
 * any standalone script that imports this module must do the same.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not defined - import `server/bootEnv.js` before this module",
  );
}

/**
 * The one Prisma client for the whole process, and the one place a driver
 * adapter is constructed.
 *
 * Prisma 7 has no built-in connection layer: `PrismaClientOptions` types
 * `adapter` as REQUIRED unless you pass `accelerateUrl`, so `new PrismaClient()`
 * neither typechecks nor runs. `@prisma/adapter-pg` wraps node-postgres and
 * ships `pg` + `@types/pg` as its own dependencies, so neither is declared in
 * this project's package.json.
 *
 * Both bindings are module-private on purpose - nothing outside this file may
 * hold the client, so every database access in the app goes through one of the
 * named functions below. That is also why app code must never import from
 * `../generated/prisma/` directly. See `../prisma/README.md`.
 */
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

/** The fields a caller supplies when creating or replacing a website row. */
export interface WebsiteInput {
  url: string;
  name: string;
  description?: string | null;
  /** How long to wait for network idle before a screenshot; the column default applies when omitted on create. */
  networkIdleTimeoutMs?: number;
  /** The floor on the time from page load to screenshot; the column default applies when omitted on create. */
  screenshotMinimumWaitMs?: number;
  /** The website's login page, or null when it does not require login. */
  loginUrl?: string | null;
}

/** The fields a caller supplies when creating or replacing a use case or an action. */
export interface TitleDescriptionInput {
  title: string;
  description: string;
}

/** The fields a caller supplies when creating or replacing a use case. */
export type UseCaseInput = TitleDescriptionInput;

/** The fields a caller supplies when creating or replacing an action. */
export interface ActionInput extends TitleDescriptionInput {
  /** The credential the action logs in as before each run, or null to run logged out. */
  credentialId: string | null;
}

/** An action as the API returns it: the row plus the id and name of the credential it runs as. */
export type ActionWithCredential = Action & {
  credential: { id: string; name: string } | null;
};

/**
 * An action's newest active script version, cut down to what the website's
 * action list shows: its id, its version number, the action text it was
 * generated from (so the list can tell it is out of date), and its newest
 * active run.
 */
export interface NewestActionScriptSummary {
  /** The newest version's cuid. */
  id: string;
  /** Its version number: how many active versions the action has, counting the oldest as 1. */
  versionNumber: number;
  /** The action's title when the version was generated. */
  actionTitle: string;
  /** The action's description when the version was generated. */
  actionDescription: string;
  /** The credential the action ran as when the version was generated, or null for logged out. */
  credentialId: string | null;
  /** That version's newest active run, or null when it has not been run yet. */
  latestRun: LatestActionScriptRun | null;
}

/**
 * An action as the website's action list returns it: the row with its
 * credential, plus its `newestScript` (null when it has no versions yet), so
 * the list can show whether the newest version's latest run passed.
 */
export type ActionWithNewestScript = ActionWithCredential & {
  newestScript: NewestActionScriptSummary | null;
};

/**
 * The fields a caller supplies when recording one screenshot run. The
 * Playwright service produces everything except `requestedUrl` and
 * `screenshotFileName`, which the controller decides before the visit.
 */
export interface ScreenshotRunInput {
  /** The URL the browser was sent to (the website's URL at run time). */
  requestedUrl: string;
  /** True only when navigation completed with an HTTP status below 400. */
  succeeded: boolean;
  /** The main response's HTTP status, or null when there was no response. */
  httpStatus: number | null;
  /** Why the run failed, or null when it succeeded. */
  errorMessage: string | null;
  /** The PNG's path relative to the screenshot directory, or null when nothing was captured. */
  screenshotFileName: string | null;
  /** How long the navigation took, in milliseconds. */
  durationMs: number;
}

/**
 * The fields a caller supplies when saving one action script version - a plan
 * Claude generated, one Claude refined from a failed run, or one saved from
 * the step editor. The snapshots record exactly what was sent to Claude (an
 * edited or refined version copies its source's). Scripts are create-only, so
 * there is no matching "update" input.
 */
export interface ActionScriptInput {
  /** The website's name at conversion time. */
  websiteName: string;
  /** The website's URL at conversion time. */
  startUrl: string;
  /** The action's title at conversion time. */
  actionTitle: string;
  /** The action's description at conversion time. */
  actionDescription: string;
  /** The credential the action ran as at conversion time, or null for logged out. */
  credentialId: string | null;
  /** That credential's name at conversion time, or null for logged out. */
  credentialName: string | null;
  /** Claude's one-line summary of what the plan does. */
  summary: string;
  /** The assumptions Claude made where the action was ambiguous. */
  assumptions: string[];
  /** The validated step plan. */
  plan: ActionPlan;
  /** The crawled pages whose aria snapshots Claude was shown. */
  contextPageUrls: string[];
  /** The model that actually wrote the plan (for a refined version, the model that refined it), or null for a version saved from the editor. */
  modelId: string | null;
  /** The effort level sent with the request, or null for "Standard" and for edited versions. */
  effort: string | null;
  /** The version this one was edited from, or null for a generated or refined version. */
  editedFromActionScriptId: string | null;
}

/**
 * The facts a caller supplies when recording how a version was refined from a
 * failed run - only what is stored nowhere else (see the
 * `ActionScriptRefinement` model's doc comment). The run's error and failed
 * step stay on the run, and the model and effort on the refined version.
 * Refinements are create-only, so there is no matching "update" input.
 */
export interface ActionScriptRefinementInput {
  /** The version whose failed run was refined. */
  sourceActionScriptId: string;
  /** The failed run Claude was shown. */
  actionScriptRunId: string;
  /** The user's hint for Claude (trimmed), or null when they gave none. */
  note: string | null;
  /** Input tokens of the refine call that were neither read from nor written to the prompt cache. */
  inputTokens: number;
  /** Output tokens of the refine call, thinking included. */
  outputTokens: number;
  /** Input tokens of the refine call read from the prompt cache. */
  cacheReadInputTokens: number;
  /** Input tokens of the refine call written to the prompt cache. */
  cacheCreationInputTokens: number;
  /** True when the failure screenshot went to Claude as an image; false when the run had none or its file was missing. */
  screenshotWasSent: boolean;
}

/**
 * What every action script read (and create) brings along: the refinement
 * that produced the version - null when the version was not refined - with
 * a summary of the failed run it came from. The run's error and failed step
 * are JOINED from the run here, never copied onto the refinement row, so
 * there is one source of truth. A soft-deleted refinement is left out
 * (refinements are only ever soft deleted together with their version, so
 * this only guards against a row deleted by hand).
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
} as const;

/**
 * How a version's newest run is read wherever its run status is shown (the
 * versions list, the website's actions list, and the dashboard): at most ONE
 * run - the newest active one - and only what it takes to say how it went:
 * whether it passed, and, when it failed, at which step or by timing out.
 */
const LATEST_ACTION_SCRIPT_RUN_QUERY = {
  where: { deletedAt: null },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { id: true, succeeded: true, failedStepNumber: true, timedOut: true, createdAt: true },
} as const;

/**
 * What every action script read (and create) includes: the refinement that
 * produced it (`ACTION_SCRIPT_REFINEMENT_INCLUDE`) and its newest active run
 * (`LATEST_ACTION_SCRIPT_RUN_QUERY`, as a list of zero or one run).
 */
const ACTION_SCRIPT_INCLUDE = {
  ...ACTION_SCRIPT_REFINEMENT_INCLUDE,
  runs: LATEST_ACTION_SCRIPT_RUN_QUERY,
} as const;

/** An action script row as Prisma returns it with `ACTION_SCRIPT_INCLUDE`. */
type ActionScriptRow = Prisma.ActionScriptGetPayload<{
  include: typeof ACTION_SCRIPT_INCLUDE;
}>;

/**
 * A version's newest active run, cut down to what its status line needs: the
 * run's id, whether it passed, the step it failed at (null when it passed or
 * stopped before the first step), whether it timed out, and when it ran.
 */
export type LatestActionScriptRun = Pick<
  ActionScriptRun,
  "id" | "succeeded" | "failedStepNumber" | "timedOut" | "createdAt"
>;

/**
 * An action script as dbService returns it: the row with `plan` typed as a
 * plan (Prisma types a `Json` column as any JSON value), plus its
 * `refinement` - the refinement row with its failed run's id, error, failed
 * step, time-out flag, and failing-page snapshot, or null when the version
 * was not refined - and its `latestRun`: its newest active run, or null when
 * it has not been run yet.
 */
export type ActionScriptWithPlan = Omit<ActionScriptRow, "plan" | "runs"> & {
  plan: ActionPlan;
  latestRun: LatestActionScriptRun | null;
};

/**
 * The fields a caller supplies when recording one script run. Runs are
 * create-only, so there is no matching "update" input.
 */
export interface ActionScriptRunInput {
  /** True only when the login (if any) and every step finished in time. */
  succeeded: boolean;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** Why the run stopped (first line, credential values scrubbed), or null when it passed. */
  errorMessage: string | null;
  /** The 1-based step the run stopped at, or null when it passed or stopped before the first step. */
  failedStepNumber: number | null;
  /** The credential the run logged in as, or null for a logged-out run. */
  credentialName: string | null;
  /** The step log, capped. */
  output: string;
  /** True when the cap dropped the start of the output. */
  outputWasTruncated: boolean;
  /** The failure PNG's path relative to the action script directory, or null when none was written. */
  failureScreenshotFileName: string | null;
  /** The address the browser was on when the run failed (credential values scrubbed), or null when it passed or could not be read. */
  failingPageUrl: string | null;
  /** The aria snapshot of the failing page's `<body>` (credential values scrubbed, capped), or null when it passed or none was taken. */
  failingPageAriaSnapshot: string | null;
  /** How long the run took, in milliseconds. */
  durationMs: number;
}

/**
 * Every value `CrawlRun.status` can hold (see the model's doc comment in
 * `../prisma/schema.prisma`).
 */
export type CrawlRunStatus =
  | "running"
  | "finished"
  | "stoppedAtPageLimit"
  | "stoppedAtTimeLimit"
  | "failed"
  | "interrupted";

/**
 * The statuses a crawl can end with. `interrupted` is set when the crawl's
 * browser closed mid-crawl, and at boot for runs a restart left `running`.
 */
export type FinishedCrawlRunStatus = Exclude<CrawlRunStatus, "running">;

/** The fields a caller supplies when starting a crawl run. */
export interface CrawlRunInput {
  /** The website's URL at crawl time - where the crawl starts. */
  startUrl: string;
  /** The most pages the crawl may visit. */
  pageLimit: number;
  /** The credential the crawl logs in as, or null for a crawl as a logged-out visitor. */
  credentialId: string | null;
  /** Which buttons the crawl clicks; the column default (`linksOnly`) applies when omitted. */
  buttonMode?: CrawlButtonMode;
}

/** The credential a crawl run was started with, as the run's API responses name it. */
export interface CrawlRunCredentialSummary {
  /** The credential's cuid. */
  id: string;
  /** The credential's name (kept even after the credential is soft deleted). */
  name: string;
}

/**
 * A crawl run together with the id and name of the credential it was started
 * with (null for a logged-out crawl) - what the crawl run reads return, so the
 * UI can say who the crawl was logged in as.
 */
export type CrawlRunWithCredential = CrawlRun & {
  credential: CrawlRunCredentialSummary | null;
};

/** A crawl's live progress counters, written each time a page is recorded. */
export interface CrawlProgress {
  /** Pages recorded so far, including the one being recorded now. */
  visitedPageCount: number;
  /** Links queued but not yet visited. */
  waitingUrlCount: number;
}

/** How a crawl ended, written once when it finishes. */
export interface CrawlRunFinish {
  /** The status the crawl ended with. */
  status: FinishedCrawlRunStatus;
  /** Links still queued when it ended (0 when every reachable page was visited). */
  waitingUrlCount: number;
  /** Links skipped because the crawl already had enough pages of their URL pattern. */
  skippedSimilarUrlCount: number;
  /** The same skipped links, counted per pattern key. */
  skippedSimilarUrlCountsByPattern: Record<string, number>;
  /** Why the crawl failed, or null when it did not. */
  errorMessage: string | null;
  /**
   * The screenshot taken when the crawl's login failed, relative to the
   * screenshot directory (`<websiteId>/<uuid>.png`), or null when there is none.
   */
  loginFailureScreenshotFileName: string | null;
  /** How long the whole crawl took, in milliseconds. */
  durationMs: number;
}

/**
 * The fields a caller supplies when recording one crawled page. Its
 * `structureSkeleton` is not one of them: it is only built later, when the
 * crawl's slug detection compares the page (see
 * `saveCrawledPageStructureSkeletons`), and starts out null.
 */
export interface CrawledPageInput {
  /** The page whose link led here, or null for the start page. */
  parentPageId: string | null;
  /**
   * The page's identity within the run: origin + path, no query or hash -
   * where the browser LANDED, or the requested page when the landing page is
   * already recorded in this run (see the model's doc comment).
   */
  url: string;
  /** What the browser loaded: the first link that reached the page, hash dropped. */
  requestedUrl: string;
  /** Where the browser ended up after redirects and client-side navigation. */
  finalUrl: string;
  /** True when the browser landed on a different page (origin + path) than it requested. */
  wasRedirected: boolean;
  /** The text of the button whose click first led to this page, or null when a link (or the start URL) did. */
  foundByButtonText: string | null;
  /** The same-site pages (identities) this page's buttons led to, in click order. */
  buttonUrls: string[];
  /** The page's position in visiting order, counting from 0. */
  visitOrder: number;
  /** How many links were followed from the start page to reach it. */
  depth: number;
  /** True only when navigation completed, the page answered below HTTP 400, and its aria snapshot was taken. */
  succeeded: boolean;
  /** The main response's HTTP status, or null when there was no response. */
  httpStatus: number | null;
  /** Why the page failed, or null when it succeeded. */
  errorMessage: string | null;
  /** The page's `<title>`, or null when it could not be read. */
  title: string | null;
  /** Playwright's YAML aria snapshot of `<body>`, or null when it could not be taken. */
  ariaSnapshot: string | null;
  /** Every same-origin link found on the page, normalized. */
  linkedUrls: string[];
  /** How long visiting the page took, in milliseconds. */
  durationMs: number;
}

/**
 * The fields a caller supplies when creating or replacing a credential -
 * everything except the password, which is passed separately and already
 * encrypted (see `../utils/credentialEncryption.ts`).
 */
export interface CredentialInput {
  /** The user's label for the credential. */
  name: string;
  /** An optional longer note; null when there is none. */
  description: string | null;
  /** What the crawler types into the username field. */
  username: string;
  /** The credential's own login page, or null to use its website's `loginUrl`. */
  loginUrl: string | null;
  /** A CSS selector for the username field, or null to let the crawler find it. */
  usernameSelector: string | null;
  /** A CSS selector for the password field, or null to let the crawler find it. */
  passwordSelector: string | null;
  /** A CSS selector for the submit button, or null to let the crawler find it. */
  submitSelector: string | null;
}

/**
 * A credential WITHOUT its encrypted password - the only shape of a
 * credential that may leave the server. Every credential read that feeds an
 * API response returns this; only `findCredentialWithPasswordForWebsite`
 * (used to start a crawl) returns the password column.
 */
export type CredentialSummary = Omit<Credential, "encryptedPassword">;

/**
 * A crawled page without its large fields (the aria snapshot and the link
 * and button lists) - what the crawl run's page list returns, because the UI
 * polls that list while the crawl runs. The full page comes from
 * `findCrawledPageForRun`.
 */
export type CrawledPageSummary = Omit<CrawledPage, "ariaSnapshot" | "linkedUrls" | "buttonUrls">;

/**
 * Checks whether a thrown value carries the given Prisma error code.
 *
 * Checked structurally (an object with a matching `code` property) rather
 * than with `instanceof PrismaClientKnownRequestError`, so callers never need
 * the generated Prisma classes and unit tests can throw plain objects.
 * @param error - Whatever a Prisma call rejected with
 * @param expectedCode - The Prisma error code to look for, e.g. "P2002"
 * @returns True when `error` is an object whose `code` equals `expectedCode`
 */
function hasPrismaErrorCode(error: unknown, expectedCode: string): boolean {
  const errorIsAnObject = typeof error === "object" && error !== null;
  if (!errorIsAnObject) {
    return false;
  }
  const errorHasMatchingCode = "code" in error && error.code === expectedCode;
  return errorHasMatchingCode;
}

/**
 * Checks whether a thrown value is Prisma's unique-constraint violation
 * (P2002). For websites that means another ACTIVE website already has the URL.
 *
 * `meta.target` is not populated through the pg driver adapter, so callers
 * should not try to build a message from it.
 * @param error - Whatever a Prisma call rejected with
 * @returns True when the error is a P2002 unique-constraint violation
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2002");
}

/**
 * Checks whether a thrown value is Prisma's "record to update not found"
 * error (P2025), raised when an `update` matches no row.
 * @param error - Whatever a Prisma call rejected with
 * @returns True when the error is a P2025 record-not-found error
 */
export function isRecordNotFound(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2025");
}

// === Websites ===

/**
 * Inserts a website. The `url` column is unique among ACTIVE websites (a
 * partial unique index), so a URL already used by another active website
 * rejects with a P2002 error - see `isUniqueConstraintViolation`. A URL that
 * only appears on soft-deleted websites is allowed.
 * @param data - URL, display name, optional description, and the optional screenshot timing settings
 * @returns The created row, including its generated cuid and timestamps
 */
export async function createWebsite(data: WebsiteInput): Promise<Website> {
  const created = await prisma.website.create({ data });
  return created;
}

/** The parts of a website's newest crawl run the dashboard shows. */
export type WebsiteLatestCrawlRun = Pick<
  CrawlRun,
  "id" | "status" | "visitedPageCount" | "pageLimit" | "createdAt" | "finishedAt"
>;

/**
 * What the dashboard shows for one website: how many of its active actions
 * pass, fail, or have not been run (judged, like the action list, by each
 * action's newest version's latest run), when any of its scripts last ran,
 * and its newest crawl.
 */
export interface WebsiteSummary {
  /** The website's active actions. */
  actionCount: number;
  /** Actions whose newest version's latest run passed. */
  passedActionCount: number;
  /** Actions whose newest version's latest run failed. */
  failedActionCount: number;
  /** Actions with no versions, or whose newest version has not been run. */
  notRunActionCount: number;
  /** When any active script of the website last ran, or null when none has. */
  latestRunAt: Date | null;
  /** The website's newest active crawl run, or null when it has never been crawled. */
  latestCrawlRun: WebsiteLatestCrawlRun | null;
}

/** A website as the website list returns it: the row plus its dashboard `summary`. */
export type WebsiteWithSummary = Website & { summary: WebsiteSummary };

/**
 * What the website list brings along to build each website's summary: its
 * active actions (each with only its newest active version's latest run),
 * its newest active script run of any version, and its newest active crawl
 * run - every relation read with `take: 1` where only the newest row counts.
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
} as const;

/** A website row as Prisma returns it with `WEBSITE_SUMMARY_INCLUDE`. */
type WebsiteSummaryRow = Prisma.WebsiteGetPayload<{ include: typeof WEBSITE_SUMMARY_INCLUDE }>;

/**
 * Turns a website row with its summary relations into the shape the API
 * answers with: the website's own fields plus `summary`, without the
 * relation lists it was counted from.
 * @param websiteRow - A website row as Prisma returns it with `WEBSITE_SUMMARY_INCLUDE`
 * @returns The website with its `summary`
 */
function toWebsiteWithSummary(websiteRow: WebsiteSummaryRow): WebsiteWithSummary {
  const { actions, actionScriptRuns, crawlRuns, ...website } = websiteRow;
  let passedActionCount = 0;
  let failedActionCount = 0;
  let notRunActionCount = 0;
  for (const action of actions) {
    const newestVersionLatestRun = action.scripts.at(0)?.runs.at(0) ?? null;
    if (newestVersionLatestRun === null) {
      notRunActionCount += 1;
    } else if (newestVersionLatestRun.succeeded) {
      passedActionCount += 1;
    } else {
      failedActionCount += 1;
    }
  }
  return {
    ...website,
    summary: {
      actionCount: actions.length,
      passedActionCount,
      failedActionCount,
      notRunActionCount,
      latestRunAt: actionScriptRuns.at(0)?.createdAt ?? null,
      latestCrawlRun: crawlRuns.at(0) ?? null,
    },
  };
}

/**
 * Lists every active website, newest first, each with the summary the
 * dashboard shows (see `WebsiteSummary`), read in one query.
 * @returns All active websites ordered by `createdAt` descending, each with its `summary`
 */
export async function listWebsitesWithSummaries(): Promise<WebsiteWithSummary[]> {
  const websiteRows = await prisma.website.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: WEBSITE_SUMMARY_INCLUDE,
  });
  return websiteRows.map(toWebsiteWithSummary);
}

/**
 * Looks up the active website with the given URL.
 *
 * Uses `findFirst`, not `findUnique`: the URL is only unique among active
 * rows, so several soft-deleted rows can share it.
 * @param url - The exact URL to match
 * @returns The active row, or null when no active website has that URL
 */
export async function findWebsiteByUrl(url: string): Promise<Website | null> {
  const website = await prisma.website.findFirst({ where: { url, deletedAt: null } });
  return website;
}

/**
 * Looks up an active website by its id.
 * @param websiteId - The website's cuid
 * @returns The active row, or null when it does not exist or was soft deleted
 */
export async function findWebsiteById(websiteId: string): Promise<Website | null> {
  const website = await prisma.website.findFirst({ where: { id: websiteId, deletedAt: null } });
  return website;
}

/**
 * Saves a login page URL the website LEARNED from a crawl that logged in
 * successfully with a credential's own login URL - but only while the website
 * has none: the `loginUrl: null` condition is part of the update, so a URL
 * already set (by the user, or by an earlier crawl) is never overwritten.
 * @param websiteId - The website's cuid
 * @param loginUrl - The login page URL that worked
 * @returns True when the website adopted the URL; false when it already had one, or is not active
 */
export async function adoptWebsiteLoginUrl(websiteId: string, loginUrl: string): Promise<boolean> {
  const websiteUpdate = await prisma.website.updateMany({
    where: { id: websiteId, loginUrl: null, deletedAt: null },
    data: { loginUrl },
  });
  const websiteAdoptedTheUrl = websiteUpdate.count > 0;
  return websiteAdoptedTheUrl;
}

/**
 * Replaces the editable fields of an active website.
 *
 * The `deletedAt: null` condition is part of the update itself, so a website
 * deleted a moment earlier cannot be edited back to life by a racing request.
 * @param websiteId - The website's cuid
 * @param data - The new URL, name, description, and screenshot timing settings
 * @returns The updated row, or null when no active website has that id
 * @throws The P2002 error (see `isUniqueConstraintViolation`) when another active website already has the new URL
 */
export async function updateWebsite(
  websiteId: string,
  data: WebsiteInput,
): Promise<Website | null> {
  try {
    const updated = await prisma.website.update({
      where: { id: websiteId, deletedAt: null },
      data,
    });
    return updated;
  } catch (error: unknown) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Soft deletes an active website AND its active use cases, actions, screenshot
 * runs, action scripts, action script runs, action script refinements, crawl
 * runs, crawled pages, credentials, web objects, and page patterns.
 *
 * All twelve updates run in one transaction and share one `deletedAt`
 * timestamp, so the batch can be identified (and restored) together later.
 * @param websiteId - The website's cuid
 * @returns True when the website was active and is now deleted; false when no active website had that id
 */
export async function softDeleteWebsite(websiteId: string): Promise<boolean> {
  const deletedAt = new Date();

  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns True when the website was active and is now deleted; false when no active website matched
   */
  const softDeleteWebsiteAndItsChildren = async (
    transaction: Prisma.TransactionClient,
  ): Promise<boolean> => {
    const websiteUpdate = await transaction.website.updateMany({
      where: { id: websiteId, deletedAt: null },
      data: { deletedAt },
    });
    const noActiveWebsiteMatched = websiteUpdate.count === 0;
    if (noActiveWebsiteMatched) {
      return false;
    }

    await transaction.useCase.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.action.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.screenshotRun.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.actionScript.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.actionScriptRun.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.actionScriptRefinement.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.crawlRun.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.crawledPage.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.credential.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.pagePattern.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.webObject.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt },
    });
    return true;
  };

  const websiteWasDeleted = await prisma.$transaction(softDeleteWebsiteAndItsChildren);
  return websiteWasDeleted;
}

// === Use cases ===

/**
 * Lists a website's active use cases, newest first.
 * @param websiteId - The owning website's cuid
 * @returns The website's active use cases ordered by `createdAt` descending
 */
export async function listUseCasesForWebsite(websiteId: string): Promise<UseCase[]> {
  const useCases = await prisma.useCase.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return useCases;
}

/**
 * Looks up one active use case, scoped to the website that owns it.
 * @param websiteId - The owning website's cuid
 * @param useCaseId - The use case's cuid
 * @returns The active use case, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findUseCaseForWebsite(
  websiteId: string,
  useCaseId: string,
): Promise<UseCase | null> {
  const useCase = await prisma.useCase.findFirst({
    where: { id: useCaseId, websiteId, deletedAt: null },
  });
  return useCase;
}

/**
 * Inserts a use case belonging to the given website.
 * @param websiteId - The owning website's cuid
 * @param data - The use case's title and description
 * @returns The created row
 */
export async function createUseCaseForWebsite(
  websiteId: string,
  data: UseCaseInput,
): Promise<UseCase> {
  const created = await prisma.useCase.create({ data: { ...data, websiteId } });
  return created;
}

/**
 * Replaces the title and description of an active use case.
 * @param websiteId - The owning website's cuid
 * @param useCaseId - The use case's cuid
 * @param data - The new title and description
 * @returns The updated row, or null when no active use case with that id belongs to the website
 */
export async function updateUseCaseForWebsite(
  websiteId: string,
  useCaseId: string,
  data: UseCaseInput,
): Promise<UseCase | null> {
  try {
    const updated = await prisma.useCase.update({
      where: { id: useCaseId, websiteId, deletedAt: null },
      data,
    });
    return updated;
  } catch (error: unknown) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Soft deletes one active use case.
 * @param websiteId - The owning website's cuid
 * @param useCaseId - The use case's cuid
 * @returns True when an active use case was deleted; false when none matched
 */
export async function softDeleteUseCaseForWebsite(
  websiteId: string,
  useCaseId: string,
): Promise<boolean> {
  const useCaseUpdate = await prisma.useCase.updateMany({
    where: { id: useCaseId, websiteId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  const anActiveUseCaseWasDeleted = useCaseUpdate.count > 0;
  return anActiveUseCaseWasDeleted;
}

// === Actions ===

/**
 * The relation every action read brings along: the id and name of the
 * credential it runs as. A deleted credential is unlinked from its actions
 * (see `softDeleteCredentialForWebsite`), so it never shows up here.
 */
const ACTION_CREDENTIAL_INCLUDE = { credential: { select: { id: true, name: true } } } as const;

/**
 * What the website's action list brings along on top of the credential: the
 * action's newest active version (as a list of zero or one), with only its
 * id, the action text it was generated from, and its newest active run
 * (`LATEST_ACTION_SCRIPT_RUN_QUERY`), plus the count of the action's active
 * versions, which is the newest version's number.
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
} as const;

/** An action row as Prisma returns it with `ACTION_LIST_INCLUDE`. */
type ActionListRow = Prisma.ActionGetPayload<{ include: typeof ACTION_LIST_INCLUDE }>;

/**
 * Turns an action list row into the shape the API answers with: the
 * zero-or-one `scripts` list becomes `newestScript` (null when the action has
 * no versions) - numbered by the count of active versions - and that
 * version's zero-or-one `runs` list becomes its `latestRun` (null when it has
 * not been run).
 * @param actionRow - An action row as Prisma returns it with `ACTION_LIST_INCLUDE`
 * @returns The action with its credential and its `newestScript`, without `scripts` or `_count`
 */
function toActionWithNewestScript(actionRow: ActionListRow): ActionWithNewestScript {
  const { scripts: newestScriptList, _count: versionCounts, ...action } = actionRow;
  const newestScriptRow = newestScriptList.at(0);
  const actionHasNoScripts = newestScriptRow === undefined;
  if (actionHasNoScripts) {
    return { ...action, newestScript: null };
  }
  const { runs: latestRunList, ...newestScriptFields } = newestScriptRow;
  return {
    ...action,
    newestScript: {
      ...newestScriptFields,
      versionNumber: versionCounts.scripts,
      latestRun: latestRunList.at(0) ?? null,
    },
  };
}

/**
 * Lists a website's active actions, newest first, each with its newest
 * version's number, the action text it was generated from, and its latest
 * run, so the list can show whether the action's script currently passes and
 * whether it is out of date.
 * @param websiteId - The owning website's cuid
 * @returns The website's active actions ordered by `createdAt` descending, each with its credential's id and name and its `newestScript` (null when it has no versions)
 */
export async function listActionsForWebsite(websiteId: string): Promise<ActionWithNewestScript[]> {
  const actionRows = await prisma.action.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: ACTION_LIST_INCLUDE,
  });
  return actionRows.map(toActionWithNewestScript);
}

/**
 * Looks up one active action, scoped to the website that owns it.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns The active action with its credential's id and name, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findActionForWebsite(
  websiteId: string,
  actionId: string,
): Promise<ActionWithCredential | null> {
  const action = await prisma.action.findFirst({
    where: { id: actionId, websiteId, deletedAt: null },
    include: ACTION_CREDENTIAL_INCLUDE,
  });
  return action;
}

/**
 * Inserts an action belonging to the given website. The caller has already
 * checked that `credentialId` (when set) is an active credential of the same
 * website.
 * @param websiteId - The owning website's cuid
 * @param data - The action's title, description, and credential
 * @returns The created row with its credential's id and name
 */
export async function createActionForWebsite(
  websiteId: string,
  data: ActionInput,
): Promise<ActionWithCredential> {
  const created = await prisma.action.create({
    data: { ...data, websiteId },
    include: ACTION_CREDENTIAL_INCLUDE,
  });
  return created;
}

/**
 * Replaces the title, description, and credential of an active action. The
 * caller has already checked that `credentialId` (when set) is an active
 * credential of the same website.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @param data - The new title, description, and credential (null unlinks it)
 * @returns The updated row with its credential's id and name, or null when no active action with that id belongs to the website
 */
export async function updateActionForWebsite(
  websiteId: string,
  actionId: string,
  data: ActionInput,
): Promise<ActionWithCredential | null> {
  try {
    const updated = await prisma.action.update({
      where: { id: actionId, websiteId, deletedAt: null },
      data,
      include: ACTION_CREDENTIAL_INCLUDE,
    });
    return updated;
  } catch (error: unknown) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Soft deletes one active action AND its active scripts, script runs, and
 * script refinements.
 *
 * All four updates run in one transaction and share one `deletedAt`
 * timestamp, like `softDeleteWebsite`. When no active action matched, the
 * scripts, runs, and refinements are left untouched.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns True when an active action was deleted; false when none matched
 */
export async function softDeleteActionForWebsite(
  websiteId: string,
  actionId: string,
): Promise<boolean> {
  const deletedAt = new Date();

  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns True when the action was active and is now deleted; false when no active action matched
   */
  const softDeleteActionAndItsScripts = async (
    transaction: Prisma.TransactionClient,
  ): Promise<boolean> => {
    const actionUpdate = await transaction.action.updateMany({
      where: { id: actionId, websiteId, deletedAt: null },
      data: { deletedAt },
    });
    const noActiveActionMatched = actionUpdate.count === 0;
    if (noActiveActionMatched) {
      return false;
    }

    await transaction.actionScript.updateMany({
      where: { actionId, websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.actionScriptRun.updateMany({
      where: { actionId, websiteId, deletedAt: null },
      data: { deletedAt },
    });
    await transaction.actionScriptRefinement.updateMany({
      where: { actionId, websiteId, deletedAt: null },
      data: { deletedAt },
    });
    return true;
  };

  const anActiveActionWasDeleted = await prisma.$transaction(softDeleteActionAndItsScripts);
  return anActiveActionWasDeleted;
}

// === Screenshot runs ===

/**
 * Lists a website's active screenshot runs, newest first.
 * @param websiteId - The owning website's cuid
 * @returns The website's active screenshot runs ordered by `createdAt` descending
 */
export async function listScreenshotRunsForWebsite(websiteId: string): Promise<ScreenshotRun[]> {
  const screenshotRuns = await prisma.screenshotRun.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return screenshotRuns;
}

/**
 * Looks up one active screenshot run, scoped to the website that owns it.
 * @param websiteId - The owning website's cuid
 * @param screenshotRunId - The screenshot run's cuid
 * @returns The active screenshot run, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findScreenshotRunForWebsite(
  websiteId: string,
  screenshotRunId: string,
): Promise<ScreenshotRun | null> {
  const screenshotRun = await prisma.screenshotRun.findFirst({
    where: { id: screenshotRunId, websiteId, deletedAt: null },
  });
  return screenshotRun;
}

/**
 * Records one screenshot run belonging to the given website. Runs are never
 * edited after this; a failed visit is recorded the same way as a successful
 * one, with `succeeded: false`.
 * @param websiteId - The owning website's cuid
 * @param data - What the visit produced, plus the URL and screenshot file name
 * @returns The created row
 */
export async function createScreenshotRunForWebsite(
  websiteId: string,
  data: ScreenshotRunInput,
): Promise<ScreenshotRun> {
  const created = await prisma.screenshotRun.create({ data: { ...data, websiteId } });
  return created;
}

// === Action scripts ===
// Create-only: there is deliberately no update function for scripts, their
// runs, or their refinements, which is what makes them immutable. They are
// soft deleted only through `softDeleteActionForWebsite` and
// `softDeleteWebsite`.

/**
 * Types a script row's `plan` as a plan, and turns its zero-or-one `runs`
 * list into `latestRun` (null when the version has not been run), so the API
 * answers with `latestRun` and never with `runs`. Parsing the plan also puts
 * its fields back in their written order, which Postgres `jsonb` does not
 * keep.
 *
 * Every plan is validated before it is saved, so the parse only fails for a
 * row edited by hand; that raw value is passed through as-is, and the run
 * route validates a plan again before running it.
 * @param actionScriptRow - A script row as Prisma returns it with `ACTION_SCRIPT_INCLUDE` (its refinement and newest run)
 * @returns The same row with `plan` typed (and its fields in order) and `latestRun` in place of `runs`
 */
function toActionScriptWithPlan(actionScriptRow: ActionScriptRow): ActionScriptWithPlan {
  const { runs: newestRunList, ...actionScript } = actionScriptRow;
  const planParse = parseActionPlan(actionScript.plan);
  const plan = planParse.isValid ? planParse.input : (actionScript.plan as ActionPlan);
  const latestRun = newestRunList.at(0) ?? null;
  return { ...actionScript, plan, latestRun };
}

/**
 * Lists an action's active scripts, newest first, each with the refinement
 * that produced it (null when it was not refined) and its newest run (null
 * when it has not been run).
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @returns The action's active scripts ordered by `createdAt` descending
 */
export async function listActionScriptsForAction(
  websiteId: string,
  actionId: string,
): Promise<ActionScriptWithPlan[]> {
  const actionScripts = await prisma.actionScript.findMany({
    where: { websiteId, actionId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: ACTION_SCRIPT_INCLUDE,
  });
  return actionScripts.map(toActionScriptWithPlan);
}

/**
 * Looks up one active script, scoped to the website and action that own it,
 * with the refinement that produced it (null when it was not refined) and its
 * newest run (null when it has not been run).
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @returns The active script, or null when it does not exist, was soft deleted, or belongs to another action
 */
export async function findActionScriptForAction(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ActionScriptWithPlan | null> {
  const actionScript = await prisma.actionScript.findFirst({
    where: { id: actionScriptId, websiteId, actionId, deletedAt: null },
    include: ACTION_SCRIPT_INCLUDE,
  });
  return actionScript === null ? null : toActionScriptWithPlan(actionScript);
}

/**
 * Saves one script version for an action - generated by Claude or saved from
 * the step editor. The row is never edited after this; converting or editing
 * again saves another row. (A version refined from a failed run is saved by
 * `createRefinedActionScriptForAction` instead.)
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param data - The snapshots, the validated plan, and where it came from
 * @returns The created row, with `refinement` and `latestRun` null (like every read, it carries both fields)
 */
export async function createActionScriptForAction(
  websiteId: string,
  actionId: string,
  data: ActionScriptInput,
): Promise<ActionScriptWithPlan> {
  const created = await prisma.actionScript.create({
    data: { ...data, websiteId, actionId },
    include: ACTION_SCRIPT_INCLUDE,
  });
  return toActionScriptWithPlan(created);
}

/**
 * Saves a version Claude refined from a failed run, together with the
 * refinement row linking it to its source version and that run.
 *
 * It is ONE nested `create`, so both rows are written atomically: a refinement
 * row never exists without its version, or the other way round. Neither row
 * is edited after this.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param script - The new version: its source's snapshots, Claude's summary, assumptions, and plan, the pages sent, and the model and effort that refined it
 * @param refinement - The source version, the failed run, the note, the call's token usage, and whether the screenshot was sent
 * @returns The created version, with its `refinement` (and that refinement's failed-run summary) and `latestRun` null
 */
export async function createRefinedActionScriptForAction(
  websiteId: string,
  actionId: string,
  script: ActionScriptInput,
  refinement: ActionScriptRefinementInput,
): Promise<ActionScriptWithPlan> {
  const created = await prisma.actionScript.create({
    data: {
      ...script,
      websiteId,
      actionId,
      refinement: { create: { ...refinement, websiteId, actionId } },
    },
    include: ACTION_SCRIPT_INCLUDE,
  });
  return toActionScriptWithPlan(created);
}

// === Action script runs ===

/**
 * Lists a script's active runs, newest first.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @returns The script's active runs ordered by `createdAt` descending
 */
export async function listActionScriptRunsForScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ActionScriptRun[]> {
  const actionScriptRuns = await prisma.actionScriptRun.findMany({
    where: { websiteId, actionId, actionScriptId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return actionScriptRuns;
}

/**
 * Looks up one active script run, scoped to the website, action, and script
 * that own it.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @param actionScriptRunId - The run's cuid
 * @returns The active run, or null when it does not exist, was soft deleted, or belongs to another script
 */
export async function findActionScriptRunForScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): Promise<ActionScriptRun | null> {
  const actionScriptRun = await prisma.actionScriptRun.findFirst({
    where: { id: actionScriptRunId, websiteId, actionId, actionScriptId, deletedAt: null },
  });
  return actionScriptRun;
}

/**
 * Records one script run. Runs are never edited after this; a failed or
 * timed-out run is recorded the same way as a passing one, with
 * `succeeded: false`.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script that was run
 * @param data - What the run produced
 * @returns The created row
 */
export async function createActionScriptRunForScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  data: ActionScriptRunInput,
): Promise<ActionScriptRun> {
  const created = await prisma.actionScriptRun.create({
    data: { ...data, websiteId, actionId, actionScriptId },
  });
  return created;
}

// === Crawl runs ===
// A run is created `running`, gains pages while the crawl works in the
// background, and is finished once. Pages are create-only. Both are soft
// deleted only through `softDeleteWebsite`.

/**
 * What the crawl run reads include alongside each run: the id and name of the
 * credential it was started with. Deliberately NOT filtered by `deletedAt`, so
 * a run keeps naming a credential that was deleted after it ran.
 */
const CRAWL_RUN_CREDENTIAL_INCLUDE = {
  credential: { select: { id: true, name: true } },
} as const;

/**
 * Lists a website's active crawl runs, newest first, each with the id and name
 * of the credential it was started with.
 * @param websiteId - The owning website's cuid
 * @returns The website's active crawl runs ordered by `createdAt` descending
 */
export async function listCrawlRunsForWebsite(
  websiteId: string,
): Promise<CrawlRunWithCredential[]> {
  const crawlRuns = await prisma.crawlRun.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: CRAWL_RUN_CREDENTIAL_INCLUDE,
  });
  return crawlRuns;
}

/**
 * Looks up one active crawl run, scoped to the website that owns it, with the
 * id and name of the credential it was started with.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns The active crawl run, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findCrawlRunForWebsite(
  websiteId: string,
  crawlRunId: string,
): Promise<CrawlRunWithCredential | null> {
  const crawlRun = await prisma.crawlRun.findFirst({
    where: { id: crawlRunId, websiteId, deletedAt: null },
    include: CRAWL_RUN_CREDENTIAL_INCLUDE,
  });
  return crawlRun;
}

/**
 * Records the start of a crawl: a new run with `status: "running"`, both
 * progress counters at 0, and `isLoggedIn: false` (a crawl with a credential
 * turns it true through `markCrawlRunLoggedIn` once its login succeeds).
 * @param websiteId - The owning website's cuid
 * @param data - Where the crawl starts, its page limit, and the credential it logs in as (or null)
 * @returns The created row, with the id and name of its credential (like the other crawl run reads)
 */
export async function createCrawlRunForWebsite(
  websiteId: string,
  data: CrawlRunInput,
): Promise<CrawlRunWithCredential> {
  const created = await prisma.crawlRun.create({
    data: { ...data, websiteId, status: "running" },
    include: CRAWL_RUN_CREDENTIAL_INCLUDE,
  });
  return created;
}

/**
 * Records one visited page and the run's new progress counters - but only
 * while the run is still active and running.
 *
 * Both writes run in one transaction, and the run's counter update comes
 * first with `status: "running", deletedAt: null` in its condition. When it
 * matches no row (the run's website was deleted, so the run was soft deleted
 * with it), nothing is written and null tells the crawler to stop. The row
 * lock that update takes also serialises it with `softDeleteWebsite`, so a
 * page can never be written as active after its run was deleted.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param progress - The run's counters after this page
 * @param data - What visiting the page produced
 * @returns The created page, or null when the run is no longer active
 */
export async function recordCrawledPage(
  websiteId: string,
  crawlRunId: string,
  progress: CrawlProgress,
  data: CrawledPageInput,
): Promise<CrawledPage | null> {
  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns The created page, or null when the run is no longer active
   */
  const recordPageWhileRunIsActive = async (
    transaction: Prisma.TransactionClient,
  ): Promise<CrawledPage | null> => {
    const crawlRunUpdate = await transaction.crawlRun.updateMany({
      where: { id: crawlRunId, websiteId, status: "running", deletedAt: null },
      data: {
        visitedPageCount: progress.visitedPageCount,
        waitingUrlCount: progress.waitingUrlCount,
      },
    });
    const runIsNoLongerActive = crawlRunUpdate.count === 0;
    if (runIsNoLongerActive) {
      return null;
    }
    const created = await transaction.crawledPage.create({
      data: { ...data, crawlRunId, websiteId },
    });
    return created;
  };

  const recordedPage = await prisma.$transaction(recordPageWhileRunIsActive);
  return recordedPage;
}

/**
 * Saves the structure skeletons a crawl's slug detection built for pages it
 * already recorded (see `recordVisitedPatternPage`) - a page only gets one
 * once its URL has enough siblings to be compared by structure.
 *
 * All the writes run in one transaction. Its first write locks the crawl
 * run's row with `status: "running", deletedAt: null` in its condition (like
 * `recordCrawledPage`), which serialises it with `softDeleteWebsite`: when
 * the run is gone, nothing is written and false tells the crawler to stop.
 * Each page is only updated while it is an active page of this run.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param structureSkeletons - Each page's id and its new skeleton
 * @returns True when the skeletons were saved; false when the run is no longer active
 */
export async function saveCrawledPageStructureSkeletons(
  websiteId: string,
  crawlRunId: string,
  structureSkeletons: NewStructureSkeleton[],
): Promise<boolean> {
  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns True when the skeletons were saved; false when the run is no longer active
   */
  const saveWhileRunIsActive = async (transaction: Prisma.TransactionClient): Promise<boolean> => {
    const crawlRunLock = await transaction.crawlRun.updateMany({
      where: { id: crawlRunId, websiteId, status: "running", deletedAt: null },
      data: { updatedAt: new Date() },
    });
    const runIsNoLongerActive = crawlRunLock.count === 0;
    if (runIsNoLongerActive) {
      return false;
    }
    for (const { crawledPageId, structureSkeleton } of structureSkeletons) {
      await transaction.crawledPage.updateMany({
        where: { id: crawledPageId, crawlRunId, websiteId, deletedAt: null },
        data: { structureSkeleton },
      });
    }
    return true;
  };

  const skeletonsWereSaved = await prisma.$transaction(saveWhileRunIsActive);
  return skeletonsWereSaved;
}

/**
 * Records that a crawl's login succeeded: sets `isLoggedIn: true`. The crawler
 * calls this BEFORE it records the first page, so every page of a logged-in
 * run was viewed logged in. Only an active run that is still `running` is
 * changed - like `recordCrawledPage`, a false result tells the crawler its run
 * was deleted (with its website) and it should stop.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns True when the run was marked; false when no active running run matched
 */
export async function markCrawlRunLoggedIn(
  websiteId: string,
  crawlRunId: string,
): Promise<boolean> {
  const crawlRunUpdate = await prisma.crawlRun.updateMany({
    where: { id: crawlRunId, websiteId, status: "running", deletedAt: null },
    data: { isLoggedIn: true },
  });
  const runWasMarked = crawlRunUpdate.count > 0;
  return runWasMarked;
}

/**
 * Records how a running crawl ended. Only an active run that is still
 * `running` is changed, so finishing a run whose website was deleted
 * meanwhile is a harmless no-op.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param finish - The final status, waiting links, error, login failure screenshot, and duration
 * @returns True when the run was finished; false when no active running run matched
 */
export async function finishCrawlRun(
  websiteId: string,
  crawlRunId: string,
  finish: CrawlRunFinish,
): Promise<boolean> {
  const crawlRunUpdate = await prisma.crawlRun.updateMany({
    where: { id: crawlRunId, websiteId, status: "running", deletedAt: null },
    data: { ...finish, finishedAt: new Date() },
  });
  const runWasFinished = crawlRunUpdate.count > 0;
  return runWasFinished;
}

/**
 * Marks every active run still `running` as `interrupted`. Called once at
 * boot, before the server accepts requests: a crawl only runs inside the
 * server process, so any run still `running` then was cut off by a restart.
 * @returns How many runs were marked interrupted
 */
export async function markRunningCrawlRunsInterrupted(): Promise<number> {
  const crawlRunUpdate = await prisma.crawlRun.updateMany({
    where: { status: "running", deletedAt: null },
    data: { status: "interrupted", finishedAt: new Date() },
  });
  return crawlRunUpdate.count;
}

/**
 * Lists a crawl run's active pages in visiting order, without their aria
 * snapshots and link and button lists (see `CrawledPageSummary`).
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns The run's page summaries ordered by `visitOrder`
 */
export async function listCrawledPageSummariesForRun(
  websiteId: string,
  crawlRunId: string,
): Promise<CrawledPageSummary[]> {
  const pageSummaries = await prisma.crawledPage.findMany({
    where: { websiteId, crawlRunId, deletedAt: null },
    orderBy: { visitOrder: "asc" },
    omit: { ariaSnapshot: true, linkedUrls: true, buttonUrls: true },
  });
  return pageSummaries;
}

/**
 * Looks up one active crawled page in full, scoped to the website and run
 * that own it.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param crawledPageId - The page's cuid
 * @returns The active page, or null when it does not exist, was soft deleted, or belongs to another run
 */
export async function findCrawledPageForRun(
  websiteId: string,
  crawlRunId: string,
  crawledPageId: string,
): Promise<CrawledPage | null> {
  const crawledPage = await prisma.crawledPage.findFirst({
    where: { id: crawledPageId, websiteId, crawlRunId, deletedAt: null },
  });
  return crawledPage;
}

/** One crawled page as the plan generator needs it: where it is and what a screen reader sees. */
export interface CrawledPageSnapshot {
  /** The page's identity (origin + path) within its crawl run. */
  url: string;
  /** The page's `<title>`, or null when it had none. */
  title: string | null;
  /** Links followed from the start page; 0 is the start page itself. */
  depth: number;
  /** Playwright's YAML aria snapshot of `<body>`. */
  ariaSnapshot: string;
}

/**
 * Finds the newest finished crawl run of a website that recorded pages and
 * matches the filter. A run still `running` is never picked.
 * @param websiteId - The owning website's cuid
 * @param credentialFilter - Extra conditions on the run (which credential it was logged in as)
 * @returns The run's id, or null when no run matches
 */
async function findNewestCrawlRunWithPages(
  websiteId: string,
  credentialFilter: Prisma.CrawlRunWhereInput,
): Promise<string | null> {
  const crawlRun = await prisma.crawlRun.findFirst({
    where: {
      websiteId,
      deletedAt: null,
      status: { not: "running" },
      visitedPageCount: { gt: 0 },
      ...credentialFilter,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return crawlRun?.id ?? null;
}

/**
 * Collects the pages of a website's most relevant crawl, for showing Claude
 * what the site looks like. It picks ONE run - the newest one crawled the
 * same way the action runs (logged in as its credential, or logged out) -
 * falling back to the newest run of any kind, and returns that run's
 * successful pages that have an aria snapshot.
 *
 * One run is picked first, and only then its pages read, so only one run's
 * snapshots are ever loaded.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The action's credential, or null when it runs logged out
 * @returns The pages in visiting order; empty when the website was never crawled
 */
export async function findLatestCrawledPagesForWebsite(
  websiteId: string,
  credentialId: string | null,
): Promise<CrawledPageSnapshot[]> {
  const actionRunsLoggedIn = credentialId !== null;
  const sameWayFilter: Prisma.CrawlRunWhereInput = actionRunsLoggedIn
    ? { credentialId, isLoggedIn: true }
    : { credentialId: null };
  const crawlRunId =
    (await findNewestCrawlRunWithPages(websiteId, sameWayFilter)) ??
    (await findNewestCrawlRunWithPages(websiteId, {}));
  const websiteWasNeverCrawled = crawlRunId === null;
  if (websiteWasNeverCrawled) {
    return [];
  }

  const pages = await prisma.crawledPage.findMany({
    where: {
      websiteId,
      crawlRunId,
      deletedAt: null,
      succeeded: true,
      ariaSnapshot: { not: null },
    },
    orderBy: { visitOrder: "asc" },
    select: { url: true, title: true, depth: true, ariaSnapshot: true },
  });
  // The query only returns pages with a snapshot; the filter narrows the type.
  return pages.filter(
    (page: Omit<CrawledPageSnapshot, "ariaSnapshot"> & { ariaSnapshot: string | null }) =>
      page.ariaSnapshot !== null,
  ) as CrawledPageSnapshot[];
}

// === Web objects ===
// What a website's latest crawl (with pages) found: the kinds of things the
// site has many of, with their URL patterns. Written only when a crawl ends,
// by REPLACING the website's previous ones; only the name can be changed
// afterwards. Soft deleted with the website too.

/** One URL pattern of a web object, as a crawl's end saves it. */
export interface PagePatternInput {
  /** The pattern as a path: `/websites/{website}/actions/{action}/edit`. */
  key: string;
  /** The pattern's path, one entry per segment. */
  segments: PathSegment[];
  /** How the pattern relates to its web object. */
  role: PagePatternRole;
  /** For a `view`, the part after the object's variable; otherwise null. */
  viewName: string | null;
  /** How the pattern's variable was recognised. */
  detectedBy: PatternDetectionMethod;
  /** How many of the crawl's pages it matched. */
  pageCount: number;
}

/** One web object as a crawl's end saves it. */
export interface WebObjectInput {
  /** The pattern of one instance's page; the object's key within the website. */
  instancePatternKey: string;
  /** What detection named it. */
  detectedName: string;
  /** The parent object's key (it comes earlier in the same list), or null. */
  parentInstancePatternKey: string | null;
  /** How many distinct instances the crawl saw. */
  instanceCount: number;
  /** Links to its pages the crawl skipped. */
  skippedLinkCount: number;
  /** Its patterns, in the order to list them. */
  pagePatterns: PagePatternInput[];
}

/** The crawl a web object was found by, as the web object reads name it. */
export interface WebObjectCrawlRunSummary {
  /** The crawl run's cuid. */
  id: string;
  /** When the crawl started. */
  createdAt: Date;
}

/** A web object with its active page patterns and the crawl that found it - what the web object reads return. */
export type WebObjectWithPatterns = WebObject & {
  pagePatterns: PagePattern[];
  crawlRun: WebObjectCrawlRunSummary;
};

/** The saved name of a web object, as a crawl run's grouping joins it in. */
export type WebObjectName = Pick<WebObject, "id" | "instancePatternKey" | "detectedName" | "name">;

/** What the web object reads include: the active patterns in order, and the crawl's id and start. */
const WEB_OBJECT_INCLUDE = {
  pagePatterns: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  crawlRun: { select: { id: true, createdAt: true } },
} as const;

/**
 * Replaces a website's web objects with the ones a crawl just found - every
 * active web object and page pattern of the website is soft deleted, then the
 * new ones are created, each object followed by its patterns - so renames do
 * not carry over: a name lasts until the next crawl.
 *
 * Everything runs in one transaction: if any write fails, the previous
 * objects stay. Its first write locks the crawl run's row, with the run's
 * `deletedAt: null` in its condition (like `recordCrawledPage`), which
 * serialises it with `softDeleteWebsite`: when the run (with its website) is
 * gone, nothing is written. Objects are created in the order given, so a
 * parent (listed before its children) already has an id when its children
 * name it; `sortOrder` keeps that order.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run that found the objects
 * @param webObjects - The objects, each parent before its children
 * @returns True when the objects were replaced; false when the crawl run (or its website) is no longer active
 */
export async function replaceWebsiteWebObjects(
  websiteId: string,
  crawlRunId: string,
  webObjects: WebObjectInput[],
): Promise<boolean> {
  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns True when the objects were replaced; false when the run is no longer active
   */
  const replaceInsideTransaction = async (
    transaction: Prisma.TransactionClient,
  ): Promise<boolean> => {
    const replacedAt = new Date();
    const crawlRunLock = await transaction.crawlRun.updateMany({
      where: { id: crawlRunId, websiteId, deletedAt: null },
      data: { updatedAt: replacedAt },
    });
    const runIsNoLongerActive = crawlRunLock.count === 0;
    if (runIsNoLongerActive) {
      return false;
    }

    await transaction.pagePattern.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt: replacedAt },
    });
    await transaction.webObject.updateMany({
      where: { websiteId, deletedAt: null },
      data: { deletedAt: replacedAt },
    });

    const webObjectIdsByKey = new Map<string, string>();
    for (const [webObjectIndex, webObject] of webObjects.entries()) {
      const { parentInstancePatternKey } = webObject;
      const parentWebObjectId =
        parentInstancePatternKey === null
          ? null
          : (webObjectIdsByKey.get(parentInstancePatternKey) ?? null);
      const created = await transaction.webObject.create({
        data: {
          websiteId,
          crawlRunId,
          parentWebObjectId,
          instancePatternKey: webObject.instancePatternKey,
          detectedName: webObject.detectedName,
          instanceCount: webObject.instanceCount,
          skippedLinkCount: webObject.skippedLinkCount,
          sortOrder: webObjectIndex,
        },
        select: { id: true },
      });
      webObjectIdsByKey.set(webObject.instancePatternKey, created.id);

      const webObjectHasPatterns = webObject.pagePatterns.length > 0;
      if (webObjectHasPatterns) {
        await transaction.pagePattern.createMany({
          data: webObject.pagePatterns.map((pagePattern, patternIndex) => ({
            ...pagePattern,
            websiteId,
            crawlRunId,
            webObjectId: created.id,
            sortOrder: patternIndex,
          })),
        });
      }
    }
    return true;
  };

  const webObjectsWereReplaced = await prisma.$transaction(replaceInsideTransaction);
  return webObjectsWereReplaced;
}

/**
 * Lists a website's active web objects - the ones its latest crawl with pages
 * found - in detection order (each parent before its children), each with
 * its active page patterns in order and the id and start of the crawl that
 * found it.
 * @param websiteId - The owning website's cuid
 * @returns The website's active web objects; empty when no crawl found any
 */
export async function listWebObjectsForWebsite(
  websiteId: string,
): Promise<WebObjectWithPatterns[]> {
  const webObjects = await prisma.webObject.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: WEB_OBJECT_INCLUDE,
  });
  return webObjects;
}

/**
 * Reads the names of the active web objects one crawl run found - none once
 * a newer crawl replaced them.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns Each object's id, key, and names; empty when the run's objects were replaced or never saved
 */
export async function findWebObjectNamesForCrawlRun(
  websiteId: string,
  crawlRunId: string,
): Promise<WebObjectName[]> {
  const webObjectNames = await prisma.webObject.findMany({
    where: { websiteId, crawlRunId, deletedAt: null },
    select: { id: true, instancePatternKey: true, detectedName: true, name: true },
  });
  return webObjectNames;
}

/**
 * Renames an active web object, until the next crawl replaces it.
 * @param websiteId - The owning website's cuid
 * @param webObjectId - The web object's cuid
 * @param name - The new name, or null to show the detected name again
 * @returns The renamed object with its patterns and crawl, or null when no active object of that website matched (it never existed, or a newer crawl replaced it)
 */
export async function renameWebObject(
  websiteId: string,
  webObjectId: string,
  name: string | null,
): Promise<WebObjectWithPatterns | null> {
  try {
    const renamed = await prisma.webObject.update({
      where: { id: webObjectId, websiteId, deletedAt: null },
      data: { name },
      include: WEB_OBJECT_INCLUDE,
    });
    return renamed;
  } catch (error: unknown) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

// === Credentials ===
// Every read that can reach an API response omits `encryptedPassword` (see
// `CredentialSummary`); only `findCredentialWithPasswordForWebsite` returns it.

/** Leaves the encrypted password out of a credential query's result. */
const OMIT_ENCRYPTED_PASSWORD = { encryptedPassword: true } as const;

/**
 * Lists a website's active credentials, newest first, without their passwords.
 * @param websiteId - The owning website's cuid
 * @returns The website's active credentials ordered by `createdAt` descending
 */
export async function listCredentialsForWebsite(
  websiteId: string,
): Promise<CredentialSummary[]> {
  const credentials = await prisma.credential.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    omit: OMIT_ENCRYPTED_PASSWORD,
  });
  return credentials;
}

/**
 * Looks up one active credential, scoped to the website that owns it, without
 * its password.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns The active credential, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findCredentialForWebsite(
  websiteId: string,
  credentialId: string,
): Promise<CredentialSummary | null> {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, websiteId, deletedAt: null },
    omit: OMIT_ENCRYPTED_PASSWORD,
  });
  return credential;
}

/**
 * Looks up one active credential WITH its encrypted password - the only read
 * that returns it. Used to start a crawl that logs in; never send its result
 * to a client.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns The active credential including `encryptedPassword`, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findCredentialWithPasswordForWebsite(
  websiteId: string,
  credentialId: string,
): Promise<Credential | null> {
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, websiteId, deletedAt: null },
  });
  return credential;
}

/**
 * Inserts a credential belonging to the given website.
 * @param websiteId - The owning website's cuid
 * @param data - The credential's fields, except the password
 * @param encryptedPassword - The password, already encrypted by `encryptCredentialPassword`
 * @returns The created row, without its password
 */
export async function createCredentialForWebsite(
  websiteId: string,
  data: CredentialInput,
  encryptedPassword: string,
): Promise<CredentialSummary> {
  const created = await prisma.credential.create({
    data: { ...data, encryptedPassword, websiteId },
    omit: OMIT_ENCRYPTED_PASSWORD,
  });
  return created;
}

/**
 * Replaces the fields of an active credential. The password is only replaced
 * when a new one is given, so editing the other fields keeps the saved
 * password.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @param data - The credential's new fields, except the password
 * @param encryptedPassword - The new password, already encrypted, or null to keep the saved one
 * @returns The updated row without its password, or null when no active credential with that id belongs to the website
 */
export async function updateCredentialForWebsite(
  websiteId: string,
  credentialId: string,
  data: CredentialInput,
  encryptedPassword: string | null,
): Promise<CredentialSummary | null> {
  const passwordIsBeingReplaced = encryptedPassword !== null;
  const updateData = passwordIsBeingReplaced ? { ...data, encryptedPassword } : data;
  try {
    const updated = await prisma.credential.update({
      where: { id: credentialId, websiteId, deletedAt: null },
      data: updateData,
      omit: OMIT_ENCRYPTED_PASSWORD,
    });
    return updated;
  } catch (error: unknown) {
    if (isRecordNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Soft deletes one active credential and unlinks it from the actions that run
 * as it (they go back to running logged out), in one transaction. Crawl runs
 * that used it keep their link to it, so their history still names it.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns True when an active credential was deleted; false when none matched
 */
export async function softDeleteCredentialForWebsite(
  websiteId: string,
  credentialId: string,
): Promise<boolean> {
  /**
   * The transaction body. Declared with an explicit parameter type because
   * the overloaded `$transaction` signature does not contextually type an
   * inline callback (tsc reports an implicit any).
   * @param transaction - The transaction-scoped Prisma client
   * @returns True when the credential was active and is now deleted; false when none matched
   */
  const softDeleteCredentialAndUnlinkActions = async (
    transaction: Prisma.TransactionClient,
  ): Promise<boolean> => {
    const credentialUpdate = await transaction.credential.updateMany({
      where: { id: credentialId, websiteId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    const noActiveCredentialMatched = credentialUpdate.count === 0;
    if (noActiveCredentialMatched) {
      return false;
    }
    await transaction.action.updateMany({
      where: { credentialId, websiteId },
      data: { credentialId: null },
    });
    return true;
  };

  const anActiveCredentialWasDeleted = await prisma.$transaction(
    softDeleteCredentialAndUnlinkActions,
  );
  return anActiveCredentialWasDeleted;
}
