# server/utils/

Small pure helpers: no I/O, no Express types, no database. Anything that needs
those belongs in `../services/`. (A `import type` from a service is fine — it
is erased at runtime.)

| File | Does |
|---|---|
| `resolveServerPort.ts` | Reads and validates `SERVER_PORT`, throwing if it is missing or out of range. |
| `resolveConfiguredDirectory.ts` | `resolveConfiguredDirectory(environmentVariableName)`: the shared rule behind both directory settings - reads the named variable and returns it as an absolute path (a relative value resolves against the project root), throwing if it is missing or blank. |
| `resolveScreenshotDirectory.ts` | `resolveConfiguredDirectory("SCREENSHOT_DIR")`. Does not create the directory. |
| `resolveActionScriptDirectory.ts` | `resolveConfiguredDirectory("ACTION_SCRIPT_DIR")`, plus: the directory must sit strictly **inside the project root** (kept from when generated `.mjs` scripts imported `playwright` from its `node_modules`; plan runs now only write their folders and failure screenshots there, and read `uploads/`). A folder merely named `..runs` counts as inside. |
| `actionPlanSchema.ts` | The JSON step plan: `ActionPlanSchema` (structure only - converts cleanly to a JSON schema with `enum`, for Claude's structured output), `PLAN_STEP_ACTIONS`, `PLAN_STEP_RULES` (a `Map`: what target and value each action takes), `ARIA_ROLES` (checked against Playwright's own role type), `PLAN_KEYS`, `CREDENTIAL_PLACEHOLDERS`; `parseActionPlan` (structure), `findActionPlanProblems(plan, allowedOrigins)` (every per-action rule, one message per problem), `validateActionPlan` (both), `buildAllowedPlanOrigins`, `readHttpOrigin`, `planUsesCredentialPlaceholders`. |
| `selectRelevantCrawledPages.ts` | `extractActionSearchTerms(title, description)`: the action's most repeated words and two-word phrases, stop words removed. `scoreCrawledPage` / `selectRelevantCrawledPages(pages, terms)`: the start page, then the pages whose URL, title (x3), and aria snapshot match those terms most - at most 6 pages and 60k characters, a snapshot over 20k cut with a visible marker. `selectContextPagesByUrl(pages, pageUrls)`: the pages with those URLs, in `pageUrls` order, URLs not found skipped, under the same caps - used by "Refine" to re-send the pages a version was shown. `capSnapshot(ariaSnapshot)`: the 20k cut with its marker, on its own - also used by the plan runner on the failing page's snapshot. |
| `readSendErrorStatus.ts` | `readSendErrorStatus(sendError)`: the HTTP status `res.sendFile` attached to its error, or null. Shared by the two controllers that serve files. |
| `statusForScriptGenerationFailure.ts` | `statusForScriptGenerationFailure(error)`: 503 for `missingApiKey`, 400 for `unsupportedModel`, 502 for `refused`/`truncated`/`unparseable`, 500 otherwise - recognized structurally, so it needs no service import. Shared by the two controllers that talk to Claude. |
| `describeError.ts` | `describeError(error)`: an Error's message, or the stringified value. Used by every route `catch`. |
| `normalizeCrawlUrl.ts` | `normalizeCrawlUrl(rawHref, baseUrl)`: resolves a link as a browser would and returns `{ identityUrl, loadUrl }` - identity is origin + path (query and hash dropped), load keeps the query - or null for anything not followable (non-http(s), unparseable, blank, longer than `MAX_CRAWL_URL_LENGTH` = 2000). `isSameOriginUrl(url, origin)`. Used by the crawler. |
| `validateRequestBodies.ts` | `validateWebsiteInput`, `validateTitleDescriptionInput`, `validateActionInput`, `validateScriptModelChoiceInput`, `validateActionPlanEditInput`, `validateActionPlanRefineInput` (with `MAX_REFINE_NOTE_LENGTH` = 2000), `validateCredentialInput`, and `validateCrawlRunStartInput`: check, trim, and normalize request bodies, returning `{ isValid: true, input }` or `{ isValid: false, errorMessage }`. |
| `crawlButtonModes.ts` | `CRAWL_BUTTON_MODES` (`linksOnly`, `allButRisky`, `openOnly`), `CrawlButtonMode`, `DEFAULT_CRAWL_BUTTON_MODE` (`linksOnly`), `isCrawlButtonMode(value)`. Shared by the crawl start validation and the crawler. |
| `credentialEncryption.ts` | `encryptCredentialPassword(plain)` / `decryptCredentialPassword(stored)`: AES-256-GCM with a fresh random 12-byte IV per encryption, stored as `iv.authTag.ciphertext` (each base64). The key is `CREDENTIAL_ENCRYPTION_KEY` - 32 random bytes, base64 - read on every call (not at boot), so the server starts without it. `readCredentialEncryptionKey()` / `credentialEncryptionIsConfigured()` check it; `CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE` is the 503 text. A wrong key or an altered value fails to decrypt (GCM authenticates) with a message saying to re-enter the password. Generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` or `openssl rand -base64 32`. |

`resolveServerPort`, `resolveScreenshotDirectory`, and
`resolveActionScriptDirectory` all run once at boot in `../server.ts`. `resolveServerPort` fails hard rather than defaulting, mirroring the same throw
in `vite.config.ts`. A silent fallback would aim the Vite `/api` proxy at a port
nothing is listening on, which surfaces much later as an unexplained 500 in the
browser instead of a one-line startup error.

## Request body rules

| Body | Rules |
|---|---|
| Website | `url` required, must be `http:`/`https:`, stored as `new URL(url).href`; `name` required; `description` optional — missing, null, or blank is stored as `null`; `loginUrl` optional — missing, null, or blank is stored as `null` (doesn't require login; an omitted one on PUT clears it), otherwise http/https and normalized like `url`; `networkIdleTimeoutMs` and `screenshotMinimumWaitMs` optional JSON numbers — whole milliseconds 0–30000, missing or null become 5000 and 1, and the cap may not be lower than the minimum. |
| Use case | `title` and `description` both required and non-blank. |
| Action | `title` and `description` as for a use case; `credentialId` a non-blank string, or null / left out to run logged out (so a PUT that leaves it out unlinks it). Whether the credential belongs to the website is checked by the controller. |
| Edited plan | `{ plan }`, where the plan passes `validateActionPlan`: only the allowed step actions, each with the target and value it takes, 1-100 steps, `startUrl` and `goto` on the website's origins, credential placeholders only as a whole `fill` value. Every problem is listed. |
| Script model choice | `modelId` required and non-blank; `effort` a non-blank string, or null / left out for "Standard". Whether the model exists and offers that level is checked by the controller against the live catalog. |
| Refine a failed run | The whole body is optional (no body means no note). `note` text, trimmed; missing, null, or blank becomes `null`; at most 2000 characters once trimmed (`MAX_REFINE_NOTE_LENGTH`). Anything else that is not a JSON object is rejected. Whether the run failed and its version was written by a model is checked by the controller. |
| Credential | `name` and `username` required; `loginUrl` optional — missing, null, or blank is stored as `null` (inherit the website's), otherwise http/https, normalized like a website URL; `description` and the three selectors (`usernameSelector`, `passwordSelector`, `submitSelector`) optional — missing, null, or blank is stored as `null`. `password` required on create; on replace, missing / null / `""` keeps the saved one. The password is **not trimmed** (spaces can be part of it), but a password of only spaces is rejected. |
| Crawl start | The whole body is optional. `credentialId` a non-blank string, or null / left out to crawl logged out. `buttonMode` one of `linksOnly` / `allButRisky` / `openOnly` (`../utils/crawlButtonModes.ts`), or null / left out for `linksOnly`. Whether the credential exists (and has an effective login URL) is checked by the controller. |

All strings are trimmed (except a credential's password). A body that is not
a JSON object (including the `undefined` Express 5 leaves when no JSON was
sent) is rejected first - except the crawl start and refine bodies, which may
be left out.
