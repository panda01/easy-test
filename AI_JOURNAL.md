# AI Journal

Newest entry at the top.

---

## 2026-10-02 16:14 EDT — Websites / Use cases / Actions CRUD, soft delete, JSDoc lint

**Intent:**
- Give the `websites` table a full CRUD API and UI, with a page per website.
- Add two website-owned concepts, **UseCase** and **Action** (title + description each), with their own CRUD API and pages.
- Make sure browser Back and Forward keep working across every screen.
- At the user's request, enforce JSDoc with `eslint-plugin-jsdoc` (`recommended-tsdoc-error`) and widen `npm run lint` from `server/` to `server/` + `src/`.

### Decisions (all made by the user)

- **Forms are separate routed pages**, not dialogs, so every screen is a history entry.
- **Soft delete on all three tables** (`deletedAt`). Deleting a website soft-deletes its active use cases and actions in one transaction with the same timestamp.
- **Website URL is unique among active websites only.** This uses Prisma 7.10's `partialIndexes` preview feature: `@@unique([url], where: { deletedAt: null })`. A deleted website's URL can be re-added.
- **URLs are normalized** with `new URL(input).href` (`HTTPS://Example.COM` → `https://example.com/`).
- **Use case and action descriptions are required.** The website description stays optional.
- **`@route` is registered** as a JSDoc tag. It is set through the `jsdoc/check-tag-names` rule option; `settings.jsdoc.definedTags` was verified not to work.
- **`npx prisma db push --accept-data-loss`** was run with explicit user consent. Prisma's AI-agent guard required the `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` env var. The `websites` table had 0 rows.
- **`.claude/agents/manual-verifier.md`** wrote its memory into `/Users/khalah/Projects/new_plex/...`. At the user's choice it now points at this project's `.claude/agent-memory/manual-verifier/`.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `previewFeatures = ["partialIndexes"]`. `Website`: added `deletedAt`, `useCases`, and `actions`; `@unique` on `url` replaced by the partial `@@unique`. **Added** models `UseCase` (`use_cases`) and `Action` (`actions`): `id`, `websiteId`, `title`, `description`, `createdAt`, `updatedAt`, `deletedAt`, plus an index on `websiteId`. |
| `server/services/dbService.ts` | See the breakdown below this table. |
| `server/utils/describeError.ts` | **New.** `describeError(error)`. |
| `server/utils/validateRequestBodies.ts` | **New.** Exports `ValidationResult<T>`, `validateWebsiteInput`, and `validateTitleDescriptionInput`. Private helpers: `isJsonObject`, `readTrimmedString`, `normalizeHttpUrl`. |
| `server/controllers/websites.ts` | **New.** `registerWebsiteRoutes(app)`: `GET`/`POST /api/websites`, `GET`/`PUT`/`DELETE /api/websites/:websiteId`. Constants `WEBSITE_NOT_FOUND_MESSAGE` and `DUPLICATE_URL_MESSAGE`. |
| `server/controllers/useCases.ts` | **New.** `registerUseCaseRoutes(app)`: `/api/websites/:websiteId/use-cases[/:useCaseId]`. |
| `server/controllers/actions.ts` | **New.** `registerActionRoutes(app)`: `/api/websites/:websiteId/actions[/:actionId]`. |
| `server/server.ts` | Registers the three new controllers. `startListening` JSDoc restyled (no `{Type}`). |
| `server/controllers/health.ts` | JSDoc restyled for the tsdoc preset. No code change. |
| `server/utils/resolveServerPort.ts` | JSDoc restyled. No code change. |

**`server/services/dbService.ts` in detail:**
- **Renamed** `CreateWebsiteInput` to `WebsiteInput`.
- **Added types:** `TitleDescriptionInput`, `UseCaseInput`, `ActionInput`. Also re-exports the `UseCase` and `Action` types.
- **Added error checks:** `isUniqueConstraintViolation` (P2002) and `isRecordNotFound` (P2025), sharing the private helper `hasPrismaErrorCode`.
- **Website functions added:** `findWebsiteById`, `updateWebsite` (atomic update; P2025 → null), and `softDeleteWebsite` (an interactive transaction; its callback is `softDeleteWebsiteAndItsChildren`).
- **Website functions changed:** `listWebsites` now filters out deleted rows; `findWebsiteByUrl` now uses `findFirst` and filters out deleted rows.
- **Removed:** `deleteWebsiteByUrl` (unused, and a hard delete contradicts soft delete).
- **Use case functions added:** `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite`.
- **Action functions added:** the same five, named `...ActionForWebsite` / `listActionsForWebsite`.
- **Implementation note:** the `$transaction` callback needs an explicit `Prisma.TransactionClient` type; without it, tsc reports an implicit `any`.

