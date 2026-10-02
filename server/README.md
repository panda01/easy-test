# server/

Express 5 API, written in TypeScript and run directly with `tsx watch` — there
is no build step in development.

## Layout

| Path | Holds |
|---|---|
| `bootEnv.ts` | Loads `.env.local` then `.env`. **Must be the first import of `server.ts`.** |
| `server.ts` | Entry point: middleware, route registration, guarded `listen`. Exports `app`. |
| `controllers/` | Route registrars. One file per API section. |
| `services/` | Stateless modules holding real logic, including the one Prisma client. |
| `utils/` | Small pure helpers with no I/O. |
| `prisma/` | `schema.prisma` and its docs. |
| `generated/` | Prisma client output. Gitignored, regenerated, never imported directly. |

## Conventions

- **`bootEnv.js` first.** ES modules evaluate imports depth-first before the
  importer's body runs, so a `dotenv.config()` call in `server.ts`'s body would
  execute *after* every imported module had already read `process.env`.
- **Explicit `.js` extensions on relative imports**, even in `.ts` source. The
  server project is `moduleResolution: "nodenext"`.
- **No `express.Router()`.** See `controllers/README.md`.
- **No `cors`.** The Vite dev server proxies `/api` to this process, so the
  browser only ever sees one origin.
- **No global error middleware.** Each route try/catches and returns
  `res.status(5xx).json({ error: message })`, so a failure reports the thing
  that actually failed instead of a generic handler's guess.
- **`app` is exported and `listen` is guarded** by `NODE_ENV !== "test"`, so
  supertest can import the app without binding a socket.
- Log lines are prefixed with a `[tag]`.
