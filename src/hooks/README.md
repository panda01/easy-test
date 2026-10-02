# src/hooks/

Reusable stateful logic. Every API call in the app lives in a hook here rather
than inline in a component.

| Hook | Returns |
|---|---|
| `useHealth` | `{ health, isLoading, errorMessage }` from `GET /api/health` |

## The fetch pattern

Each data hook:

1. Declares an exported `interface` for the response body.
2. Fetches a **relative** `/api/...` URL inside a `useEffect`.
3. Holds a `cancelled` flag, checks it before every setState, and flips it in
   the cleanup function.
4. Returns flat values (`data`, `isLoading`, `errorMessage`) rather than a
   discriminated union, so a component can branch without unpacking.

Errors are normalised with `err instanceof Error ? err.message : String(err)` —
a rejection is not guaranteed to be an `Error`.
