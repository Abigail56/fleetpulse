import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const RULE = {
  id: "r1",
  name: "Tell managers",
  is_enabled: true,
  alert_types: ["document_expiry"],
  min_severity: "warning",
  vehicle_id: null,
  actions: [{ type: "notify", roles: ["fleet_manager"], email: true }],
  archived_at: null,
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
    permissions: ["alerts.view", "automation.manage"],
  },
  "/organisations": [],
  "/alerts/summary": { unacknowledged: 0, critical: 0 },
  "/notifications/unread-count": { unread: 2 },
  "/notifications": {
    items: [
      {
        id: "n1",
        alert_id: "a1",
        title: "KCA 123A: Brakes",
        body: "A critical defect was reported.",
        severity: "critical",
        read_at: null,
        email_status: "sent",
        created_at: "2030-01-01T08:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  },
  "/notifications/preferences": [
    { alert_type: "speeding", in_app: true, email_mode: "critical" },
    { alert_type: "defect_reported", in_app: true, email_mode: "all" },
  ],
  "/automation/rules": [RULE],
  "/automation/rules/r1": RULE,
  "/automation/runs": {
    items: [
      {
        id: "x",
        rule_id: "r1",
        rule_name: "Tell managers",
        alert_title: "Insurance",
        status: "succeeded",
        attempts: 1,
        outcome: "Notified 1 person",
        created_at: "2030-01-01T00:00:00Z",
        finished_at: "2030-01-01T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  },
};

for (const path of ["/notifications", "/automation", "/automation/new", "/automation/r1"]) {
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

  test("a rule turns a real defect into a notification, an email and a work order", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    const email = `e2e-note-${tag}@example.com`;
    await newUser(page, request, email, "Ada Obi");
    await createOrganisation(page, "Automation Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/automation/new");
    await page.getByLabel("Name").fill("Book defects");
    await page.getByLabel("Defect reported").check();
    await page.getByLabel("Create a work order for the vehicle").check();
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByRole("list", { name: "Rules" }).getByText("Book defects")).toBeVisible();

    await page.goto("/compliance/defects/new");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A · Isuzu NPR" });
    await page.getByLabel(/What.s wrong/).fill("Brakes failing");
    await page.getByLabel(/^Severity/).selectOption("critical");
    await page.getByRole("button", { name: "Report defect" }).click();
    await expect(page).toHaveURL(/\/compliance$/);

    // The real scheduled job does the rest, within half a minute: nothing here calls it directly.
    await expect
      .poll(
        async () => {
          const response = await page.request.get("http://localhost:8010/api/v1/notifications");
          return (await response.json()).total as number;
        },
        { timeout: 70000, intervals: [3000] },
      )
      .toBe(1);
    await expect
      .poll(
        async () => {
          const response = await page.request.get("http://localhost:8010/api/v1/maintenance/work-orders");
          return (await response.json()).total as number;
        },
        { timeout: 70000, intervals: [3000] },
      )
      .toBe(1);

    await page.goto("/notifications");
    const list = page.getByRole("list", { name: "Notifications" });
    await expect(list.getByText("KCA 123A: Brakes failing")).toBeVisible();
    const unread = await page.request.get("http://localhost:8010/api/v1/notifications/unread-count");
    expect((await unread.json()).unread).toBe(1);
    await page.getByRole("button", { name: /Mark as read: KCA 123A/ }).click();
    await expect(page.getByRole("button", { name: /Mark as read:/ })).toHaveCount(0);

    // A critical alert is emailed by default, through the real mail server.
    await expect
      .poll(
        async () => {
          const inbox = await (
            await request.get(
              `http://localhost:8027/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
            )
          ).json();
          return inbox.messages.some((item: { Subject: string }) =>
            item.Subject.includes("KCA 123A: Brakes failing"),
          );
        },
        { timeout: 70000, intervals: [3000] },
      )
      .toBe(true);

    await page.goto("/automation");
    const history = page.getByRole("list", { name: "History" });
    await expect(history.getByText("Succeeded")).toBeVisible();
    await expect(history.getByText(/Created a work order/)).toBeVisible();
  });
});
