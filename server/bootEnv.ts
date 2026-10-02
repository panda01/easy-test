import dotenv from "dotenv";
import path from "path";

/**
 * Bootstrap module: runs `dotenv.config(...)` at MODULE LOAD time so any
 * downstream module that reads `process.env.<X>` at its own load time
 * (e.g. `services/dbService.ts` reading `DATABASE_URL`) sees the populated
 * values.
 *
 * This MUST be the first import in `server/server.ts`. ES module semantics
 * evaluate imports depth-first in source order before the importer's body
 * runs, so any `dotenv.config(...)` call placed in server.ts's body would
 * execute too late - every imported module would already have read its env
 * vars from a still-empty `process.env`.
 *
 * Loads `.env.local` first, then `.env`. dotenv preserves keys that are
 * already set, so `.env.local` wins on conflicts.
 *
 * `prisma.config.ts` imports this module too. Prisma 7 loads its config file
 * with dotenv disabled, so without this the CLI would never see
 * `DATABASE_URL` - and `import "dotenv/config"` alone would miss `.env.local`,
 * which is where the machine-specific values live.
 *
 * `quiet: true` suppresses dotenv 17's "injecting env (n) from ..." banner,
 * which would otherwise land in the middle of the `[server]`-prefixed dev log.
 */
const projectRoot = process.cwd();
dotenv.config({ path: path.join(projectRoot, ".env.local"), quiet: true });
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
