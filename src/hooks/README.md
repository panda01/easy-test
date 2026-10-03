# src/hooks/

Reusable stateful logic. Every API call in the app lives in a hook here rather
than inline in a component.

| Hook | Returns |
|---|---|
| `useHealth` | `{ health, isLoading, errorMessage }` from `GET /api/health` |
| `useJsonResource` | `{ data, isLoading, errorMessage }` for any `GET` url; `data` is `unknown`. A `null` url stays idle (no request, not loading) |
| `useWebsites` / `useWebsite` | Typed `useJsonResource` wrappers for the website list / one website |
| `useWebsiteItems` / `useWebsiteItem` | Typed wrappers for a website's use cases or actions / one of them |
| `useScreenshotRuns` | `{ runs, isLoading, errorMessage, addTakenRun }` for a website's screenshot runs; see below |
| `useRecordListWithAdditions` | `{ records, isLoading, errorMessage, addRecord }`: the generic "fetched list plus rows a POST just created" behind the two hooks below |
| `useActionScripts` | `{ scripts, isLoading, errorMessage, addCreatedScript }` for an action's saved script versions |
| `useActionScriptRuns` | `{ runs, isLoading, errorMessage, addFinishedRun }` for one script's runs; a `null` script id fetches nothing |
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

`useActionScriptRuns` takes a `null` script id while the action has no script
yet. That passes a `null` url to `useJsonResource`, which stays idle, so the
action page can call the hook unconditionally (hooks cannot be called
conditionally).
