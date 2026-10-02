# AI Journal

Newest entry at the top.

---

## 2026-10-02 18:28 EDT — Minimum wait default lowered from 300 ms to 1 ms

**Intent:**
- At the user's request, a website's screenshot **minimum wait** now defaults to **1 ms** instead of 300 ms.
- In practice there is no floor, because network idle + paint always takes longer than 1 ms.
- The network idle cap default (5000 ms) is unchanged.

### Decisions (all made by the user)

- New default: `screenshotMinimumWaitMs` = 1.

### Files changed

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `Website.screenshotMinimumWaitMs` `@default(300)` → `@default(1)`. `db push` + `generate` were run; the Postgres column default is now `1`. |
| `server/utils/validateRequestBodies.ts` | `DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS` 300 → 1. Its JSDoc and the `validateWebsiteInput` JSDoc are updated. |
| `server/controllers/websites.ts` | JSDoc only: "(defaults 5000 and 1)". |
| `src/pages/WebsiteCreatePage.tsx` | `NEW_WEBSITE_VALUES.screenshotMinimumWaitMs` 300 → 1. |
| `server/utils/README.md`, `server/prisma/README.md`, `README.md` | The documented default is now 1 ms. |
| **Tests** | Expectations that assert the *default* changed from 300 → 1. Explicit inputs that merely use 300 (for example "cap 200 below minimum 300") were left as is. Files: `tests/backend/utils/validateRequestBodies.test.ts` (`DEFAULT_TIMING_SETTINGS`, the "0 with the default minimum (1)" label), `tests/backend/api/websites.test.ts`, `tests/backend/server.test.ts`, `tests/frontend/support/frontendTestHelpers.tsx` (`buildWebsiteRecord`), `tests/frontend/WebsiteForm.test.tsx` (`BLANK_VALUES`, the submitted payload), `tests/frontend/WebsiteCreatePage.test.tsx`, `tests/frontend/WebsiteEditPage.test.tsx`. |

### Verification performed

- **psql:** `information_schema` shows the `screenshotMinimumWaitMs` column default is `1`.
- **Existing rows are not changed by a new default.**
  - "Forge Gym management" already had 1, because the user had set it.
  - **"Example Again" still has 300** from the old default. It was left as is and the user was told.
- **End-to-end Playwright script** against the user's running dev servers (health check and homepage sniff both passed):
  - The create form shows cap 5000 and minimum 1.
  - A website saved from the form stores 1, and its detail caption reads "at least 1 ms after the page loads".
  - A website created through the API without the fields gets 5000 / 1.
  - Both temporary websites were soft-deleted.
- **Checks:**
  - `npm run test:coverage`: 554 tests in 42 files, all passing. Statements 99.77%, branches 99.44%, functions 100%, lines 99.88%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Not touched:** the user's dev servers were left running, as they started them.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 17:38 EDT — Screenshots wait for network idle + paint, with per-website timing settings

**Intent:**
- Screenshots were still catching a loading spinner. On the Forge Gym site the real content appears about 810 ms after the page's `load` event, so the fixed 1/200/300 ms delays of the previous entry could not fix it.
- At the user's request, the screenshot now waits for the page to be **ready** instead:
  1. network requests finished (capped);
  2. the page painted;
  3. a **minimum wait** since `load` has passed.
- The cap and the minimum are **settings on each website**, edited on the website form. This entry supersedes the fixed `SCREENSHOT_DELAY_MS` experiment below.

### Decisions (all made by the user)

- **Order:** load → network idle (capped) → painted → minimum wait satisfied → screenshot.
- **The minimum wait is a floor, not an extra delay.** If idle + paint already took at least the minimum, the screenshot is taken at once. Otherwise only the remainder is waited.
- **When the cap runs out** while the network is still busy, the paint wait is skipped and the screenshot is taken at once. Success is still judged by HTTP status.
- **The cap may not be lower than the minimum wait** (validated). So by the time the cap runs out, the minimum has always passed.
- **The paint wait's safety limit is 2 s.** It is fixed, not a setting.
- **The settings live on `Website`** and are edited on the create/edit form. Defaults are cap **5000 ms** and minimum **300 ms**; values are whole **milliseconds 0–30000**.
- **Runs are unchanged.** Nothing new is recorded on `ScreenshotRun`.
- **Approved in the plan:**
  - the minimum is measured from `load`;
  - a cap of `0` means "don't wait for idle", because Playwright reads `timeout: 0` as "forever";
  - the server fills in the defaults when the fields are omitted;
  - the detail page shows the settings as a caption.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `Website` gained `networkIdleTimeoutMs Int @default(5000)` and `screenshotMinimumWaitMs Int @default(300)`, and its doc comment describes them. `db push` + `generate` were run. The 2 existing websites got the defaults; no data was lost. |
| `server/utils/validateRequestBodies.ts` | **Added:** exported constants `DEFAULT_NETWORK_IDLE_TIMEOUT_MS` (5000), `DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS` (300), `MAX_TIMING_SETTING_MS` (30000); private helper `readOptionalMilliseconds`. **Changed** `validateWebsiteInput`: it reads both settings (JSON numbers only; missing or null become the defaults), rejects out-of-range or non-integer values, rejects a cap below the minimum, and returns both fields. Its JSDoc rules are updated. |
| `server/services/dbService.ts` | `WebsiteInput` gained the optional `networkIdleTimeoutMs?` and `screenshotMinimumWaitMs?`. JSDoc of `createWebsite` / `updateWebsite` updated. No logic change. |
| `server/services/playwrightService.ts` | See the breakdown below this table. |
| `server/controllers/playwright.ts` | The POST passes the found website's `networkIdleTimeoutMs` / `screenshotMinimumWaitMs` to `captureWebsiteScreenshot`. Its JSDoc describes the wait sequence. |
| `server/controllers/websites.ts` | JSDoc only: the POST/PUT `@param body` lines list the two settings and their rules. |

