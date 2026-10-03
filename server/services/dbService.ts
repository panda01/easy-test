import {
  PrismaClient,
  type Prisma,
  type Website,
  type UseCase,
  type Action,
  type ScreenshotRun,
  type ActionScript,
  type ActionScriptRun,
  type CrawlRun,
  type CrawledPage,
  type Credential,
} from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CrawlButtonMode } from "../utils/crawlButtonModes.js";

export type {
  Website,
  UseCase,
  Action,
  ScreenshotRun,
  ActionScript,
  ActionScriptRun,
  CrawlRun,
  CrawledPage,
  Credential,
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
export type ActionInput = TitleDescriptionInput;

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
 * The fields a caller supplies when saving one generated action script. The
 * four snapshots record exactly what was sent to Claude; the rest is what came
 * back, plus the rule scan of the code. Scripts are create-only, so there is
 * no matching "update" input.
 */
export interface ActionScriptInput {
  /** The website's name at conversion time. */
  websiteName: string;
  /** The website's URL at conversion time - the script's START_URL. */
  startUrl: string;
  /** The action's title at conversion time. */
  actionTitle: string;
  /** The action's description at conversion time. */
  actionDescription: string;
  /** Claude's one-line summary of what the script does. */
  summary: string;
  /** The assumptions Claude made where the action was ambiguous. */
  assumptions: string[];
  /** The complete `.mjs` source. */
  code: string;
  /** Warn-only rule scan results; empty when the code is clean. */
  ruleViolations: string[];
  /** The model that actually wrote the script. */
  modelId: string;
  /** The effort level sent with the request, or null for a model with no effort setting ("Standard"). */
  effort: string | null;
}

/**
 * The fields a caller supplies when recording one script run. Runs are
 * create-only, so there is no matching "update" input.
 */
export interface ActionScriptRunInput {
  /** True only for exit code 0, no timeout, and no failure screenshot. */
  succeeded: boolean;
  /** The process exit code, or null when it was killed by a signal. */
  exitCode: number | null;
  /** The signal that killed the process, or null when it exited on its own. */
  exitSignal: string | null;
  /** True when the run hit the time limit and was stopped. */
  timedOut: boolean;
  /** Combined stdout + stderr, capped. */
  output: string;
  /** True when the cap dropped the start of the output. */
  outputWasTruncated: boolean;
  /** The failure PNG's path relative to the action script directory, or null when none was written. */
  failureScreenshotFileName: string | null;
  /** How long the process ran, in milliseconds. */
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
 * The fields a caller supplies when recording one crawled page. Pages are
 * create-only, so there is no matching "update" input.
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

/**
 * Lists every active (not soft-deleted) website, newest first.
 * @returns All active rows ordered by `createdAt` descending
 */
export async function listWebsites(): Promise<Website[]> {
  const websites = await prisma.website.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return websites;
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
 * runs, action scripts, action script runs, crawl runs, crawled pages, and
 * credentials.
 *
 * All nine updates run in one transaction and share one `deletedAt`
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
 * Lists a website's active actions, newest first.
 * @param websiteId - The owning website's cuid
 * @returns The website's active actions ordered by `createdAt` descending
 */
export async function listActionsForWebsite(websiteId: string): Promise<Action[]> {
  const actions = await prisma.action.findMany({
    where: { websiteId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return actions;
}

/**
 * Looks up one active action, scoped to the website that owns it.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns The active action, or null when it does not exist, was soft deleted, or belongs to another website
 */
export async function findActionForWebsite(
  websiteId: string,
  actionId: string,
): Promise<Action | null> {
  const action = await prisma.action.findFirst({
    where: { id: actionId, websiteId, deletedAt: null },
  });
  return action;
}

/**
 * Inserts an action belonging to the given website.
 * @param websiteId - The owning website's cuid
 * @param data - The action's title and description
 * @returns The created row
 */
export async function createActionForWebsite(
  websiteId: string,
  data: ActionInput,
): Promise<Action> {
  const created = await prisma.action.create({ data: { ...data, websiteId } });
  return created;
}

/**
 * Replaces the title and description of an active action.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @param data - The new title and description
 * @returns The updated row, or null when no active action with that id belongs to the website
 */
export async function updateActionForWebsite(
  websiteId: string,
  actionId: string,
  data: ActionInput,
): Promise<Action | null> {
  try {
    const updated = await prisma.action.update({
      where: { id: actionId, websiteId, deletedAt: null },
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
 * Soft deletes one active action AND its active scripts and script runs.
 *
 * All three updates run in one transaction and share one `deletedAt`
 * timestamp, like `softDeleteWebsite`. When no active action matched, the
 * scripts and runs are left untouched.
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
// Create-only: there is deliberately no update function for scripts or their
// runs, which is what makes them immutable. They are soft deleted only through
// `softDeleteActionForWebsite` and `softDeleteWebsite`.

/**
 * Lists an action's active scripts, newest first.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @returns The action's active scripts ordered by `createdAt` descending
 */
export async function listActionScriptsForAction(
  websiteId: string,
  actionId: string,
): Promise<ActionScript[]> {
  const actionScripts = await prisma.actionScript.findMany({
    where: { websiteId, actionId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return actionScripts;
}

/**
 * Looks up one active script, scoped to the website and action that own it.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @returns The active script, or null when it does not exist, was soft deleted, or belongs to another action
 */
export async function findActionScriptForAction(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ActionScript | null> {
  const actionScript = await prisma.actionScript.findFirst({
    where: { id: actionScriptId, websiteId, actionId, deletedAt: null },
  });
  return actionScript;
}

/**
 * Saves one generated script for an action. The row is never edited after
 * this; converting the action again saves another row.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param data - The snapshots sent to Claude, what Claude returned, and the rule scan
 * @returns The created row
 */
export async function createActionScriptForAction(
  websiteId: string,
  actionId: string,
  data: ActionScriptInput,
): Promise<ActionScript> {
  const created = await prisma.actionScript.create({ data: { ...data, websiteId, actionId } });
  return created;
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
 * Soft deletes one active credential. Crawl runs that used it keep their link
 * to it, so their history still names it.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns True when an active credential was deleted; false when none matched
 */
export async function softDeleteCredentialForWebsite(
  websiteId: string,
  credentialId: string,
): Promise<boolean> {
  const credentialUpdate = await prisma.credential.updateMany({
    where: { id: credentialId, websiteId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  const anActiveCredentialWasDeleted = credentialUpdate.count > 0;
  return anActiveCredentialWasDeleted;
}
