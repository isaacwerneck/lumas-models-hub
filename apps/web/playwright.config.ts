import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.10" } } },
    { name: "desktop-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.11" } } },
    { name: "mobile-390", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.12" } } },
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.13" } } }
  ],
  webServer: [
    {
      command: "npm run dev:e2e --workspace @lumas/api",
      cwd: "../..",
      url: "http://127.0.0.1:3334/ready",
      reuseExistingServer: false,
      env: {
        PORT: "3334",
        APP_ORIGIN: "http://localhost:4173",
        TRUST_PROXY: "true",
        LOGIN_RATE_LIMIT_MAX: "100"
      },
      timeout: 120_000
    },
    {
      command: "npm run dev:e2e",
      cwd: ".",
      url: "http://127.0.0.1:4173/login",
      reuseExistingServer: false,
      env: { VITE_API_URL: "http://localhost:3334" },
      timeout: 120_000
    }
  ]
});
