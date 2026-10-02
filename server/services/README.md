# server/services/

Stateless modules holding the real logic. Controllers stay thin and delegate
here; services never touch `req`/`res`.

| File | Owns |
|---|---|
| `dbService.ts` | The one `PrismaClient` for the process, and all `Website` queries. |

## dbService is the only database door

The `PrismaClient` and its `PrismaPg` adapter are **module-private** — neither
is exported. Every database access in the app goes through one of the named
functions (`createWebsite`, `listWebsites`, `findWebsiteByUrl`,
`deleteWebsiteByUrl`).

That is also why app code must never import from `../generated/prisma/`
directly. See `../prisma/README.md`.

`dbService.ts` reads `DATABASE_URL` **at module load time**, so anything that
imports it must import `server/bootEnv.js` first. `server.ts` does; a standalone
script must do the same.

Nothing routes to it yet — the `Website` table has no API surface so far. It is
here as the anchor the first website route will build on, and it is covered by
`tests/backend/services/dbService.test.ts`.
