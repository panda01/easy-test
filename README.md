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

A website's page also has a **Crawls** section with a **Crawl website**
button. The server crawls the website in the **background** with a headless
Chromium on this machine: it starts at the website's URL and follows every
`<a href>` to another page on the same origin - **links only**, it never
clicks buttons or submits forms - breadth first, up to 50 pages or 10
minutes. Two links are the same page when their origin + path match (query
string and hash ignored). For every page it records Playwright's **aria
snapshot** (`page.locator("body").ariaSnapshot()`), the HTTP outcome, the
title, its same-site links, and the page whose link first led to it, so the
pages form a **tree** (`CrawledPage.parentPageId`). Clicking the button opens
the crawl's own page, which re-fetches every 2 seconds while it runs and
shows the "Site map" tree beside the selected page's snapshot. One crawl per
website runs at a time; a dev server restart ends a running crawl as
"interrupted". See `server/services/README.md` and `src/pages/README.md`.

A website can also have **Credentials** (name, description, username,
password, login page URL, and optional login form CSS selectors). Picking one
in the Crawls section's **Crawl as** dropdown makes the crawler **log in
first** - it finds the login form's fields itself unless the credential names
selectors - and record nothing until the login works; the run is then marked
`isLoggedIn` with that credential, and logout links are never followed. A
failed login ends the run "failed" with no pages, and the crawl's page shows
a screenshot of what the browser saw. The login page is only typed into once
it has loaded and waited out the website's own timing settings (network idle
cap and minimum wait), like every crawled page. After submitting, the crawler
gives the site time to answer: up to 15 s for the login form to go, the
sign-in's own requests to finish (capped by the network idle cap), and the
minimum wait - so a login is never judged while it still says "Signing in…".

A website can also have a **login page URL** (blank = it doesn't require
login). Its credentials inherit it unless they set their own, and a website
without one learns it from the first crawl that logs in with a credential's
own URL. The Credentials section and "Crawl as" only show when the website or
one of its credentials has a login URL.

A crawl can also **click buttons**, picked in the Crawls section's
**Buttons** dropdown: "Links only (no buttons)" (the default), "Buttons,
except risky ones", or "Only “Open” buttons". A click only counts when it
lands on another page of the same site, which is then crawled like a link
and shown as "via “Open Yoga”". Risky buttons - create, delete, update, log
out, pay, confirm, and similar (the full list is in
`server/services/README.md`) - and unlabelled or disabled ones are never
clicked. Passwords are stored
**encrypted** (AES-256-GCM) with `CREDENTIAL_ENCRYPTION_KEY` from `.env.local`
and are never sent back to the browser; see `.env.example` for how to
generate the key.

An action can be linked to one of the website's credentials (**Log in as**
on its create / edit form): every run of it then **logs in first** with the
crawler's own login routine. Deleting the credential unlinks it.

An action's page has **Model** and **Effort** dropdowns and a **Convert to
script** button. The dropdowns list every Claude model Anthropic's Models API
offers (live, so new models appear on their own) and exactly the effort levels
the chosen one supports ("Standard" for models without an effort setting);
they start on Claude Opus 5.5 at high. The server picks the crawled pages
most relevant to the action - the newest crawl done the same way the action
runs (logged in as its credential, or logged out); the start page plus the
pages whose URL, title, and aria snapshot repeat the action's own words most
(stop words dropped) - and sends the action, the website's name and URL, the
credential's NAME (never its username or password), and those pages' **aria
snapshots** to the chosen model, with the plan-writing guidelines in
`server/prompts/actionPlanGuidelines.md` used verbatim as the system prompt
(prompt-cached). If the model declines, the API retries on its fallback
(Claude Opus 4.8 where allowed) inside the same call. Claude answers with a
summary, its assumptions, and a **JSON step plan** - `{ name, startUrl,
steps: [{ action, target, value }] }` - whose actions can only come from a
fixed list of things a user can do with a mouse and keyboard (click, fill,
press, check, selectOption, expectVisible, ...); structured outputs enforce
that list and the server re-checks every rule. The page shows each version's
summary, assumptions, steps, the pages Claude was shown, and the plan JSON.
**Edit steps** opens a step editor - drag steps (mouse or keyboard) or use the
up/down buttons, add, change, or delete steps - and **Save as new version**
saves the result as a new version ("Edited from Version K"); every version
is **immutable**. **Run script** runs the selected version **inside the
server**, opening a **visible browser window on this machine**: it logs in
first when the action has a credential, opens the start URL, and walks the
steps through a fixed `switch` of allowed Playwright calls - the plan is
never turned into code, so nothing outside the list can run. `fill` types
like a person (never `.fill()`), and the placeholders
`{{credential.username}}` / `{{credential.password}}` are filled in at run
time only, never stored, logged, or sent to Claude. A run records pass/fail
("Failed at step N" and why), who it logged in as, the step log, and a
failure screenshot, plus the URL and aria snapshot of the page it failed on,
and is stopped after **5 minutes**. A **failed** run of a version Claude
wrote shows a **Refine** button with an optional **Note for Claude**: it
sends the run's error, failed step, step log, failure screenshot, and
failing-page snapshot, with the version's plan, summary, assumptions, the
same crawled pages, and the note, to **the same model and effort** that wrote
the version, and saves the reply as a new version ("Refined from Version K").
Refine is hidden on passing runs and on edited versions (no model wrote
them). Each refinement is recorded as a link between the source version, the
failed run, and the new version, with the note, the call's token usage, and
whether the screenshot was sent. A version generated
from a title, description, or credential the action no longer has is marked
**Out of date**, and **Compare versions** shows any two versions side by
side: the title, description, and plan JSON, with changed lines and words
highlighted. Without `ANTHROPIC_API_KEY` the server still boots, and the
model list and conversion answer 503.
See `server/controllers/README.md` and `server/services/README.md`.

