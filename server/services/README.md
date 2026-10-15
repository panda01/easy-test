# server/services/

Stateless modules holding the real logic. Controllers stay thin and delegate
here; services never touch `req`/`res`.

| File | Owns |
|---|---|
| `dbService.ts` | The one `PrismaClient` for the process, and every `Website`, `UseCase`, `Action`, `ScreenshotRun`, `ActionScript`, `ActionScriptRun`, `CrawlRun`, `CrawledPage`, and `Credential` query. |
| `playwrightService.ts` | `captureWebsiteScreenshot(url, screenshotFilePath, timingSettings)`: launches headless Chromium on this machine, visits the URL in a 1280x720 viewport, writes a viewport PNG, and reports the outcome. Also exports the page helpers the crawler reuses (`navigateToUrl`, `waitForPageReadiness`, `summarizeError`, `closeBrowserQuietly`, ...). |
| `crawlerService.ts` | `crawlWebsite(startUrl, timingSettings, recordVisitedPage, login?, buttonMode?)`: crawls a website breadth first with headless Chromium, following same-origin links - and, with a button mode, the pages its buttons open - recording each page's aria snapshot, after logging in first when given a `login`. Browser only - it saves nothing itself. |
| `crawlerButtonService.ts` | `followPageButtons(...)`: clicks a page's buttons one at a time (reloading the page before every click but the first) and reports the same-site pages they landed on; `chooseButtonsToClick(buttons, mode)` picks which (see below). |
| `pageActionService.ts` | `trackPageRequests(page)`, `waitForTrackedRequestsToFinish(page, tracker, capMs)`, `waitOutMinimumWaitSince(page, startedAt, minimumWaitMs)`: waiting out what an action (a login submit, a button click) set off - shared by the login and the button clicks. |
| `crawlerLoginService.ts` | `buildCrawlLoginDetails(credential, website)`: decrypts the password and picks the EFFECTIVE login URL (shared by crawls and action runs). `logInWithCredential(page, login, timingSettings)`: fills in and submits a website's login form on the given page, finding the fields itself unless the credential names CSS selectors, and reports `{ loggedIn }` (never rejects). `captureLoginFailureScreenshot(page, filePath)`: the viewport PNG of a failed login (never rejects). |
| `crawlRunService.ts` | `startCrawlRun(website, credential, screenshotDirectory, buttonMode)`: decrypts the credential's password (when there is one), starts a crawl in the background (one per website at a time), and records its login, pages, and outcome; `markUnfinishedCrawlRunsInterrupted()` for boot. |
| `anthropicClient.ts` | `createAnthropicClient()` / `readAnthropicApiKey()` (per call, key passed explicitly) and `ScriptGenerationError`, shared by the two Claude services below. |
| `scriptModelService.ts` | The live model catalog: `listScriptModels()`, `findScriptModel(id)`, `chooseEffortForModel()`, `chooseDefaultScriptModel()`. |
| `scriptGenerationService.ts` | `convertActionToPlan(request, { model, effort })`: asks the chosen Claude model to turn an action into a JSON step plan, following `../prompts/actionPlanGuidelines.md` verbatim, with the relevant crawled pages' aria snapshots in the user message; only a plan that passes every rule is returned. `refineActionPlan(request, { model, effort })`: asks the model that wrote a version to fix it from a failed run (error, step log, failure screenshot, failing-page snapshot, the user's note), returning the new plan plus the call's token usage. |
| `actionPlanRunnerService.ts` | `runActionPlan(request)`: runs a validated plan in a visible browser in this process - logs in first when there is a credential, opens `startUrl`, then each step through `runPlanStep`'s fixed `switch` - enforcing the 5 minute limit; a failed run writes `failure.png` and returns the failing page's URL and aria snapshot. |

## dbService is the only database door

The `PrismaClient` and its `PrismaPg` adapter are **module-private** — neither
is exported. Every database access in the app goes through one of the named
functions:

