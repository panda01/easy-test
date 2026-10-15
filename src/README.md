# src/

React 19 frontend, bundled by Vite. Entry point is `/index.html` at the project
root, which loads `main.tsx`.

| Path | Holds |
|---|---|
| `main.tsx` | React root, `ThemeProvider` (the Nocturne theme) + `CssBaseline`. |
| `theme/nocturneTheme.ts` | The Nocturne design system as an MUI theme (`nocturneTheme`), its tokens (`nocturneTokens`: ground, surface, text, accent, ramps, radii, shadows), the status colors (`statusColors`, `runStatusColors`, `crawlSeverityColors`), and `MONOSPACE_FONT_FAMILY`. |
| `App.tsx` | Router shell: `AppHeader` plus the route table. |
| `index.css` | Minimal reset and the Nocturne page background (before React mounts). Inter is loaded by a Google Fonts link in `/index.html`. |
| `pages/` | One component per route. |
| `components/` | Reusable pieces pages are built from (forms, dialogs, breadcrumbs, header), plus `icons.tsx`, the one module that imports MUI icons. |
| `hooks/` | Reusable stateful logic, including all API calls. |
| `utils/` | Pure helpers: URL builders, item-kind config, error and count formatting, and run outcome / status wording (e.g. `describeScriptRunStatus.ts`: `findScriptRunStatus` decides passed / failed / not run from a version's latest run). |

## Conventions

- **MUI components over elements with classnames.** Colors, radii, and shadows
  come from `theme/nocturneTheme.ts`, never from a hex written in a component.
- **Icons come from `components/icons.tsx`**, never from `@mui/icons-material`
  directly, so each icon is imported by its own path and the bundle never
  carries the whole library.
- **Screens whose structure changes on a phone** (tabs instead of a side panel,
  a dropdown instead of a list) switch with `useIsNarrowerThan`; spacing-only
  differences use responsive `sx` values.
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