### Files changed — client

| File | Change |
|---|---|
| `src/App.tsx` | Renders `AppHeader` and the 10 routes. Each use case / action route element has its own `key`. |
| `src/main.tsx` | The `!` non-null assertion became a checked `rootElement` lookup that throws a clear error (lint). |
| `src/hooks/useHealth.ts` | `String(response.status)` in the template (lint). Added JSDoc to the inner `loadHealth`. Return JSDoc restyled. |
| `src/pages/HomePage.tsx` | JSDoc restyled. No code change. |
| `src/utils/describeError.ts` | **New.** `describeError` and `readResponseErrorMessage`. |
| `src/utils/routePaths.ts` | **New.** Page paths: `WEBSITE_LIST_PATH`, `NEW_WEBSITE_PATH`, `websiteDetailPath`, `websiteEditPath`, `newWebsiteItemPath`, `websiteItemDetailPath`, `websiteItemEditPath`. API URLs: `WEBSITES_API_URL`, `websiteApiUrl`, `websiteItemsApiUrl`, `websiteItemApiUrl`. |
| `src/utils/websiteItemKinds.ts` | **New.** `WebsiteItemKind`, `USE_CASE_KIND`, `ACTION_KIND`, `WebsiteItemPageProps`. |
| `src/utils/formatCount.ts` | **New.** `formatCount`. |
| `src/hooks/useJsonResource.ts` | **New.** `JsonResourceState<T>` and `useJsonResource(url)`. Its result is keyed by URL, it uses a `cancelled` flag, and its inner function is `loadResource`. |
| `src/hooks/useJsonMutation.ts` | **New.** `MutationMethod`, `MutationResult`, `SendJsonRequest`, `useJsonMutation()`. |
| `src/hooks/useWebsites.ts` | **New.** `WebsiteRecord`, `WebsiteRequestBody`, `useWebsites`, `useWebsite`. |
| `src/hooks/useWebsiteItems.ts` | **New.** `WebsiteItemRecord`, `WebsiteItemRequestBody`, `useWebsiteItems`, `useWebsiteItem`. |
| `src/hooks/useRequiredRouteParam.ts` | **New.** `useRequiredRouteParam`. |
| `src/hooks/useReturnNavigation.ts` | **New.** `ReturnState`, `useReturnToHereState`, `useReturnNavigation` (returns `returnTo` and `replaceKeepingReturnState`). Private helper `readReturnTo`. |
| `src/components/*.tsx` | **New.** `AppHeader`, `PageBreadcrumbs` (`BreadcrumbItem`), `LoadStatusNotice`, `ConfirmDeleteDialog`, `WebsiteForm`, `TitleDescriptionForm`, `WebsiteItemListSection`. Each comes with its `<Name>Props` interface. |
| `src/pages/Website*.tsx` | **New.** `WebsiteListPage`, `WebsiteCreatePage`, `WebsiteEditPage`, `WebsiteDetailPage`, `WebsiteItemCreatePage`, `WebsiteItemDetailPage`, `WebsiteItemEditPage`. |

**History rule:**
- Links into forms and detail pages carry `state.returnTo`.
- Cancel, edit-Save, and Delete go back one entry when `returnTo` matches the destination, and otherwise replace the current entry.
- Create-Save replaces the form entry with the new record's page and keeps that state.
- Result: history never holds a stale form or a duplicate `[detail, detail]`.

### Files changed — config, tooling, docs

- `package.json` / `package-lock.json`:
  - Added devDependency `eslint-plugin-jsdoc@^65.0.2`, which ships its own types.
  - `"lint"` is now `npx eslint server src`.
- `eslint.config.ts`:
  - Added the constant `jsdocTsdocPreset`.
  - Added a block applying it to `./server/**` and `./src/**`, with the `@route` `check-tag-names` option.
- `.claude/agents/manual-verifier.md`: memory path fixed (line 191).
- **READMEs updated:**
  - root `README.md`
  - `server/controllers/`, `server/services/`, `server/prisma/`, `server/utils/`
  - `src/`, `src/hooks/`, `src/pages/`
- **README added:** `src/components/README.md`.

### Tests

**Backend:**
- **New specs:**
  - `tests/backend/utils/describeError.test.ts`
  - `tests/backend/utils/validateRequestBodies.test.ts`
  - `tests/backend/api/websites.test.ts` (helper `createWebsitesApp`)
  - `tests/backend/api/useCases.test.ts` (helper `createUseCasesApp`)
  - `tests/backend/api/actions.test.ts` (helper `createActionsApp`)
- **Changed `tests/backend/services/dbService.test.ts`:**
  - Mocks for the `useCase`/`action` delegates and `$transaction`.
  - Helpers `createMockModelDelegate` and `readDeletedAtWrittenBy`.
  - The `deleteWebsiteByUrl` test was replaced by soft-delete tests, because that function was removed.
  - Two existing tests were renamed for soft-delete semantics.
