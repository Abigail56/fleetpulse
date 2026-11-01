import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const TRIP = {
  id: "t1",
  status: "in_progress",
  origin_name: "Nairobi",
  destination_name: "Mombasa",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  driver_id: "d1",
  driver_name: "Tunde Adeyemi",
  planned_departure_at: "2030-01-01T08:00:00Z",
  estimated_arrival_at: "2030-01-01T16:00:00Z",
  actual_departure_at: "2030-01-01T08:10:00Z",
  actual_arrival_at: null,
  distance_km: null,
  distance_source: null,
  dispatch_notes: "Use the bypass",
  created_at: "2030-01-01T00:00:00Z",
  updated_at: "2030-01-01T00:00:00Z",
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
    permissions: ["trips.view", "trips.view_all", "trips.manage"],
  },
  "/organisations": [],
  "/trips": { items: [TRIP], total: 1, page: 1, page_size: 25 },
  "/trips/options": { vehicles: [], drivers: [] },
  "/trips/t1": TRIP,
  "/trips/t1/events": [],
  "/trips/t1/route": { points: [], is_simulated: false, is_limited: false },
};

for (const path of ["/trips", "/trips/new", "/trips/t1"]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${path} is accessible and fits the screen (${scheme})`, async ({ page }) => {
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
      await page.waitForTimeout(300);
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

  test("plan, dispatch, run and complete a trip, with distance measured from real positions", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-trip-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Trip Test Org");

    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();
    const vehiclePath = new URL(page.url()).pathname;

    await page.goto("/drivers/new");
    await page.getByLabel("First name").fill("Tunde");
    await page.getByLabel("Last name").fill("Adeyemi");
    await page.getByLabel("Licence number").fill("DL-12345");
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByRole("heading", { name: "Tunde Adeyemi" })).toBeVisible();

    await page.goto("/tracking");
    await page.getByLabel("Feed name").fill("Trip feed");
    await page.getByRole("button", { name: "Create key" }).click();
    const key = await page.getByText(/^fpgps_/).first().innerText();
    await page.getByLabel("Device ID").fill("IMEI-TRIP-1");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A" });
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByText("IMEI-TRIP-1")).toBeVisible();

    await page.goto("/trips");
    await expect(page.getByText("No trips yet")).toBeVisible();
    await page.getByRole("link", { name: "Create a trip" }).click();
    await page.getByLabel(/^Origin/).fill("Nairobi");
    await page.getByLabel(/^Destination/).fill("Mombasa");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A · Isuzu NPR" });
    await page.getByLabel(/^Driver/).selectOption({ label: "Tunde Adeyemi" });
    await page.getByLabel(/^Planned departure/).fill("2030-01-01T08:00");
    await page.getByRole("button", { name: "Create trip" }).click();
    await expect(page.getByRole("heading", { name: "Nairobi → Mombasa" })).toBeVisible();

    await page.getByRole("button", { name: "Mark as planned" }).click();
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Dispatch" }).click();
    await expect(page.getByRole("button", { name: "Start trip" })).toBeVisible();

    await page.getByRole("button", { name: "Start trip" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start trip" }).click();
    await expect(page.getByRole("button", { name: "Complete trip" })).toBeVisible();
    await expect(page.getByText(/Not enough GPS positions/)).toBeVisible();

    const now = Date.now();
    const position = (offset: number, latitude: number) => ({
      device_id: "IMEI-TRIP-1",
      recorded_at: new Date(now + offset).toISOString(),
      latitude,
      longitude: 36.8219,
      speed_kph: 50,
    });
    const sent = await request.post("http://localhost:8010/api/v1/ingest/gps", {
      headers: { Authorization: `Bearer ${key}` },
      data: { positions: [position(1000, -1.2), position(2000, -1.3)] },
    });
    expect((await sent.json()).accepted).toBe(2);
    await page.waitForTimeout(2500);

    await page.getByRole("button", { name: "Complete trip" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Complete trip" }).click();
    await expect(page.getByText(/measured from GPS positions/)).toBeVisible();
    await expect(page.getByText(/^11\.\d+ km/)).toBeVisible();
    await expect(page.getByText(/2 reported positions/)).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel trip" })).toHaveCount(0);
    await expect(page.getByText("Departed by Ada Obi")).toBeVisible();

    await page.goto(vehiclePath);
    await expect(
      page.getByRole("list", { name: "Recent trips" }).getByRole("link", { name: /Nairobi/ }),
    ).toBeVisible();
  });
});
