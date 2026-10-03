# easy-test

Development scaffold: Express API + React/Vite frontend + Prisma/PostgreSQL.

The homepage says Hello World and displays the live result of `GET /api/health`,
which doubles as the end-to-end proof that the Vite `/api` proxy and the Express
server are both up.

`/websites` manages the websites to test. Each website has its own page, with
its **use cases** (scenarios to test) and **actions** (reusable steps such as
"Log in"), and each of those has its own page too. All three support create,
view, edit, and (soft) delete; see `server/prisma/README.md` and
`src/pages/README.md`.

A website's page also has a **Take screenshot** button. The server's
Playwright controller launches a headless Chromium **on this machine**, visits
the website's URL in a 1280x720 viewport, saves a PNG, and records the run:
succeeded (HTTP < 400) or failed (HTTP 400+ with a screenshot, or a DNS error /
refused connection / timeout with none). Every run is kept and listed under
"Run history". Before each screenshot it waits for the page's network
requests to finish and for it to paint, using two per-website settings on the
website form: a network idle cap (default 5000 ms) and a minimum wait
(default 1 ms). The browser can reach anything this machine can — localhost and
LAN addresses included — and an invalid TLS certificate counts as a failed
visit. See `server/controllers/README.md` and `server/services/README.md`.

An action's page has a **Convert to script** button. The server sends the
action (and the website's name and URL) to **Claude Opus 5.5**, with the
script-writing guidelines in `server/prompts/actionScriptGuidelines.md` used
verbatim as the system prompt (prompt-cached). Claude answers with a summary,
its assumptions, and a Playwright `.mjs` script that may only do what a user
could do with a mouse and keyboard. Every conversion is saved as a new,
**immutable** version - there is no edit - and the page shows each version's
summary, assumptions, and code. A text scan flags forbidden features (`.fill(`,
`page.evaluate`, `force: true`, imports other than `playwright`, ...) as
**warnings only**: the script is still saved and runnable. **Run script** runs
the selected version with plain `node` and **no environment variables**,
opening a **visible browser window on this machine**; it records pass/fail,
the step log, and a failure screenshot, and stops a run after **5 minutes**.
Without `ANTHROPIC_API_KEY` the server still boots and conversion answers 503.
See `server/controllers/README.md` and `server/services/README.md`.

**This project is development-only.** There is no production build, no PM2, no
Docker, and no CI.

## Stack

| Layer | Choice |
|---|---|
| Server | Express 5, run with `tsx watch` |
| Client | React 19 + Vite 7 + MUI 7 |
| Database | PostgreSQL 18 via Prisma 7 + `@prisma/adapter-pg` |
| Tests | Vitest (two projects: backend/node, frontend/jsdom) |
| Lint | ESLint flat config in TypeScript, `strictTypeChecked` + eslint-plugin-jsdoc `recommended-tsdoc-error` |

## First-time setup

Requires Node 25.4.0 and a local PostgreSQL server.

```sh
createdb easy_test_dev
cp .env.example .env.local     # then edit if your postgres user is not your OS user
npm install                    # postinstall runs: prisma generate && prisma db push
npx playwright install chromium   # the browser the screenshot feature launches
```

## Running

```sh
npm run dev          # Express on :3010 and Vite on :5180, one terminal
./stop-dev.sh        # kills ONLY this project's two ports
```

Then verify:

```sh
curl http://localhost:3010/api/health    # direct to Express
curl http://localhost:5180/api/health    # through the Vite proxy
open http://localhost:5180/
```

## Ports

`SERVER_PORT=3010`, `VITE_PORT=5180`. Chosen to avoid every other project on
this machine (new_plex 3001/5174, theerp 3004/3005, apply-for-me 4000/4173,
forge-gym 6100/6101) and Vite's own default 5173. `3011`/`5181` are reserved for
a future production pair.

Vite runs with `strictPort: true`, so a collision fails loudly rather than
silently drifting to another port.

## Environment

`.env` holds committed non-secret defaults. `.env.local` is gitignored and
**wins** — `server/bootEnv.ts` loads it first, and dotenv never overwrites a key
that is already set. `.env.example` documents every key.

| Key | Used for |
|---|---|
| `SERVER_PORT` / `VITE_PORT` | The two dev ports (see above). |
| `DATABASE_URL` | PostgreSQL connection string. |
| `SCREENSHOT_DIR` | Where screenshot PNGs are written and served from. Required; default `screenshots` (gitignored). A relative path resolves against the project root; `~` is not expanded. |
| `ACTION_SCRIPT_DIR` | Where each script run's folder (`script.mjs`, plus `failure.png` when it fails) is written. Required; default `action-scripts` (gitignored). Must be **inside the project** - generated scripts import `playwright` from its `node_modules` - or the server refuses to start. |
| `ANTHROPIC_API_KEY` | **Secret** - put it in `.env.local` only. Used by "Convert to script". Optional for boot: without it, conversion answers 503 with an explanation. |

## Database

Prisma 7 with the `prisma-client` (ESM) generator. Two things differ from older
Prisma:

1. **The connection URL lives in `prisma.config.ts`**, not in `schema.prisma` —
   the datasource block carries only `provider`.
2. **A driver adapter is mandatory.** `PrismaClientOptions` types `adapter` as
   required, so plain `new PrismaClient()` neither typechecks nor runs. This
   project uses `@prisma/adapter-pg`, which ships `pg` and `@types/pg` as its own
   dependencies (hence neither appears in `package.json`).

After any schema change:

```sh
npx prisma db push && npx prisma generate
```

Migrations are not used. Note that the `Website` model's fields are camelCase
and are not individually `@map`'d, so hand-written SQL must quote them:
`select "createdAt" from websites;`

## Scripts

| Script | Does |
|---|---|
| `dev` | Express + Vite together, log lines prefixed `[server]` / `[vite]` |
| `dev:server` / `dev:client` | Either half on its own |
| `stop-dev` | Kill only this project's listeners |
| `lint` | `eslint server src` — TypeScript rules plus JSDoc rules (TSDoc style: no `{Type}` braces; `@route` is a registered tag) |
| `tsc` / `tsc:client` | Typecheck the server / client projects |
| `test` / `test:backend` / `test:frontend` / `test:watch` | Vitest |
| `test:coverage` | Vitest with v8 coverage and global thresholds |
| `db:push` / `db:generate` / `db:studio` | Prisma CLI passthroughs |

## Tripwire for a future production deploy

`typescript`, `tsx`, `vite`, and `prisma` currently live in `devDependencies`,
which is the honest classification for a dev-only project. **Move them back to
`dependencies` the day a production deploy is added** — a prod install runs
`npm ci --omit=dev`, but the `postinstall` hook (`prisma generate && prisma db
push`) still runs and would fail without the Prisma CLI.

`playwright`, `@anthropic-ai/sdk`, and `zod` are already in `dependencies`,
because the server imports them at runtime (zod is the SDK's peer dependency
for its structured-output helper). Generated scripts also import `playwright`
from this project's `node_modules`. Its browser is not part of the npm package: a production machine also
needs `npx playwright install chromium`.

The production `express.static(dist)` mount and SPA fallback are also omitted; a
comment in `server/server.ts` marks the exact insertion point.
