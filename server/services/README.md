# server/services/

Stateless modules holding the real logic. Controllers stay thin and delegate
here; services never touch `req`/`res`.

| File | Owns |
|---|---|
| `dbService.ts` | The one `PrismaClient` for the process, and every `Website`, `UseCase`, `Action`, `ScreenshotRun`, `ActionScript`, `ActionScriptRun`, `CrawlRun`, and `CrawledPage` query. |
| `playwrightService.ts` | `captureWebsiteScreenshot(url, screenshotFilePath, timingSettings)`: launches headless Chromium on this machine, visits the URL in a 1280x720 viewport, writes a viewport PNG, and reports the outcome. Also exports the page helpers the crawler reuses (`navigateToUrl`, `waitForPageReadiness`, `summarizeError`, `closeBrowserQuietly`, ...). |
| `crawlerService.ts` | `crawlWebsite(startUrl, timingSettings, recordVisitedPage)`: crawls a website breadth first with headless Chromium, following same-origin links only, recording each page's aria snapshot. Browser only - it saves nothing itself. |
| `crawlRunService.ts` | `startCrawlRun(website)`: starts a crawl in the background (one per website at a time) and records its pages and outcome; `markUnfinishedCrawlRunsInterrupted()` for boot. |
| `anthropicClient.ts` | `createAnthropicClient()` / `readAnthropicApiKey()` (per call, key passed explicitly) and `ScriptGenerationError`, shared by the two Claude services below. |
| `scriptModelService.ts` | The live model catalog: `listScriptModels()`, `findScriptModel(id)`, `chooseEffortForModel()`, `chooseDefaultScriptModel()`. |
| `scriptGenerationService.ts` | `convertActionToScript(request, { model, effort })`: asks the chosen Claude model to turn an action into a Playwright `.mjs` script, following `../prompts/actionScriptGuidelines.md` verbatim. |
| `scriptRunnerService.ts` | `runPlaywrightScript(code, runDirectory)`: writes the script into its own run folder and runs it with plain `node` (no environment variables), enforcing the 5 minute limit. |

## dbService is the only database door

The `PrismaClient` and its `PrismaPg` adapter are **module-private** — neither
is exported. Every database access in the app goes through one of the named
functions:

| Model | Functions |
|---|---|
| Website | `createWebsite`, `listWebsites`, `findWebsiteById`, `findWebsiteByUrl`, `updateWebsite`, `softDeleteWebsite` |
| UseCase | `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite` |
| Action | `listActionsForWebsite`, `findActionForWebsite`, `createActionForWebsite`, `updateActionForWebsite`, `softDeleteActionForWebsite` |
| ScreenshotRun | `listScreenshotRunsForWebsite`, `findScreenshotRunForWebsite`, `createScreenshotRunForWebsite` (runs are never edited; they are soft deleted with their website) |
| ActionScript | `listActionScriptsForAction`, `findActionScriptForAction`, `createActionScriptForAction` - **deliberately no update function**, which is what makes scripts immutable |
| ActionScriptRun | `listActionScriptRunsForScript`, `findActionScriptRunForScript`, `createActionScriptRunForScript` - no update function either |
| CrawlRun | `listCrawlRunsForWebsite`, `findCrawlRunForWebsite`, `createCrawlRunForWebsite` (created `running`), `finishCrawlRun`, `markRunningCrawlRunsInterrupted` |
| CrawledPage | `recordCrawledPage` (create-only, see below), `listCrawledPageSummariesForRun` (no `ariaSnapshot` / `linkedUrls`, via Prisma `omit`), `findCrawledPageForRun` |
| Errors | `isUniqueConstraintViolation` (P2002), `isRecordNotFound` (P2025) |

That is also why app code must never import from `../generated/prisma/`
directly. See `../prisma/README.md`.

## Rules the functions follow

- **Every read and write filters `deletedAt: null`.** A soft-deleted row is
  invisible: `find*` returns null, `update*` returns null, `softDelete*`
  returns false.
- **Children are always scoped to their website.** Use case, action, and
  screenshot run queries match on `websiteId` as well as `id`, so an id from
  another website never matches. Script queries also match `actionId`, and
  run queries `actionScriptId`, so every parent in the URL must line up.