| Model | Functions |
|---|---|
| Website | `createWebsite`, `listWebsitesWithSummaries` (each active website plus its dashboard `summary` - the `WebsiteWithSummary` type: its active actions counted as passed / failed / not run by each one's newest version's latest run, `latestRunAt` of its newest script run, and `latestCrawlRun` - read in one query with `take: 1` on the relations where only the newest row counts), `findWebsiteById`, `findWebsiteByUrl`, `updateWebsite`, `softDeleteWebsite` |
| UseCase | `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite` |
| Action | `listActionsForWebsite`, `findActionForWebsite`, `createActionForWebsite`, `updateActionForWebsite` (all four include `credential: { id, name }` - the `ActionWithCredential` type), `softDeleteActionForWebsite`. The LIST also carries `newestScript` (the `ActionWithNewestScript` type): the newest active version's id, its `versionNumber` (the count of active versions, from `_count`), the `actionTitle` / `actionDescription` / `credentialId` it was generated from, and its `latestRun`, or null when the action has no versions - read with `take: 1` on both relations, so it costs no extra rows |
| ScreenshotRun | `listScreenshotRunsForWebsite`, `findScreenshotRunForWebsite`, `createScreenshotRunForWebsite` (runs are never edited; they are soft deleted with their website) |
| ActionScript | `listActionScriptsForAction`, `findActionScriptForAction`, `createActionScriptForAction`, `createRefinedActionScriptForAction` (one nested write: the refined version AND its `ActionScriptRefinement` row, so both or neither are saved) - **deliberately no update function**, which is what makes plan versions immutable; reads parse `plan` back into an `ActionPlan` (the `ActionScriptWithPlan` type), restoring the field order `jsonb` drops, and include `refinement` (the refinement that produced the version, or null) with its run's `errorMessage`, `failedStepNumber`, `timedOut`, and `failingPageAriaSnapshot` JOINED from the run row, never copied; every read and create also carries `latestRun` (`LatestActionScriptRun`: `{ id, succeeded, failedStepNumber, timedOut, createdAt }` of the newest active run, or null) in place of Prisma's `runs` list (`ACTION_SCRIPT_INCLUDE`) |
| ActionScriptRun | `listActionScriptRunsForScript`, `findActionScriptRunForScript`, `createActionScriptRunForScript` (now also stores `failingPageUrl` / `failingPageAriaSnapshot`) - no update function either |
| ActionScriptRefinement | created only by `createRefinedActionScriptForAction`, read only through a version's `refinement` include; soft deleted with its action or website |
| CrawlRun | `listCrawlRunsForWebsite`, `findCrawlRunForWebsite`, `createCrawlRunForWebsite` (created `running`; all three include `credential: { id, name }`), `markCrawlRunLoggedIn`, `finishCrawlRun`, `markRunningCrawlRunsInterrupted` |
| CrawledPage | `recordCrawledPage` (create-only, see below), `listCrawledPageSummariesForRun` (no `ariaSnapshot` / `linkedUrls`, via Prisma `omit`), `findCrawledPageForRun`, `findLatestCrawledPagesForWebsite(websiteId, credentialId)` (the successful, snapshotted pages of ONE run: the newest finished crawl done the same way an action runs - logged in as its credential, or logged out - else the newest of any kind) |
| Credential | `listCredentialsForWebsite`, `findCredentialForWebsite`, `createCredentialForWebsite`, `updateCredentialForWebsite` (a null password keeps the saved one), `softDeleteCredentialForWebsite` (one transaction that also unlinks the actions running as it) - all **without** `encryptedPassword` (Prisma `omit`, the `CredentialSummary` type); `findCredentialWithPasswordForWebsite` is the only read that returns it, used only by crawl start and action runs |
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
  script runs, crawl runs, crawled pages, and credentials with the same
  `deletedAt`.
- **A credential's password never leaves through a summary read.** Every
  credential function that feeds an API response omits `encryptedPassword`;
  the encryption itself is `../utils/credentialEncryption.ts`. Crawl run reads
  include the credential's id and name WITHOUT a `deletedAt` filter, so a run
  keeps naming a credential deleted after it ran.
