# server/prompts/

Model prompts the server reads at runtime. **Each file is used verbatim** -
it is sent to the model exactly as it is on disk, with nothing prepended,
appended, or trimmed - so do not reformat or "tidy" these files: every byte
is part of the prompt (and of the prompt-cache key).

| File | Used by | For |
|---|---|---|
| `actionScriptGuidelines.md` | `../services/scriptGenerationService.ts` | The system prompt for "Convert to script": the user's rules for turning an action into a Playwright script that only does what a real user could do with a mouse and keyboard, and the `.mjs` template every script starts from. |

The per-request details (website, action, the one-shot "you cannot ask
questions" note, and how the guidelines' Output Format maps onto the JSON
fields) are built in the service and sent as the user message, AFTER this
system prompt, so the system prompt stays identical across requests and is
served from the prompt cache.

Markdown rather than a `.ts` string constant: the guidelines contain backticks
and code fences, which a template literal would need escaped.

## Generated scripts are `.mjs`

The project rule is "always TypeScript, module files are `.mts`". Generated
scripts are the one deliberate exception, chosen by the user: they are
runtime **data** (stored in `action_scripts.code`, run with plain `node`), not
project source, and they follow the guidelines' `node usecase.mjs` template.
All of this project's own code stays TypeScript.
