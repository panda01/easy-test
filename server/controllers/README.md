# server/controllers/

Route registrars. One file per API section.

| File | Routes |
|---|---|
| `health.ts` | `GET /api/health` |
| `websites.ts` | `GET`/`POST /api/websites`, `GET`/`PUT`/`DELETE /api/websites/:websiteId`, `POST /api/websites/:websiteId/login-check`. The list answers each website with the dashboard's `summary: { actionCount, passedActionCount, failedActionCount, notRunActionCount, latestRunAt, latestCrawlRun }`. POST (create) waits for the login-form check (see below) and answers the website plus `loginCheck` |
| `useCases.ts` | `GET`/`POST /api/websites/:websiteId/use-cases`, `GET`/`PUT`/`DELETE /api/websites/:websiteId/use-cases/:useCaseId` |
| `actions.ts` | `GET`/`POST /api/websites/:websiteId/actions`, `GET`/`PUT`/`DELETE /api/websites/:websiteId/actions/:actionId` (body `{ title, description, userActionKind, userObjectTypeKey, userNameParameterKey, credentialId, loginUrl, usernameSelector, passwordSelector, submitSelector }`; each role choice null / left out means "detect". The **Login** action - at most one per website: a second answers `409 This website already has a login action: "<title>"` - needs a login page (its own `loginUrl` or the website's), may have the three selectors, and has no credential; any other action may only name one of the website's credentials as the one it runs as (`credentialId`). Deleting the Login action, or changing its kind, is allowed: the others keep their credentials). Every action carries `credential: { id, name }` (the credential it runs as) or null. The list answers each action with `newestScript: { id, versionNumber, actionTitle, actionDescription, credentialId, latestRun }` (or null when it has no versions) for its status, version, and "Out of date" tag, and every action (list and single) with its cleanup links `deleteAction` / `createActions` (read from the website's `ActionCleanup` rows in one query). A single action (GET, POST, PUT) also carries `objectRole`: its kind (`parameters` / `create` / `read` / `update` / `delete` / `login`) and object type, with the detections and how sure they are (see `../utils/scoreActionObjectRole.ts`). A PUT syncs the action's parameters. `POST .../actions/:actionId/delete-action/proposal` asks Claude for the Delete action that cleans up after a Create action (`{ title, description, modelId }`, nothing saved; 409 for a non-Create or already linked action); `POST .../actions/:actionId/delete-action` (body `{ title, description }`) creates it with `userActionKind: "delete"`, the Create action's Login action and resolved type, links the two, and syncs it. Deleting a Login action unlinks the actions that log in with it |
| `loginRuns.ts` | `GET`/`POST /api/websites/:websiteId/actions/:actionId/login-runs` and `GET .../login-runs/:loginRunId/screenshot`: a Login action's "Run login" (see below) |
| `playwright.ts` | `GET`/`POST /api/websites/:websiteId/screenshot-runs`, `GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot` |
| `actionScripts.ts` | `GET`/`POST /api/websites/:websiteId/actions/:actionId/scripts`, `POST .../scripts/:actionScriptId/edits`, `GET`/`POST .../scripts/:actionScriptId/runs`, `GET .../runs/:actionScriptRunId` (one run for the run page, with its `screenshots`), `GET .../runs/:actionScriptRunId/failure-screenshot`, `GET .../runs/:actionScriptRunId/screenshots/:screenshotId`, `POST .../runs/:actionScriptRunId/refinements` (body `{ note }`, optional). Every version answered carries `latestRun` (`{ id, succeeded, failedStepNumber, timedOut, createdAt }` of its newest run, or null). A run takes an optional body `{ parameterValues, cleanUpAfterwards }` (values by parameter key - see below; the flag defaults to true) and answers with the run plus `createdObject`, `deletedObjects`, `cleanupRun` (the Delete action's run that cleaned up after a Create run) and `cleanedUpRun`; a Create run whose cleanup failed or could not start (no Delete action, or no version of it) is recorded as failed, and refining such a run is refused (409) in favour of the Delete action's run. Convert also converts a Create action's linked Delete action when it has no version yet (answered as `deleteActionScript`, with `deleteActionConversionError` when that second call failed). Convert, edit, and refine sync the action's parameters afterwards, and refine puts the failed run's values back into the plan it sends |
| `autoRefineJobs.ts` | `POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/auto-refine-jobs` (body `{ parameterValues }`, optional; answers `201` at once with the running job), `GET /api/websites/:websiteId/actions/:actionId/auto-refine-jobs` (newest first), `GET .../auto-refine-jobs/:autoRefineJobId` (polled while the job runs), `POST .../auto-refine-jobs/:autoRefineJobId/stop`. The shared website / action / script lookups these routes and the action script routes both use live in `actionLookups.ts` |
| `actionParameters.ts` | `GET`/`POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters` (a version's parameters view `{ role, parameters, objectChoices, confirmStepNumber, nameParameterKey, bindableTexts, warnings }`; POST adds one of the user's own - `{ addKind: "value", ... }` or `{ addKind: "field", ... }`), `PUT`/`DELETE /api/websites/:websiteId/actions/:actionId/parameters/:parameterKey` (change a parameter's `userLabel` / `userRequiredChoice`; remove one the user added) |
| `createdObjects.ts` | `GET /api/websites/:websiteId/created-objects` (the record of objects Create runs made), `DELETE .../created-objects/:createdObjectId` (remove one from the record) |
| `webObjects.ts` | `GET /api/websites/:websiteId/web-objects`, `PUT .../web-objects/:webObjectId` (rename) |
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

The routes keep the name "scripts", but each version is now a **JSON step
plan** `{ name, startUrl, steps: [{ action, target, value }] }` (see
`../utils/actionPlanSchema.ts`), never code.
`registerActionScriptRoutes(app, actionScriptDirectory)` also takes the
directory as a second argument, resolved once at boot by
`resolveActionScriptDirectory()` in `server.ts` (from `ACTION_SCRIPT_DIR`), so
tests can point it at a fixture directory: run folders and failure
screenshots live there, and `uploadFile` steps pick files from its
`uploads/` folder. Claude lives in `../services/scriptGenerationService.ts`;
running lives in `../services/actionPlanRunnerService.ts`.

- **Versions, runs, and refinements are create-only.** There is no `PUT`,
  `PATCH`, or `DELETE` for them; converting again, saving an edit, or
  refining a failed run creates a new version. They are soft deleted only
  with their action or website.
- **Every version JSON carries `refinement`** (list, convert, edit, and
  refine alike): `null`, unless the version was refined from a failed run.
  Then it is the refinement row - `id`, `websiteId`, `actionId`,
  `sourceActionScriptId`, `actionScriptRunId`, `refinedActionScriptId`,
  `note`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`,
  `cacheCreationInputTokens`, `screenshotWasSent`, and the timestamps - plus
  `actionScriptRun: { id, errorMessage, failedStepNumber, timedOut,
  failingPageAriaSnapshot }`, JOINED from the failed run
  (`ACTION_SCRIPT_REFINEMENT_INCLUDE` in dbService). The row never copies the
  run's error or step, nor the version's `modelId` / `effort`: one source of
  truth for each.
- **Every version JSON also carries `latestRun`** (list, convert, edit, and
  refine alike): `{ id, succeeded, createdAt }` of the version's newest
  active run, or `null` when it has not been run - a new version is always
  `null`. It drives the versions list's pass / fail / not run icon. The JSON
  never carries a `runs` list; the runs themselves come from `GET .../runs`.
- **The allowed origins** of a plan are the website URL's and the login
  URLs' (the website's and its Login action's), from
  `buildAllowedPlanOrigins`. A plan's `startUrl` and every `goto` must stay
  on them - checked when Claude answers, when an edit is saved, and again
  before every run.
- **`POST .../scripts` converts and saves.** Its JSON body is
  `{ modelId, effort }` (`validateScriptModelChoiceInput`). The model must be
  in the live catalog (`findScriptModel`) and the level one it offers - or
  null for a model with no effort setting (module-private
  `resolveEffortForModel`); otherwise `400` with a message naming what the
  model offers. It picks the crawled pages Claude is shown
  (`findLatestCrawledPagesForWebsite`, then `extractActionSearchTerms` +
  `selectRelevantCrawledPages`), sends snapshots of the FOUND website (name,
  URL), action (title, description), and the NAME of the credential it runs
  as to Claude, and stores the same snapshots on the version, plus the
  validated `plan`, the pages' URLs (`contextPageUrls`), the model that
  answered (`modelId`), and the level sent (`effort`). Extra status codes
  beyond the CRUD set:
  - `503 { error }` when `ANTHROPIC_API_KEY` is not configured (the server
    itself boots fine without it);
  - `502 { error }` when Claude declined (every model in the fallback chain),
    its reply hit the token limit, or the reply was not a valid plan.
  Known failures are mapped by `statusForScriptGenerationFailure`
  (`../utils/`), structurally (`name: "ScriptGenerationError"` plus a known
  `reason`); any other error - an Anthropic API error included - answers
  `500`. The request lasts as long as Claude takes.
- **`POST .../scripts/:actionScriptId/edits` saves an edited plan as a NEW
  version.** Body `{ plan }` (`validateActionPlanEditInput`, which applies
  every plan rule - the lookups come first because the rules need the
  website's origins). The new version copies its source's snapshots,
  summary, assumptions, and context pages, names the source in
  `editedFromActionScriptId`, and has null `modelId` / `effort`. `400` lists
  every problem.
- **`POST .../runs` answers `201` for a failed or timed-out run too**, like
  the screenshot POST, so the run reaches the client. Before running:
  - `409` when this action already has a run in progress (a module `Set`,
    claimed before the first await - one visible browser per action);
  - `409` for a Login action (it has no steps - `POST .../scripts` and
    refine answer the same);
  - for an action that runs as a credential: `503` when
    `CREDENTIAL_ENCRYPTION_KEY` is not configured, `409` when that
    credential no longer exists (`ACTION_CREDENTIAL_MISSING_MESSAGE`) or the
    website has no Login action (`WEBSITE_HAS_NO_LOGIN_ACTION_MESSAGE`), `400` when
    neither the Login action nor the website has a login page URL;
  - `409` when the stored plan no longer passes the rules (e.g. the website
    URL changed), or types a credential placeholder while the action runs
    logged out.
  Each run gets its own folder, `<website.id>/<random uuid>`, under the
  action script directory; `failureScreenshotFileName` and every step
  screenshot's `fileName` (`start-page.png`, `logged-in.png`,
  `step-003.png`) are stored relative to it, and `credentialName` names who
  it logged in as. A failed run also
  stores `failingPageUrl` and `failingPageAriaSnapshot` - where the browser
  was, and what a screen reader saw there (both scrubbed of the credential's
  values, the snapshot capped), or null when they could not be read; every
  run JSON carries both fields. Only infrastructure
  failures answer `500` (the password cannot be decrypted, the folder cannot
  be written, the browser cannot start, a query fails). The request lasts as
  long as the run, at most 5 minutes plus a few seconds to stop it.
- **`GET .../runs/:actionScriptRunId`** answers one active run for the run
  page (`findActionScriptRunDetailForScript`): the run, `createdObject`,
  `deletedObjects`, `cleanupRun`, `cleanedUpRun`, and `screenshots` - its
  active step screenshots by `position`, each `{ id, position, moment,
  stepNumber, fileName, errorMessage, pageUrl, ... }`; `404 "Script run not
  found"` when it is missing, deleted, or belongs to another script. The run
  list does NOT carry `screenshots`, so it stays light.
- **`GET .../failure-screenshot`** serves the PNG through
  `sendStoredImageFile` (`../utils/`: `res.sendFile(name, { root }, cb)`,
  with the shared `readSendErrorStatus`): `404 "This run did not capture a
  failure screenshot"`, `404 "Failure screenshot file not found"`, `500`
  otherwise.
- **`GET .../runs/:actionScriptRunId/screenshots/:screenshotId`** serves one
  step screenshot's PNG the same way. The row is found by id, scoped to the
  run (`findActionScriptRunScreenshotForRun`), and the file sent is the one
  the row names - never a path from the URL: `404 "Step screenshot not
  found"`, `404 "This step screenshot could not be taken during the run"`
  (the row has an `errorMessage` and no file), `404 "Step screenshot file
  not found"`, `500` otherwise.
- **`POST .../runs/:actionScriptRunId/refinements` refines a failed run**
  into a new version with the model that wrote the run's version. The body
  is optional: `{ note }` (`validateActionPlanRefineInput`) - text, trimmed,
  blank becomes null, at most 2000 characters. Checks, in order:
  - `400` for a bad body (before any lookup, like convert);
  - `404` for a missing website, action, version, or run (`"Script run not
    found"`);
  - `409` when the run passed or recorded no error, when the version was
    saved from the step editor (`modelId` null - no model wrote it), when
    this run is already being refined (a module `Set` keyed by run id,
    claimed with no await after the check and released in `finally`), and
    when the source model is no longer in the live catalog ("convert the
    action again");
  - then `503` / `502` / `500` from `statusForScriptGenerationFailure`, the
    same as convert.

  Claude is shown the SOURCE version's snapshots (like the edit route), the
  action's current allowed origins, the crawled pages the source version was
  shown (`selectContextPagesByUrl` over the newest crawl done the way it
  ran, falling back to `selectRelevantCrawledPages` when none are left), the
  source summary, assumptions, and plan, the run's error, step, time-out
  flag, step log, and failing page, the failure screenshot as base64
  (module-private `readFailureScreenshotAsBase64`: null when the run has
  none, when the stored name would leave the action script directory, or
  when the file is gone - then the refine goes ahead without it and records
  `screenshotWasSent: false`), and the note. The effort is the source
  version's when the model still offers it, otherwise `chooseEffortForModel`.
  `201` answers the new version (its own `modelId` / `effort` are the
  refining call's, `editedFromActionScriptId` is null, `contextPageUrls` are
  the pages actually sent) with its `refinement`; the version and its
  refinement row are ONE nested write (`createRefinedActionScriptForAction`).
  A failed Claude call writes nothing. The request lasts as long as Claude
  takes.
- **A dev server restart mid-request loses that request.** The browser runs
  inside the server process now, so `tsx watch` restarting (any edit under
  `server/`) or `./stop-dev.sh` during a run closes its window and records
  nothing.

## The crawl runs controller (`crawlRuns.ts`)

`registerCrawlRunRoutes(app, screenshotDirectory)` starts and reads back
crawls; the crawling itself lives in `../services/crawlerService.ts`, the
background orchestration in `../services/crawlRunService.ts`. Like the
Playwright routes it takes the screenshot directory (`SCREENSHOT_DIR`,
resolved at boot): a failed login's screenshot is written there.

- **`POST .../crawl-runs` answers `201` at once** with the new run
  (`status: "running"`); the crawl carries on in the background (up to 50
  pages and 10 minutes). The body is optional: `{ credentialId }` crawls
  logged in as one of the website's credentials, through the website's
  Login action, while no body, `{}`, or `credentialId: null` crawls logged
  out; `buttonMode` (`linksOnly` - the default, `allButRisky`, or
  `openOnly`) picks which buttons the crawl clicks, and an unknown mode
  answers `400`. A Login action with no login page URL of its own on a
  website that has none answers `400`. `400` for a `credentialId` that is
  not a non-blank string, `404 "Credential not found"` for one that is not
  one of the website's credentials (or was deleted), `409` when the website
  has no Login action, `503` when one was chosen but
  `CREDENTIAL_ENCRYPTION_KEY` is not configured. A second POST while a crawl
  of the same website is running answers `409 "A crawl is already running
  for this website"` and starts nothing. `500` when the run cannot be created
  or the saved password cannot be decrypted (the key changed).
- **Logged-in crawls log in first.** The crawler records no page until the
  login worked, then sets the run's `isLoggedIn: true` - so every page of a
  run with `isLoggedIn: true` was viewed logged in. A failed login ends the
  run `failed` with `Login with "<login action>" as "<name>" failed: <reason>` and no pages, and
  the crawler screenshots what the browser showed at that moment:
  `loginFailureScreenshotFileName` (`<websiteId>/<uuid>.png`, relative to the
  screenshot directory) is set on the run, and
  **`GET .../crawl-runs/:crawlRunId/login-failure-screenshot`** serves the PNG
  (sent with `root` = the screenshot directory, so a stored name cannot climb
  out of it; `404` when the run has none or the file is gone). Every run read
  carries `credentialId`, `isLoggedIn`, `loginFailureScreenshotFileName`,
  and `credential: { id, name }` (null for a logged-out crawl).
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

## The auto-refine jobs controller (`autoRefineJobs.ts`)

`registerAutoRefineJobRoutes(app, actionScriptDirectory)` starts, reads back,
and stops auto-refine jobs: a background loop that runs a version and, when
the run fails, refines it with Claude and runs the refined version, until a
run passes or the job gives up. The loop itself lives in
`../services/autoRefineService.ts`; the run and refine work it calls is the
very code behind the action script routes' "Run" and "Refine"
(`../services/actionScriptExecutionService.ts`). Like the action script
routes it takes the action script directory (`ACTION_SCRIPT_DIR`, resolved at
boot): every run the job records writes its folder there.

Every path is nested under `/api/websites/:websiteId/actions/:actionId`, and
every route checks the website, then the action (then the version or the
job) and answers `404` for the first one missing - with the same messages as
the action script routes, because both controllers share
`findWebsiteAndAction` / `findWebsiteActionAndScript` from
`actionLookups.ts`. Later lookups use the FOUND rows' ids.

- **`POST .../scripts/:actionScriptId/auto-refine-jobs` answers `201` at
  once** with the new job (`status: "running"`, `phase: "running"`,
  `startActionScriptId` = `currentActionScriptId` = the version in the
  path); the loop carries on in the background. The body is optional:
  `{ parameterValues }` are the run-form values the user had changed, by
  key, validated like a run's (`400` for a body that is not an object, a
  value that is not text, one over 1000 characters, or one containing
  `{{`). They are stored on the job and sent to every run; a key a later
  version no longer has is dropped before that run. Two `409`s: the version
  was saved from the step editor (`modelId` null - no model wrote it, so
  Claude cannot refine it; `EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE`), and
  the action is already running - a manual run, or another job
  (`ACTION_ALREADY_RUNNING_MESSAGE`, the same message the run route gives).
  The job holds the action's run claim for its whole life, so a manual
  "Run" of the action during the job gets that same `409`. `500` when the
  job row cannot be created.
- **The loop ends** with one of `passed` (a run succeeded), `gaveUp` (five
  refinements were made and the last run still failed), `unchanged` (a
  refinement came back with the very plan it refined), `stopped` (see Stop),
  `failed` (a step broke; `errorMessage` says why), or `interrupted` (the
  server restarted mid-job). Every version it creates and every run it
  records is an ordinary version / run on the action, listed like a hand-made
  one; the job keeps their ids in `createdActionScriptIds` and
  `actionScriptRunIds` (oldest first) so the page can refetch when they grow.
- **`GET .../auto-refine-jobs`** answers the action's jobs newest first; the
  action page reads it on load to find a job still `running` and pick up
  following it.
- **`GET .../auto-refine-jobs/:autoRefineJobId`** answers the job on its own
  - no joined versions or runs - because the page polls it every 2 seconds
  while the job runs. `404 "Auto-refine job not found"` for a job that is not
  the action's (or was deleted).
- **`POST .../auto-refine-jobs/:autoRefineJobId/stop`** asks a running job to
  stop. The job reads `stopRequestedAt` between steps, so it ends `stopped`
  after the run or refinement in flight - a run or a Claude call is never cut
  short. The route answers `200` with the job re-read after the write
  (`stopRequestedAt` set, `status` still `running`); poll it to see it end.
  `409 "This auto-refine job is not running, so it cannot be stopped"` when
  the job has already ended - either on the read, or when the conditional
  write (`where status: "running"`) matched no row because it ended in
  between.
- **Jobs are create-only from the API's point of view**: there is no `PUT` or
  `DELETE`. They are soft deleted with their action or website, and a running
  job whose action is deleted notices on its next conditional write (0 rows)
  and ends quietly.
- **A dev server restart interrupts a running job.** The loop runs inside the
  server process; a job left `running` by a killed process is marked
  `interrupted` at the next boot (`markUnfinishedAutoRefineJobsInterrupted`,
  awaited in `server.ts` before listening, next to the crawl sweep).

## The credentials controller (`credentials.ts`)

A credential is a username and password for one website - an account that
actions and crawls run as, typed by the website's Login action. CRUD like use cases (website checked first, soft
deletes), with these differences:

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
- **No login page or selectors.** Where and how it logs in belongs to the
  website's Login action (see `actions.ts`). Deleting a credential unlinks
  it from the actions that run as it, which then run logged out.
- **Body rules:** see `../utils/README.md`.

## The login runs controller (`loginRuns.ts`)

"Run login" on the LOGIN action (the one with `userActionKind: "login"`): it
has no steps, so this is how it is tested on its own, as a credential picked
for that run.

- **`POST .../login-runs` answers `201` for a failed login too**, like a
  plan run, with the recorded `LoginRun`. The body is `{ credentialId }`
  (required; `400` when missing, or when it is not one of the website's
  credentials). `409` when the action is not a Login action or is already
  running (the same one-run-per-action claim plan runs take); `400` when
  neither it nor the website has a login page URL; `503` when
  `CREDENTIAL_ENCRYPTION_KEY` is not configured. The work is
  `performLoginRun` (`../services/loginRunService.ts`): a headless browser
  logs in with `logInWithCredential` and takes ONE screenshot, into its own
  run folder under the action script directory.
- **`GET .../login-runs`** lists the action's login runs, newest first.
- **`GET .../login-runs/:loginRunId/screenshot`** serves the run's PNG
  (`logged-in.png` or `failure.png`), with `root` = the action script
  directory; `404` when the run has none or the file is gone.

## The login-form check (`websites.ts`)

A website gets its Login action by itself when it has a login form:

- **`POST /api/websites` waits for the check** after creating the website
  (`checkWebsiteForLoginForm` in `../services/loginFormCheckService.ts`, at
  most about 20 s): a headless browser looks for a visible password field
  on the website's login page URL (or its URL), following one "Log in" /
  "Sign in" link when that page has none. On a find it makes the "Log in"
  Login action and the website learns the form's page. The answer is the
  website as it is after the check, plus `loginCheck: { outcome, loginUrl,
  loginActionId, message }` (`found` / `notFound` / `failed`). A check that
  fails - the site did not load, the browser could not start, it ran out of
  time, or a query threw - is a `failed` `loginCheck`, never a failed
  create.
- **`POST /api/websites/:websiteId/login-check`** runs the same check on
  demand ("Look for a login form" on the Credentials tab): `200` with
  `{ loginCheck }`, `404` for a missing website, `409` when the website
  already has its Login action.

## The script models controller (`scriptModels.ts`)

`GET /api/script-models` answers `{ models, defaultModelId, defaultEffort }`
from the live Models API (`../services/scriptModelService.ts`): every model
with structured outputs, newest first, each with its effort levels (empty for
"Standard"), whether it takes adaptive thinking, and its fallback. The
defaults are Claude Opus 5.5 at `high` when listed (both null when no model
is usable). Without `ANTHROPIC_API_KEY` it answers `503`, like a conversion.

## Action parameters

An action's parameters - the values a run can change - are stored in ONE
place, its `ActionParameter` rows (see `../prisma/schema.prisma`), kept up to
date by `syncActionParameters` (`../services/actionParameterService.ts`) with
no LLM. Which steps of a version use each parameter, and the value the
version types, are read from the version's plan when its parameters are
shown or run.

- **Run values:** `POST .../runs` takes `{ parameterValues: { [key]: string } }`.
  A key left out keeps the version's own value. `400` for an unknown key, a
  blank required value, a value over 1000 characters or containing `{{`, an
  object with no known address for a version that opens it by address, or a
  plan the values make invalid. A blank optional value skips the steps that
  use it; an added field with a value adds a step.
- **After a run** (`followUpRecordedRun`): the parameters learn from the
  fields the runner read; a Create run whose confirm step showed no error
  records a `CreatedObject`; a passed Delete run marks a created object
  deleted - the one it cleaned up (by id), or the newest one whose name is
  among the values the run used.
- **Delete actions:** a Delete action has no `object` parameter. It mirrors
  its linked Create action's text parameters (`source: "create"` - same key,
  label and default literal, bound wherever the literal appears in its
  steps), synced whenever the Create action syncs; `DELETE .../parameters/:key`
  on one answers `409` like any detected row. A cleanup run gets the Create
  run's values by key.
- **After a crawl:** created objects are checked against the type's list page,
  and every action's parameters are synced.