- **`recordCrawledPage` is one too:** it first updates the run's two progress
  counters with `status: "running", deletedAt: null` in the `where`, and only
  inserts the page when that matched. When the run was deleted with its
  website it writes nothing and returns null (the crawler then stops). The
  row lock that update takes serialises it with `softDeleteWebsite`, so a page
  can never be written as active after its run was deleted.
- **`markCrawlRunLoggedIn`, `finishCrawlRun`, and
  `markRunningCrawlRunsInterrupted` only touch active runs that are still
  `running`** (an `updateMany`), so finishing a deleted
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
| `stoppedBecauseBrowserClosed` | The browser or its page closed mid-visit (or mid-login). In practice a server restart: `tsx watch` sends SIGTERM and Playwright's own handler closes the browser. That visit is **not** recorded (its "browser has been closed" failure says nothing about the page) and goes back on the queue. |
| `loginFailed` | The crawl was asked to log in and could not; `loginErrorMessage` says why. No page was visited. |

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
- **A redirected page is recorded where it LANDED** (`decideRecordedIdentity`):
  a link to `/` that ends up on `/calendar` (HTTP 3xx or client-side) is
  recorded as `/calendar` with `wasRedirected: true`, and `requestedUrl`
  keeps `/`. If the landing page was still queued it is taken off the queue
  (`claimRecordedIdentity`), so it is recorded once. If it was already
  recorded, the new page keeps the identity it was requested at (no
  duplicate rows) and its `finalUrl` names the page it landed on. A change of
  query string alone is not a redirect.
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
- **Logging in first.** With a `login` (`{ details, recordLoginSucceeded }`),
  `logInWithCredential` runs on the crawl's own page **before** the start page
  is queued, so the session cookies carry over and nothing is recorded until
  it worked. On success `recordLoginSucceeded()` is awaited (false = the run is
  gone, so the crawl stops as `stoppedBecauseRunWasDeleted`) and the crawl
  goes on as usual; on failure it screenshots the page to
  `login.failureScreenshotPath` (`captureLoginFailureScreenshot`) and stops at
  once as `loginFailed`, reporting `loginFailureScreenshotWasCaptured`.
