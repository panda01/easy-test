# tests/

Unit tests, mirroring the source layout rather than sitting next to the code.

| Path | Runner project | Environment |
|---|---|---|
| `backend/**/*.test.ts` | `backend` | node |
| `frontend/**/*.test.tsx` | `frontend` | jsdom |

`setup.ts` wires `@testing-library/jest-dom` matchers and calls `cleanup()`
after each test. It applies to the frontend project.

## Running

```sh
npm run test             # both projects
npm run test:backend
npm run test:frontend
npm run test:watch
npm run test:coverage    # enforces the global thresholds
```

## Naming

`<SourceFileName>.test.ts` / `.test.tsx`, matching the file under test —
`HomePage.tsx` is covered by `frontend/HomePage.test.tsx`.

Backend specs mock with the **`.js`-suffixed specifier**, matching how the
server imports it: `vi.mock("../../../server/services/dbService.js", ...)`.
Stubs for classes instantiated with `new` (`PrismaClient`, `PrismaPg`) must be
declared as a `class` — an arrow function is not constructible and vitest
rejects it.

**No unit test ever launches a real browser.** `playwrightService.test.ts`
mocks the `playwright` module (`chromium.launch` returns a fake browser whose
`newPage` returns a fake page) and `node:fs/promises`; every spec that loads a
controller mocks `../services/playwrightService.js` outright.
`backend/fixtures/screenshot-files/` holds a tiny committed PNG that the
Playwright controller spec serves through the real `res.sendFile`.
`backend/fixtures/client-build-files/` stands in for the `vite build` output
(`index.html` and `assets/app.js`) in `server.test.ts`'s production client
serving specs. In `backend/fixtures/client-build-with-unreadable-index/`,
`index.html` is a directory, so sending it fails with EISDIR.
`crawlerService.test.ts` mocks `playwright` the same way, but its fake page
serves a **fake site** (a table of URL → status, final URL, title, snapshot,
and raw hrefs), and it runs the in-page link scan (`readRawPageLinks`) against
a stubbed `document`. `crawlRunService.test.ts` mocks the crawler and
dbService and awaits the returned `crawlCompletion` instead of polling; the
crawl controller spec and `server.test.ts` mock `crawlRunService` outright.
`server.test.ts` reads `markUnfinishedCrawlRunsInterrupted`'s call count
right after import (before any `beforeEach` reset) to prove the boot step does
not run under test.

**Polling is tested with fake timers.** `usePolledJsonResource`,
`useCrawlRunProgress`, and `CrawlRunPage`'s "while the crawl runs" specs use
`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })` and
`act(() => vi.advanceTimersByTimeAsync(ms))`, then assert synchronously:
Testing Library's `waitFor` / `findBy` do not advance Vitest's fake timers.

**No unit test ever calls the Anthropic API or starts a process.**
`scriptGenerationService.test.ts` replaces `@anthropic-ai/sdk` with a fake
client whose `beta.messages.create` is a spy (the real prompt file is read, to
prove it is sent verbatim, and the JSON schema sent is checked to keep the
step actions' `enum`); `scriptModelService.test.ts` fakes `beta.models.list`
as an async iterable of model infos. `actionPlanRunnerService.test.ts` mocks
`playwright` (a fake browser, page, and locators that record every call),
`node:fs/promises`, and the login service's `logInWithCredential`, and drives
the 5 minute limit with fake `setTimeout`. Every spec that loads the action
scripts controller mocks the generator, the runner, and the login-details
builder outright. `backend/fixtures/action-script-files/` holds the committed
failure PNG that controller spec serves - and that the refine route reads and
base64-encodes for Claude (the refine specs compare against the real file's
bytes). The refinement request's content blocks (context with a cache marker,
then the screenshot, then the failure text) are asserted through the same fake
`beta.messages.create` spy; the real refine call and its prompt caching were
checked once against the live API with a throwaway script in `claude_tmp/`.

**The plan editor's drag-and-drop** is dnd-kit; its specs render the step
cards inside a real `DndContext` / `SortableContext`. jsdom has no layout, so
`ActionPlanEditor.test.tsx` fakes `getBoundingClientRect` for the step cards
only (`layOutStepCardsVertically`: card N at N x 100px) and then drags with the
keyboard (focus "Drag step N", Space, arrow keys, Space) through the real
`onDragEnd`. Dragging with the MOUSE was checked in a real browser (a
throwaway script in `claude_tmp/`).

`ActionPlanSteps.component.test.tsx` is named that way because macOS file
systems are case-insensitive: `ActionPlanSteps.test.tsx` (the component)
and `actionPlanSteps.test.tsx` (the utility) would be the same file.

`frontend/support/websiteItemDetailPageCases.tsx` holds the detail-page
cases (summary and delete flow) that `UseCaseDetailPage.test.tsx` and
`ActionDetailPage.test.tsx` both run - like the helpers file, it is not a spec
itself.

## Coverage

Global thresholds: **lines 80 / branches 70 / functions 80 / statements 80.**

Two deliberate configuration details in `vitest.config.ts`:

- **`coverage.include` is unset**, so only files the tests actually load are
  measured. A module with no caller yet cannot sink the thresholds — but it is
  not in `exclude` either, so it starts being measured the moment something
  imports it.
- **`exclude` replaces a default of `[]`** and there is no built-in
  node_modules filter, so `node_modules/**` is listed explicitly.

If a threshold goes red, add the missing test. Do not lower the number and do
not edit the config.

## Why there is no tests/playwright/

By explicit user decision, this project keeps **unit tests only**. End-to-end
browser checks are still done with Playwright, but as throwaway scripts in
`claude_tmp/` that are deleted after the run — they are not committed specs.
