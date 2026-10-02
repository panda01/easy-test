import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

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
]);
