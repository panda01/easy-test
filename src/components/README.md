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
