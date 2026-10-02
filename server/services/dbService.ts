import { PrismaClient, type Website } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

export type { Website };

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

/** The fields a caller supplies when creating a website row. */
export interface CreateWebsiteInput {
  url: string;
  name: string;
  description?: string | null;
}

/**
 * Inserts a website. The `url` column is unique, so a duplicate URL rejects
 * with a Prisma unique-constraint error rather than creating a second row.
 *
 * @param {CreateWebsiteInput} data - URL, display name, and optional description
 * @returns {Promise<Website>} The created row, including its generated cuid and timestamps
 */
export async function createWebsite(data: CreateWebsiteInput): Promise<Website> {
  const created = await prisma.website.create({ data });
  return created;
}

/**
 * Lists every website, newest first.
 *
 * @returns {Promise<Website[]>} All rows ordered by `createdAt` descending
 */
export async function listWebsites(): Promise<Website[]> {
  const websites = await prisma.website.findMany({ orderBy: { createdAt: "desc" } });
  return websites;
}

/**
 * Looks up a single website by its unique URL.
 *
 * @param {string} url - The exact URL to match
 * @returns {Promise<Website | null>} The row, or null when no website has that URL
 */
export async function findWebsiteByUrl(url: string): Promise<Website | null> {
  const website = await prisma.website.findUnique({ where: { url } });
  return website;
}

/**
 * Deletes the website with the given URL.
 *
 * @param {string} url - The exact URL to delete
 * @returns {Promise<void>} Resolves once the row is gone
 * @throws {Error} Prisma rejects when no row matches
 */
export async function deleteWebsiteByUrl(url: string): Promise<void> {
  await prisma.website.delete({ where: { url } });
}
