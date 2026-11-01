import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const FENCE = {
  id: "g1",
  name: "Nairobi depot",
  kind: "polygon",
  boundary: [
    [-1.3, 36.8],
    [-1.3, 36.9],
    [-1.2, 36.9],
    [-1.3, 36.8],
  ],
  center_latitude: null,
  center_longitude: null,
  radius_m: null,
  is_restricted: true,
  alert_on_entry: true,
  alert_on_exit: false,
  vehicles_inside: 1,
  archived_at: null,
  created_at: "2030-01-01T00:00:00Z",
};
const ALERT = {
  id: "a1",
  alert_type: "geofence_entry",
  severity: "critical",
  title: "KCA 123A entered Nairobi depot",
  message: "KCA 123A entered restricted area Nairobi depot.",
  occurred_at: "2030-01-01T08:00:00Z",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  driver_id: null,
  geofence_id: "g1",
  is_simulated: true,
  acknowledged_at: null,
  resolved_at: null,
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
    permissions: [
      "vehicles.view",
      "alerts.view",
      "alerts.manage",
      "geofences.view",
      "geofences.manage",
    ],
  },
  "/organisations": [],
  "/alerts": { items: [ALERT], total: 1, page: 1, page_size: 25 },
  "/alerts/summary": { unacknowledged: 3, critical: 1 },
  "/alerts/settings": {
    speed_limit_kph: 90,
    offline_alerts_enabled: true,
    offline_minutes: 60,
    licence_alerts_enabled: true,
    maintenance_alerts_enabled: true,
    document_alerts_enabled: true,
  },
  "/geofences": [FENCE],
  "/geofences/g1": FENCE,
  "/geofences/g1/events": { items: [], total: 0, page: 1, page_size: 25 },
  "/tracking/fleet": [],
};

for (const path of ["/alerts", "/geofences", "/geofences/new", "/geofences/g1"]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${path} is accessible and fits the screen (${scheme})`, async ({ page }) => {
      await page.route("**/tiles.openfreemap.org/**", (route) =>
        route.fulfill({ status: 200, json: { version: 8, sources: {}, layers: [] } }),
      );
      await page.route("**/api/v1/**", (route) => {
        const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
        return route.fulfill({
          status: ROUTES[key] === undefined ? 404 : 200,
          json: ROUTES[key] ?? {},
          headers: CORS,
        });
      });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForTimeout(500);
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
}

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  test.setTimeout(120000);

  test("draw a geofence, drive a real position into it, and acknowledge the alert", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-fence-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Geofence Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/tracking");
    await page.getByLabel("Feed name").fill("Fence feed");
    await page.getByRole("button", { name: "Create key" }).click();
    const key = await page.getByText(/^fpgps_/).first().innerText();
    await page.getByLabel("Device ID").fill("IMEI-FENCE-1");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A" });
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByText("IMEI-FENCE-1")).toBeVisible();

    const send = async (secondsAgo: number, latitude: number, longitude: number) => {
      const response = await request.post("http://localhost:8010/api/v1/ingest/gps", {
        headers: { Authorization: `Bearer ${key}` },
        data: {
          positions: [
            {
              device_id: "IMEI-FENCE-1",
              recorded_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
              latitude,
              longitude,
              speed_kph: 40,
            },
          ],
        },
      });
      expect(response.status()).toBe(202);
    };
    await send(60, -1.0, 36.0);

    await page.goto("/geofences");
    await page.getByRole("link", { name: "Create a geofence" }).click();
    await page.getByLabel(/^Name/).fill("Quarry");
    await page.getByLabel("Polygon").check();
    await page.getByLabel(/^Corners/).fill("-1.3, 36.8\n-1.3, 36.9\n-1.2, 36.9\n-1.2, 36.8");
    await page.getByLabel(/Restricted area/).check();
    await page.getByRole("button", { name: "Create geofence" }).click();
    await expect(page.getByRole("heading", { name: "Quarry" })).toBeVisible();
    await expect(page.getByText(/No vehicle has entered/)).toBeVisible();

    await send(30, -1.25, 36.85);

    await page.goto("/alerts");
    const list = page.getByRole("list", { name: "Alerts" });
    await expect(list.getByText("KCA 123A entered Quarry")).toBeVisible();
    await expect(list.getByText("Critical")).toBeVisible();
    await expect(page.getByRole("link", { name: /Alerts.*1/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /Acknowledge: KCA 123A entered Quarry/ }).click();
    await expect(page.getByText("No active alerts")).toBeVisible();

    await page.getByLabel("Show").selectOption("all");
    await expect(page.getByText("KCA 123A entered Quarry")).toBeVisible();
    await page.getByRole("link", { name: "Open geofence" }).click();
    const history = page.getByRole("list", { name: "Entry and exit history" });
    await expect(history.getByText(/entered/)).toBeVisible();

    // The boundary also appears on the live map's data, and clicking a map fills in a centre.
    await page.goto("/geofences/new");
    const map = page.locator(".maplibregl-canvas");
    await expect(map).toBeVisible();
    await expect(async () => {
      const box = await map.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(page.getByLabel(/Centre latitude/)).not.toHaveValue("", { timeout: 500 });
    }).toPass({ timeout: 15000 });
  });
});
