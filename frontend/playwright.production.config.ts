import { defineConfig, devices } from "@playwright/test";

// Checks the production stack over HTTPS. See "Checking a stack" in docs/operations.md.
// E2E_PRODUCTION_URL is whichever address it's running on, and nothing here starts a server.
export default defineConfig({
  testDir: "./e2e-production",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  use: {
    baseURL: process.env.E2E_PRODUCTION_URL ?? "https://app.fleetpulse.localhost:8443",
    // The local check uses a locally issued certificate. A real deployment should turn this off.
    ignoreHTTPSErrors: process.env.E2E_REAL_CERTIFICATE !== "1",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
