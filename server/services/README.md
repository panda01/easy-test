# server/services/

Stateless modules holding the real logic. Controllers stay thin and delegate
here; services never touch `req`/`res`.

| File | Owns |
|---|---|
| `dbService.ts` | The one `PrismaClient` for the process, and every `Website`, `UseCase`, and `Action` query. |

## dbService is the only database door

The `PrismaClient` and its `PrismaPg` adapter are **module-private** — neither
is exported. Every database access in the app goes through one of the named
functions:

| Model | Functions |
|---|---|
| Website | `createWebsite`, `listWebsites`, `findWebsiteById`, `findWebsiteByUrl`, `updateWebsite`, `softDeleteWebsite` |
| UseCase | `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite` |
| Action | `listActionsForWebsite`, `findActionForWebsite`, `createActionForWebsite`, `updateActionForWebsite`, `softDeleteActionForWebsite` |
| Errors | `isUniqueConstraintViolation` (P2002), `isRecordNotFound` (P2025) |

That is also why app code must never import from `../generated/prisma/`
directly. See `../prisma/README.md`.

## Rules the functions follow

- **Every read and write filters `deletedAt: null`.** A soft-deleted row is
  invisible: `find*` returns null, `update*` returns null, `softDelete*`
  returns false.
- **Children are always scoped to their website.** Use case and action
  queries match on `websiteId` as well as `id`, so an id from another website
  never matches.
- **`update*` is a single atomic `update`** whose `where` includes
  `deletedAt: null`; a P2025 "no row matched" becomes `null`. A row deleted a
  moment earlier cannot be edited back to life.
- **`softDeleteWebsite` is one interactive transaction:** it stamps the website
  and its active use cases and actions with the same `deletedAt`.
- **Prisma errors are recognised structurally** (an object with a matching
  `code`), so controllers can map them to HTTP statuses without importing the
  generated error classes, and unit tests can throw plain objects.

`dbService.ts` reads `DATABASE_URL` **at module load time**, so anything that
imports it must import `server/bootEnv.js` first. `server.ts` does; a standalone
script must do the same.
