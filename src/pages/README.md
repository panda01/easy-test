# src/pages/

One component per route. Routes are declared in `../App.tsx`.

| Page | Route | Shows |
|---|---|---|
| `HomePage.tsx` | `/` (and `/websites`, which redirects here) | The websites dashboard (mockup 1a / 2a): "N sites · N actions · last run X ago", "New website", and one row per website, newest first - name and URL, its actions as a passed / failed / not run bar (or "No actions yet — add the first one"), and its last crawl. The whole row opens the website. On a phone the rows are stacked cards. |
| `WebsiteCreatePage.tsx` | `/websites/new` | The website form. |
| `WebsiteDetailPage.tsx` | `/websites/:websiteId?tab=` | One website (mockup 1b / 2b): its URL, "Login page /login" (or "Doesn't require login"), "Updated X ago", and Edit/Delete (a "⋯" menu on a phone); its Actions (status, out of date, version, status label) and Use cases (cards); and a side panel with Crawls, Screenshots, and Credentials tabs - on a phone one tab row holds all five sections. The open tab lives in `?tab=` (replaced, not pushed). "Crawl website" starts a background crawl - logged out, or logged in as the credential picked in "Crawl as", clicking the buttons picked in "Buttons" (links only by default) - and opens its page; both picks also filter the Crawls tab's History; while one runs, the Crawls tab shows its live progress card with "Watch". The Credentials tab and "Crawl as" show only when the website **or any of its credentials** has a login URL; otherwise the site is crawled logged out. |
| `CredentialCreatePage.tsx` | `/websites/:websiteId/credentials/new` | The credential form, every field blank: a blank login page URL inherits the website's (shown as the placeholder), and is required when the website has none. Save and Cancel return to the website. |
| `CredentialEditPage.tsx` | `/websites/:websiteId/credentials/:credentialId/edit` | The credential form, pre-filled except the password (never sent by the server; blank keeps it) - mounted once both the credential and its website have loaded, so the login URL field knows whether it inherits - plus Delete. A credential has no separate detail page. |
| `CrawlRunPage.tsx` | `/websites/:websiteId/crawl-runs/:crawlRunId?page=` | One crawl (mockup 1d / 2d): "Crawl" with a tag saying who it viewed the site as (logged out, logged in as a credential - the same for every page - or that the login failed); a `role="status"` line - while running: "N of up to 50 pages · N waiting", a progress bar, "2:14 of 10:00 max", and "Updated just now" (re-fetched every 2 s); once ended: how it ended and how long it took, with its error; the "Login failure screenshot" when its login failed; the "Site map" tree of every page it found beside the selected page in full (facts, links and button targets - a link to a URL that redirected selects the page it led to - and its aria snapshot). On a phone the map comes first and the page follows below it. The selected page lives in `?page=` (replaced, not pushed) and defaults to the start page, so it survives a reload. |
| `WebsiteEditPage.tsx` | `/websites/:websiteId/edit` | The website form, pre-filled. |
| `WebsiteItemCreatePage.tsx` | `/websites/:websiteId/use-cases/new`, `.../actions/new` | The title/description form; for an action also "Log in as" (it waits for the website's credentials). |
| `UseCaseDetailPage.tsx` | `/websites/:websiteId/use-cases/:itemId` | One use case, Edit/Delete (via `WebsiteItemSummary`). |
| `ActionDetailPage.tsx` | `/websites/:websiteId/actions/:itemId?version=` | One action (mockup 1c / 2c): its title, description, who it runs as, and Edit/Delete; then, at 1200 px and up, three columns - the Versions (status, out of date, where each came from; Model / Effort and "Convert to new version"; "Compare"), the shown version (summary, steps marked by the shown run, the step editor - saving POSTs `.../edits` and shows the new version - and collapsed Assumptions, Pages given to Claude, and Plan JSON), and the Latest run panel ("Run again", outcome, failure screenshot, "Refine with Claude", output log, the version's other runs). Narrower, it is one column: a Version dropdown, the run card, the steps, and collapsed rows. The shown version lives in `?version=N` (replaced, not pushed; the newest by default). A finished run is handed to `recordFinishedRun`, so that version's icon turns green or red at once. A failed run of a version Claude wrote (`modelId` not null) can be refined with an optional note: it POSTs `{ note }` to `.../runs/:actionScriptRunId/refinements`, and the new version is added and shown. The model choice lasts for the visit and starts on the server's default. |
| `ActionScriptComparePage.tsx` | `/websites/:websiteId/actions/:itemId/scripts/compare?from=&to=` | Two of the action's plan versions side by side - title, description, and the plan as indented JSON. Each version is labelled with its model and effort, "refined · <model and effort>", or "edited". "From" (left) defaults to the second newest and "To" (right) to the newest; both are kept in the query string (replaced, not pushed), so a comparison can be linked or reloaded. |
| `WebsiteItemEditPage.tsx` | `/websites/:websiteId/use-cases/:itemId/edit`, `.../actions/:itemId/edit` | The title/description form, pre-filled; for an action also "Log in as", pre-selected (it waits for the website's credentials, so a form without them can never save the action as logged out). |

Pages compose hooks and MUI components; they do not fetch inline. See
`../hooks/README.md`.

## Use cases and actions share the create and edit pages

Both have the same shape (title + description) and the same forms, so the
`WebsiteItemCreatePage` and `WebsiteItemEditPage` components take an
`itemKind` prop (`USE_CASE_KIND` or `ACTION_KIND`, from
`../utils/websiteItemKinds.ts`) that supplies the labels and the URL segment.

The **detail** pages are separate components (`UseCaseDetailPage`,
`ActionDetailPage`), because only actions have scripts and the page owns
every request (components only take props). What they share lives outside
them: `useWebsiteItemDeletion` (the delete flow), plus `ConfirmDeleteDialog`.
The use case page shows its top with `WebsiteItemSummary`; the action page has
its own header, laid out as its mockup draws it.

Each of their `<Route>` elements has its own `key`. Without it, react-router
would reuse the mounted component when Back/Forward moves between two routes
that render the same page component, carrying state across.

## History: Back and Forward

Every page fetches on mount, so returning to a page always shows current data.
On top of that, forms and deletes avoid leaving stale entries in history
(`../hooks/useReturnNavigation.ts`):

- Links into a form or a detail page carry `state: { returnTo: <current path> }`.
- **Cancel, Save on an edit form, and Delete** go *back* one entry when
  `returnTo` is where they are heading, otherwise they *replace* the current
  entry. History stays `[list, detail]`, never `[list, detail, detail]`.
- **Save on a create form** replaces the form's entry with the new record's
  page, so Back from there skips the form.
- Forward onto a just-deleted record shows the server's "... not found" text
  in an error alert.

Edit forms mount only once the record has loaded, keyed by its id, so the
fields always start from the saved values.
