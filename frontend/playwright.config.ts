import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "dev/**",
  fullyParallel: true,
  // Password hashing is deliberately slow, so too many parallel journeys starve each other.
  workers: 3,
  expect: { timeout: 15000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:3211" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // The public site, in a second browser engine.
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: "marketing.spec.ts" },
  ],
  webServer: {
    // Its own port and build, so tests can run beside a developer's `next dev` on 3210.
    command: "npx next start -p 3211",
    env: { NEXT_DIST_DIR: ".next-e2e" },
    url: "http://localhost:3211",
    // Never reuse: another project on this port would silently be tested instead.
    reuseExistingServer: false,
  },
});
