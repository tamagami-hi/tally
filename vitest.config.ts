import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
      exclude: ["packages/cli/src/main.ts", "packages/cli/src/io.ts", "packages/web/src/main.tsx", "packages/web/src/App.tsx", "packages/web/src/live.ts", "packages/server/src/serve.ts", "packages/cli/src/commands/mcp.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
  resolve: {
    alias: {
      "@tally/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@tally/server": new URL("./packages/server/src/index.ts", import.meta.url).pathname,
      "@tally/mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
    },
  },
});
