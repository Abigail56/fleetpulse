import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const SCHEDULE = {
  id: "s1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  vehicle_odometer_km: "12000.0",
  odometer_recorded_at: "2020-01-01T00:00:00Z",
  name: "Oil change",
  interval_days: 90,
  interval_km: "5000.0",
  warn_days: 14,
  warn_km: "500.0",
  last_service_on: "2030-01-01",
  last_service_km: "10000.0",
  next_due_on: "2030-04-01",
  next_due_km: "15000.0",
  state: "overdue",
  open_work_order_id: null,
  notes: null,
  archived_at: null,
};
const ORDER = {
  id: "w1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  schedule_id: null,
  work_type: "corrective",
  status: "completed",
  title: "Replace brake pads",
  description: "Front pads worn",
  scheduled_for: "2030-01-10",
  provider_name: "Nairobi Motors",
  provider_phone: "+254 712 345678",
  provider_email: "service@example.com",
  started_at: "2030-01-10T08:00:00Z",
  took_off_road: true,
  completed_on: "2030-01-11",
  odometer_km: "12000.0",
  labour_cost: "1500.00",
  parts_cost: null,
  total_cost: "1500.00",
  currency: "KES",
  completion_notes: "Done",
  created_at: "2030-01-01T00:00:00Z",
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
    permissions: ["maintenance.view", "maintenance.manage"],
  },
  "/organisations": [],
  "/maintenance/summary": {
    overdue: 1,
    due_soon: 2,
    open_work_orders: 1,
    in_progress_work_orders: 1,
    recent_costs: [{ currency: "KES", amount: "1500.00" }],
  },
  "/maintenance/schedules": { items: [SCHEDULE], total: 1, page: 1, page_size: 25 },
  "/maintenance/schedules/s1": SCHEDULE,
  "/maintenance/work-orders": { items: [ORDER], total: 1, page: 1, page_size: 25 },
  "/maintenance/work-orders/w1": ORDER,
  "/maintenance/vehicle-options": [],
};

const PAGES = [
  "/maintenance",
  "/maintenance/schedules/new",
  "/maintenance/schedules/s1",
  "/maintenance/work-orders/new",
  "/maintenance/work-orders/w1",
];

for (const path of PAGES) {
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
      await page.waitForTimeout(400);
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
  test.setTimeout(150000);

  test("an overdue schedule raises a reminder, and doing the work clears it", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-maint-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Maintenance Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();
    const vehiclePath = new URL(page.url()).pathname;
    await expect(page.getByText("No schedules or service history yet.")).toBeVisible();

    await page.getByRole("link", { name: "Add schedule" }).click();
    await expect(page.getByLabel(/^Vehicle/)).toHaveValue(vehiclePath.split("/").pop()!);
    await page.getByLabel(/^Name/).fill("Oil change");
    await page.getByLabel(/Every how many days/).fill("90");
    await page.getByLabel(/Last done on/).fill("2020-01-01");
    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByRole("heading", { name: "Oil change" })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();

    const reminderCount = async () => {
      const response = await page.request.get(
        "http://localhost:8010/api/v1/alerts?alert_type=maintenance_due",
      );
      return (await response.json()).total as number;
    };
    // The real scheduled sweep raises it, within a minute: nothing here calls it directly.
    await expect
      .poll(
        reminderCount,
        { timeout: 90000, intervals: [5000] },
      )
      .toBeGreaterThan(0);
    await page.goto("/alerts");
    await expect(page.getByText("KCA 123A: Oil change is overdue")).toBeVisible();

    await page.goto(vehiclePath);
    await page.getByRole("list", { name: "Maintenance schedules" }).getByRole("link").click();
    await page.getByRole("link", { name: "Book this work" }).click();
    await expect(page.getByLabel(/^Type/)).toHaveValue("preventive");
    await page.getByLabel(/^Title/).fill("Oil and filter");
    await page.getByLabel("Provider name").fill("Nairobi Motors");
    await page.getByRole("button", { name: "Create work order" }).click();
    await expect(page.getByRole("heading", { name: "Oil and filter" })).toBeVisible();

    await page.getByRole("button", { name: "Start work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start work" }).click();
    await expect(page.getByRole("button", { name: "Complete work" })).toBeVisible();

    await page.goto(vehiclePath);
    await expect(page.getByRole("heading", { name: "Maintenance", exact: true })).toBeVisible();
    await page.getByRole("list", { name: "Service history" }).getByRole("link").click();

    await page.getByRole("button", { name: "Complete work" }).click();
    await page.getByLabel(/Labour cost/).fill("1500");
    await page.getByRole("button", { name: "Complete work order" }).click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete work order" })).toHaveCount(0);
    await expect(page.getByText(/1,500\.00/).first()).toBeVisible();
    // Parts weren't entered, so they're unknown rather than zero.
    await expect(page.getByText("Not recorded").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel work order" })).toHaveCount(0);

    await page.goto("/maintenance");
    await expect(page.getByRole("link", { name: /Oil change.*Not due/ })).toBeVisible();
    await expect
      .poll(
        reminderCount,
        { timeout: 90000, intervals: [5000] },
      )
      .toBe(0);
  });
});