**`server/services/playwrightService.ts` in detail:**
- **Removed:** `SCREENSHOT_DELAY_MS`, and `saveViewportScreenshot`, which is replaced by `captureWhenReady`.
- **Added:**
  - `PAINT_WAIT_LIMIT_MS` (2000) and the exported `ScreenshotTimingSettings`;
  - the import of `errors` from `playwright`;
  - private helpers `waitForNetworkIdle` (a cap of 0 skips it; `errors.TimeoutError` → `false`; other errors rethrown), `waitForPaint` (an in-page `page.evaluate`: fonts ready + two `requestAnimationFrame`s, each raced against the 2 s limit) and `captureWhenReady` (idle → paint → remaining minimum → screenshot; cap ran out → screenshot at once).
- **Changed:** `captureWebsiteScreenshot` and `visitPageAndCapture` take `timingSettings`, and their JSDoc is updated.

### Files changed — client

| File | Change |
|---|---|
| `src/hooks/useWebsites.ts` | `WebsiteRecord` and `WebsiteRequestBody` gained `networkIdleTimeoutMs` and `screenshotMinimumWaitMs`. |
| `src/components/WebsiteForm.tsx` | **Added:** the "Screenshot settings" subheading; number fields "Network idle cap (ms)" and "Minimum wait (ms)" with helper text; state `networkIdleTimeoutMs` / `screenshotMinimumWaitMs` (held as text); handlers `handleNetworkIdleTimeoutChange` / `handleScreenshotMinimumWaitChange`; conditionals `networkIdleTimeoutIsFilled` / `screenshotMinimumWaitIsFilled`. **Changed:** submit is blocked while either is blank, and `onSubmit` sends them as numbers. JSDoc updated. |
| `src/pages/WebsiteCreatePage.tsx` | `EMPTY_WEBSITE_VALUES` renamed to `NEW_WEBSITE_VALUES`, with the 5000/300 defaults. JSDoc updated. |
| `src/pages/WebsiteEditPage.tsx` | `initialValues` includes both settings from the loaded website. JSDoc updated. |
| `src/components/ScreenshotRunsSection.tsx` | New props `networkIdleTimeoutMs` / `screenshotMinimumWaitMs`; new conditional `networkIdleWaitIsDisabled`; a `timingSettingsText` caption under the heading. JSDoc updated. |
| `src/pages/WebsiteDetailPage.tsx` | Passes the website's two settings to `ScreenshotRunsSection`. JSDoc updated. |

### Files changed — docs

- `server/services/README.md`:
  - the order of work is rewritten (it also fixes the stale "currently 200 ms");
  - a note warns that the in-page `__name` function must stay anonymous;
  - the result table gains the cap-expired row.
- `server/prisma/README.md` and `server/utils/README.md`: the Website rows.
- `server/controllers/README.md`: how the row's settings drive the wait.
- `src/components/README.md`: the form and section rows.
- Root `README.md`: the feature blurb.

### Tests

- **`tests/backend/services/playwrightService.test.ts`, rewritten:**
  - mocks `waitForLoadState`, `evaluate`, and `errors.TimeoutError` (`MockTimeoutError`), with a fake `performance.now` clock (`fakeNowMs`) and the helper `readPaintWaitScript`;
  - covers the sequence order and the remaining-minimum arithmetic (180 ms);
  - covers no extra wait once the minimum is met, including exactly at it;
  - covers a cap that runs out (no paint, no wait), a cap of 0, and a per-website cap;
  - covers failures at each step;
  - runs the **real in-page paint script** against stubbed `document.fonts` / `requestAnimationFrame` (two frames; gives up at 2 s when frames or fonts never come).
- **Changed `tests/backend/utils/validateRequestBodies.test.ts`:**
  - the success cases gain the defaults;
  - new cases for values that pass, invalid values for each field, and a cap below the minimum (explicit, a defaulted cap, and 0 with the default minimum).
- **Changed `tests/backend/api/websites.test.ts`:** expectations include the settings; a pass-through test for custom values; 400 tests for a cap below the minimum and an out-of-range cap.
- **Changed `tests/backend/server.test.ts` and `tests/backend/api/playwright.test.ts`:** fixtures and expectations include the settings. The controller test uses non-default values to prove the row's settings are passed through.
- **Frontend:**
  - `buildWebsiteRecord` gained the defaults.
  - `WebsiteForm.test.tsx`: helpers `BLANK_VALUES`, `getNetworkIdleCapField`, `getMinimumWaitField`; the fields seed from `initialValues` and have a heading and helper text; numbers are submitted; a blank field blocks submit.
  - The create and edit pages: pre-fill and exact request bodies.
  - `ScreenshotRunsSection` and `WebsiteDetailPage`: caption text, including the cap-0 wording.

### Verification performed

- **psql:** the existing websites read 5000 / 300 after `db push`.
- **The user's dev servers had stopped** by the time of verification. I started `npm run dev`, passed the health check and the homepage sniff test, and stopped it afterwards.
- **First end-to-end run caught a real bug:** `page.evaluate: ReferenceError: __name is not defined`. A named inner function in the in-page script had been wrapped by esbuild. Fixed by keeping the in-page code anonymous, which is now documented in the code and README. Unit tests could not catch this because they mock the browser.
- **End-to-end run** with a throwaway Playwright script (`claude_tmp/verify-readiness.mts`), using temporary websites only:
  - The create form shows 5000 / 300, and the detail caption shows the settings.
  - **Forge `/` now shows the landing card, not the spinner. Forge `/login` shows the email and password inputs.**
  - Validation messages appear for 30001, -1, 1.5, and cap 200 below minimum 300. A blank field disables Save. A valid edit (4000/4000) saves and the caption updates.
  - **Local test site timings** (POST round trip, including browser launch):

    | Page | Cap / minimum | Time |
    |---|---|---|
    | never-idle | 1500 / 1000 | 1646 ms (the cap ended the wait) |
    | never-idle | 0 / 0 | 181 ms |
    | static | 5000 / 0 | 684 ms |
    | static | 5000 / 3000 | 3153 ms (the minimum is a floor) |
    | Forge | 5000 / 300 | 1068 ms (no extra wait) |

