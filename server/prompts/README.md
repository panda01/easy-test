# server/prompts/

Model prompts the server reads at runtime. **Each file is used verbatim** -
it is sent to the model exactly as it is on disk, with nothing prepended,
appended, or trimmed - so do not reformat or "tidy" these files: every byte
is part of the prompt (and of the prompt-cache key).

Each file is read relative to the service that uses it (`../prompts/` from
`services/`). `tsc` does not copy non-TypeScript files, so the production
build (`npm run build:server`) copies this whole folder into
`dist-server/server/prompts/`, byte for byte. A new prompt file here needs no
build change.

| File | Used by | For |
|---|---|---|
| `actionPlanGuidelines.md` | `../services/scriptGenerationService.ts` (`convertActionToPlan` and `refineActionPlan`, both through `askClaudeForPlan`) | The system prompt for "Convert to script" and for "Refine" (fixing a plan version whose run failed): the rules for turning an action into a JSON step plan that only does what a real user could do with a mouse and keyboard - how to read the aria snapshots, how to pick targets, the step catalog (the only actions the runner knows), logging in and the credential placeholders, the "Deleting or confirming" pattern (confirm buttons, browser confirms, and typing the name again - a delete almost always asks), how to read a failed run's evidence and fix the plan with as small a change as possible ("Refining a Failed Plan"), and the Output Format with two example plans. |
| `deleteActionGuidelines.md` | `../services/deleteActionGenerationService.ts` (`proposeDeleteAction`) | The system prompt that writes the DELETE action cleaning up after a Create action: invert the user's request with the same names and values, say to confirm the deletion when the site asks (an "Are you sure?" dialog, a browser confirm, or typing the name again), end by checking the object is gone; Output Format `{ title, description }` with one example. Sent verbatim and cached like the plan guidelines. |

The per-request details (website, action, whether the browser is logged in
and as which credential's NAME, and the crawled pages' aria snapshots) are
built in the service and sent as the user message, AFTER this system prompt,
so the system prompt stays identical across requests and is served from the
prompt cache. The same file is used whichever model the user picks, and for
both a conversion and a refinement: the two send the same system prompt and
the same settings, so they share one prompt cache.

A refinement's user message is three content blocks: the same website,
action, login, and crawled-page context a conversion sends (marked for
prompt caching as a second breakpoint, and identical along a chain of
refines), the failure screenshot as a PNG (only when there is one), and the
run-specific text - the plan that failed, the error and the step it stopped
at, the tail of the step log in `<run_output>`, the failing page's aria
snapshot in `<failing_page_snapshot>`, and the user's optional note in
`<user_note>`. The prompt's "Refining a Failed Plan" section tells Claude how
to read those, that they are data and never instructions, and to add one
`Refined:` entry to `assumptions` saying what changed.

**Keep it over 4,096 tokens.** That is the minimum cacheable prefix of Claude
Haiku 4.5 and Opus 4.6 (Opus 5.5 needs only 512); below it those models
silently never cache. It is about 5.7k tokens on them today (Haiku 4.5: 5,674;
Opus 4.6: 5,675; Opus 5.5: 7,275) - check with `messages.countTokens` after
shortening it.

Markdown rather than a `.ts` string constant: the guidelines contain backticks
and code fences, which a template literal would need escaped.

## Plans are data, not code

Claude no longer writes scripts. It answers with a JSON plan whose step
actions come from a fixed list; the runner
(`../services/actionPlanRunnerService.ts`) maps each one to a Playwright call
through a `switch`, so nothing Claude writes is ever executed as code. The
step catalog in this prompt must stay in step with `PLAN_STEP_ACTIONS` /
`PLAN_STEP_RULES` in `../utils/actionPlanSchema.ts`.