Development runs on `npm run dev`. A production build runs under pm2 with
`npm start` (see **Production** below). There is no Docker and no CI.

## Stack

| Layer | Choice |
|---|---|
| Server | Express 5, run with `tsx watch` in development; compiled to `dist-server/` and run by pm2 in production |
| Client | React 19 + Vite 7 + MUI 7 |
| Database | PostgreSQL 18 via Prisma 7 + `@prisma/adapter-pg` |
| Tests | Vitest (two projects: backend/node, frontend/jsdom) |
| Lint | ESLint flat config in TypeScript, `strictTypeChecked` + eslint-plugin-jsdoc `recommended-tsdoc-error` |

## First-time setup

Requires Node 25.4.0 and a local PostgreSQL server.

```sh
createdb easy_test_dev
cp .env.example .env.local     # then edit if your postgres user is not your OS user
npm install                    # postinstall: prisma generate, prisma db push, playwright install chromium
```

`postinstall` also installs the Chromium build that this project's
`playwright` version expects: the full browser, which the plan runner opens
headed, and the headless shell, which screenshots and crawls use. It does
nothing when that build is already installed.

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

## Production

```sh
npm i                # installs everything, including pm2 and the Chromium build
npm start            # builds the client and server, then starts them under pm2
npm run logs         # tail the pm2 logs (Ctrl-C to stop tailing)
npm run stop         # stop the app (pm2 keeps it listed; `npm start` brings it back)
npm run restart      # restart WITHOUT rebuilding
```

Then verify:

```sh
curl http://localhost:3011/api/health
open http://localhost:3011/
```

`npm start` runs `build:prod` (`vite build` into `dist/`, then `build:server`)
and then `pm2 start ecosystem.config.json --env production`. `build:server`
empties `dist-server/`, compiles the server with `tsc --project
tsconfig.server.json`, and copies `server/prompts/` next to the compiled
services, because `scriptGenerationService` reads its prompt file relative to
its own location. Running `npm start` again while the app is up rebuilds and
restarts it.

`ecosystem.config.json` runs `dist-server/server/server.js` as the pm2 app
`easy-test` with `NODE_ENV=production` and `SERVER_PORT=3011`. Both override
`.env` and `.env.local`, because dotenv never overwrites a key that is already
set; every other key (`DATABASE_URL`, `SCREENSHOT_DIR`, ...) comes from those
files as in development. pm2 restarts the app 1 second after a crash, and
gives up after 10 restarts in a row that each crash within a second of
starting, such as a missing required setting.

In production one process serves everything: Express serves `dist/` as static
files, and any other GET or HEAD outside `/api` answers `dist/index.html`, so
reloading a client route works. Nothing listens on a Vite port.

Things to know:

- **Production and development share the database and the directories.**
  Both read `DATABASE_URL`, `SCREENSHOT_DIR`, and `ACTION_SCRIPT_DIR` from the
  same `.env` files. Each server marks every `running` crawl as interrupted
  when it boots, so starting one ends a crawl the other is running.