- **Checks:**
  - `npm run test:coverage`: 554 tests in 42 files, all passing. Statements 99.77%, branches 99.44%, functions 100%, lines 99.88%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Cleanup:** every temporary website was soft-deleted, and the local test site was closed. The user's "Forge Gym management" and "Example Again" websites gained no runs.

### Notable during implementation

- **Forge's `/` never has email/password inputs.** It is a landing card; the form is at `/login`. The user was told, and the stored URL was not changed.
- **Playwright treats `timeout: 0` as "no timeout"**, which is why a cap of 0 is special-cased rather than passed through.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 17:08 EDT — Screenshot delay after page load (experiment, currently 200 ms)

**Intent:**
- Screenshots were taken before the page was ready. On the user's "Forge Gym management" website (`https://forge.aikazi.com/`) the PNG showed a loading spinner instead of the page.
- At the user's request, add a fixed wait between the page's `load` event and the screenshot, and tune its value by experiment.

### Decisions (all made by the user)

- First try 1 ms, then 200 ms. The value is still being tuned.

### Files changed

| File | Change |
|---|---|
| `server/services/playwrightService.ts` | **Added** constant `SCREENSHOT_DELAY_MS` (currently `200`). **Changed** `saveViewportScreenshot`: it now calls `page.waitForTimeout(SCREENSHOT_DELAY_MS)` before `page.screenshot`, inside the same `try`, so a failed wait is reported as "The screenshot could not be saved: …". Its JSDoc is updated. The wait runs only when navigation completed, and it is not counted in `durationMs`. |
| `server/services/README.md` | The "order of work" list gains the wait step (now step 4 of 5). |
| `tests/backend/services/playwrightService.test.ts` | `mockPage.waitForTimeout` added. New constant `EXPECTED_SCREENSHOT_DELAY_MS`. New tests: the wait runs after `goto` and before `screenshot` with the configured delay; a failed wait becomes a failed run with no screenshot. The navigation-failure test now also asserts there is no wait. |

### Verification performed

- **End-to-end runs** with a throwaway Playwright script (`claude_tmp/verify-delay.mts`). For each delay it created a temporary website at `https://forge.aikazi.com/?verify=<ts>`, clicked **Take screenshot** in the UI against the user's running dev server, saved the image, and soft-deleted the website.
  - **1 ms:** still shows the spinner.
  - **200 ms:** still shows the spinner.
- **Timing probe** (read-only, nothing recorded), over 3 visits each of `/` and `/login`:
  - Forge's real content appears **about 810 ms after `load`**, every time (809–816 ms).
  - At `networkidle` (about 830 ms from navigation start), the `/login` inputs were already visible.
- **The stored URL `https://forge.aikazi.com/` never shows email or password inputs.** After loading it is a landing card with "Log in" / "Create an account" buttons. The login form, with 2 inputs, is at `https://forge.aikazi.com/login`. The user was told; the stored URL was not changed.
- **Checks:**
  - `npm run test:coverage`: 515 tests in 42 files, all passing. Statements 99.75%, branches 99.39%, functions 100%, lines 99.87%.
  - `npm run lint` and `npm run tsc`: clean.
- **Not touched:** the user's own dev servers were left running. The user's Forge website gained no runs from this testing.

---

## 2026-10-02 17:00 EDT — Playwright controller: screenshot a website on demand

**Intent:**
- Add a **Playwright controller**. It launches a headless Chromium on the host machine, visits a website's stored URL, saves a screenshot, and records whether the visit succeeded.
- For now it runs only when the user clicks **Take screenshot** on the website detail page.
- Every run is saved. The page shows the selected run's status and screenshot (newest by default), plus a "Run history" list to pick older runs from.
- At the user's request, the folder screenshots are saved to is configurable (`SCREENSHOT_DIR`).

### Decisions (all made by the user)

- The button is on the **website detail page**, beside Edit/Delete.
- **Every run is recorded in the DB.** The PNG is a file on disk; the DB stores only its file name, relative to the screenshot folder.
- The UI shows the **latest run and a list of past runs**, and clicking one shows its screenshot.
- **Headless** Chromium. The capture is **viewport-only at 1280×720**.
- **Success** means navigation completed and the HTTP status was below 400.
  - A 404/500 page is a failed run that still has a screenshot.
  - A DNS error, refused connection, or timeout is a failed run with no screenshot.
- The default image folder is `screenshots/` at the repo root (gitignored). It is configurable via `SCREENSHOT_DIR`.
- **Screenshot runs follow the soft-delete convention** (`deletedAt`) and are soft-deleted together with their website.
- `playwright` **moved from devDependencies to dependencies**, at the same version.
- Approved in the plan:
  - a 30 s navigation timeout;
  - the POST answers **201 even for a failed visit**, because the run was still recorded;
  - the delete-website dialog also counts screenshot runs.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **Added** model `ScreenshotRun` (`screenshot_runs`). Fields: `id`, `websiteId`, `requestedUrl`, `succeeded`, `httpStatus?`, `errorMessage?`, `screenshotFileName?`, `durationMs`, `createdAt`, `updatedAt`, `deletedAt?`, `website`. Index on `websiteId`. `Website` gained `screenshotRuns`, and its doc comment now says runs are soft-deleted with it. `db push` and `generate` were run; this was a new table only, with no data-loss prompt. |
