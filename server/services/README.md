# server/services/

Stateless modules holding the real logic. Controllers stay thin and delegate
here; services never touch `req`/`res`.

| File | Owns |
|---|---|
| `dbService.ts` | The one `PrismaClient` for the process, and every `Website`, `UseCase`, `Action`, `ScreenshotRun`, `ActionScript`, and `ActionScriptRun` query. |
| `playwrightService.ts` | `captureWebsiteScreenshot(url, screenshotFilePath)`: launches headless Chromium on this machine, visits the URL in a 1280x720 viewport, writes a viewport PNG, and reports the outcome. |
| `scriptGenerationService.ts` | `convertActionToScript(request)`: asks Claude to turn an action into a Playwright `.mjs` script, following `../prompts/actionScriptGuidelines.md` verbatim. |
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
  and its active use cases, actions, screenshot runs, action scripts, and
  action script runs with the same `deletedAt`.
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

`dbService.ts` reads `DATABASE_URL` **at module load time**, so anything that
imports it must import `server/bootEnv.js` first. `server.ts` does; a standalone
script must do the same.

## scriptGenerationService asks Claude for a script

`convertActionToScript` makes **one** request to the Anthropic API:

- **Model:** `claude-opus-5-5`, with a server-side **fallback** to
  `claude-opus-4-8` (beta `server-side-fallback-2026-06-01`): if a safety
  classifier declines on Opus 5.5, the API retries on the fallback inside the
  same call. `modelId` on the result is whichever model answered.
- **System prompt:** `../prompts/actionScriptGuidelines.md`, read per call and
  sent **unmodified**, marked `cache_control: { type: "ephemeral" }` so repeat
  conversions within 5 minutes read it from the prompt cache. Everything that
  varies (website, action) is in the user message, after the cached prefix.
  Each call logs `[scripts] ... read from cache, ... written to cache` so the
  cache can be checked.
- **Structured output:** `client.beta.messages.parse` with
  `betaZodOutputFormat({ summary, assumptions, script })`, so the reply is a
  validated object, not Markdown to scrape. `effort: "high"`, `max_tokens`
  16000, non-streaming; thinking is always on for this model.
- **The client is built per call**, with the key passed explicitly, so a
  missing `ANTHROPIC_API_KEY` only affects this feature and the SDK never
  picks up some other credential on this machine.
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
