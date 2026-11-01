import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser, PASSWORD } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE = {
  id: ID,
  registration_number: "KCA 123A",
  make: "Isuzu",
  model: "NPR",
  year: 2021,
  vehicle_type: "truck",
  vin: "JTDKB20U093123456",
  fuel_type: "diesel",
  odometer_km: "45210.5",
  ownership_type: "leased",
  owner_name: "Acme Leasing",
  status: "active",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
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
    permissions: ["vehicles.view", "vehicles.manage"],
  },
  "/organisations": [],
  "/vehicles": { items: [VEHICLE], total: 1, page: 1, page_size: 25 },
  [`/vehicles/${ID}`]: VEHICLE,
};

for (const path of ["/vehicles", "/vehicles/new", `/vehicles/${ID}`, `/vehicles/${ID}/edit`]) {
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

  test("add, find, edit, archive and restore a vehicle", async ({ page, request }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-fleet-${tag}@example.com`, "Ada Obi");
    expect(PASSWORD).toBeTruthy();
    await createOrganisation(page, "Vehicle Test Org");

    await expect(page.getByText("Nothing to report yet")).toBeVisible();
    await page.getByRole("link", { name: "Add your first vehicle" }).click();

    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByText("Please enter the registration number.")).toBeVisible();

    const fill = async (registration: string) => {
      await page.getByLabel("Registration number").fill(registration);
      await page.getByLabel("Make").fill("Isuzu");
      await page.getByLabel("Model").fill("NPR");
    };
    await fill("KCA 123A");
    await page.getByLabel("Odometer (km)").fill("45210.5");
    await page.getByLabel("Status").selectOption("active");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();
    await expect(page.getByText("45,210.5 km")).toBeVisible();

    // The same registration with different punctuation is refused, on the field itself.
    await page.goto("/vehicles/new");
    await fill("kca-123a");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByText("Another vehicle already has this registration.")).toBeVisible();

    await fill("KBZ 900B");
    await page.getByLabel("Vehicle type").selectOption("van");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KBZ 900B" })).toBeVisible();

    await page.goto("/vehicles");
    await expect(page.getByText("2 vehicles")).toBeVisible();
    await page.getByLabel("Search vehicles").fill("kbz");
    await expect(page).toHaveURL(/search=kbz/);
    await expect(page.getByText("1 vehicle", { exact: true })).toBeVisible();
    await page.getByLabel("Search vehicles").fill("no-such-vehicle");
    await expect(page.getByText("No vehicles match")).toBeVisible();

    // A filtered list survives a reload, because it lives in the URL.
    await page.goto("/vehicles?vehicle_type=van");
    await expect(page.getByRole("link", { name: "KBZ 900B" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KCA 123A" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByText("50%")).toBeVisible();

    await page.goto("/vehicles");
    await page.getByRole("link", { name: "KCA 123A" }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Odometer (km)").fill("46000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("46,000 km")).toBeVisible();

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: "Archive vehicle" }).click();
    await expect(page.getByRole("button", { name: "Restore vehicle" })).toBeVisible();
    await page.goto("/vehicles");
    await expect(page.getByRole("link", { name: "KCA 123A" })).toHaveCount(0);
    await page.getByLabel("Show archived").check();
    await page.getByRole("link", { name: "KCA 123A" }).click();
    await page.getByRole("button", { name: "Restore vehicle" }).click();
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  });
});
