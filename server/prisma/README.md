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
| `Website` | `websites` | A website a user wants to test: url, name, description. |

`Website`'s fields are camelCase and are **not** individually `@map`'d — only
the table name is mapped. Postgres therefore stores quoted mixed-case columns,
so hand-written SQL must quote them:

```sql
select "createdAt" from websites;   -- works
select createdAt from websites;     -- fails
```

## Workflow

Migrations are not used — this project is `db push` only. After any schema
change:

```sh
npx prisma db push
npx prisma generate
```

`npm install` runs both automatically via `postinstall`.
