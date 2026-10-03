# server/utils/

Small pure helpers: no I/O, no Express types, no database. Anything that needs
those belongs in `../services/`. (A `import type` from a service is fine — it
is erased at runtime.)

| File | Does |
|---|---|
| `resolveServerPort.ts` | Reads and validates `SERVER_PORT`, throwing if it is missing or out of range. |
| `resolveConfiguredDirectory.ts` | `resolveConfiguredDirectory(environmentVariableName)`: the shared rule behind both directory settings - reads the named variable and returns it as an absolute path (a relative value resolves against the project root), throwing if it is missing or blank. |
| `resolveScreenshotDirectory.ts` | `resolveConfiguredDirectory("SCREENSHOT_DIR")`. Does not create the directory. |
| `resolveActionScriptDirectory.ts` | `resolveConfiguredDirectory("ACTION_SCRIPT_DIR")`, plus: the directory must sit strictly **inside the project root** (generated scripts import `playwright` from its `node_modules`, and ES modules ignore `NODE_PATH`). A folder merely named `..runs` counts as inside. |
| `findScriptRuleViolations.ts` | `findScriptRuleViolations(code)`: the warn-only text scan of a generated script for features a user could not use (`.fill(`, `evaluate`, `force: true`, `page.route`, `textContent`, `process.env`, imports other than `playwright`, ...). Returns `"Line N: <feature> - <why>"` strings in line order. Anchored import matching, so `"from 'X'"` inside a step message is not an import. |
| `readSendErrorStatus.ts` | `readSendErrorStatus(sendError)`: the HTTP status `res.sendFile` attached to its error, or null. Shared by the two controllers that serve files. |
| `describeError.ts` | `describeError(error)`: an Error's message, or the stringified value. Used by every route `catch`. |
| `validateRequestBodies.ts` | `validateWebsiteInput` and `validateTitleDescriptionInput`: check, trim, and normalize request bodies, returning `{ isValid: true, input }` or `{ isValid: false, errorMessage }`. |

`resolveServerPort`, `resolveScreenshotDirectory`, and
`resolveActionScriptDirectory` all run once at boot in `../server.ts`. `resolveServerPort` fails hard rather than defaulting, mirroring the same throw
in `vite.config.ts`. A silent fallback would aim the Vite `/api` proxy at a port
nothing is listening on, which surfaces much later as an unexplained 500 in the
browser instead of a one-line startup error.

## Request body rules

| Body | Rules |
|---|---|
| Website | `url` required, must be `http:`/`https:`, stored as `new URL(url).href`; `name` required; `description` optional — missing, null, or blank is stored as `null`; `networkIdleTimeoutMs` and `screenshotMinimumWaitMs` optional JSON numbers — whole milliseconds 0–30000, missing or null become 5000 and 1, and the cap may not be lower than the minimum. |
| Use case / action | `title` and `description` both required and non-blank. |

All strings are trimmed. A body that is not a JSON object (including the
`undefined` Express 5 leaves when no JSON was sent) is rejected first.