| `server/services/dbService.ts` | **Added:** the `ScreenshotRun` type re-export; interface `ScreenshotRunInput`; `listScreenshotRunsForWebsite`, `findScreenshotRunForWebsite`, `createScreenshotRunForWebsite`. **Changed:** `softDeleteWebsite` (inner `softDeleteWebsiteAndItsChildren`) now also stamps the website's active screenshot runs with the shared `deletedAt`, and its JSDoc says so. |
| `server/services/playwrightService.ts` | **New.** See the breakdown below this table. |
| `server/controllers/playwright.ts` | **New.** See the breakdown below this table. |
| `server/utils/resolveScreenshotDirectory.ts` | **New.** `resolveScreenshotDirectory()` reads `SCREENSHOT_DIR`, trims it, resolves a relative value against `process.cwd()`, and throws if the value is missing or blank. |
| `server/server.ts` | **Added** `SCREENSHOT_DIRECTORY = resolveScreenshotDirectory()` at boot (fail fast) and `registerPlaywrightRoutes(app, SCREENSHOT_DIRECTORY)`. |

**`server/services/playwrightService.ts` in detail:**
- **Exports:** `ScreenshotCaptureResult` and `captureWebsiteScreenshot(url, screenshotFilePath)`.
- **Constants:** `NAVIGATION_TIMEOUT_MS`, `SCREENSHOT_VIEWPORT`, `FIRST_FAILING_HTTP_STATUS`.
- **Private type:** `NavigationOutcome`.
- **Private helpers:**
  - `measureElapsedMs`, `summarizeError` (keeps the first line only), `describeUnsuccessfulResponse`
  - `navigateToUrl`, `saveViewportScreenshot`, `visitPageAndCapture`
  - `closeBrowserQuietly`
- **Order of work:** create the folder (before launch), launch Chromium, open a page, visit, screenshot. The browser is closed in `finally`.

**`server/controllers/playwright.ts` in detail:**
- **Entry point:** `registerPlaywrightRoutes(app, screenshotDirectory)`.
- **Routes:**
  - `GET /api/websites/:websiteId/screenshot-runs`
  - `POST /api/websites/:websiteId/screenshot-runs`
  - `GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot`
- **Message constants:** `WEBSITE_NOT_FOUND_MESSAGE`, `SCREENSHOT_RUN_NOT_FOUND_MESSAGE`, `RUN_HAS_NO_SCREENSHOT_MESSAGE`, `SCREENSHOT_FILE_NOT_FOUND_MESSAGE`.
- **Private helpers:** `buildScreenshotFileName`, which gives `<website.id>/<uuid>.png`, and `readSendErrorStatus`.
- **How the image is served:** `res.sendFile(name, { root })` with a callback (`handleScreenshotFileSent`) that answers send errors itself.

### Files changed — client

| File | Change |
|---|---|
| `src/utils/routePaths.ts` | **Added** `screenshotRunsApiUrl(websiteId)` and `screenshotRunImageApiUrl(websiteId, screenshotRunId)`. |
| `src/utils/describeScreenshotRun.ts` | **New.** `ScreenshotRunOutcomeFields`, `describeScreenshotRunOutcome` ("Succeeded · HTTP 200" / "Failed · No response"), `formatRunDuration` ("1.2 s"). |
| `src/hooks/useScreenshotRuns.ts` | **New.** `ScreenshotRunRecord`, `ScreenshotRunsState`, `useScreenshotRuns(websiteId)` → `{ runs, isLoading, errorMessage, addTakenRun }`. Runs taken on this visit are shown first: they are filtered by `websiteId`, and fetched runs are de-duplicated by id. No refetch. |
| `src/components/ScreenshotRunsSection.tsx` | **New.** `ScreenshotRunsSectionProps` and `ScreenshotRunsSection`: the "Screenshots" section with a progress bar, a take-error alert, `LoadStatusNotice`, the empty state, the selected run, and the "Run history" list. Constants `HEADING_ID` and `HISTORY_HEADING_ID`. |
| `src/components/ScreenshotRunDetails.tsx` | **New.** `ScreenshotRunDetailsProps` and `ScreenshotRunDetails`: a `role="status"` outcome alert, the "Taken … · url" caption, and the `<img>` (or "No screenshot was captured for this run."). |
| `src/pages/WebsiteDetailPage.tsx` | **Added:** `screenshotRuns` / `addTakenRun` (`useScreenshotRuns`); a second `useJsonMutation` (`sendScreenshotRequest`, `screenshotIsInFlight`, `screenshotErrorMessage`); `selectedRunId` state; `screenshotRunCountText`; `takeScreenshot`; `handleTakeScreenshotClick`; the "Take screenshot" / "Taking screenshot…" button; `<ScreenshotRunsSection>`. **Changed:** the button row wraps (`useFlexGap`, `flexWrap`), the delete dialog message counts screenshot runs, and the page JSDoc. |

### Files changed — config, tooling, docs

- **`package.json` / `package-lock.json`:** `playwright@^1.58.2` moved from `devDependencies` to `dependencies`. `npm install` dropped its `dev` flags in the lockfile; installed version 1.63.0 is unchanged.
- **`.env`:** added `SCREENSHOT_DIR=screenshots`.
- **`.env.example`:** added a documented `SCREENSHOT_DIR`. `.env.local` was not touched.
- **`.gitignore`:** added `/screenshots/`.
- **READMEs updated:**
  - root `README.md`: feature blurb, `npx playwright install chromium` in setup, env table, tripwire note.
  - server: `server/controllers/README.md`, `server/services/README.md`, `server/utils/README.md`, `server/prisma/README.md`.
  - client: `src/hooks/README.md`, `src/components/README.md`, `src/pages/README.md`.
  - `tests/README.md`.

### Tests

**Backend:**
- **New specs:**
  - `tests/backend/utils/resolveScreenshotDirectory.test.ts`
  - `tests/backend/services/playwrightService.test.ts`, which mocks `playwright` and `node:fs/promises` so no real browser launches.
  - `tests/backend/api/playwright.test.ts`, with helpers `createPlaywrightApp` and `readRequestedScreenshotFilePath`. It covers every status in the route matrix, including path traversal (500 "Forbidden", no file served) and a directory name (500 "EISDIR, read").
