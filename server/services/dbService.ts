import {
  PrismaClient,
  type Prisma,
  type Website,
  type UseCase,
  type Action,
  type ScreenshotRun,
  type ActionScript,
  type ActionScriptRun,
} from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

export type { Website, UseCase, Action, ScreenshotRun, ActionScript, ActionScriptRun };

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
 * runs, action scripts, and action script runs.
 *
 * All six updates run in one transaction and share one `deletedAt`
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
