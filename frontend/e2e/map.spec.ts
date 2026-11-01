import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const row = (id: string, registration: string, fields: Record<string, unknown> = {}) => ({
  id,
  registration_number: registration,
  make: "Isuzu",
  model: "NPR",
  vehicle_status: "active",
  recorded_at: minutesAgo(1),
  latitude: -1.2921,
  longitude: 36.8219,
  speed_kph: "42.50",
  heading_degrees: "90.00",
  ignition_on: true,
  signal_status: "good",
  is_simulated: false,
  driver_name: "Tunde Adeyemi",
  ...fields,
});
const FLEET = [
  row("v1", "KCA 123A"),
  row("v2", "KCB 456B", { latitude: -1.3, longitude: 36.85, speed_kph: "0.00" }),
  row("v3", "KCC 789C", { latitude: -1.31, longitude: 36.8, recorded_at: minutesAgo(60) }),
  row("v4", "KCD 012D", { latitude: -1.25, longitude: 36.79, recorded_at: minutesAgo(3000) }),
  row("v5", "KCE 345E", {
    recorded_at: null,
    latitude: null,
    longitude: null,
    speed_kph: null,
    heading_degrees: null,
    ignition_on: null,
    signal_status: null,
  }),
];

async function stub(page: Page, fleet: unknown[] = FLEET) {
  await page.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({ status: 200, json: { version: 8, sources: {}, layers: [] } }),
  );
  const routes: Record<string, unknown> = {
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
      permissions: ["vehicles.view", "vehicles.manage", "drivers.view"],
    },
    "/organisations": [],
    "/tracking/config": { simulator_enabled: false, stale_minutes: 15, offline_minutes: 1440 },
    "/tracking/fleet": fleet,
  };
  await page.route("**/api/v1/**", (route) => {
    const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (key.endsWith("/history")) return route.fulfill({ status: 200, json: [], headers: CORS });
    return route.fulfill({
      status: routes[key] === undefined ? 404 : 200,
      json: routes[key] ?? {},
      headers: CORS,
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`/map is accessible and fits the screen (${scheme})`, async ({ page }) => {
    await page.routeWebSocket(/tracking\/stream/, (socket) => {
      socket.send(JSON.stringify({ type: "ready" }));
    });
    await stub(page);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/map");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.getByRole("button", { name: /KCC 789C/ }).click();
    await expect(page.getByText(/may have moved since/)).toBeVisible();
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

test("each vehicle shows the status its data supports", async ({ page }) => {
  await page.routeWebSocket(/tracking\/stream/, () => {});
  await stub(page);
  await page.goto("/map");
  const list = page.getByRole("list", { name: "Vehicles" });
  const status = (name: RegExp, text: string) =>
    expect(list.getByRole("button", { name }).getByText(text, { exact: true })).toBeVisible();
  await status(/KCA 123A/, "Moving");
  await status(/KCB 456B/, "Idle");
  await status(/KCC 789C/, "Stale GPS");
  await status(/KCD 012D/, "Offline");
  await status(/KCE 345E/, "No position yet");
});

test("filters are kept in the address, and survive a reload", async ({ page }) => {
  await page.routeWebSocket(/tracking\/stream/, () => {});
  await stub(page);
  await page.goto("/map");
  await page.getByLabel("Status").selectOption("stale");
  await expect(page).toHaveURL(/status=stale/);
  await page.reload();
  const list = page.getByRole("list", { name: "Vehicles" });
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByRole("button", { name: /KCC 789C/ })).toBeVisible();
});

test("a position from the stream updates the page without a reload", async ({ page }) => {
  await page.routeWebSocket(/tracking\/stream/, (socket) => {
    socket.send(JSON.stringify({ type: "ready" }));
    socket.send(
      JSON.stringify({
        type: "positions",
        positions: [
          {
            vehicle_id: "v2",
            recorded_at: new Date().toISOString(),
            latitude: -1.3,
            longitude: 36.85,
            speed_kph: "61.00",
            heading_degrees: "10.00",
            ignition_on: true,
            signal_status: "good",
            is_simulated: false,
          },
        ],
      }),
    );
  });
  await stub(page, FLEET);
  await page.goto("/map");
  const row = page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /KCB 456B/ });
  await expect(row.getByText("Moving", { exact: true })).toBeVisible();
});

test("if the stream can't connect, the page says so and keeps working", async ({ page }) => {
  await page.routeWebSocket(/tracking\/stream/, (socket) => {
    void socket.close({ code: 1013 });
  });
  await stub(page);
  await page.goto("/map");
  await expect(page.getByText(/Live updates paused/)).toBeVisible();
  await expect(page.getByRole("button", { name: /KCA 123A/ })).toBeVisible();
});

test("if the map background can't load, the list still works", async ({ page }) => {
  await page.routeWebSocket(/tracking\/stream/, () => {});
  await stub(page);
  await page.route("**/tiles.openfreemap.org/**", (route) => route.abort());
  await page.goto("/map");
  await expect(page.getByText(/The map couldn.t load/)).toBeVisible();
  await page.getByRole("button", { name: /KCA 123A/ }).click();
  await expect(page.getByRole("region", { name: "KCA 123A details" })).toBeVisible();
});

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  test.setTimeout(120000);

  test("a real position reaches an open map over the real stream, then draws a route", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-map-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Map Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/tracking");
    await page.getByLabel("Feed name").fill("Map feed");
    await page.getByRole("button", { name: "Create key" }).click();
    const key = await page.getByText(/^fpgps_/).first().innerText();
    await page.getByLabel("Device ID").fill("IMEI-MAP-1");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A" });
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByText("IMEI-MAP-1")).toBeVisible();

    await page.goto("/map");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expect(page.getByText(/None of your vehicles has reported/)).toBeVisible();
    const row = page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /KCA 123A/ });
    await expect(row.getByText("No position yet")).toBeVisible();

    const send = async (secondsAgo: number, latitude: number, speed: number) => {
      const response = await request.post("http://localhost:8010/api/v1/ingest/gps", {
        headers: { Authorization: `Bearer ${key}` },
        data: {
          positions: [
            {
              device_id: "IMEI-MAP-1",
              recorded_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
              latitude,
              longitude: 36.8219,
              speed_kph: speed,
            },
          ],
        },
      });
      expect(response.status()).toBe(202);
    };
    await send(30, -1.2921, 42.5);
    // Well under the 30-second refresh, so only the stream can have delivered it.
    await expect(row.getByText("Moving", { exact: true })).toBeVisible({ timeout: 8000 });

    // Clicking the only vehicle, which the map centres on, selects it.
    await page.reload();
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    await expect(async () => {
      const box = await canvas.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(page.getByRole("region", { name: "KCA 123A details" })).toBeVisible({
        timeout: 500,
      });
    }).toPass({ timeout: 15000 });
    await expect(page.getByText("-1.29210, 36.82190")).toBeVisible();
    await expect(page.getByText(/1 position, joined by straight lines/)).toBeVisible();
    await expect(page.getByText(/simulated/i)).toHaveCount(0);

    await send(0, -1.3, 0);
    await expect(row.getByText("Idle", { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("-1.30000, 36.82190")).toBeVisible();
  });
});
