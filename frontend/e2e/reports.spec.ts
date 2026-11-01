import { readFileSync } from "node:fs";

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
    permissions: ["reports.view"],
  },
  "/organisations": [],
  "/reports": [{ key: "utilisation", title: "Vehicle utilisation", description: "How much." }],
  "/reports/utilisation": {
    key: "utilisation",
    title: "Vehicle utilisation",
    start: "2030-01-01",
    end: "2030-01-30",
    tiles: [{ label: "Vehicles used", value: "1 of 2" }],
    columns: [
      { key: "vehicle", label: "Vehicle", kind: "text" },
      { key: "a", label: "A long column heading one", kind: "number" },
      { key: "b", label: "A long column heading two", kind: "number" },
      { key: "c", label: "A long column heading three", kind: "number" },
      { key: "d", label: "A long column heading four", kind: "number" },
    ],
    rows: [{ vehicle: "KCA 123A", a: 1, b: 2, c: 3, d: 4 }],
    notes: ["Based on completed trips."],
    truncated: false,
  },
};

for (const scheme of ["light", "dark"] as const) {
  test(`/reports is accessible and a wide table doesn't widen the page (${scheme})`, async ({ page }) => {
    await page.route("**/api/v1/**", (route) => {
      const key = new URL(route.request().url()).pathname.replace("/api/v1", "");
      return route.fulfill({
        status: ROUTES[key] === undefined ? 404 : 200,
        json: ROUTES[key] ?? {},
        headers: CORS,
      });
    });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/reports");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("1 of 2")).toBeVisible();
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

  test("a real record appears in a report, and exports as real CSV and PDF files", async ({
    page,
    request,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-report-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Report Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/costs/fuel/new");
    await expect(page.getByLabel(/^Currency/)).toHaveValue("KES");
    await page.getByLabel(/^Vehicle/).selectOption({ index: 1 });
    await page.getByLabel(/^Quantity/).fill("40");
    await page.getByLabel(/^Price per unit/).fill("200");
    await page.getByRole("button", { name: "Add fuel record" }).click();
    await expect(page).toHaveURL(/\/costs$/);

    await page.goto("/reports");
    await page.getByLabel("Report").selectOption("fuel");
    await expect(page).toHaveURL(/report=fuel/);
    await expect(page.getByRole("cell", { name: "KCA 123A" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /8,000\.00/ }).first()).toBeVisible();

    const csv = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV" }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toMatch(/^fleetpulse-fuel-.*\.csv$/);
    expect(readFileSync(await csvFile.path(), "utf8")).toContain("KCA 123A");

    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF" }).click();
    const pdfFile = await pdf;
    expect(pdfFile.suggestedFilename()).toMatch(/\.pdf$/);
    expect(readFileSync(await pdfFile.path()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
