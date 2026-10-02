# src/components/

Reusable building blocks for pages. Components take props and render; any
fetching is done by the page through a hook and passed down.

| Component | Does |
|---|---|
| `AppHeader.tsx` | Top bar on every page: app name (home) and a Websites link. Rendered outside `<Routes>`. |
| `PageBreadcrumbs.tsx` | The "Websites › Example › Log in" trail; the last crumb is plain text. |
| `LoadStatusNotice.tsx` | Spinner while loading, error alert on failure, nothing once loaded. |
| `ConfirmDeleteDialog.tsx` | Confirm-before-delete dialog that also shows a failed delete's reason. |
| `WebsiteForm.tsx` | URL / name / description form for the website create and edit pages. |
| `TitleDescriptionForm.tsx` | Title / description form for the use case and action create and edit pages. |
| `WebsiteItemListSection.tsx` | The "Use cases" or "Actions" section of a website's page. |

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
