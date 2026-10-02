# easy-test

Development scaffold: Express API + React/Vite frontend + Prisma/PostgreSQL.

The homepage says Hello World and displays the live result of `GET /api/health`,
which doubles as the end-to-end proof that the Vite `/api` proxy and the Express
server are both up.

**This project is development-only.** There is no production build, no PM2, no
Docker, and no CI.

## Stack

| Layer | Choice |
|---|---|
| Server | Express 5, run with `tsx watch` |
| Client | React 19 + Vite 7 + MUI 7 |
| Database | PostgreSQL 18 via Prisma 7 + `@prisma/adapter-pg` |
| Tests | Vitest (two projects: backend/node, frontend/jsdom) |
| Lint | ESLint flat config in TypeScript, `strictTypeChecked` |

## First-time setup

Requires Node 25.4.0 and a local PostgreSQL server.

```sh
createdb easy_test_dev
cp .env.example .env.local     # then edit if your postgres user is not your OS user
npm install                    # postinstall runs: prisma generate && prisma db push
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
| `lint` | `eslint server` |
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

The production `express.static(dist)` mount and SPA fallback are also omitted; a
comment in `server/server.ts` marks the exact insertion point.
