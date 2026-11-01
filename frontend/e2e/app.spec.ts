import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { createOrganisation, emailLink, newUser, secondUser } from "./helpers";

const CORS = {
  "access-control-allow-origin": "http://localhost:3211",
  "access-control-allow-credentials": "true",
};
const ORG = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Swift Logistics",
  slug: "swift",
  country_code: "KE",
  default_currency: "KES",
  timezone: "UTC",
  distance_unit: "km",
};
const PERMISSIONS = [
  "vehicles.view",
  "vehicles.manage",
  "organisation.view",
  "organisation.manage",
  "members.view",
  "members.manage",
];
const SUMMARY = {
  vehicles: { total: 12, active: 7, idle: 3, maintenance: 1, out_of_service: 1, utilisation_percent: 58 },
  drivers: { total: 9, available: 5, on_trip: 3, off_duty: 1, unavailable: 0, licences_expiring_soon: 2, licences_expired: 1 },
  trips: { in_progress: 3, scheduled: 4 },
};

async function stubApi(page: Page) {
  const routes: Record<string, unknown> = {
    "/auth/me": { user: { id: "1", email: "ada@example.com", full_name: "Ada Obi" }, csrf_token: "c" },
    "/organisation": { organisation: ORG, role: "owner", permissions: PERMISSIONS },
    "/organisations": [{ organisation: ORG, role: "owner", is_active: true }],
    "/dashboard": SUMMARY,
    "/organisation/members": [
      { id: "m1", user_id: "1", email: "ada@example.com", full_name: "Ada Obi", role: "owner", status: "active" },
      { id: "m2", user_id: "2", email: "tunde.adeyemi.long.address@example.com", full_name: "Tunde Adeyemi", role: "dispatcher", status: "active" },
    ],
    "/organisation/invitations": [],
    "/vehicles": { items: [], total: 0, page: 1, page_size: 25 },
    "/auth/sessions": [],
  };
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const body = routes[path];
    if (body === undefined) return route.fulfill({ status: 404, json: {}, headers: CORS });
    return route.fulfill({ status: 200, json: body, headers: CORS });
  });
}

for (const path of ["/dashboard", "/vehicles", "/vehicles/new", "/organisation/members", "/organisation/settings", "/account", "/onboarding"]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${path} is accessible and fits the screen (${scheme})`, async ({ page }) => {
      await stubApi(page);
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

test("the dashboard shows the figures it's given", async ({ page }) => {
  await stubApi(page);
  await page.goto("/dashboard");
  await expect(page.getByText("58%")).toBeVisible();
  await expect(page.getByText("Vehicles by status")).toBeVisible();
  await expect(page.getByText(/1 driver licence has expired/)).toBeVisible();
});

test("navigation has no links to unbuilt pages", async ({ page, isMobile }) => {
  await stubApi(page);
  await page.goto("/dashboard");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  await expect(links).toHaveText(["Dashboard", "Live map", "Vehicles", "Tracking", "Members", "Organisation", "Account security"]);
});

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  test.setTimeout(180000);

  test("create an organisation, invite, change roles, switch and remove", async ({
    page,
    browser,
    request,
    baseURL,
    isMobile,
  }) => {
    const tag = `${Date.now()}-${test.info().project.name}`;
    const ownerEmail = `e2e-owner-${tag}@example.com`;
    const staffEmail = `e2e-staff-${tag}@example.com`;
    const openMenu = async (target: Page) => {
      if (isMobile) await target.getByRole("button", { name: "Open menu" }).click();
    };

    await newUser(page, request, ownerEmail, "Ada Obi");
    await expect(page.getByRole("heading", { name: "Set up your organisation" })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding$/);

    await createOrganisation(page, "Swift Logistics");
    await expect(page.getByText("Nothing to report yet")).toBeVisible();

    await page.goto("/organisation/members");
    await page.getByLabel("Email").fill(staffEmail);
    await page.getByLabel("Role", { exact: true }).selectOption("read_only");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${staffEmail}.`)).toBeVisible();
    await expect(page.getByText(staffEmail, { exact: true })).toBeVisible();

    const staff = await secondUser(browser, baseURL);
    await newUser(staff.page, request, staffEmail, "Tunde Adeyemi");
    await staff.page.goto(await emailLink(request, staffEmail, "invited"));
    await staff.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(staff.page).toHaveURL(/\/dashboard$/);
    await expect(staff.page.getByRole("main").getByText("Swift Logistics")).toBeVisible();

    // A read-only member has no Members link, and the page itself refuses them.
    await openMenu(staff.page);
    await expect(staff.page.getByRole("link", { name: "Members" })).toHaveCount(0);
    await staff.page.goto("/organisation/members");
    await expect(staff.page.getByText(/doesn't include this page/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Role for Tunde Adeyemi")).toHaveValue("read_only");
    await page.getByLabel("Role for Tunde Adeyemi").selectOption("fleet_manager");
    await expect(page.getByText("Member updated.")).toBeVisible();

    await staff.page.goto("/organisation/members");
    await expect(staff.page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    await expect(staff.page.getByRole("button", { name: /Remove/ })).toHaveCount(0);

    // Two organisations: the switcher appears, and another tab follows the change.
    await page.goto("/onboarding");
    await createOrganisation(page, "Metro Buses");
    await openMenu(page);
    const secondTab = await page.context().newPage();
    await secondTab.goto("/organisation/settings");
    await expect(secondTab.getByLabel("Organisation name")).toHaveValue("Metro Buses");
    const switcher = page.getByLabel("Organisation", { exact: true });
    await switcher.selectOption({ label: "Swift Logistics" });
    await expect(page.getByRole("main").getByText("Swift Logistics")).toBeVisible();
    await expect(secondTab.getByLabel("Organisation name")).toHaveValue("Swift Logistics");
    await secondTab.close();

    // Removal takes effect on the member's next request.
    await page.goto("/organisation/members");
    await page.getByRole("button", { name: "Remove Tunde Adeyemi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Member removed.")).toBeVisible();
    await staff.page.goto("/dashboard");
    await expect(staff.page).toHaveURL(/\/onboarding$/);
    await staff.context.close();

    // The last owner can't leave, and the API's reason is shown.
    await page.goto("/organisation/settings");
    await page.getByRole("button", { name: "Leave organisation" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave organisation" }).click();
    await expect(page.getByText("An organisation must keep at least one owner.")).toBeVisible();
  });
});
