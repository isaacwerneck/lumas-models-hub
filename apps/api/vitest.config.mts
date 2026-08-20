import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { provider: "v8", thresholds: { lines: 85 } }
  }
});
