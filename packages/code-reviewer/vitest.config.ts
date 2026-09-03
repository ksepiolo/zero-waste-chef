import { defineConfig } from "vitest/config";

// Package-local runner. The repo-root config scopes `include` to the root `src/`, so
// `packages/` is outside that suite; this one is scoped to this package alone and no
// root-level config is touched.
export default defineConfig({
  test: {
    // Nothing here touches a DOM — the reviewer is prompt building, schema parsing, and a
    // model call stubbed with `ai/test` doubles.
    environment: "node",
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    // Globals stay off, matching the root convention: every test imports describe/it/expect
    // explicitly, which keeps ESLint's no-undef working without a globals declaration.
    globals: false,
  },
});