- **New fixture:** `tests/backend/fixtures/screenshot-files/website-id-from-db/existing-run.png`, a 1×1 PNG served through the real `res.sendFile`.
- **Changed `tests/backend/services/dbService.test.ts`:**
  - `mockScreenshotRunDelegate` and `sampleScreenshotRun`.
  - The `softDeleteWebsite` tests now cover runs; one was renamed to "all four tables".
  - A new `describe("screenshot runs")` with 4 tests.
- **Changed `tests/backend/server.test.ts`:**
  - Mocks for the 3 new dbService functions and the Playwright service.
  - `sampleScreenshotRun`.
  - 2 wiring tests. One asserts the capture path is inside `resolveScreenshotDirectory()`.

**Frontend:**
- **New specs:** `describeScreenshotRun.test.tsx`, `useScreenshotRuns.test.tsx`, `ScreenshotRunsSection.test.tsx` (helpers `renderSection`, `getRunHistory`), `ScreenshotRunDetails.test.tsx`.
- **Changed `frontendTestHelpers.tsx`:** added `buildScreenshotRunRecord`.
- **Changed `routePaths.test.tsx`:** 3 tests for the screenshot run URLs.
- **Changed `App.test.tsx`:** `stubEveryPageRequest` stubs the runs list.
- **Changed `WebsiteDetailPage.test.tsx`:**
  - `SCREENSHOT_RUNS_API_URL` added. `stubLoadedWebsite` stubs the runs list as `[]`.
  - The delete-dialog texts were updated for the run count, and one new count test was added.
  - The loading and not-found tests also assert there is no Take screenshot button.
  - A new `describe("screenshots")` with 7 tests: in-flight state, POST once and no refetch, POST failure, list failure, selection.

### Verification performed

- **curl smoke test against the real dev server and DB:**
  - A run against the app's own homepage returned 201 `succeeded: true`, HTTP 200, and a PNG file that was 1280×720.
  - An Express 404 URL returned 201 `succeeded: false`, HTTP 404, with a screenshot.
  - A closed port returned 201 `succeeded: false`, `net::ERR_CONNECTION_REFUSED`, and `screenshotFileName: null`.
  - The image route answered 200 `image/png`. It answered 404 for a run with no image, an unknown run, a run of another website, and an unknown website.
- **manual-verifier agent** (Playwright, headless Chromium): **VERIFIED**, all 9 scenarios.
  - Statuses and images are correct, and the image's natural size is 1280×720.
  - The in-flight state was observed: the button disabled with "Taking screenshot…" and the progress bar shown.
  - A new run goes to the top and is selected. Runs persist across a reload. Selecting an older run works.
  - The empty state, a DNS failure, and both the singular and plural delete-dialog counts.
  - After a website is deleted, its runs list answers 404.
  - No console errors. The buttons wrap at 300 px.
- **`SCREENSHOT_DIR` override:** the server was started alone with `claude_tmp/alt-shots` (relative), an absolute path, and `claude_tmp/.hidden/shots` (a dot-folder). Each time:
  - the PNG landed in that folder, not in `screenshots/`;
  - the image route served it with 200.
  - An empty or whitespace-only value makes the server exit at startup with "SCREENSHOT_DIR is not defined in environment variables".
- **`npm run test:coverage`:** **513 tests in 42 files, all passing.**
  - Statements 99.75%, branches 99.39%, functions 100%, lines 99.87%, against thresholds of 80/70/80/80.
  - Uncovered: the NODE_ENV-guarded `startListening` in `server.ts`, and the `res.headersSent` (client aborted mid-download) guard in `playwright.ts`.
- `npm run lint`: clean. `npm run tsc` and `npm run tsc:client`: clean.
- **Cleanup:**
  - The 4 smoke-test websites were soft-deleted through the API. All 14 test runs now carry `deletedAt`, which confirms the cascade in Postgres.
  - The user's "Forge Gym management" and "Example Again" websites were left untouched.
  - `screenshots/` (test PNGs only) and every `claude_tmp/` file were removed.
  - The dev servers and a surviving `tsx watch` parent were stopped. Ports 3010 and 5180 are free.

### Notable during implementation

- **Port 1 is not a "connection refused" target.** Chromium blocks it as `net::ERR_UNSAFE_PORT` before connecting. Use a closed high port such as 59997.
- **A run that never reached a page still leaves an empty `<websiteId>/` folder,** because the folder is created before the browser launches, so that a bad `SCREENSHOT_DIR` fails fast.
- **The `tsx watch` parent ignored SIGTERM** after its child was gone, and needed SIGKILL (same root cause as in the previous entry).
- **Playwright's error text reaches the UI verbatim** (e.g. `page.goto: net::ERR_CONNECTION_REFUSED at …`), trimmed to its first line.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 16:14 EDT — Websites / Use cases / Actions CRUD, soft delete, JSDoc lint

**Intent:**
- Give the `websites` table a full CRUD API and UI, with a page per website.
- Add two website-owned concepts, **UseCase** and **Action** (title + description each), with their own CRUD API and pages.
- Make sure browser Back and Forward keep working across every screen.
- At the user's request, enforce JSDoc with `eslint-plugin-jsdoc` (`recommended-tsdoc-error`) and widen `npm run lint` from `server/` to `server/` + `src/`.

### Decisions (all made by the user)

