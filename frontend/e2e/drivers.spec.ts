import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const ID = "33333333-3333-4333-8333-333333333333";
const DRIVER = {
  id: ID,
  first_name: "Tunde",
  last_name: "Adeyemi",
  phone: "+254 712 345678",
  email: "tunde@example.com",
  licence_number: "DL-123456",
  sensitive_visible: true,
  licence_class: "C",
  licence_country_code: "KE",
  licence_expires_on: "2020-01-01",
  status: "active",
  availability: "available",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  current_vehicle: null,
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
    permissions: ["drivers.view", "drivers.manage", "drivers.view_sensitive", "vehicles.view"],
  },
  "/organisations": [],
  "/drivers": { items: [DRIVER], total: 1, page: 1, page_size: 25 },
  [`/drivers/${ID}`]: DRIVER,
  [`/drivers/${ID}/assignments`]: [
    {
      id: "a1",
      vehicle_id: "v1",
      registration_number: "KCA 123A",
      started_at: "2026-01-01T00:00:00Z",
      ended_at: "2026-02-01T00:00:00Z",
    },
  ],
  "/vehicles": { items: [], total: 0, page: 1, page_size: 25 },
};

for (const path of ["/drivers", "/drivers/new", `/drivers/${ID}`, `/drivers/${ID}/edit`]) {
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

test("the Google button appears on sign-in and sign-up when configured", async ({ page }) => {
  await page.route("**/api/v1/auth/providers", (route) =>
    route.fulfill({ status: 200, json: { google: true }, headers: CORS }),
  );
  await page.goto("/login?next=/vehicles");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    /\/api\/v1\/auth\/google\/start\?next=%2Fvehicles$/,
  );
  await page.goto("/register");
  await expect(page.getByRole("link", { name: "Sign up with Google" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((item) => item.id)).toEqual([]);
});

test("the Google button is absent when it isn't configured", async ({ page }) => {
  await page.route("**/api/v1/auth/providers", (route) =>
    route.fulfill({ status: 200, json: { google: false }, headers: CORS }),
  );
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Google/ })).toHaveCount(0);
});

test("a failed Google sign-in explains itself", async ({ page }) => {
  await page.goto("/login?error=google_cancelled");
  await expect(page.getByText(/Google sign-in was cancelled/)).toBeVisible();
});

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  test.setTimeout(120000);

  test("add a driver, assign a vehicle, edit, and archive", async ({ page, request }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-drivers-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Driver Test Org");

    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/drivers");
    await page.getByRole("link", { name: "Add your first driver" }).click();
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByText("Please enter a first name.")).toBeVisible();
    await page.getByLabel("First name").fill("Tunde");
    await page.getByLabel("Last name").fill("Adeyemi");
    await page.getByLabel("Phone").fill("+254 712 345678");
    await page.getByLabel("Licence number").fill("dl-123456");
    await page.getByLabel("Licence expiry").fill("2020-01-01");
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByRole("heading", { name: "Tunde Adeyemi" })).toBeVisible();
    // The list page stays mounted but hidden, and its filter also offers "Expired".
    await expect(page.getByText("Expired", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("DL-123456")).toBeVisible();

    // The dashboard counts the real expired licence.
    await page.goto("/dashboard");
    await expect(page.getByText(/1 driver licence has expired/)).toBeVisible();

    await page.goto("/drivers/new");
    await page.getByLabel("First name").fill("Other");
    await page.getByLabel("Last name").fill("Person");
    await page.getByLabel("Licence number").fill("DL-123456");
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByText("Another driver already has this licence number.")).toBeVisible();

    await page.goto("/drivers");
    await page.getByRole("link", { name: "Tunde Adeyemi" }).click();
    await page.getByLabel("Vehicle to assign").selectOption({ label: "KCA 123A (Isuzu NPR)" });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("Vehicle assigned.")).toBeVisible();
    await page.getByRole("link", { name: "KCA 123A" }).click();
    await expect(page.getByRole("link", { name: "Tunde Adeyemi" })).toBeVisible();

    await page.getByRole("link", { name: "Tunde Adeyemi" }).click();
    await page.getByRole("button", { name: "Unassign" }).click();
    await expect(page.getByText("Not assigned to a vehicle.")).toBeVisible();
    await expect(page.getByText(/to \d+ \w+ \d{4}|to now/).first()).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Availability", { exact: true }).selectOption("off_duty");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Off duty", { exact: true }).filter({ visible: true })).toBeVisible();

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: "Archive driver" }).click();
    await expect(page.getByRole("button", { name: "Restore driver" })).toBeVisible();
  });
});