- **Changed `tests/backend/server.test.ts`:**
  - Mocks dbService.
  - Four new "routes are wired" tests.
  - All original tests kept.

**Frontend:**
- **New specs:** one `tests/frontend/<Source>.test.tsx` per new util, hook, component, and page (24 files).
- **New shared module `tests/frontend/support/frontendTestHelpers.tsx`:**
  - `stubFetchRoutes`, `buildJsonResponse`, `buildUnparseableResponse`, `countRequests`
  - `createDeferred`, `createRejectedFetch`
  - `buildWebsiteRecord`, `buildWebsiteItemRecord`, `ITEM_KIND_TEST_CASES`
  - `LocationProbe`, `renderPageRoutes`, `readProbeAfterLanding`, `readBreadcrumbTrail`
  - Their types.
- **Changed `tests/frontend/App.test.tsx`:**
  - Added a `describe("App routes")` block with helper `stubEveryPageRequest`.
  - The original tests are unchanged.

The backend and frontend specs were written by two parallel subagents. Both were limited to `tests/` and reported no source bugs.

### Verification performed

- **Database:**
  - `psql \d websites` shows `websites_url_key UNIQUE ... WHERE "deletedAt" IS NULL`.
  - The `use_cases` and `actions` tables exist with their FKs and the `websiteId` index.
- **curl smoke test against the real DB:**
  - URL normalization works.
  - Duplicate URL returns 409 (P2002 arrives through the pg adapter).
  - Invalid bodies return 400.
  - Website delete stamps one identical `deletedAt` on the website, its use case, and its action, after which all three return 404.
  - Re-adding the deleted URL returns 201.
  - The test rows were then removed.
- **manual-verifier agent** (Playwright, about 75 checks): **VERIFIED**.
  - Create, view, edit, and delete for all three record types.
  - Back and Forward after save, cancel, and delete, with no stale forms and no duplicate entries.
  - Deep links and reloads work.
  - The delete dialog shows the counts.
  - Forward onto a deleted record shows "… not found".
  - No JS errors.
  - It left soft-deleted test rows and one active "Example Again" website in `easy_test_dev`.
- `npm run test:coverage`: **427 tests in 35 files, all passing.**
  - Statements 99.84%, branches 99.61%, functions 100%, lines 99.84%, against thresholds of 80/70/80/80.
  - The only uncovered line is the NODE_ENV-guarded `startListening(app, PORT)` in `server.ts`.
- `npm run lint` (server + src): clean. `npm run tsc` and `npm run tsc:client`: clean.

### Notable during implementation

- Prisma refuses `db push --accept-data-loss` from an AI agent until it gets consent in the moment. Earlier approval does not count.
- `./stop-dev.sh` kills only the **listeners** on 3010/5180. After the verifier's `npm run dev`, the parent `tsx watch` process survived and started a new server when server files were edited. It was found with `lsof` and stopped by PID. The script itself was not changed.
- `tests/` is outside `npm run lint`'s scope, by the user's choice. Some pre-existing test files still use `{Type}` JSDoc and would fail the jsdoc and strict TypeScript rules if they were ever linted.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-09-17 16:27 EDT — Initial development scaffold

**Intent:** Stand up a new project from empty, mirroring the architecture of the
`new_plex` repo, with a health API, a Hello World homepage that displays that
health live, and a Prisma `Website` table for saving URLs to test. Development
only — no production build, PM2, Docker, or CI.

The `new_plex` GitHub URL 404s (private repo); the architecture was taken from
the local clone at `/Users/khalah/Projects/new_plex`, which was read but never
modified.

### Decisions

- **Database:** local Homebrew PostgreSQL 18, database `easy_test_dev`, user
  `khalah`, no password. Not SQLite (which is what `new_plex` uses).
- **Ports:** `SERVER_PORT=3010`, `VITE_PORT=5180` — clear of every other project
  on this machine. `3011`/`5181` reserved for a future production pair.
- **Tests:** unit tests only, per user request. No `tests/playwright/` directory
  and no `playwright.config.ts`; Playwright is still used to drive end-to-end
  checks, but as throwaway scripts in `claude_tmp/`.
- **Git:** left uninitialized. The user runs `git init` themselves.
- **Tooling in `devDependencies`** (unlike `new_plex`, which needs it in
  `dependencies` for its `--omit=dev` production install). Tripwire recorded in
  `README.md`.

### Prisma 7 notes

Three findings that shaped the wiring, verified against the installed packages:

