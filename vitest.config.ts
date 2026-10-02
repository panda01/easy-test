import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    env: { NODE_ENV: "test" },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // `coverage.include` is deliberately UNSET. Vitest then measures only the
      // files the tests actually load (its getUntestedFiles() short-circuits to
      // [] when include == null), which keeps a module that has no caller yet -
      // e.g. server/services/dbService.ts - from sinking the global thresholds
      // before anything uses it. The moment a route imports it, it starts being
      // measured, which is why it is NOT listed in `exclude` below.
      //
      // `exclude` REPLACES Vitest's default (which is an empty array). There is
      // no built-in node_modules filter, so it has to be named explicitly or
      // every MUI/React file the tests touch would be counted.
      exclude: [
        "node_modules/**",
        "server/generated/**",
        "server/prisma/**",
        "src/main.tsx",
        "vite.config.ts",
        "vitest.config.ts",
        "eslint.config.ts",
        "prisma.config.ts",
        "dist/**",
        "dist-server/**",
        "coverage/**",
        "claude_tmp/**",
        "tests/**",
      ],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
    },
    projects: [
      {
        test: {
          name: "backend",
          include: ["tests/backend/**/*.test.ts"],
          environment: "node",
          globals: true,
          env: { NODE_ENV: "test" },
        },
      },
      {
        plugins: [react()],
        test: {
          name: "frontend",
          include: ["tests/frontend/**/*.test.tsx"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          env: { NODE_ENV: "test" },
        },
      },
    ],
  },
});
