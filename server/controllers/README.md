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
| `scriptModels.ts` | `GET /api/script-models` |
| `crawlRuns.ts` | `GET`/`POST /api/websites/:websiteId/crawl-runs`, `GET .../crawl-runs/:crawlRunId`, `GET .../crawl-runs/:crawlRunId/pages/:crawledPageId`, `GET .../crawl-runs/:crawlRunId/login-failure-screenshot` |
| `credentials.ts` | `GET`/`POST /api/websites/:websiteId/credentials`, `GET`/`PUT`/`DELETE /api/websites/:websiteId/credentials/:credentialId` |

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
  duplicate active website URL (or a crawl that is already running),
  `503 { error }` for a missing server key (`ANTHROPIC_API_KEY`,
  `CREDENTIAL_ENCRYPTION_KEY`), `500 { error }` otherwise.
- **Replace, not patch:** `PUT` takes the full body; there is no `PATCH`.
- **Bodies are validated** by `../utils/validateRequestBodies.ts` before any
  query runs. Handlers pass `req.body` whole (it is `any`, and may be
  `undefined` in Express 5) rather than reading fields off it.
- **Deletes are soft.** See `../prisma/README.md`.
- **Nested routes check the parent first.** Use case, action, screenshot run,
  and crawl run routes look up the website and answer `404 "Website not
  found"` before touching the child. Action script routes check every parent in order -
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
- **`POST .../scripts` converts and saves.** Its JSON body is
  `{ modelId, effort }` (`validateScriptModelChoiceInput`). The model must be
  in the live catalog (`findScriptModel`) and the level one it offers - or
  null for a model with no effort setting (module-private
  `resolveEffortForModel`); otherwise `400` with a message naming what the
  model offers. It sends snapshots of the FOUND website (name, URL) and
  action (title, description) to Claude, stores the same snapshots on the
  script, stores the model that answered (`modelId`) and the level sent
  (`effort`), and stores `findScriptRuleViolations(code)` as
  `ruleViolations` - warnings only, the script is saved either way. Extra
  status codes beyond the CRUD set:
  - `503 { error }` when `ANTHROPIC_API_KEY` is not configured (the server
    itself boots fine without it);
  - `502 { error }` when Claude declined (every model in the fallback chain),
    its reply hit the token limit, or the reply had no usable script.
  Known failures are mapped by `statusForScriptGenerationFailure`
  (`../utils/`), structurally (`name: "ScriptGenerationError"` plus a known
  `reason`); any other error - an Anthropic API error included - answers
  `500`. The request lasts as long as Claude takes.
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

## The crawl runs controller (`crawlRuns.ts`)

`registerCrawlRunRoutes(app, screenshotDirectory)` starts and reads back
crawls; the crawling itself lives in `../services/crawlerService.ts`, the
background orchestration in `../services/crawlRunService.ts`. Like the
Playwright routes it takes the screenshot directory (`SCREENSHOT_DIR`,
resolved at boot): a failed login's screenshot is written there.

- **`POST .../crawl-runs` answers `201` at once** with the new run
  (`status: "running"`); the crawl carries on in the background (up to 50
  pages and 10 minutes). The body is optional: `{ credentialId }` crawls
  logged in as one of the website's credentials, while no body, `{}`, or
  `credentialId: null` crawls logged out; `buttonMode` (`linksOnly` -
  the default, `allButRisky`, or `openOnly`) picks which buttons the crawl
  clicks, and an unknown mode answers `400`. A credential with no login page
  URL of its own on a website that has none answers `400` "This credential
  has no login page URL, and neither does the website". `400` for a `credentialId` that is
  not a non-blank string, `404 "Credential not found"` for one that is not
  the website's (or was deleted), `503` when a credential was chosen but
  `CREDENTIAL_ENCRYPTION_KEY` is not configured. A second POST while a crawl
  of the same website is running answers `409 "A crawl is already running
  for this website"` and starts nothing. `500` when the run cannot be created
  or the saved password cannot be decrypted (the key changed).
- **Logged-in crawls log in first.** The crawler records no page until the
  login worked, then sets the run's `isLoggedIn: true` - so every page of a
  run with `isLoggedIn: true` was viewed logged in. A failed login ends the
  run `failed` with `Login as "<name>" failed: <reason>` and no pages, and
  the crawler screenshots what the browser showed at that moment:
  `loginFailureScreenshotFileName` (`<websiteId>/<uuid>.png`, relative to the
  screenshot directory) is set on the run, and
  **`GET .../crawl-runs/:crawlRunId/login-failure-screenshot`** serves the PNG
  (sent with `root` = the screenshot directory, so a stored name cannot climb
  out of it; `404` when the run has none or the file is gone). Every run read
  carries `credentialId`, `isLoggedIn`, `loginFailureScreenshotFileName`, and
  `credential: { id, name }` (null for a logged-out crawl).
- **`GET .../crawl-runs/:crawlRunId`** answers the run plus `pages`: its page
  summaries in visiting order (the tree, via `parentPageId`) **without** each
  page's `ariaSnapshot` and `linkedUrls`, because the UI polls it every 2
  seconds while the crawl runs. `404 "Crawl run not found"` for a missing run.
- **`GET .../pages/:crawledPageId`** answers one page in full, snapshot and
  links included. `404 "Crawled page not found"` for a missing page. Checks
  website, then run, then page, and later lookups use the FOUND rows' ids.
- **Runs and pages are create-only from the API's point of view**: there is
  no `PUT` or `DELETE`. They are soft deleted with their website.
- **A dev server restart interrupts a running crawl.** `tsx watch` restarting
  sends SIGTERM; Playwright closes the crawl's browser, and the crawl finishes
  the run as `interrupted` before the process exits. A run left `running` by a
  killed process is marked `interrupted` at the next boot.

## The credentials controller (`credentials.ts`)

A credential is a username and password for one website, used to crawl it
logged in. CRUD like use cases (website checked first, soft deletes), with
these differences:

- **The password goes in, never out.** POST and PUT take `password`; it is
  encrypted with `CREDENTIAL_ENCRYPTION_KEY` (`../utils/credentialEncryption.ts`)
  before it is stored. No response contains `password` or `encryptedPassword` -
  only `hasPassword: true`.
- **PUT keeps the saved password** when `password` is left out, null, or `""`
  (the client never receives it to send back) - the one exception to "PUT
  replaces".
- **`503`** when a password must be encrypted (POST, or a PUT with a new
  password) and `CREDENTIAL_ENCRYPTION_KEY` is missing or not 32 bytes of
  base64. Listing, reading, deleting, and a PUT that keeps the password work
  without the key.
- **The login page URL is inherited.** A credential's `loginUrl` is an
  optional override; null/blank uses the website's `loginUrl`. POST and PUT
  answer `400` "A login page URL is required - this website doesn't have one
  yet" only when neither the body nor the website has one.
- **Body rules:** see `../utils/README.md`.

## The script models controller (`scriptModels.ts`)

`GET /api/script-models` answers `{ models, defaultModelId, defaultEffort }`
from the live Models API (`../services/scriptModelService.ts`): every model
with structured outputs, newest first, each with its effort levels (empty for
"Standard"), whether it takes adaptive thinking, and its fallback. The
defaults are Claude Opus 5.5 at `high` when listed (both null when no model
is usable). Without `ANTHROPIC_API_KEY` it answers `503`, like a conversion.