- **`update*` is a single atomic `update`** whose `where` includes
  `deletedAt: null`; a P2025 "no row matched" becomes `null`. A row deleted a
  moment earlier cannot be edited back to life.
- **`softDeleteWebsite` is one interactive transaction:** it stamps the website
  and its active use cases, actions, screenshot runs, action scripts, action
  script runs, crawl runs, and crawled pages with the same `deletedAt`.
- **`recordCrawledPage` is one too:** it first updates the run's two progress
  counters with `status: "running", deletedAt: null` in the `where`, and only
  inserts the page when that matched. When the run was deleted with its
  website it writes nothing and returns null (the crawler then stops). The
  row lock that update takes serialises it with `softDeleteWebsite`, so a page
  can never be written as active after its run was deleted.
- **`finishCrawlRun` and `markRunningCrawlRunsInterrupted` only touch active
  runs that are still `running`** (an `updateMany`), so finishing a deleted
  run is a harmless no-op rather than a P2025.
- **`softDeleteActionForWebsite` is one too:** it stamps the action and its
  active scripts and runs with the same `deletedAt`, and touches no scripts
  when no active action matched.
- **Prisma errors are recognised structurally** (an object with a matching
  `code`), so controllers can map them to HTTP statuses without importing the
  generated error classes, and unit tests can throw plain objects.

## playwrightService visits websites from this machine

`captureWebsiteScreenshot` launches **its own** headless Chromium per call and
closes it in a `finally`, so nothing stays running between requests and no
shutdown hook is needed. In order:

1. Creates the screenshot's directory (`mkdir -p`) — **before** launching, so a
   bad `SCREENSHOT_DIR` fails without spawning a browser.
2. Launches Chromium and opens a 1280x720 page.
3. `page.goto(url, { waitUntil: "load", timeout: 30_000 })`. Redirects are
   followed; the final response's status is the one reported.
4. Waits until the page is **ready**, using the website's two settings
   (`ScreenshotTimingSettings`). A single-page app often fires `load` while it
   is still fetching data behind a spinner, so `load` alone is not enough:
   1. **Network idle** — `page.waitForLoadState("networkidle")` (no requests
      for 500 ms), for at most `networkIdleTimeoutMs`. A cap of `0` skips this
      wait, because Playwright reads `timeout: 0` as "wait forever".
   2. If the network went idle: **paint** — fonts ready plus two animation
      frames, run inside the page with a fixed 2 s safety limit; then the rest
      of **`screenshotMinimumWaitMs`**. The minimum is a *floor* on the time
      since `load`, not an extra delay: if idle + paint already took that
      long, there is no further wait.
   3. If the cap ran out instead, the screenshot is taken **at once** (no paint
      wait). Validation keeps the cap at or above the minimum, so the minimum
      has already passed.
5. Writes a **viewport** screenshot (not the full scrollable page) — even for
   an HTTP 400+ page, so the error page can be seen.

The paint wait runs **inside the browser** (`page.evaluate`): keep every
function in it anonymous. `tsx` (esbuild) wraps *named* functions in a
`__name(...)` helper that only exists on the server, and the page then fails
with `ReferenceError: __name is not defined`.

| Visit | Result |
|---|---|
| Loaded, HTTP < 400 | `succeeded: true`, screenshot written |
| Loaded, HTTP >= 400, or no response | `succeeded: false` with a reason, screenshot written |
| DNS error, refused connection, TLS certificate error, timeout | `succeeded: false`, first line of Playwright's error, no screenshot |
| Network idle cap ran out | Screenshot taken at once; success still decided by the HTTP status |
| A readiness wait failed for another reason, or the screenshot could not be written | `succeeded: false`, HTTP status kept, no screenshot |
| Directory cannot be created, browser cannot launch or open a page | **rejects** (the controller answers 500 and records nothing) |

A failed **visit** is a normal result, never a rejection. A failure to close
the browser is only logged (`[playwright] ...`), because the visit's result is
already known. Chromium must be installed once per machine:
`npx playwright install chromium`.

