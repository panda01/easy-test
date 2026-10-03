# server/prisma/

Prisma 7 schema for the PostgreSQL database.

## The one rule

**Never import from `../generated/prisma/` in application code.** Go through
`../services/dbService.ts`, which owns the single `PrismaClient` and exposes
named query functions. The generated directory is gitignored and is rewritten
on every `prisma generate`.

## Two Prisma 7 specifics worth knowing

1. **The connection URL is not in this schema.** The `datasource db` block
   carries only `provider = "postgresql"`. The URL comes from the project-root
   `prisma.config.ts`, which imports `server/bootEnv.js` first because Prisma 7
   loads its config file with dotenv disabled. This is what `prisma init`
   generates on Prisma 7.
2. **A driver adapter is mandatory.** `PrismaClientOptions` types `adapter` as
   required unless you pass `accelerateUrl`, so plain `new PrismaClient()`
   neither typechecks nor runs. `dbService.ts` constructs a `PrismaPg`.

The generator is `prisma-client` (the ESM generator), **not** the legacy
`prisma-client-js`. It emits TypeScript sources rather than writing into
`node_modules`.

## Models

| Model | Table | Purpose |
|---|---|---|
| `Website` | `websites` | A website a user wants to test: url, name, optional description, and two screenshot timing settings — `networkIdleTimeoutMs` (default 5000) and `screenshotMinimumWaitMs` (default 1). |
| `UseCase` | `use_cases` | A scenario to test on one website: title, description (both required). |
| `Action` | `actions` | A reusable step on one website, e.g. "Log in": title, description (both required). |
| `ScreenshotRun` | `screenshot_runs` | One visit the Playwright controller made to a website: the URL visited, whether it succeeded, the HTTP status, the failure reason, the screenshot's file name, and how long navigation took. |
| `ActionScript` | `action_scripts` | One Playwright script Claude generated from an action: snapshots of what was sent (website name, START_URL, action title and description), the summary, `assumptions String[]`, the `.mjs` `code`, the warn-only `ruleViolations String[]`, and the `modelId` that answered. **Immutable** - create-only. |
| `ActionScriptRun` | `action_script_runs` | One run of a script: `succeeded`, `exitCode` (null when killed by a signal), `exitSignal`, `timedOut`, the capped `output` and `outputWasTruncated`, the failure screenshot's file name, and the duration. Create-only. |

`UseCase`, `Action`, and `ScreenshotRun` each belong to exactly one `Website`
(`websiteId`, indexed). `ActionScript` belongs to one `Action` and, denormalized
for single-statement cascades, its `Website`; `ActionScriptRun` carries all
three parent ids (`websiteId`, `actionId`, `actionScriptId`, each indexed). The foreign keys use Prisma's default `onDelete: Restrict`, which is
fine because rows are never hard deleted.

`ScreenshotRun.screenshotFileName` is **relative** to the configured
screenshot directory (`SCREENSHOT_DIR`), e.g. `<websiteId>/<uuid>.png`, and is
null when the visit never reached a page. The PNG itself lives on disk, not in
the database. `requestedUrl` is a snapshot, because the website's URL can be
edited after the run.

`ActionScriptRun.failureScreenshotFileName` is likewise **relative** to
`ACTION_SCRIPT_DIR`, e.g. `<websiteId>/<uuid>/failure.png` (the run folder
also holds the `script.mjs` that ran). Converting an action again never edits
a script - it adds a new row, which the UI shows as the next "Version N".

Fields are camelCase and are **not** individually `@map`'d — only table names
are mapped. Postgres therefore stores quoted mixed-case columns, so
hand-written SQL must quote them:

```sql
select "createdAt" from websites;   -- works
select createdAt from websites;     -- fails
```

## Soft delete

All six models have a nullable `deletedAt`. Deleting sets it instead of
removing the row, and every `dbService` query filters `deletedAt: null`.
Deleting a website also stamps its active use cases, actions, screenshot
runs, action scripts, and action script runs, in one transaction, with the
**same** timestamp — so that batch can be identified together later. Deleting
an action likewise stamps its active scripts and their runs with the action's
timestamp. A soft-deleted run's PNG (and run folder) stays on disk. Scripts
and runs are never deleted on their own.

## The partial unique index on `Website.url`

```prisma
@@unique([url], where: { deletedAt: null })
```

A URL may appear on any number of soft-deleted websites but on at most one
active website, so a deleted website's URL can be added again. This needs the
**`partialIndexes` preview feature** (enabled in the generator block). In
Postgres it is `websites_url_key ... WHERE "deletedAt" IS NULL`.

Prisma still lists `url` in `WebsiteWhereUniqueInput`, but because several
deleted rows can share a URL, URL lookups use `findFirst` with
`deletedAt: null`, never `findUnique`.

URLs are normalized with `new URL(input).href` before they are stored (see
`../utils/validateRequestBodies.ts`), so `HTTPS://Example.COM` and
`https://example.com/` collide on this index instead of becoming two websites.

## Workflow

Migrations are not used — this project is `db push` only. After any schema
change:

```sh
npx prisma db push
npx prisma generate
```

`npm install` runs both automatically via `postinstall`. A change that adds a
unique index makes `db push` ask for `--accept-data-loss`, because the index
cannot be created if duplicates exist.
