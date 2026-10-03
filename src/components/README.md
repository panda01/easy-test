# src/components/

Reusable building blocks for pages. Components take props and render; any
fetching is done by the page through a hook and passed down.

| Component | Does |
|---|---|
| `AppHeader.tsx` | Top bar on every page: app name (home) and a Websites link. Rendered outside `<Routes>`. |
| `PageBreadcrumbs.tsx` | The "Websites › Example › Log in" trail; the last crumb is plain text. |
| `LoadStatusNotice.tsx` | Spinner while loading, error alert on failure, nothing once loaded. |
| `ConfirmDeleteDialog.tsx` | Confirm-before-delete dialog that also shows a failed delete's reason. |
| `WebsiteForm.tsx` | URL / name / description form for the website create and edit pages, plus the "Screenshot settings" number fields (network idle cap and minimum wait, in ms). |
| `TitleDescriptionForm.tsx` | Title / description form for the use case and action create and edit pages. |
| `WebsiteItemListSection.tsx` | The "Use cases" or "Actions" section of a website's page. |
| `ScreenshotRunsSection.tsx` | The "Screenshots" section of a website's page: a line explaining when screenshots are taken (the website's timing settings), progress while a screenshot is being taken, the selected run (newest by default), and the "Run history" list to pick a run from. |
| `ScreenshotRunDetails.tsx` | One screenshot run in full: a `role="status"` outcome line ("Failed · HTTP 404 · 1.2 s") with its reason, when and where it was taken, and its image (or "No screenshot was captured"). |
| `WebsiteItemSummary.tsx` | The top of a use case's or action's page: kind, title with Edit (link) and Delete, description, timestamps, and the delete dialog. The delete flow comes in as a `WebsiteItemDeletion` prop (`../hooks/useWebsiteItemDeletion.ts`). |
| `ActionScriptsSection.tsx` | The "Scripts" section of an action's page: the Model / Effort dropdowns (`ScriptModelPicker`) and the "Convert to script" button with progress and its error, a "Compare versions" link once there are two, the "Versions" list ("Version N", newest first, with model, effort, rule-warning counts, and an "Out of date" chip), and the selected version via `ActionScriptDetails`. |
| `ActionScriptDetails.tsx` | One script version in full: when, by which model at which effort, and for which START_URL it was generated; an "Out of date" warning when the action's title or description changed since; a warning listing its rule violations (still runnable); the title and description it was generated from; the summary, the assumptions, and the code. |
| `ScriptModelPicker.tsx` | The "Model" and "Effort" dropdowns: every model in the live list, the chosen model's own effort levels (or a disabled "Standard"), and helper text naming the model id and its fallback. Shows why the list could not load instead. |
| `SideBySideDiff.tsx` | One section of a side-by-side comparison (older text left, newer right): removed lines red, added lines green, changed words highlighted, filler keeping rows aligned, "No differences" when equal. Rows come from `../utils/buildSideBySideDiff.ts`. |
| `ActionScriptRunsSection.tsx` | "Runs of version N": the "Run script" button (it opens a browser window on this computer) with progress and its error, the selected run via `ActionScriptRunDetails`, and the "Run history" list. |
| `ActionScriptRunDetails.tsx` | One script run in full: a `role="status"` outcome line ("Failed · exit code 1 · 4.2 s"), when it ran, its output, and its failure screenshot when there is one. |
| `CodeBlock.tsx` | A read-only, monospace, scrollable `<pre>` for code or program output, with an accessible name. Also shows aria snapshots. |
| `CrawlRunsSection.tsx` | The "Crawls" section of a website's page: what a crawl does (links only, up to 50 pages or 10 minutes), the "Crawl website" button (disabled while starting one or while one is running) and its error, and the "Crawl history" list, each run linking to its page. No `role="status"` region - a run's outcome is on its own page. |
| `CrawlSiteMap.tsx` | The "Site map" of a crawl: every page as one indented list in tree order (each page under the page whose link first led to it), with its path, HTTP outcome, and title; picking a row selects the page. Built with `../utils/buildCrawlSiteTree.ts`. |
| `CrawledPageDetails.tsx` | One crawled page in full: path, outcome and duration, error, the URL loaded and where it ended up, title, the page it was found on (a button), the aria snapshot in a `CodeBlock`, and its same-site links (visited ones select their page, the rest are marked "not visited"). |

## Conventions

- One default-exported component per file, with an exported `<Name>Props`
  interface whose fields are documented. Props arrive as a single `props`
  parameter and are destructured in the body.
- Forms own only their field values. Saving, error text, and navigation come
  from the page via props (`onSubmit`, `errorMessage`, `onCancel`).
- Forms seed their fields from `initialValues` once, on mount. Pages that edit
  a loaded record mount the form only after it loads, with `key={record.id}`.
- Submit stays disabled until the required fields are non-blank; the server
  still validates and its message is shown in an alert.
