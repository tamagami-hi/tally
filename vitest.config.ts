import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/cli/src/main.ts", "packages/cli/src/io.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
  resolve: {
    alias: {
      "@tally/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
    },
  },
});