- **Logout links are skipped while logged in.** `isLogoutLink(identityUrl)`
  matches a path segment or word like `logout`, `log-out`, `signout`,
  `sign_out`, or `logoff`; such links are never queued (they still appear in
  the page's `linkedUrls`), so the crawl cannot end its own session.

## Button modes: crawlerButtonService clicks buttons

A crawl's `buttonMode` (`../utils/crawlButtonModes.ts`, stored on the run)
decides which buttons it clicks on each page, on top of following links:

| Mode | Clicks |
|---|---|
| `linksOnly` (default) | nothing - links only |
| `allButRisky` | every visible, enabled, labelled button whose text is not risky |
| `openOnly` | only buttons whose text holds the whole word "open" (not "Reopen") - and still never a risky one ("Open and delete" is skipped) |

- **Risky words** (`RISKY_BUTTON_WORDS`, whole words, any case; two-word
  ones also with a hyphen): create, add, new; delete, remove, destroy,
  archive; update, edit, save, submit, change, reset; log out, logout, log
  off, logoff, sign out, signout; pay, payment, purchase, buy, checkout,
  check out, order; confirm, cancel, send, publish, approve, reject, refund,
  subscribe, unsubscribe, upload, invite, accept, decline. Change the list in
  one place.
- **Never clicked:** buttons with no text or label (icon-only - their action
  is unknown), disabled ones, hidden ones. At most
  `BUTTON_CLICKS_PER_PAGE_LIMIT` (20) per page, in page order.
- **Which pages:** only a page that fully succeeded on the crawl's origin has
  its buttons clicked, AFTER its snapshot, title, and links were read.
- **Each click:** reload the page (from the second click on, with the
  website's timing settings) → check the button at that index still has the
  same text → start `trackPageRequests` → click (10 s limit) → wait for the
  click's requests (`waitForTrackedRequestsToFinish`, the website's idle cap)
  and the minimum wait → read the URL. **A click only counts when it lands on
  a different same-site page**; a dialog or panel opening is ignored. One
  failing button only skips that button; `followPageButtons` never rejects.
- **What is recorded:** the page gets `buttonUrls` (where its buttons led,
  de-duplicated, click order); each new page is queued like a link with
  `foundByButtonText`. Links are claimed first, so a page reachable both ways
  counts as found by a link. The logout rule applies to button targets too.
  The page's `durationMs` includes its button clicks.
- **Side effects:** windows a click opens are closed (`page.on("popup")`);
  `alert` / `confirm` dialogs are dismissed by Playwright (never accepted).

## crawlerLoginService logs a crawl in

`logInWithCredential(page, login, timingSettings)` returns
`{ loggedIn: true }` or `{ loggedIn: false, errorMessage }` and never rejects:

1. Load `loginUrl` (`navigateToUrl` + `waitForPageReadiness`, the website's
   timing settings - network idle up to its cap, paint, then the rest of its
   minimum wait - exactly as for every crawled page). **Nothing is typed
   before this wait is over.** A thrown navigation or HTTP 400+ fails the
   login.
2. The password field: `passwordSelector`, or the first visible
   `input[type="password"]`. Then the login form: the `<form>` holding it, or
   `<body>` when there is none.
3. The username field: `usernameSelector`, or the first visible input with no
   type / `text` / `email` / `tel` **inside that form** (so a header search
   box is not mistaken for it).
4. Fill both, then submit: `submitSelector`, or the form's first visible
   `button[type=submit]` / `input[type=submit]` / `button:not([type])`, or
   Enter in the password field. Request counting starts **before** the
   submit (`page.on("request" | "requestfinished" | "requestfailed")`).
5. Give the site time to answer (`waitForLoginResult`) - Playwright's own
   `load` / `networkidle` states are useless here, because a single-page app
   that signs in with `fetch` never leaves its already-loaded, already-idle
   page (the first version judged such logins ~30 ms after the click, while
   the button still said "Signing in…"):
   1. wait up to `LOGIN_RESULT_TIMEOUT_MS` (15 s) for the password field to
      go - a working login is noticed the moment it does;
   2. wait for the requests the submit started to finish: none in flight
      and nothing started or ended for `ACTION_REQUESTS_QUIET_WINDOW_MS`
      (500 ms), checked every 100 ms, capped by the website's network idle
      cap (0 skips it);
   3. wait out the rest of the website's minimum wait since the submit.
6. **Success = no visible password field at that last look.** Looking again
   after the requests finished matters: a page re-rendered with an error has
   no password field for an instant mid-reload, which step 5.1 sees as gone.
   A field still there means the site showed the form again ("Still on the
   login form after submitting - check the username and password"). A wrong
   password therefore takes about 15 s to be declared.

Finding each field and each fill or click is capped at
`LOGIN_STEP_TIMEOUT_MS` (10 s); the result wait in step 5 has its own limits.
Two-step logins (username and password on separate screens) are not
supported.

`captureLoginFailureScreenshot(page, filePath)` creates the PNG's folder and
writes a viewport screenshot of whatever the failed login ended on (usually
the form with the site's own error). It logs and returns false instead of
rejecting, so a screenshot problem never replaces the login's own error.

## crawlRunService runs crawls in the background

- **`startCrawlRun(website, credential, screenshotDirectory, buttonMode)`**
  first decrypts the credential's password (when there is one), so a password
  that cannot be decrypted rejects with nothing started, and resolves its
  EFFECTIVE login URL (`credential.loginUrl ?? website.loginUrl`; neither
  throws), and picks where a failed
  login's screenshot would go: `<websiteId>/<uuid>.png` in the screenshot
  directory, recorded on the run (`loginFailureScreenshotFileName`) only when
  the crawler reports it was written. It then claims the website's id in an in-memory Set
  **before** anything is awaited (Node runs one request's synchronous code to
  the end before another's, so two simultaneous requests cannot both start
  one), creates the `running` run, and starts the crawl **without awaiting
  it**. It returns `{ crawlStarted: false }` when a crawl of the website is
  already running, else `{ crawlStarted: true, crawlRun, crawlCompletion }` -
  production ignores `crawlCompletion`; tests await it. The run stores
  `buttonMode` (default `linksOnly`), which is passed on to `crawlWebsite`.
- **A website learns its login URL.** When a crawl's login succeeds and the
  run is still active (`markCrawlRunLoggedIn`), and the website has no
  `loginUrl` yet, the URL that worked is saved on it
  (`learnWebsiteLoginUrl` → `adoptWebsiteLoginUrl`, which never overwrites a
  URL already set). A failure there is only logged; the crawl goes on.
- **The background crawl never rejects** (Node 25 crashes the process on an
  unhandled rejection): it finishes the run with the crawler's stop reason
  (`stoppedBecauseBrowserClosed` becomes `interrupted` with a reason, and
  `loginFailed` becomes `failed` with `Login as "<name>" failed: <reason>`), writes
  nothing more when the run was deleted, and turns any error into a `failed`
  run - logging instead if even that write fails. The claim is released in a
  `finally`. A successful login is recorded with `markCrawlRunLoggedIn`
  (`isLoggedIn: true`) before the first page.
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

## scriptGenerationService asks Claude for a JSON step plan

`convertActionToPlan` makes **one** request to the Anthropic API, shaped by
the chosen model:

- **Model:** the one the user picked. `fallbacks` (beta
  `server-side-fallback-2026-06-01`) are sent only when the model has a
  fallback: if a safety classifier declines, the API retries there inside the
  same call. `thinking: { type: "adaptive" }` is sent only when the model
  takes it. `output_config.effort` is sent unless the model has no effort
  setting. The result's `modelId` is whichever model answered and `effort` is
  the level sent (a fallback inherits it).
- **System prompt:** `../prompts/actionPlanGuidelines.md`, read per call and
  sent **unmodified**, marked `cache_control: { type: "ephemeral" }` so repeat
  conversions on the same model within 5 minutes read it from the prompt
  cache. Caches are per model; the prompt is kept above 4,096 tokens (about
  5.7k on Haiku 4.5 / Opus 4.6, 7.3k on Opus 5.5) so it caches on every model
  in the catalog - a shorter prompt silently would not on those. Everything
  that varies is in the user message, after the cached prefix: the website,
  the action, the credential's NAME (never its username or password) and
  whether the browser is already logged in, and the selected crawled pages'
  aria snapshots inside `<page_snapshot>` elements, labelled as page data,
  not instructions. Each call logs `[scripts] ... read from cache, ...
  written to cache` so the cache can be checked.
- **Structured output:** `client.beta.messages.create` with
  `output_config.format = { type: "json_schema", schema }` (beta
  `structured-outputs-2025-12-15`, the one the SDK's `parse` sends). The
  schema is built from `ActionPlanConversionSchema` with `z.toJSONSchema`
  and `toStructuredOutputSchema` (drops `$schema`, turns type lists into
  `anyOf`, flattens nested `anyOf`) - NOT with the SDK's
  `betaZodOutputFormat`, which moves `enum` into description text, so the
  allowed step actions would only be a hint. `max_tokens` 16000,
  non-streaming.
- **The reply is checked in order:** `stop_reason` first (`refusal`,
  `max_tokens`), then `JSON.parse`, then the zod schema, then every plan rule
  (`findActionPlanProblems`) - only a valid plan is ever returned.
- **The client is built per call** (`createAnthropicClient`), with the key
  passed explicitly, so a missing `ANTHROPIC_API_KEY` only affects this
  feature and the SDK never picks up some other credential on this machine.
- **Known failures throw `ScriptGenerationError`** with a `reason`:
  `missingApiKey`, `refused` (every model declined), `truncated` (hit
  `max_tokens`), `unparseable` (not JSON, no schema match, or a plan that
  breaks a rule - the message lists the problems). API and network errors
  reject unchanged.

### refineActionPlan fixes a plan from a failed run

`refineActionPlan` goes through the same private `askClaudeForPlan` as
`convertActionToPlan`, so it sends the **same** system prompt, betas,
fallbacks, thinking, effort, structured-output schema, and `max_tokens` - and
the two share one prompt cache per model. Only the user message differs: an
array of content blocks built by `buildRefinementRequestContent`:

1. **Stable context text, marked `cache_control: ephemeral`** (the second
   cache breakpoint): "Refine a step plan whose run failed.", then the same
   website / origins / login / action / `<page_snapshot>` lines a conversion
   sends. It holds nothing about the run, so a refine chain (v1 → v2 → v3)
   reads it from the cache.
2. **The failure screenshot** as a base64 `image/png` block - only when the
   run's `failure.png` was still on disk.
3. **The run-specific text:** the failed version's summary, assumptions, and
   plan JSON; the error; "stopped at step N of M: ..." (with the step's
   JSON) or "before the first step"; whether it timed out; the step log's
   last 20,000 characters (`MAX_REFINE_RUN_OUTPUT_CHARACTERS`, with a marker)
   in `<run_output>`; the failing page's URL and aria snapshot in
   `<failing_page_snapshot>`; and the user's note in `<user_note>`. All of it
   is labelled as data, never instructions.

It returns the conversion fields plus `usage` (input, output, cache read,
cache write - null cache figures become 0) and `screenshotWasSent`, and logs
`[scripts] refined with <model> at <effort> effort with N page snapshot(s),
screenshot yes|no, failing page snapshot yes|no; ... read from cache, ...
written to cache ...`. A refusal reads "Claude declined to refine this plan
(...)". Measured on Opus 5.5: a refine right after a conversion read the
system prompt from the cache, and a second refine also read the context block.

## actionPlanRunnerService runs a plan like a user would

`runActionPlan` never turns a plan into code. In order:

1. `mkdir -p` the run folder - **before** launching anything, so a bad
   directory fails with nothing running.
2. `chromium.launch({ headless: false, slowMo: 100 })` - a visible window on
   this machine, like the old scripts - with a 1280x720 viewport, a 10 s
   default timeout per step and 30 s per navigation.
3. **Login first** when the action has a credential: the crawler's own
   `logInWithCredential` (it may use `.fill()` - that is setup, not a plan
   step). A failed login fails the run before any step.
4. `goto(plan.startUrl)`, then each step through **`runPlanStep`**, an
   exhaustive `switch (step.action)` whose `default` throws: each allowed
   action maps to the one Playwright call it stands for (`fill` = click,
   `ControlOrMeta+A`, `pressSequentially` with a 100 ms delay - never
   `.fill()`; `waitForUrl` takes a glob string, never a RegExp; `uploadFile`
   only picks files directly inside `<ACTION_SCRIPT_DIR>/uploads/`). The
   first failing step stops the run.
5. **Credential values stay in memory:** a placeholder
   (`{{credential.username}}` / `{{credential.password}}`) is replaced only
   while the page is on one of the website's own origins; the log describes
   steps but never typed text; error messages are cut to their first line
   and scrubbed of the username and password (Playwright's call log can echo
   typed text).
6. **Time limit:** after 5 minutes the failure evidence (below) is captured,
   then the browser is closed, which makes the pending step reject;
   the run is `timedOut`. Every fire-and-forget promise (dialog answer, file
   chooser, close) is `.catch`ed so it cannot become an unhandled rejection.
7. **Failure evidence**, captured before the browser closes, in order (and
   never throwing - each piece is null/false when it cannot be read): the
   screenshot `failure.png` in the run folder, the page's URL
   (`failingPageUrl`; `about:blank` counts as none), and the aria snapshot of
   its `<body>` (`failingPageAriaSnapshot`, NUL stripped and cut by
   `capSnapshot`). The URL and snapshot are scrubbed of the username and
   password like the error message. A passing run captures none. The log is capped
   at 200,000 characters keeping the **tail** (where the error is), NUL
   stripped.
