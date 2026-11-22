import { defineConfig, devices } from "@playwright/test";

// Development mode reports problems a production build never shows, such as route validation
// errors in the dev overlay. Its own port and build, to run beside a developer's `next dev`.
export default defineConfig({
  testDir: "./e2e/dev",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: "http://localhost:3212",
    ...devices["Desktop Chrome"],
    storageState: {
      cookies: [
        {
          name: "fleetpulse_access",
          value: "e2e-session",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  webServer: {
    command: "npx next dev -p 3212",
    env: { NEXT_DIST_DIR: ".next-dev", NEXT_PUBLIC_GEOAPIFY_API_KEY: "" },
    url: "http://localhost:3212",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
