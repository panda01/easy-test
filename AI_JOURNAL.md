# AI Journal

Newest entry at the top.

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
