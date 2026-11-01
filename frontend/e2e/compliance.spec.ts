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
    permissions: ["compliance.view", "compliance.manage", "inspections.submit", "maintenance.manage"],
  },
  "/organisations": [],
  "/compliance/summary": {
    expired_documents: 1,
    expiring_documents: 1,
    open_defects: 1,
    critical_defects: 1,
    failed_inspections_30_days: 1,
  },
  "/compliance/options": {
    vehicles: [{ id: "v1", registration_number: "KCA 123A", make: "Isuzu", model: "NPR" }],
    drivers: [{ id: "d1", name: "Tunde Adeyemi" }],
  },
  "/compliance/documents": [
    {
      id: "c1",
      vehicle_id: "v1",
      vehicle_registration: "KCA 123A",
      driver_id: null,
      driver_name: null,
      document_type: "insurance",
      title: "Motor insurance",
      reference_number: "POL-1",
      issued_on: null,
      expires_on: "2020-01-05",
      state: "expired",
      file: null,
      notes: null,
      archived_at: null,
    },
  ],
  "/compliance/my-documents": [],
  "/compliance/defects": {
    items: [
      {
        id: "f1",
        vehicle_id: "v1",
        vehicle_registration: "KCA 123A",
        inspection_id: "i1",
        title: "Brakes",
        description: "Soft pedal",
        severity: "critical",
        status: "open",
        photo: null,
        work_order_id: null,
        resolved_at: null,
        resolution_note: null,
        created_at: "2030-01-01T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  },
  "/compliance/inspections": { items: [], total: 0, page: 1, page_size: 25 },
  "/compliance/templates": [
    { id: "t1", name: "Pre-trip", items: [{ id: "x", label: "Brakes", critical: true }], archived_at: null },
  ],
};

for (const path of [
  "/compliance",
  "/compliance/documents/new",
  "/compliance/templates/new",
  "/compliance/inspections/new",
  "/compliance/defects/new",
]) {
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

  test("a failed inspection stops dispatch until a work order fixes it", async ({ page, request }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    await newUser(page, request, `e2e-comp-${tag}@example.com`, "Ada Obi");
    await createOrganisation(page, "Compliance Test Org");
    await page.goto("/vehicles/new");
    await page.getByLabel("Registration number").fill("KCA 123A");
    await page.getByLabel("Make").fill("Isuzu");
    await page.getByLabel("Model").fill("NPR");
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

    await page.goto("/drivers/new");
    await page.getByLabel("First name").fill("Tunde");
    await page.getByLabel("Last name").fill("Adeyemi");
    await page.getByLabel("Licence number").fill("DL-12345");
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByRole("heading", { name: "Tunde Adeyemi" })).toBeVisible();

    await page.goto("/trips/new");
    await page.getByLabel(/^Origin/).fill("Nairobi");
    await page.getByLabel(/^Destination/).fill("Mombasa");
    await page.getByLabel(/^Vehicle/).selectOption({ label: "KCA 123A · Isuzu NPR" });
    await page.getByLabel(/^Driver/).selectOption({ label: "Tunde Adeyemi" });
    await page.getByLabel(/^Planned departure/).fill("2030-01-01T08:00");
    await page.getByRole("button", { name: "Create trip" }).click();
    await expect(page.getByRole("heading", { name: "Nairobi → Mombasa" })).toBeVisible();
    const tripPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Mark as planned" }).click();
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toBeVisible();

    await page.goto("/compliance/templates/new");
    await page.getByLabel(/^Name/).fill("Pre-trip");
    await page.getByLabel(/^Check 1/).fill("Brakes");
    await page.getByLabel("Critical").check();
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page).toHaveURL(/\/compliance$/);

    await page.getByRole("link", { name: "New inspection" }).click();
    await page.getByLabel("Vehicle").selectOption({ label: "KCA 123A · Isuzu NPR" });
    await page.getByLabel("Template").selectOption({ label: "Pre-trip" });
    await page.getByRole("radio", { name: "Fail" }).check();
    await page.getByLabel(/What.s wrong/).fill("Soft pedal");
    await page.getByRole("button", { name: "Save inspection" }).click();
    await expect(page.getByRole("heading", { name: /KCA 123A · Pre-trip/ })).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();

    // The trip now can't go.
    await page.goto(tripPath);
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Dispatch" }).click();
    await expect(page.getByText(/critical defect to fix first/)).toBeVisible();

    await page.goto("/compliance");
    await page.getByRole("button", { name: "Create work order" }).click();
    await expect(page.getByRole("heading", { name: "Fix: Brakes" })).toBeVisible();
    await page.getByRole("button", { name: "Start work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start work" }).click();
    await page.getByRole("button", { name: "Complete work", exact: true }).click();
    await page.getByRole("button", { name: "Complete work order" }).click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete work order" })).toHaveCount(0);

    await page.goto("/compliance");
    await expect(page.getByText("No open defects.")).toBeVisible();

    await page.goto(tripPath);
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Dispatch" }).click();
    await expect(page.getByRole("button", { name: "Start trip" })).toBeVisible();

    // A document with a real file, reached through a signed link.
    await page.goto("/compliance/documents/new");
    await page.getByLabel(/^Belongs to/).selectOption({ label: "KCA 123A" });
    await page.getByLabel(/^Title/).fill("Motor insurance");
    await page.getByLabel(/^Expires on/).fill("2020-01-05");
    await page.getByLabel(/^File/).setInputFiles({
      name: "policy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 policy"),
    });
    await expect(page.getByText("policy.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Add document" }).click();
    await expect(page).toHaveURL(/\/compliance$/);
    await expect(
      page.getByRole("list", { name: "Documents" }).getByText("Expired", { exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download policy.pdf" }).click();
    expect((await download).suggestedFilename()).toBe("policy.pdf");
  });
});
