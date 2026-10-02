# src/pages/

One component per route. Routes are declared in `../App.tsx`.

| Page | Route | Shows |
|---|---|---|
| `HomePage.tsx` | `/` | "Hello World" plus the live `/api/health` status. |
| `WebsiteListPage.tsx` | `/websites` | Every active website, newest first, plus "New website". |
| `WebsiteCreatePage.tsx` | `/websites/new` | The website form. |
| `WebsiteDetailPage.tsx` | `/websites/:websiteId` | One website, Take screenshot/Edit/Delete, its Screenshots section, and its Use cases and Actions sections. |
| `WebsiteEditPage.tsx` | `/websites/:websiteId/edit` | The website form, pre-filled. |
| `WebsiteItemCreatePage.tsx` | `/websites/:websiteId/use-cases/new`, `.../actions/new` | The title/description form. |
| `WebsiteItemDetailPage.tsx` | `/websites/:websiteId/use-cases/:itemId`, `.../actions/:itemId` | One use case or action, Edit/Delete. |
| `WebsiteItemEditPage.tsx` | `/websites/:websiteId/use-cases/:itemId/edit`, `.../actions/:itemId/edit` | The title/description form, pre-filled. |

Pages compose hooks and MUI components; they do not fetch inline. See
`../hooks/README.md`.

## Use cases and actions share pages

Both have the same shape (title + description) and the same screens, so the
three `WebsiteItem*Page` components take an `itemKind` prop
(`USE_CASE_KIND` or `ACTION_KIND`, from `../utils/websiteItemKinds.ts`) that
supplies the labels and the URL segment.

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