- **Forms are separate routed pages**, not dialogs, so every screen is a history entry.
- **Soft delete on all three tables** (`deletedAt`). Deleting a website soft-deletes its active use cases and actions in one transaction with the same timestamp.
- **Website URL is unique among active websites only.** This uses Prisma 7.10's `partialIndexes` preview feature: `@@unique([url], where: { deletedAt: null })`. A deleted website's URL can be re-added.
- **URLs are normalized** with `new URL(input).href` (`HTTPS://Example.COM` → `https://example.com/`).
- **Use case and action descriptions are required.** The website description stays optional.
- **`@route` is registered** as a JSDoc tag. It is set through the `jsdoc/check-tag-names` rule option; `settings.jsdoc.definedTags` was verified not to work.
- **`npx prisma db push --accept-data-loss`** was run with explicit user consent. Prisma's AI-agent guard required the `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` env var. The `websites` table had 0 rows.
- **`.claude/agents/manual-verifier.md`** wrote its memory into `/Users/khalah/Projects/new_plex/...`. At the user's choice it now points at this project's `.claude/agent-memory/manual-verifier/`.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `previewFeatures = ["partialIndexes"]`. `Website`: added `deletedAt`, `useCases`, and `actions`; `@unique` on `url` replaced by the partial `@@unique`. **Added** models `UseCase` (`use_cases`) and `Action` (`actions`): `id`, `websiteId`, `title`, `description`, `createdAt`, `updatedAt`, `deletedAt`, plus an index on `websiteId`. |
| `server/services/dbService.ts` | See the breakdown below this table. |
| `server/utils/describeError.ts` | **New.** `describeError(error)`. |
| `server/utils/validateRequestBodies.ts` | **New.** Exports `ValidationResult<T>`, `validateWebsiteInput`, and `validateTitleDescriptionInput`. Private helpers: `isJsonObject`, `readTrimmedString`, `normalizeHttpUrl`. |
| `server/controllers/websites.ts` | **New.** `registerWebsiteRoutes(app)`: `GET`/`POST /api/websites`, `GET`/`PUT`/`DELETE /api/websites/:websiteId`. Constants `WEBSITE_NOT_FOUND_MESSAGE` and `DUPLICATE_URL_MESSAGE`. |
| `server/controllers/useCases.ts` | **New.** `registerUseCaseRoutes(app)`: `/api/websites/:websiteId/use-cases[/:useCaseId]`. |
| `server/controllers/actions.ts` | **New.** `registerActionRoutes(app)`: `/api/websites/:websiteId/actions[/:actionId]`. |
| `server/server.ts` | Registers the three new controllers. `startListening` JSDoc restyled (no `{Type}`). |
| `server/controllers/health.ts` | JSDoc restyled for the tsdoc preset. No code change. |
| `server/utils/resolveServerPort.ts` | JSDoc restyled. No code change. |

**`server/services/dbService.ts` in detail:**
- **Renamed** `CreateWebsiteInput` to `WebsiteInput`.
- **Added types:** `TitleDescriptionInput`, `UseCaseInput`, `ActionInput`. Also re-exports the `UseCase` and `Action` types.
- **Added error checks:** `isUniqueConstraintViolation` (P2002) and `isRecordNotFound` (P2025), sharing the private helper `hasPrismaErrorCode`.
- **Website functions added:** `findWebsiteById`, `updateWebsite` (atomic update; P2025 → null), and `softDeleteWebsite` (an interactive transaction; its callback is `softDeleteWebsiteAndItsChildren`).
- **Website functions changed:** `listWebsites` now filters out deleted rows; `findWebsiteByUrl` now uses `findFirst` and filters out deleted rows.
- **Removed:** `deleteWebsiteByUrl` (unused, and a hard delete contradicts soft delete).
- **Use case functions added:** `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite`.
- **Action functions added:** the same five, named `...ActionForWebsite` / `listActionsForWebsite`.
- **Implementation note:** the `$transaction` callback needs an explicit `Prisma.TransactionClient` type; without it, tsc reports an implicit `any`.

### Files changed — client

| File | Change |
|---|---|
| `src/App.tsx` | Renders `AppHeader` and the 10 routes. Each use case / action route element has its own `key`. |
| `src/main.tsx` | The `!` non-null assertion became a checked `rootElement` lookup that throws a clear error (lint). |
| `src/hooks/useHealth.ts` | `String(response.status)` in the template (lint). Added JSDoc to the inner `loadHealth`. Return JSDoc restyled. |
| `src/pages/HomePage.tsx` | JSDoc restyled. No code change. |
| `src/utils/describeError.ts` | **New.** `describeError` and `readResponseErrorMessage`. |
| `src/utils/routePaths.ts` | **New.** Page paths: `WEBSITE_LIST_PATH`, `NEW_WEBSITE_PATH`, `websiteDetailPath`, `websiteEditPath`, `newWebsiteItemPath`, `websiteItemDetailPath`, `websiteItemEditPath`. API URLs: `WEBSITES_API_URL`, `websiteApiUrl`, `websiteItemsApiUrl`, `websiteItemApiUrl`. |
| `src/utils/websiteItemKinds.ts` | **New.** `WebsiteItemKind`, `USE_CASE_KIND`, `ACTION_KIND`, `WebsiteItemPageProps`. |
| `src/utils/formatCount.ts` | **New.** `formatCount`. |
| `src/hooks/useJsonResource.ts` | **New.** `JsonResourceState<T>` and `useJsonResource(url)`. Its result is keyed by URL, it uses a `cancelled` flag, and its inner function is `loadResource`. |
| `src/hooks/useJsonMutation.ts` | **New.** `MutationMethod`, `MutationResult`, `SendJsonRequest`, `useJsonMutation()`. |
| `src/hooks/useWebsites.ts` | **New.** `WebsiteRecord`, `WebsiteRequestBody`, `useWebsites`, `useWebsite`. |
| `src/hooks/useWebsiteItems.ts` | **New.** `WebsiteItemRecord`, `WebsiteItemRequestBody`, `useWebsiteItems`, `useWebsiteItem`. |
| `src/hooks/useRequiredRouteParam.ts` | **New.** `useRequiredRouteParam`. |
| `src/hooks/useReturnNavigation.ts` | **New.** `ReturnState`, `useReturnToHereState`, `useReturnNavigation` (returns `returnTo` and `replaceKeepingReturnState`). Private helper `readReturnTo`. |
| `src/components/*.tsx` | **New.** `AppHeader`, `PageBreadcrumbs` (`BreadcrumbItem`), `LoadStatusNotice`, `ConfirmDeleteDialog`, `WebsiteForm`, `TitleDescriptionForm`, `WebsiteItemListSection`. Each comes with its `<Name>Props` interface. |
| `src/pages/Website*.tsx` | **New.** `WebsiteListPage`, `WebsiteCreatePage`, `WebsiteEditPage`, `WebsiteDetailPage`, `WebsiteItemCreatePage`, `WebsiteItemDetailPage`, `WebsiteItemEditPage`. |

