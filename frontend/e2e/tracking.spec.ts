import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const ROUTES: Record<string, unknown> = {
  "/auth/me": { user: { id: "1", email: "a@example.com", full_name: "Ada" }, csrf_token: "c" },
  "/organisation": {
    organisation: {
      id: "o",
      name: "Swift",
      slug: "s",
      country_code: "KE",
      default_currency: "KES",
      timezone: "UTC",
      distance_unit: "km",
    },
    role: "owner",
    permissions: ["vehicles.view", "vehicles.manage", "organisation.manage"],
  },
  "/organisations": [],
  "/tracking/config": { simulator_enabled: true, stale_minutes: 15, offline_minutes: 1440 },
  "/tracking/integrations": [
    {
      id: "i",
      name: "Feed",
      provider: "generic",
      key_prefix: "fpgps_abc",
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: null,
    },
  ],
  "/tracking/devices": [
    {
      id: "d",
      provider: "simulator",
      external_device_id: "sim-1",
      vehicle_id: "v",
      registration_number: "KCA 123A",
      status: "active",
      is_simulated: true,
      last_seen_at: "2026-01-01T00:00:00Z",
    },
  ],
  "/vehicles": { items: [], total: 0, page: 1, page_size: 25 },
};

for (const scheme of ["light", "dark"] as const) {
  test(`/tracking is accessible and fits the screen (${scheme})`, async ({ page }) => {
    await page.route("**/api/v1/**", (route) => {
      const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
      return route.fulfill({
        status: ROUTES[key] === undefined ? 404 : 200,
        json: ROUTES[key] ?? {},
        headers: CORS,
      });
    });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/tracking");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Simulated", { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const summary = results.violations.flatMap((item) =>
      item.nodes.map((node) => `${item.id}: ${node.target} ${node.any[0]?.message ?? ""}`),
    );
    expect(summary).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  test.setTimeout(120000);

  test("the scheduled simulator moves a vehicle, and its data is labelled", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-sim-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Simulator Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("SIM 001");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "SIM 001" })).toBeVisible();
    const vehicleId = new URL(page.url()).pathname.split("/").pop();

    await page.goto("/tracking");
    await page.getByLabel(/Simulated device/).check();
    await page.getByLabel("Vehicle", { exact: true }).selectOption({ label: "SIM 001" });
    await page.getByLabel("Starting latitude").fill("-1.2921");
    await page.getByLabel("Starting longitude").fill("36.8219");
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByText("Simulated", { exact: true })).toBeVisible();

    // Beat fires every 30 seconds, and the worker does the moving: nothing here calls it directly.
    await expect
      .poll(
        async () => {
          const latest = await page.request.get(
            `http://localhost:8010/api/v1/tracking/vehicles/${vehicleId}/latest`,
          );
          const body = await latest.json();
          expect(body.is_simulated).toBe(true);
          return body.latitude === -1.2921 && body.longitude === 36.8219;
        },
        { timeout: 70000, intervals: [3000] },
      )
      .toBe(false);

    await page.goto(`/vehicles/${vehicleId}`);
    await expect(page.getByText("Simulated", { exact: true })).toBeVisible();

    // It stops when the device is deactivated, leaving the last position honest about its age.
    await page.goto("/tracking");
    await page.getByRole("button", { name: /^Deactivate sim-/ }).click();
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  });

  test("register a device, send a real position through the feed, and see it", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-gps-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Tracking Test Org");

    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();
    const vehiclePath = new URL(page.url()).pathname;
    await expect(page.getByText(/No position has been received/)).toBeVisible();

    await page.goto("/tracking");
    await page.getByLabel("Feed name").fill("Test feed");
    await page.getByRole("button", { name: "Create key" }).click();
    const key = await page.getByText(/^fpgps_/).first().innerText();
    expect(key.length).toBeGreaterThan(30);

    await page.getByLabel("Device ID").fill("IMEI-LIVE-1");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A" });
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByText("IMEI-LIVE-1")).toBeVisible();

    const response = await request.post("http://localhost:8010/api/v1/ingest/gps", {
      headers: { Authorization: `Bearer ${key}` },
      data: {
        positions: [
          {
            device_id: "IMEI-LIVE-1",
            recorded_at: new Date().toISOString(),
            latitude: -1.2921,
            longitude: 36.8219,
            speed_kph: 42.5,
          },
        ],
      },
    });
    expect(response.status()).toBe(202);
    expect((await response.json()).accepted).toBe(1);

    await page.goto(vehiclePath);
    await expect(page.getByText("-1.29210, 36.82190")).toBeVisible();
    await expect(page.getByText("42.5 km/h")).toBeVisible();
    await expect(page.getByText("Simulated", { exact: true })).toHaveCount(0);

    // A revoked key stops working.
    await page.goto("/tracking");
    await page.getByRole("button", { name: "Revoke Test feed" }).click();
    await page.getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByText("Key revoked.")).toBeVisible();
    const refused = await request.post("http://localhost:8010/api/v1/ingest/gps", {
      headers: { Authorization: `Bearer ${key}` },
      data: { positions: [] },
    });
    expect(refused.status()).toBe(401);
  });
});