- **Plan runs open a visible Chromium window** (`headless: false`) on the
  machine pm2 runs on, the same as in development.
- **The pm2 version is pinned in `package.json`** (`pm2` 7, a dependency). If
  a pm2 daemon from an older global install is already running, pm2 prints an
  "In-memory PM2 is out-of-date" warning. Everything still works; `npx pm2
  update` restarts the daemon on the project's version.
- **`npm run tsc` also writes `dist-server/`**, without the prompts. Run
  `npm start` (or `npm run build:server`) before relying on that folder.

## Ports

`SERVER_PORT=3010`, `VITE_PORT=5180`. Chosen to avoid every other project on
this machine (new_plex 3001/5174, theerp 3004/3005, apply-for-me 4000/4173,
forge-gym 6100/6101) and Vite's own default 5173. Production (`npm start`) uses
`3011`, set in `ecosystem.config.json`. `5181` stays reserved and unused,
because production has no Vite server.

Vite runs with `strictPort: true`, so a collision fails loudly rather than
silently drifting to another port.

## Environment

`.env` holds committed non-secret defaults. `.env.local` is gitignored and
**wins** — `server/bootEnv.ts` loads it first, and dotenv never overwrites a key
that is already set. `.env.example` documents every key.

| Key | Used for |
|---|---|
| `SERVER_PORT` / `VITE_PORT` | The two dev ports (see above). Production's `SERVER_PORT=3011` comes from `ecosystem.config.json`. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `SCREENSHOT_DIR` | Where screenshot PNGs are written and served from. Required; default `screenshots` (gitignored). A relative path resolves against the project root; `~` is not expanded. |
| `ACTION_SCRIPT_DIR` | Where each plan run's folder (`failure.png` when it fails) is written, and where `uploadFile` steps pick files from (its `uploads/` folder). Required; default `action-scripts` (gitignored). Must be **inside the project**, or the server refuses to start. |
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
| `build` | `vite build` into `dist/` |
| `build:server` | Empty `dist-server/`, compile the server into it, copy `server/prompts/` beside it |
| `build:prod` | `build`, then `build:server` |
| `start` | `build:prod`, then start (or restart) the pm2 app `easy-test` on :3011 |
| `stop` / `restart` / `logs` | `pm2 stop` / `pm2 restart` / `pm2 logs` for `easy-test` |
| `lint` | `eslint server src` — TypeScript rules plus JSDoc rules (TSDoc style: no `{Type}` braces; `@route` is a registered tag) |
| `tsc` / `tsc:client` | Typecheck the server / client projects |
| `test` / `test:backend` / `test:frontend` / `test:watch` | Vitest |
| `test:coverage` | Vitest with v8 coverage and global thresholds |
| `db:push` / `db:generate` / `db:studio` | Prisma CLI passthroughs |

## Continuous integration

`.github/workflows/tests.yml` runs on every push to `master`. It sets up Node
from `engines.node` in `package.json`, runs `npm ci`, then runs
`npm run test:coverage`. That runs every backend and frontend test and enforces
the coverage thresholds, so a failing test or a threshold miss fails the run.

The job starts its own throwaway PostgreSQL 18 service and points
`DATABASE_URL` at it. `npm ci` triggers `postinstall`, and the `prisma db push`
in it needs a live database. The tests themselves never touch it, because every
spec mocks the database layer. SQLite was tried in CI and rejected: the schema's
`String[]` fields are Postgres-only.

## Dependencies

`typescript`, `tsx`, `vite`, and `prisma` are in `dependencies`, because the
production build and the `postinstall` hook use them. `pm2` is there too, so
`npm start` uses the project's own pm2 and needs no global install.

The production install is a full `npm i`, not `npm ci --omit=dev`: the build
also needs devDependencies (`@vitejs/plugin-react` for `vite build`, and the
`@types/*` packages for `tsc`).

`playwright`, `@anthropic-ai/sdk`, and `zod` are in `dependencies` because the
server imports them at runtime (zod is the SDK's peer dependency for its
structured-output helper). `diff` (jsdiff, ships its own types) is a client
dependency used by the version comparison page. `@dnd-kit/core`,
`@dnd-kit/sortable`, and `@dnd-kit/utilities` (drag-and-drop in the plan step
editor) and `@mui/icons-material` (pinned to v7, matching `@mui/material`;
imported per icon path) ship their own types. Playwright's browser is not part
of the npm package; `postinstall` installs it (`playwright install chromium`).