**History rule:**
- Links into forms and detail pages carry `state.returnTo`.
- Cancel, edit-Save, and Delete go back one entry when `returnTo` matches the destination, and otherwise replace the current entry.
- Create-Save replaces the form entry with the new record's page and keeps that state.
- Result: history never holds a stale form or a duplicate `[detail, detail]`.

### Files changed — config, tooling, docs

- `package.json` / `package-lock.json`:
  - Added devDependency `eslint-plugin-jsdoc@^65.0.2`, which ships its own types.
  - `"lint"` is now `npx eslint server src`.
- `eslint.config.ts`:
  - Added the constant `jsdocTsdocPreset`.
  - Added a block applying it to `./server/**` and `./src/**`, with the `@route` `check-tag-names` option.
- `.claude/agents/manual-verifier.md`: memory path fixed (line 191).
- **READMEs updated:**
  - root `README.md`
  - `server/controllers/`, `server/services/`, `server/prisma/`, `server/utils/`
  - `src/`, `src/hooks/`, `src/pages/`
- **README added:** `src/components/README.md`.

### Tests

**Backend:**
- **New specs:**
  - `tests/backend/utils/describeError.test.ts`
  - `tests/backend/utils/validateRequestBodies.test.ts`
  - `tests/backend/api/websites.test.ts` (helper `createWebsitesApp`)
  - `tests/backend/api/useCases.test.ts` (helper `createUseCasesApp`)
  - `tests/backend/api/actions.test.ts` (helper `createActionsApp`)
- **Changed `tests/backend/services/dbService.test.ts`:**
  - Mocks for the `useCase`/`action` delegates and `$transaction`.
  - Helpers `createMockModelDelegate` and `readDeletedAtWrittenBy`.
  - The `deleteWebsiteByUrl` test was replaced by soft-delete tests, because that function was removed.
  - Two existing tests were renamed for soft-delete semantics.
- **Changed `tests/backend/server.test.ts`:**
  - Mocks dbService.
  - Four new "routes are wired" tests.
  - All original tests kept.

**Frontend:**
- **New specs:** one `tests/frontend/<Source>.test.tsx` per new util, hook, component, and page (24 files).
- **New shared module `tests/frontend/support/frontendTestHelpers.tsx`:**
  - `stubFetchRoutes`, `buildJsonResponse`, `buildUnparseableResponse`, `countRequests`
  - `createDeferred`, `createRejectedFetch`
  - `buildWebsiteRecord`, `buildWebsiteItemRecord`, `ITEM_KIND_TEST_CASES`
  - `LocationProbe`, `renderPageRoutes`, `readProbeAfterLanding`, `readBreadcrumbTrail`
  - Their types.
- **Changed `tests/frontend/App.test.tsx`:**
  - Added a `describe("App routes")` block with helper `stubEveryPageRequest`.
  - The original tests are unchanged.

The backend and frontend specs were written by two parallel subagents. Both were limited to `tests/` and reported no source bugs.

### Verification performed

- **Database:**
  - `psql \d websites` shows `websites_url_key UNIQUE ... WHERE "deletedAt" IS NULL`.
  - The `use_cases` and `actions` tables exist with their FKs and the `websiteId` index.
- **curl smoke test against the real DB:**
  - URL normalization works.
  - Duplicate URL returns 409 (P2002 arrives through the pg adapter).
  - Invalid bodies return 400.
  - Website delete stamps one identical `deletedAt` on the website, its use case, and its action, after which all three return 404.
  - Re-adding the deleted URL returns 201.
  - The test rows were then removed.
- **manual-verifier agent** (Playwright, about 75 checks): **VERIFIED**.
  - Create, view, edit, and delete for all three record types.
  - Back and Forward after save, cancel, and delete, with no stale forms and no duplicate entries.
  - Deep links and reloads work.
  - The delete dialog shows the counts.
  - Forward onto a deleted record shows "… not found".
  - No JS errors.
  - It left soft-deleted test rows and one active "Example Again" website in `easy_test_dev`.
- `npm run test:coverage`: **427 tests in 35 files, all passing.**
  - Statements 99.84%, branches 99.61%, functions 100%, lines 99.84%, against thresholds of 80/70/80/80.
  - The only uncovered line is the NODE_ENV-guarded `startListening(app, PORT)` in `server.ts`.
- `npm run lint` (server + src): clean. `npm run tsc` and `npm run tsc:client`: clean.

### Notable during implementation

- Prisma refuses `db push --accept-data-loss` from an AI agent until it gets consent in the moment. Earlier approval does not count.
- `./stop-dev.sh` kills only the **listeners** on 3010/5180. After the verifier's `npm run dev`, the parent `tsx watch` process survived and started a new server when server files were edited. It was found with `lsof` and stopped by PID. The script itself was not changed.
- `tests/` is outside `npm run lint`'s scope, by the user's choice. Some pre-existing test files still use `{Type}` JSDoc and would fail the jsdoc and strict TypeScript rules if they were ever linted.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-09-17 16:27 EDT — Initial development scaffold

**Intent:** Stand up a new project from empty, mirroring the architecture of the
`new_plex` repo, with a health API, a Hello World homepage that displays that
health live, and a Prisma `Website` table for saving URLs to test. Development
only — no production build, PM2, Docker, or CI.

