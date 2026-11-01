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
    permissions: ["billing.manage"],
  },
  "/organisations": [],
  "/billing/status": {
    payments_enabled: true,
    enforced: true,
    state: "grace",
    plan: "growth",
    trial_ends_at: null,
    paid_until: "2030-01-15T00:00:00Z",
    vehicles_paid_for: 3,
    vehicles_used: 3,
    members_used: 2,
    max_vehicles: 250,
    max_members: null,
  },
  "/billing/plans": [
    { key: "starter", name: "Starter", price_per_vehicle: "9.00", currency: "USD", max_vehicles: 25, max_members: 5 },
    { key: "growth", name: "Growth", price_per_vehicle: "15.00", currency: "USD", max_vehicles: 250, max_members: null },
  ],
  "/billing/payments": [
    {
      id: "p1",
      reference: "fp_abc",
      plan: "growth",
      vehicles: 3,
      amount: "45.00",
      currency: "USD",
      status: "paid",
      created_at: "2030-01-01T00:00:00Z",
      paid_at: "2030-01-01T00:00:00Z",
    },
  ],
};

for (const scheme of ["light", "dark"] as const) {
  test(`/billing is accessible and fits the screen (${scheme})`, async ({ page }) => {
    await page.route("**/api/v1/**", (route) => {
      const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
      return route.fulfill({
        status: ROUTES[key] === undefined ? 404 : 200,
        json: ROUTES[key] ?? {},
        headers: CORS,
      });
    });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/billing");
    await expect(page.getByRole("button", { name: "Pay for Growth" })).toBeVisible();
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

  test("with no provider set up, the page says so and a forged webhook gets nowhere", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-bill-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Billing Test Org");
    await page.goto("/billing");
    await expect(page.getByText(/Online payment isn.t set up yet/)).toBeVisible();
    await expect(page.getByText("Free trial")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pay for/ })).toHaveCount(0);

    const webhook = await request.post("http://localhost:8010/api/v1/billing/webhooks/paystack", {
      data: { event: "charge.success", data: { reference: "x", amount: 1, currency: "USD" } },
    });
    expect(webhook.status()).toBe(404);
  });
});
