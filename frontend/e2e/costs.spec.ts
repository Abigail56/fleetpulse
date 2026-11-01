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
    permissions: ["costs.submit", "costs.view", "costs.approve"],
  },
  "/organisations": [],
  "/costs/options": {
    vehicles: [{ id: "v1", registration_number: "KCA 123A", make: "Isuzu", model: "NPR" }],
    default_currency: "KES",
  },
  "/costs/summary": {
    start: "2030-01-01",
    end: "2030-01-31",
    totals: [{ currency: "KES", fuel: "8000", maintenance: "0", expenses: "500", total: "8500" }],
    expense_categories: [],
    awaiting_approval: 1,
  },
  "/costs/expenses": {
    items: [
      {
        id: "e1",
        vehicle_id: "v1",
        vehicle_registration: "KCA 123A",
        category: "tolls",
        amount: "500.00",
        currency: "KES",
        incurred_on: "2030-01-05",
        vendor: "Highway Co",
        description: null,
        receipt: null,
        status: "submitted",
        submitted_by_user_id: "2",
        reviewed_at: null,
        review_note: null,
        voided_at: null,
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  },
  "/costs/fuel": { items: [], total: 0, page: 1, page_size: 25 },
};

for (const path of ["/costs", "/costs/fuel/new", "/costs/expenses/new"]) {
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
  test.setTimeout(120000);

  test("record fuel with a real receipt, approve an expense, and see cost per distance", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-cost-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Cost Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();
    const vehiclePath = new URL(page.url()).pathname;
    await expect(page.getByText("No costs recorded in this period.")).toBeVisible();

    const addFuel = async (odometer: string, minutesAgo: number) => {
      await page.goto(`/costs/fuel/new?vehicle=${vehiclePath.split("/").pop()}`);
      await expect(page.getByLabel(/^Currency/)).toHaveValue("KES");
      await expect(page.getByLabel(/^Vehicle/)).not.toHaveValue("");
      const when = new Date(Date.now() - minutesAgo * 60000);
      const pad = (value: number) => String(value).padStart(2, "0");
      await page
        .getByLabel(/^Date and time/)
        .fill(
          `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`,
        );
      await page.getByLabel(/^Quantity/).fill("40");
      await page.getByLabel(/^Price per unit/).fill("200");
      await page.getByLabel(/^Odometer/).fill(odometer);
      await page.getByLabel(/^Filled to full/).check();
    };
    await addFuel("1000", 120);
    await page.getByLabel(/^Receipt/).setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 a real receipt"),
    });
    await expect(page.getByText("receipt.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Add fuel record" }).click();
    await expect(page).toHaveURL(/\/costs$/);
    await addFuel("1500", 60);
    await page.getByRole("button", { name: "Add fuel record" }).click();
    await expect(page).toHaveURL(/\/costs$/);

    await page.getByRole("link", { name: "Add expense" }).click();
    await page.getByLabel(/^Vehicle/).selectOption({ index: 1 });
    await page.getByLabel(/^Amount/).fill("500");
    await page.getByRole("button", { name: "Submit expense" }).click();
    await expect(page).toHaveURL(/\/costs$/);
    await expect(page.getByText(/1 expense is awaiting approval/)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved", { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/16,500\.00/)).toBeVisible();

    // A real signed link from private storage, which forces a download.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download receipt.pdf" }).click();
    expect((await download).suggestedFilename()).toBe("receipt.pdf");

    await page.goto(vehiclePath);
    await expect(page.getByText(/per km/).first()).toBeVisible();
    await expect(page.getByText(/measured from\s+2 odometer readings/)).toBeVisible();
    await expect(page.getByText(/8 litres|5\d? litres|litres per 100 km/).first()).toBeVisible();
  });
});