## crawlerService maps a website from this machine

`crawlWebsite` launches **one** headless Chromium with **one** page
(`acceptDownloads: false`) and closes it in a `finally`. It is breadth first:
the start page, then every page linked from it, then the pages linked from
those, until one of the stop conditions:

| Stop reason | When |
|---|---|
| `finished` | The queue is empty: every reachable page was visited. |
| `stoppedAtPageLimit` | `CRAWL_PAGE_LIMIT` (50) pages were visited with links still waiting. Failed pages count. |
| `stoppedAtTimeLimit` | `CRAWL_TIME_LIMIT_MS` (10 minutes) passed. Checked **between** pages, so a crawl can overrun by one page's own timeouts. |
| `stoppedBecauseRunWasDeleted` | The recorder returned null (the run was deleted with its website). |
| `stoppedBecauseBrowserClosed` | The browser or its page closed mid-visit. In practice a server restart: `tsx watch` sends SIGTERM and Playwright's own handler closes the browser. That visit is **not** recorded (its "browser has been closed" failure says nothing about the page) and goes back on the queue. |

- **Links only.** It reads `a[href]:not([download])` and never clicks
  anything, so it cannot submit a form or press a delete button. The in-page
  scan returns raw `href` attributes and `document.baseURI`; they are resolved
  on the server by `../utils/normalizeCrawlUrl.ts`.
- **Same origin only**, and the origin is taken from where the **start page
  ended up** (after redirects), so an http to https or apex to www redirect
  does not end the crawl after one page. A page that redirected off-site is
  recorded, but its links are not read.
