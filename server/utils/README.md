# server/utils/

Small pure helpers: no I/O, no Express types, no database. Anything that needs
those belongs in `../services/`.

| File | Does |
|---|---|
| `resolveServerPort.ts` | Reads and validates `SERVER_PORT`, throwing if it is missing or out of range. |

`resolveServerPort` fails hard rather than defaulting, mirroring the same throw
in `vite.config.ts`. A silent fallback would aim the Vite `/api` proxy at a port
nothing is listening on, which surfaces much later as an unexplained 500 in the
browser instead of a one-line startup error.
