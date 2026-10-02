// MUST be the first import. Loads `.env.local` then `.env` into process.env.
// Required because Prisma 7 loads this config file with dotenv DISABLED, so
// without it the CLI would never see DATABASE_URL. Prisma's own template
// suggests `import "dotenv/config"`, which is not enough here: that reads only
// `.env`, and this project's machine-specific values live in `.env.local`.
//
// ES modules evaluate imports depth-first in source order, so bootEnv's body
// has already run by the time `env("DATABASE_URL")` below is called.
import "./server/bootEnv.js";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "server/prisma/schema.prisma",
  datasource: {
    // The URL lives here, not in schema.prisma: Prisma 7 datasource blocks
    // carry only `provider`. `env()` (from "prisma/config") throws a named
    // PrismaConfigEnvError when the variable is missing - better than
    // `process.env["DATABASE_URL"]`, which is `string | undefined` and would
    // silently resolve to undefined and fail later with an opaque engine error.
    url: env("DATABASE_URL"),
  },
  // No `migrations` block on purpose: this project uses `prisma db push` only
  // (see `postinstall`). Add `migrations: { path: "server/prisma/migrations" }`
  // the day migrations are introduced.
});
