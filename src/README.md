# src/

React 19 frontend, bundled by Vite. Entry point is `/index.html` at the project
root, which loads `main.tsx`.

| Path | Holds |
|---|---|
| `main.tsx` | React root, MUI theme, `ThemeProvider` + `CssBaseline`. |
| `App.tsx` | Router shell. One route today. |
| `index.css` | Minimal reset and page background. |
| `pages/` | One component per route. |
| `hooks/` | Reusable stateful logic, including all API calls. |

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
- Components and pages are `PascalCase`; hooks and utilities are `camelCase`.
- Client imports carry **no** file extension (bundler resolution), unlike the
  server's `.js` suffixes.
