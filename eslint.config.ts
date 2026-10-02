import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import { defineConfig } from "eslint/config";

/**
 * eslint-plugin-jsdoc's TSDoc-flavoured preset, with every rule as an error.
 * TypeScript already holds the types, so `{Type}` braces in a comment are
 * rejected (jsdoc/no-types), and `@param` / `@returns` need descriptions.
 */
const jsdocTsdocPreset = jsdoc.configs["flat/recommended-tsdoc-error"];

export default defineConfig([
  {
    // Generated Prisma client. It is TypeScript, it is regenerated on every
    // `prisma generate`, and linting it is pure noise.
    ignores: [
      "server/generated/**",
      "dist/**",
      "dist-server/**",
      "coverage/**",
      "claude_tmp/**",
    ],
  },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // projectService resolves each linted file to its owning tsconfig.
        // server/** and prisma.config.ts are covered by tsconfig.server.json.
        projectService: true,
      },
    },
  },
  {
    files: ["./server/**/*.{ts,js}"],
    plugins: { js },
    languageOptions: { globals: globals.node },
    rules: {
      // Interpolating a number or an error's message into a log line is the
      // normal case on the server; the rule fights it constantly for no gain.
      "@typescript-eslint/restrict-template-expressions": "off",
      "max-depth": ["error", { max: 4 }],
      "max-nested-callbacks": ["error", { max: 3 }],
    },
  },
  {
    files: ["./server/**/*.{ts,js}", "./src/**/*.{ts,tsx}"],
    ...jsdocTsdocPreset,
    rules: {
      ...jsdocTsdocPreset.rules,
      // `@route METHOD /path` is this project's tag for documenting an API
      // route (see server/controllers/README.md). It has to be registered as a
      // rule option: the `settings.jsdoc.definedTags` form is not honoured by
      // check-tag-names. `typed: true` is the preset's own option, kept as is.
      "jsdoc/check-tag-names": ["error", { typed: true, definedTags: ["route"] }],
    },
  },
]);
