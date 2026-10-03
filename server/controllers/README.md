# server/controllers/

Route registrars. One file per API section.

| File | Routes |
|---|---|
| `health.ts` | `GET /api/health` |
| `websites.ts` | `GET`/`POST /api/websites`, `GET`/`PUT`/`DELETE /api/websites/:websiteId` |
| `useCases.ts` | `GET`/`POST /api/websites/:websiteId/use-cases`, `GET`/`PUT`/`DELETE /api/websites/:websiteId/use-cases/:useCaseId` |
| `actions.ts` | `GET`/`POST /api/websites/:websiteId/actions`, `GET`/`PUT`/`DELETE /api/websites/:websiteId/actions/:actionId` |
| `playwright.ts` | `GET`/`POST /api/websites/:websiteId/screenshot-runs`, `GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot` |
| `actionScripts.ts` | `GET`/`POST /api/websites/:websiteId/actions/:actionId/scripts`, `GET`/`POST .../scripts/:actionScriptId/runs`, `GET .../runs/:actionScriptRunId/failure-screenshot` |

## The convention

Each file exports a single `register<Section>Routes(app: Express): void` that
declares **full literal paths**:

```ts
export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => { ... });
}
```

`server.ts` calls each registrar in turn. Registration order is not significant.

**There is no `express.Router()` anywhere**, and that is deliberate: with full
literal paths, grepping for `"/api/health"` finds the route in one hop, rather
than requiring you to work out which prefix a router was mounted under.

Every route carries a JSDoc block with an `@route` tag naming the method and
path, a `@param` for each path parameter and body, and its `@returns` shape
including error statuses. `@route` is registered with eslint-plugin-jsdoc in
`eslint.config.ts`. Following the tsdoc preset, JSDoc carries **no `{Type}`
braces** - TypeScript already holds the types.

## CRUD route conventions

- **Status codes:** `201` + the row on create, `200` + the row on read/replace,
  `204` with no body on delete, `400 { error }` for an invalid body,
  `404 { error }` for a missing or soft-deleted row, `409 { error }` for a
  duplicate active website URL, `500 { error }` otherwise.
- **Replace, not patch:** `PUT` takes the full body; there is no `PATCH`.
- **Bodies are validated** by `../utils/validateRequestBodies.ts` before any
  query runs. Handlers pass `req.body` whole (it is `any`, and may be
  `undefined` in Express 5) rather than reading fields off it.
- **Deletes are soft.** See `../prisma/README.md`.
- **Nested routes check the parent first.** Use case, action, and screenshot
  run routes look up the website and answer `404 "Website not found"` before
  touching the child. Action script routes check every parent in order -
  website, action, script, run - and later lookups use the FOUND rows' ids.
- **Handlers leave `req`/`res` unannotated.** Express infers
  `req.params.websiteId` as `string` from the literal path; an explicit
  `Request` annotation widens params to `string | string[]`.
- **Errors go through `describeError`** (`../utils/describeError.ts`), so the
  "is it an Error?" branch lives in one tested place.

## The Playwright controller (`playwright.ts`)

`registerPlaywrightRoutes(app, screenshotDirectory)` takes a **second
argument**: the absolute screenshot directory, resolved once at boot by
`resolveScreenshotDirectory()` in `server.ts` (from `SCREENSHOT_DIR`), so tests
can point it at a fixture directory. The browser work itself lives in
`../services/playwrightService.ts`.

- **`POST .../screenshot-runs` answers `201` for a failed visit too.** An HTTP
  400+ page, a DNS error, a refused connection, or a timeout is still a
  successfully *recorded* run, with `succeeded: false`. That keeps the run's
  details in the response body (the client's `useJsonMutation` discards the body
  of any non-2xx response). Only infrastructure failures answer `500`: the
  directory cannot be created, the browser cannot launch, or a query fails.
  The request lasts as long as the visit — up to the 30 second navigation
  timeout plus the website's network idle cap.
- **The website row's timing settings drive the wait.** The POST passes the
  found website's `networkIdleTimeoutMs` and `screenshotMinimumWaitMs` to the
  service: wait for network idle (capped), then paint, and never screenshot
  sooner than the minimum after `load`. See `../services/README.md`.
- **File names come from the database row**, never the URL:
  `<website.id>/<random uuid>.png`, relative to the screenshot directory.
- **`GET .../screenshot` answers `image/png`** (errors are still JSON
  `{ error }`). It uses `res.sendFile(name, { root: screenshotDirectory }, cb)`:
  `root` makes `send` refuse a name that climbs out with `..`, and keeps a
  screenshot directory under a dot-folder working. Send errors arrive in the
  callback *after* the async handler returned, so the callback answers them
  itself: `404 "Screenshot file not found"` when the file is gone, `500`
  otherwise, and nothing at all when the response had already started.

## The action scripts controller (`actionScripts.ts`)

`registerActionScriptRoutes(app, actionScriptDirectory)` also takes the
directory as a second argument, resolved once at boot by
`resolveActionScriptDirectory()` in `server.ts` (from `ACTION_SCRIPT_DIR`), so
tests can point it at a fixture directory. Claude lives in
`../services/scriptGenerationService.ts`; running lives in
`../services/scriptRunnerService.ts`.

- **Scripts and runs are create-only.** There is no `PUT`, `PATCH`, or
  `DELETE` for them; converting again creates a new version. They are soft
  deleted only with their action or website.
- **`POST .../scripts` converts and saves.** It sends snapshots of the FOUND
  website (name, URL) and action (title, description) to Claude, stores the
  same snapshots on the script, and stores `findScriptRuleViolations(code)`
  as `ruleViolations` - warnings only, the script is saved either way. Extra
  status codes beyond the CRUD set:
  - `503 { error }` when `ANTHROPIC_API_KEY` is not configured (the server
    itself boots fine without it);
  - `502 { error }` when Claude declined (every model in the fallback chain),
    its reply hit the token limit, or the reply had no usable script.
  Known failures are recognized structurally (`name: "ScriptGenerationError"`
  plus a known `reason`); any other error - an Anthropic API error included -
  answers `500`. The request lasts as long as Claude takes.
- **`POST .../runs` answers `201` for a failed or timed-out run too**, like
  the screenshot POST, so the run reaches the client. Each run gets its own
  folder, `<website.id>/<random uuid>`, under the action script directory;
  `failureScreenshotFileName` is stored relative to it. Only infrastructure
  failures answer `500` (the folder cannot be written, node cannot start, a
  query fails). The request lasts as long as the script, at most 5 minutes
  plus a few seconds to stop it.
- **`GET .../failure-screenshot`** serves the PNG with the same
  `res.sendFile(name, { root }, cb)` pattern as the screenshot route (the
  shared `readSendErrorStatus` lives in `../utils/`): `404 "This run did not
  capture a failure screenshot"`, `404 "Failure screenshot file not found"`,
  `500` otherwise.
- **A dev server restart mid-request loses that request.** `tsx watch`
  restarting (any edit under `server/`) or `./stop-dev.sh` during a run drops
  the response, and the script keeps running on its own - a script waiting in
  `page.pause()` stays open until it is closed by hand.
