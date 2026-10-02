# tests/

Unit tests, mirroring the source layout rather than sitting next to the code.

| Path | Runner project | Environment |
|---|---|---|
| `backend/**/*.test.ts` | `backend` | node |
| `frontend/**/*.test.tsx` | `frontend` | jsdom |

`setup.ts` wires `@testing-library/jest-dom` matchers and calls `cleanup()`
after each test. It applies to the frontend project.

## Running

```sh
npm run test             # both projects
npm run test:backend
npm run test:frontend
npm run test:watch
npm run test:coverage    # enforces the global thresholds
```

## Naming

`<SourceFileName>.test.ts` / `.test.tsx`, matching the file under test —
`HomePage.tsx` is covered by `frontend/HomePage.test.tsx`.

Backend specs mock with the **`.js`-suffixed specifier**, matching how the
server imports it: `vi.mock("../../../server/services/dbService.js", ...)`.
Stubs for classes instantiated with `new` (`PrismaClient`, `PrismaPg`) must be
declared as a `class` — an arrow function is not constructible and vitest
rejects it.

## Coverage

Global thresholds: **lines 80 / branches 70 / functions 80 / statements 80.**

Two deliberate configuration details in `vitest.config.ts`:

- **`coverage.include` is unset**, so only files the tests actually load are
  measured. A module with no caller yet cannot sink the thresholds — but it is
  not in `exclude` either, so it starts being measured the moment something
  imports it.
- **`exclude` replaces a default of `[]`** and there is no built-in
  node_modules filter, so `node_modules/**` is listed explicitly.

If a threshold goes red, add the missing test. Do not lower the number and do
not edit the config.

## Why there is no tests/playwright/

By explicit user decision, this project keeps **unit tests only**. End-to-end
browser checks are still done with Playwright, but as throwaway scripts in
`claude_tmp/` that are deleted after the run — they are not committed specs.
