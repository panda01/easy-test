# src/

React 19 frontend, bundled by Vite. Entry point is `/index.html` at the project
root, which loads `main.tsx`.

| Path | Holds |
|---|---|
| `main.tsx` | React root, MUI theme, `ThemeProvider` + `CssBaseline`. |
| `App.tsx` | Router shell: `AppHeader` plus the route table. |
| `index.css` | Minimal reset and page background. |
| `pages/` | One component per route. |
| `components/` | Reusable pieces pages are built from (forms, dialogs, breadcrumbs, header). |
| `hooks/` | Reusable stateful logic, including all API calls. |
| `utils/` | Pure helpers: URL builders, item-kind config, error and count formatting. |

## Conventions

- **MUI components over elements with classnames.** The theme is created inline
  in `main.tsx` while it still fits on a screen.
- **API calls live in a hook, never inline in a component.** Always plain
  `fetch` against a **relative** `/api/...` URL — in dev the Vite server proxies
  `/api` to Express, so there is no base URL to configure and no CORS. No axios,
  no react-query.
- **Every fetch effect carries a `cancelled` flag** and returns a cleanup that
  sets it, so a response landing after unmount cannot setState on a dead
  component.
- **Every screen is a URL**, including create and edit forms, so the browser's
  Back and Forward buttons work everywhere. See `pages/README.md` for how forms
  and deletes keep history tidy.
- **URLs are built in `utils/routePaths.ts`** (links, `navigate()`, and fetches
  alike); route *patterns* are written literally in `App.tsx`.
- **The client never imports server code.** API response shapes are declared
  as interfaces in the hook that fetches them, with dates as ISO strings.
- Components and pages are `PascalCase` with a default export; hooks and
  utilities are `camelCase` with named exports.
- Client imports carry **no** file extension (bundler resolution), unlike the
  server's `.js` suffixes.