The `new_plex` GitHub URL 404s (private repo); the architecture was taken from
the local clone at `/Users/khalah/Projects/new_plex`, which was read but never
modified.

### Decisions

- **Database:** local Homebrew PostgreSQL 18, database `easy_test_dev`, user
  `khalah`, no password. Not SQLite (which is what `new_plex` uses).
- **Ports:** `SERVER_PORT=3010`, `VITE_PORT=5180` — clear of every other project
  on this machine. `3011`/`5181` reserved for a future production pair.
- **Tests:** unit tests only, per user request. No `tests/playwright/` directory
  and no `playwright.config.ts`; Playwright is still used to drive end-to-end
  checks, but as throwaway scripts in `claude_tmp/`.
- **Git:** left uninitialized. The user runs `git init` themselves.
- **Tooling in `devDependencies`** (unlike `new_plex`, which needs it in
  `dependencies` for its `--omit=dev` production install). Tripwire recorded in
  `README.md`.

### Prisma 7 notes

Three findings that shaped the wiring, verified against the installed packages:

1. A **driver adapter is mandatory** — `PrismaClientOptions` types `adapter` as
   required unless `accelerateUrl` is given, so plain `new PrismaClient()`
   neither typechecks nor runs. Uses `@prisma/adapter-pg`.
2. npm's `prisma@latest` is **`8.0.0-rc.15`**, a prerelease. The Prisma trio is
   pinned `^7.3.0`, resolving to 7.10.0.
3. `@prisma/adapter-pg` ships `pg` and `@types/pg` as its own dependencies, so
   neither is declared here.

The datasource URL lives in `prisma.config.ts`, not `schema.prisma`.

### Files created

**Config / env:** `.gitignore`, `.env`, `.env.example`, `.env.local`,
`package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`,
`vitest.config.ts`, `eslint.config.ts`, `stop-dev.sh`, `prisma.config.ts`.

**Server:**

| File | Added |
|---|---|
| `server/bootEnv.ts` | Module-load `dotenv.config()` for `.env.local` then `.env`. No exports. |
| `server/prisma/schema.prisma` | `Website` model (`id`, `url` unique, `name`, `description?`, `createdAt`, `updatedAt`), mapped to table `websites`. |
| `server/utils/resolveServerPort.ts` | `resolveServerPort(): number` |
| `server/controllers/health.ts` | `registerHealthRoutes(app: Express): void` → `GET /api/health` returning `{ status: "ok", uptime }` |
| `server/services/dbService.ts` | `CreateWebsiteInput` interface; `createWebsite`, `listWebsites`, `findWebsiteByUrl`, `deleteWebsiteByUrl`; module-private `prisma` and `adapter`; re-exports the `Website` type. |
| `server/server.ts` | `startListening(expressApp, port): Server`; exports `app`. Module-body `listen` guarded by `NODE_ENV !== "test"`. |

**Client:**

| File | Added |
|---|---|
| `index.html` | Vite entry. |
| `src/index.css` | Reset + dark page background. |
| `src/main.tsx` | Inline MUI dark `theme`; React root render. |
| `src/hooks/useHealth.ts` | `HealthStatus` interface; `useHealth()` returning `{ health, isLoading, errorMessage }`. |
| `src/pages/HomePage.tsx` | `HomePage()` — Hello World + live health chip. |
| `src/App.tsx` | `App()` — `BrowserRouter` with the `/` route. |

**Tests:** `tests/setup.ts`, `tests/backend/utils/resolveServerPort.test.ts`,
`tests/backend/api/health.test.ts`, `tests/backend/server.test.ts`,
`tests/backend/services/dbService.test.ts` (adds local helper
`createHealthApp()` in the health spec), `tests/frontend/App.test.tsx`,
`tests/frontend/HomePage.test.tsx` (adds local helper `createDeferredFetch()`).

**Docs:** `README.md`, this file, and a `README.md` in `server/`,
`server/controllers/`, `server/services/`, `server/utils/`, `server/prisma/`,
`src/`, `src/hooks/`, `src/pages/`, `tests/`.

### Notable during implementation

- **`npm run lint` initially failed** on `dbService.ts` with "was not found by
  the project service". Root cause: nothing imported it, so it belonged to no
  TypeScript project. Fixed by adding
  `tests/backend/services/dbService.test.ts` — which the module needed anyway —
  rather than by touching any config.
- The first version of that spec stubbed `PrismaClient` with `vi.fn(() => ...)`;
  vitest rejects a non-constructible mock for a `new` call. Changed both stubs
  to `class` declarations.

### Verification performed

- `createdb easy_test_dev`; `npm install` ran `prisma generate && prisma db push`
  cleanly. `npm ls` confirms `prisma`, `@prisma/client`, `@prisma/adapter-pg`
  all at 7.10.0.
- `psql -c '\d websites'` shows all six columns plus the unique index on `url`.
- Throwaway `claude_tmp/verifyDb.mts` did a full create → find → list → delete
  round trip through `dbService`, proving the pg adapter reaches Postgres.
  `@default(cuid())` generated fine with no deprecation warning.
- `npm run tsc` and `npm run tsc:client` — both clean.
- `npm run lint` — clean.
- `npm run test:coverage` — 28 tests pass; 97.05% statements, 93.1% branches,
  100% functions, 96.92% lines, all above the 80/70/80/80 thresholds.
- `npm run dev` came up on both ports. `GET /api/health` returns
  `{"status":"ok","uptime":...}` both directly on :3010 and through the Vite
  proxy on :5180; homepage returns 200.
- Throwaway `claude_tmp/verifyHomepage.mts` drove headless Chromium against
  :5180 and confirmed the "Hello World" heading and the live `ok` health chip
  both render, with no console errors. (`npx playwright install chromium` was
  needed first.)
- Dev servers stopped with `./stop-dev.sh`; `claude_tmp/` deleted.