1. A **driver adapter is mandatory** — `PrismaClientOptions` types `adapter` as
   required unless `accelerateUrl` is given, so plain `new PrismaClient()`
   neither typechecks nor runs. Uses `@prisma/adapter-pg`.
2. npm's `prisma@latest` is **`8.0.0-rc.15`**, a prerelease. The Prisma trio is
   pinned `^7.3.0`, resolving to 7.10.0.
3. `@prisma/adapter-pg` ships `pg` and `@types/pg` as its own dependencies, so
   neither is declared here.

The datasource URL lives in `prisma.config.ts`, not `schema.prisma`.

### Files created

**Config / env:** `.gitignore`, `.env`, `.env.example`, `.env.local`,
`package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`,
`vitest.config.ts`, `eslint.config.ts`, `stop-dev.sh`, `prisma.config.ts`.

**Server:**

| File | Added |
|---|---|
| `server/bootEnv.ts` | Module-load `dotenv.config()` for `.env.local` then `.env`. No exports. |
| `server/prisma/schema.prisma` | `Website` model (`id`, `url` unique, `name`, `description?`, `createdAt`, `updatedAt`), mapped to table `websites`. |
| `server/utils/resolveServerPort.ts` | `resolveServerPort(): number` |
| `server/controllers/health.ts` | `registerHealthRoutes(app: Express): void` → `GET /api/health` returning `{ status: "ok", uptime }` |
| `server/services/dbService.ts` | `CreateWebsiteInput` interface; `createWebsite`, `listWebsites`, `findWebsiteByUrl`, `deleteWebsiteByUrl`; module-private `prisma` and `adapter`; re-exports the `Website` type. |
| `server/server.ts` | `startListening(expressApp, port): Server`; exports `app`. Module-body `listen` guarded by `NODE_ENV !== "test"`. |

**Client:**

| File | Added |
|---|---|
| `index.html` | Vite entry. |
| `src/index.css` | Reset + dark page background. |
| `src/main.tsx` | Inline MUI dark `theme`; React root render. |
| `src/hooks/useHealth.ts` | `HealthStatus` interface; `useHealth()` returning `{ health, isLoading, errorMessage }`. |
| `src/pages/HomePage.tsx` | `HomePage()` — Hello World + live health chip. |
| `src/App.tsx` | `App()` — `BrowserRouter` with the `/` route. |

**Tests:** `tests/setup.ts`, `tests/backend/utils/resolveServerPort.test.ts`,
`tests/backend/api/health.test.ts`, `tests/backend/server.test.ts`,
`tests/backend/services/dbService.test.ts` (adds local helper
`createHealthApp()` in the health spec), `tests/frontend/App.test.tsx`,
`tests/frontend/HomePage.test.tsx` (adds local helper `createDeferredFetch()`).

**Docs:** `README.md`, this file, and a `README.md` in `server/`,
`server/controllers/`, `server/services/`, `server/utils/`, `server/prisma/`,
`src/`, `src/hooks/`, `src/pages/`, `tests/`.

### Notable during implementation

- **`npm run lint` initially failed** on `dbService.ts` with "was not found by
  the project service". Root cause: nothing imported it, so it belonged to no
  TypeScript project. Fixed by adding
  `tests/backend/services/dbService.test.ts` — which the module needed anyway —
  rather than by touching any config.
- The first version of that spec stubbed `PrismaClient` with `vi.fn(() => ...)`;
  vitest rejects a non-constructible mock for a `new` call. Changed both stubs
  to `class` declarations.

### Verification performed

- `createdb easy_test_dev`; `npm install` ran `prisma generate && prisma db push`
  cleanly. `npm ls` confirms `prisma`, `@prisma/client`, `@prisma/adapter-pg`
  all at 7.10.0.
- `psql -c '\d websites'` shows all six columns plus the unique index on `url`.
- Throwaway `claude_tmp/verifyDb.mts` did a full create → find → list → delete
  round trip through `dbService`, proving the pg adapter reaches Postgres.
  `@default(cuid())` generated fine with no deprecation warning.
- `npm run tsc` and `npm run tsc:client` — both clean.
- `npm run lint` — clean.
- `npm run test:coverage` — 28 tests pass; 97.05% statements, 93.1% branches,
  100% functions, 96.92% lines, all above the 80/70/80/80 thresholds.
- `npm run dev` came up on both ports. `GET /api/health` returns
  `{"status":"ok","uptime":...}` both directly on :3010 and through the Vite
  proxy on :5180; homepage returns 200.
- Throwaway `claude_tmp/verifyHomepage.mts` drove headless Chromium against
  :5180 and confirmed the "Hello World" heading and the live `ok` health chip
  both render, with no console errors. (`npx playwright install chromium` was
  needed first.)
- Dev servers stopped with `./stop-dev.sh`; `claude_tmp/` deleted.
