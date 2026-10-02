# src/hooks/

Reusable stateful logic. Every API call in the app lives in a hook here rather
than inline in a component.

| Hook | Returns |
|---|---|
| `useHealth` | `{ health, isLoading, errorMessage }` from `GET /api/health` |
| `useJsonResource` | `{ data, isLoading, errorMessage }` for any `GET` url; `data` is `unknown` |
| `useWebsites` / `useWebsite` | Typed `useJsonResource` wrappers for the website list / one website |
| `useWebsiteItems` / `useWebsiteItem` | Typed wrappers for a website's use cases or actions / one of them |
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
