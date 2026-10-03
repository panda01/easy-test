# src/pages/

One component per route. Routes are declared in `../App.tsx`.

| Page | Route | Shows |
|---|---|---|
| `HomePage.tsx` | `/` | "Hello World" plus the live `/api/health` status. |
| `WebsiteListPage.tsx` | `/websites` | Every active website, newest first, plus "New website". |
| `WebsiteCreatePage.tsx` | `/websites/new` | The website form. |
| `WebsiteDetailPage.tsx` | `/websites/:websiteId` | One website: its URL and "Login page: <url>" (or "Doesn't require login"), Take screenshot/Edit/Delete, its Screenshots, Crawls, and Credentials sections, and its Use cases and Actions sections. "Crawl website" starts a background crawl - logged out, or logged in as the credential picked in "Crawl as", clicking the buttons picked in "Buttons" - and opens its page. The Credentials section and "Crawl as" show only when the website **or any of its credentials** has a login URL; otherwise the site is crawled logged out. |
| `CredentialCreatePage.tsx` | `/websites/:websiteId/credentials/new` | The credential form, every field blank: a blank login page URL inherits the website's (shown as the placeholder), and is required when the website has none. Save and Cancel return to the website. |
| `CredentialEditPage.tsx` | `/websites/:websiteId/credentials/:credentialId/edit` | The credential form, pre-filled except the password (never sent by the server; blank keeps it) - mounted once both the credential and its website have loaded, so the login URL field knows whether it inherits - plus Delete. A credential has no separate detail page. |
| `CrawlRunPage.tsx` | `/websites/:websiteId/crawl-runs/:crawlRunId?page=` | One crawl: when and where it started, plus which buttons it clicked when not links only ("· clicked buttons except risky ones"), who it viewed the site as (a `role="note"` alert: logged out, or logged in as a credential - the same for every page), its `role="status"` outcome, the "Login failure screenshot" when its login failed (a link to a URL that redirected selects the page it led to) (live progress while running, re-fetched every 2 s), the "Site map" tree of every page it found, and the selected page in full with its aria snapshot. The selected page lives in `?page=` (replaced, not pushed) and defaults to the start page, so it survives a reload. |
| `WebsiteEditPage.tsx` | `/websites/:websiteId/edit` | The website form, pre-filled. |
| `WebsiteItemCreatePage.tsx` | `/websites/:websiteId/use-cases/new`, `.../actions/new` | The title/description form. |
| `UseCaseDetailPage.tsx` | `/websites/:websiteId/use-cases/:itemId` | One use case, Edit/Delete. |
| `ActionDetailPage.tsx` | `/websites/:websiteId/actions/:itemId` | One action, Edit/Delete, then its Scripts (Model / Effort dropdowns, Convert to script, versions with model and effort and out-of-date marks, code, Compare versions) and the selected version's Runs (Run script, outcome, output, failure screenshot). The model choice lasts for the visit and starts on the server's default. |
| `ActionScriptComparePage.tsx` | `/websites/:websiteId/actions/:itemId/scripts/compare?from=&to=` | Two of the action's script versions side by side - title, description, and code. "From" (left) defaults to the second newest and "To" (right) to the newest; both are kept in the query string (replaced, not pushed), so a comparison can be linked or reloaded. |
| `WebsiteItemEditPage.tsx` | `/websites/:websiteId/use-cases/:itemId/edit`, `.../actions/:itemId/edit` | The title/description form, pre-filled. |

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
them: `WebsiteItemSummary` (title, Edit/Delete, description, the delete
dialog) and `useWebsiteItemDeletion` (the delete flow).

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
