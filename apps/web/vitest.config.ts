import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "test-results/**", "playwright-report/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 70
      }
    }
  }
});