- **URL identity is origin + path** (query string and hash ignored, the
  user's choice); a page is loaded with the first link that reached it, hash
  dropped. The start page is loaded with the website's URL exactly.
- **Per page:** `navigateToUrl` → `waitForPageReadiness` (the website's timing
  settings, exactly as screenshots wait) → `page.url()` (read **after** the
  wait, so client-side redirects count) → `page.locator("body").ariaSnapshot({
  timeout: 10_000 })` → `page.title()` → the links.
- **A page is `succeeded`** only when it answered below HTTP 400 and both its
  snapshot and its links were read. Every problem is joined into its
  `errorMessage`. A failed page is still recorded and still counts.
- **The tree:** each visited page is handed to `recordVisitedPage` at once,
  and the id that returns becomes the `parentPageId` of the new links found on
  it. The new links are claimed (marked seen) before the page is saved, so the
  saved progress already counts them as waiting.
- It only **rejects** when the browser cannot launch or open a page, or the
  recorder rejects. The in-page link scan follows the same `__name` rule as the
  paint wait: no named functions inside it.

## crawlRunService runs crawls in the background

- **`startCrawlRun(website)`** claims the website's id in an in-memory Set
  **before** anything is awaited (Node runs one request's synchronous code to
  the end before another's, so two simultaneous requests cannot both start
  one), creates the `running` run, and starts the crawl **without awaiting
  it**. It returns `{ crawlStarted: false }` when a crawl of the website is
  already running, else `{ crawlStarted: true, crawlRun, crawlCompletion }` -
  production ignores `crawlCompletion`; tests await it.
- **The background crawl never rejects** (Node 25 crashes the process on an
  unhandled rejection): it finishes the run with the crawler's stop reason
  (`stoppedBecauseBrowserClosed` becomes `interrupted` with a reason), writes
  nothing more when the run was deleted, and turns any error into a `failed`
  run - logging instead if even that write fails. The claim is released in a
  `finally`.
- **`markUnfinishedCrawlRunsInterrupted()`** marks every run still `running`
  as `interrupted`. `server.ts` awaits it **before** it starts listening, so it
  can never flip a run the new process started. It is the backstop for a
  process killed before it could record anything; it never rejects.

`dbService.ts` reads `DATABASE_URL` **at module load time**, so anything that
imports it must import `server/bootEnv.js` first. `server.ts` does; a standalone
script must do the same.

## scriptModelService lists the models live

`listScriptModels` makes one `client.beta.models.list({ betas:
["server-side-fallback-2026-06-01"] })` call (the beta is what makes the API
report each model's `allowed_fallback_models`) and keeps every model with
structured outputs, in the API's order (newest first). Nothing is
hard-coded, so models appear and disappear with Anthropic's list. Each
`ScriptModelOption` carries:

- `effortLevels` from `capabilities.effort`, in ladder order
  (`low` → `max`); empty when the model has no effort setting ("Standard");
- `supportsAdaptiveThinking` from `capabilities.thinking.types.adaptive`;
- `fallbackModel`: Claude Opus 4.8 when the model allows it, otherwise its
  first allowed (and listed) fallback, otherwise null.

`chooseEffortForModel` keeps a wanted level the model offers, else `high`,
else the model's highest level, else null; `chooseDefaultScriptModel` picks
Claude Opus 5.5 at high when listed, else the newest model.

## scriptGenerationService asks Claude for a script

`convertActionToScript` makes **one** request to the Anthropic API, shaped by
the chosen model:

- **Model:** the one the user picked. `fallbacks` (beta
  `server-side-fallback-2026-06-01`) are sent only when the model has a
  fallback: if a safety classifier declines, the API retries there inside the
  same call. `thinking: { type: "adaptive" }` is sent only when the model
  takes it (Opus 4.7/4.8 would otherwise run without thinking; Opus 4.5,
  Haiku 4.5, and Sonnet 4.5 do not accept it). `output_config.effort` is sent
  unless the model has no effort setting. The result's `modelId` is whichever
  model answered and `effort` is the level sent (a fallback inherits it).
- **System prompt:** `../prompts/actionScriptGuidelines.md`, read per call and
  sent **unmodified**, marked `cache_control: { type: "ephemeral" }` so repeat
  conversions on the same model within 5 minutes read it from the prompt
  cache. Caches are per model, and the prompt (~2.2k tokens) is below the
  4,096-token minimum of Claude Haiku 4.5, Opus 4.5, and Opus 4.6, so those
  three never cache - silently, not as an error. Everything that
  varies (website, action) is in the user message, after the cached prefix.
  Each call logs `[scripts] ... read from cache, ... written to cache` so the
  cache can be checked.
- **Structured output:** `client.beta.messages.parse` with
  `betaZodOutputFormat({ summary, assumptions, script })`, so the reply is a
  validated object, not Markdown to scrape. `max_tokens` 16000,
  non-streaming (at `xhigh`/`max` a large action could hit it, which surfaces
  as `truncated`).
- **The client is built per call** (`createAnthropicClient`), with the key
  passed explicitly, so a missing `ANTHROPIC_API_KEY` only affects this
  feature and the SDK never picks up some other credential on this machine.
- **Known failures throw `ScriptGenerationError`** with a `reason`:
  `missingApiKey`, `refused` (every model declined), `truncated` (hit
  `max_tokens`), `unparseable` (no schema match, or an empty script). API and
  network errors reject unchanged.

## scriptRunnerService runs a script like a user would

`runPlaywrightScript` is script-agnostic (future use-case scripts can reuse
it). In order:

1. `mkdir -p` the run folder and write `script.mjs` - **before** starting
   anything, so a bad directory fails with nothing running.
2. `spawn(process.execPath, ["script.mjs"], { cwd: runDirectory, env: {},
   detached: true })`. The working directory is the run folder, so the
   template's `failure.png` lands next to the script. **No environment
   variables** reach the script, so generated code never sees secrets; Node
   and Playwright still find the home folder (where Chromium lives) and `/tmp`
   without them. The script imports `playwright` from the project's
   `node_modules`, which is why `ACTION_SCRIPT_DIR` must be inside the project.
3. stdout and stderr are collected together in arrival order, capped at
   200,000 characters keeping the **tail** (where the error is), NUL stripped.
4. **Time limit:** after 5 minutes the script's process group gets SIGTERM -
   Playwright's own handler closes the browser, which also ends a waiting
   `page.pause()` - and SIGKILL 5 seconds later if it is still alive.
5. Resolves on `close`. A run **passes** only with exit code 0, no timeout,
   AND no `failure.png` (a script can catch its own error and still exit 0).
