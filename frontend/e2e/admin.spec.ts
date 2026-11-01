import { execSync } from "node:child_process";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createOrganisation, newUser, PASSWORD } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const ROUTES: Record<string, unknown> = {
  "/auth/me": {
    user: { id: "1", email: "a@example.com", full_name: "Ada", is_platform_admin: true },
    csrf_token: "c",
  },
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
    permissions: [],
  },
  "/organisations": [],
  "/admin/session": { verified: true },
  "/admin/system": {
    services: [{ name: "Database", state: "ok" }],
    jobs: [{ name: "alerts.sweep", state: "ok", last_success_at: "2030-01-01T00:00:00Z" }],
    integrations: [{ name: "Online payment", state: "not_configured", detail: "Not set." }],
    counts: {
      organisations: 2,
      users: 3,
      vehicles: 4,
      active_subscriptions: 0,
      emails_waiting: 0,
      emails_failed: 0,
      automation_failed: 0,
      active_gps_feeds: 0,
    },
  },
};

for (const scheme of ["light", "dark"] as const) {
  test(`/admin is accessible and fits the screen (${scheme})`, async ({ page }) => {
    await page.route("**/api/v1/**", (route) => {
      const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
      return route.fulfill({
        status: ROUTES[key] === undefined ? 404 : 200,
        json: ROUTES[key] ?? {},
        headers: CORS,
      });
    });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/admin");
    await expect(page.getByRole("list", { name: "Services" })).toBeVisible();
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

  test("only a granted admin gets in, after a password, and real jobs show as running", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    const email = `e2e-admin-${tag}@example.com`;
    await newUser(page, request, email, "Ada Obi");
    await createOrganisation(page, "Admin Test Org");

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    // The same command an operator uses. No request can do this.
    execSync(
      `docker compose --profile app run --rm -T migrate python -m app.db.make_platform_admin ${email}`,
      { cwd: "..", stdio: "pipe" },
    );

    await page.goto("/admin");
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    const services = page.getByRole("list", { name: "Services" });
    await expect(services.getByText("Working").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Integrations" }).getByText("Online payment")).toBeVisible();
    // The worker really is running, so its most frequent job has reported in.
    const jobs = page.getByRole("list", { name: "Background jobs" });
    await expect(jobs.getByText("notifications.dispatch")).toBeVisible();

    await page.getByRole("button", { name: "Audit log" }).click();
    await expect(page.getByRole("list", { name: "Audit log" }).getByText("admin.verified").first()).toBeVisible();

    // Removing the grant takes effect immediately.
    execSync(
      `docker compose --profile app run --rm -T migrate python -m app.db.make_platform_admin ${email} --remove`,
      { cwd: "..", stdio: "pipe" },
    );
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
