# src/hooks/

Reusable stateful logic. Every API call in the app lives in a hook here rather
than inline in a component.

| Hook | Returns |
|---|---|
| `useHealth` | `{ health, isLoading, errorMessage }` from `GET /api/health` |
| `useJsonResource` | `{ data, isLoading, errorMessage }` for any `GET` url; `data` is `unknown`. A `null` url stays idle (no request, not loading) |
| `useWebsites` / `useWebsite` | Typed `useJsonResource` wrappers for the website list / one website; `WebsiteRecord.loginUrl` is null when the website doesn't require login |
| `useWebsiteItems` / `useWebsiteItem` | Typed wrappers for a website's use cases or actions / one of them |
| `useScreenshotRuns` | `{ runs, isLoading, errorMessage, addTakenRun }` for a website's screenshot runs; see below |
| `useRecordListWithAdditions` | `{ records, isLoading, errorMessage, addRecord }`: the generic "fetched list plus rows a POST just created" behind the two hooks below |
| `useActionScripts` | `{ scripts, isLoading, errorMessage, addCreatedScript }` for an action's saved script versions |
| `useActionScriptRuns` | `{ runs, isLoading, errorMessage, addFinishedRun }` for one script's runs; a `null` script id fetches nothing |
| `useScriptModels` | Typed `useJsonResource` wrapper for `GET /api/script-models`: the live model list, each model's effort levels and fallback, and the default choice |
| `useCrawlRuns` | Typed `useJsonResource` wrapper for a website's crawl runs (newest first, no pages); exports `CrawlRunRecord` (with `credentialId`, `isLoggedIn`, `credential: { id, name }`, and `buttonMode`) and `CrawlButtonModeRecord` |
| `useCredentials` / `useCredential` | Typed wrappers for a website's credentials / one of them; export `CredentialRecord` (no password - only `hasPassword: true`) and `CredentialRequestBody` |
| `usePolledJsonResource` | `useJsonResource` plus `pollErrorMessage`, GETting the url again every interval while a `keepPolling(data)` check says so; see below |
| `useCrawlRunProgress` | One crawl run with its page summaries, polled every 2 s while it is `running` (`CRAWL_RUN_POLL_INTERVAL_MS`); exports `CrawlRunWithPagesRecord`, `CrawledPageSummaryRecord` |
| `useCrawledPage` | One crawled page in full (aria snapshot and links); a `null` page id fetches nothing |
| `useWebsiteItemDeletion` | The delete dialog's state and handlers shared by the use case and action pages: DELETE, then a history-aware return to the website |
| `useJsonMutation` | `{ sendJsonRequest, isSubmitting, errorMessage }` for `POST`/`PUT`/`DELETE` |
| `useRequiredRouteParam` | A `:param` the matched route is guaranteed to have, as `string` |
| `useReturnNavigation` / `useReturnToHereState` | History-aware exits from forms and deleted pages; see `../pages/README.md` |

## The fetch pattern

Each data hook:

1. Declares an exported `interface` for the response body (dates as strings —
   the client never imports server types).
2. Fetches a **relative** `/api/...` URL inside a `useEffect`.
3. Holds a `cancelled` flag, checks it before every setState, and flips it in
   the cleanup function.
4. Returns flat values (`data`, `isLoading`, `errorMessage`) rather than a
   discriminated union, so a component can branch without unpacking.

`useJsonResource` additionally remembers which url its result belongs to and
reports `isLoading` again the moment the url changes, so navigating between two
records that use the same page never flashes the previous record.

A failed request's `errorMessage` is the server's `{ error }` text when the
response has one ("Website not found"), else `Server responded with <status>`
(`readResponseErrorMessage` in `../utils/describeError.ts`). Thrown values are
normalised with `describeError` — a rejection is not guaranteed to be an
`Error`.

The generic hooks return `unknown` rather than taking a type parameter that
would appear only in their return type (`no-unnecessary-type-parameters`); the
typed wrappers state the response shape in one place each.

## `useScreenshotRuns`: showing a new run without refetching

"Take screenshot" POSTs a new run, and the POST's response already is the
saved row. So rather than giving `useJsonResource` a `reload()` (an extra GET,
and a spinner flash, on a hook every page shares), `useScreenshotRuns` keeps
the runs taken on this visit in local state and returns them ahead of the
fetched list:

- taken runs are filtered by `websiteId`, because React Router reuses the page
  when navigating straight from one website to another, and a slow POST can
  resolve after that navigation;
- a fetched run whose id was also taken is dropped, so no run is listed twice.

`runs` is never null — it is empty while loading or after a failed fetch,
apart from any runs taken in the meantime.

`useRecordListWithAdditions` is that same pattern made generic, and is what
`useActionScripts` (a new version from "Convert to script") and
`useActionScriptRuns` (a new run from "Run script") are built on: added
records are kept only while a caller-supplied check says they belong to the
list on screen (the same action / the same script), and a fetched record
whose id was also added is dropped. `useScreenshotRuns` predates it and is
left as is.

## `usePolledJsonResource`: watching a background crawl

A crawl runs in the background on the server, so its page re-fetches the run
until it ends. `usePolledJsonResource(url, keepPolling, intervalMs)`:

- reports `isLoading` only until the **first** response for the url - later
  polls replace `data` in place, with no spinner flash;
- schedules the next GET only after the previous one finished (no
  overlapping requests), with a `setTimeout` cleared on unmount or url change
  (StrictMode-safe), plus the usual `cancelled` flag on each fetch;
- on a failed **re-poll** keeps the last good `data`, sets `pollErrorMessage`,
  and keeps polling - a dev server restart briefly 5xx's the Vite proxy, and
  the next poll then shows the run as `interrupted`. A failed **first** load is
  `errorMessage` and stops there;
- reads `keepPolling` on every render rather than as an effect dependency, so
  an inline function is fine.

Tests drive it with `vi.useFakeTimers({ toFake: ["setTimeout",
"clearTimeout"] })` and `act(() => vi.advanceTimersByTimeAsync(ms))`, then
assert synchronously - Testing Library's `waitFor` / `findBy` do not advance
Vitest's fake timers.

`useActionScriptRuns` takes a `null` script id while the action has no script
yet. That passes a `null` url to `useJsonResource`, which stays idle, so the
action page can call the hook unconditionally (hooks cannot be called
conditionally).
