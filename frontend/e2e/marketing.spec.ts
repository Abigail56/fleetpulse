import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A valid map with no background, so tests don't need the map server.
const MAP_STYLE = { version: 8, sources: {}, layers: [] };

const PAGES = [
  { path: "/", heading: "Every Vehicle. Every Journey. Under Control." },
  { path: "/features", heading: "Everything a fleet operation runs on" },
  { path: "/solutions", heading: "Built for fleets of many kinds" },
  { path: "/pricing", heading: "Simple pricing per vehicle" },
  { path: "/about", heading: "Why we're building FleetPulse" },
  { path: "/contact", heading: "Talk to us" },
  { path: "/terms", heading: "Terms and Conditions" },
  { path: "/privacy", heading: "Privacy Policy" },
];

for (const { path, heading } of PAGES) {
  test.describe(`page ${path}`, () => {
    // Tests shouldn't depend on an outside map server being reachable.
    test.beforeEach(async ({ page }) => {
      await page.route("**/tiles.openfreemap.org/**", (route) =>
        route.fulfill({ status: 200, json: MAP_STYLE }),
      );
    });

    test("loads with one main heading and no console errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page).toHaveTitle(/FleetPulse/);
      expect(errors).toEqual([]);
    });

    test("does not scroll sideways", async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("has no detectable accessibility violations", async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((item) => item.id)).toEqual([]);
    });

    test("has no detectable accessibility violations in dark mode", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((item) => item.id)).toEqual([]);
    });

    test("every internal link leads somewhere", async ({ page, request }) => {
      await page.goto(path);
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
      for (const href of new Set(hrefs)) {
        const response = await request.get(href);
        expect(response.status(), href).toBe(200);
      }
    });
  });
}

test("the development notice appears on every marketing page", async ({ page }) => {
  for (const { path } of PAGES) {
    await page.goto(path);
    await expect(page.getByText("FleetPulse is in development.")).toBeVisible();
  }
});

test.describe("live fleet demonstration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/tiles.openfreemap.org/**", (route) =>
      route.fulfill({ status: 200, json: MAP_STYLE }),
    );
  });

  test("credits OpenStreetMap, using the real map style", async ({ page }) => {
    // Runs against the real server when it's reachable, because the credit comes from its style.
    await page.unroute("**/tiles.openfreemap.org/**");
    await page.goto("/");
    await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap", {
      useInnerText: false,
    });
  });

  test("is clearly labelled as simulated, and shows a real map", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("DEMO · SIMULATED VEHICLE DATA")).toBeVisible();
    await expect(page.locator(".maplibregl-map")).toBeVisible();
    await expect(page.locator(".fleet-marker")).toHaveCount(5);
    await expect(page.getByText("5 vehicles · 2 moving")).toBeVisible();
  });

  test("choosing a vehicle in the list selects it on the map, with its details", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /FP-3306/ });
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".fleet-marker--selected")).toContainText("FP-3306");
    const popup = page.locator(".maplibregl-popup-content");
    await expect(popup).toContainText("Stale GPS");
    await expect(popup).toContainText("Destination: Ojota");
    await expect(popup).toContainText("Speed: Not reported");
  });

  test("choosing a vehicle on the map updates the list", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fleet-marker", { hasText: "FP-2178" }).click();
    await expect(
      page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /FP-2178/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".maplibregl-popup-content")).toContainText("Idle");
  });

  test("moving vehicles move smoothly, and stopped ones stay put", async ({ page }) => {
    await page.goto("/");
    const place = (id: string) =>
      page
        .locator(".fleet-marker", { hasText: id })
        .evaluate((element) => (element as HTMLElement).style.transform);
    await expect(page.locator(".fleet-marker")).toHaveCount(5);
    const movingBefore = await place("FP-1042");
    const stoppedBefore = await place("FP-3306");
    await page.waitForTimeout(3000);
    expect(await place("FP-1042")).not.toBe(movingBefore);
    expect(await place("FP-3306")).toBe(stoppedBefore);
  });

  test("respects a preference for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const marker = page.locator(".fleet-marker", { hasText: "FP-1042" });
    await expect(marker).toBeVisible();
    const before = await marker.evaluate((element) => (element as HTMLElement).style.transform);
    await page.waitForTimeout(1200);
    expect(await marker.evaluate((element) => (element as HTMLElement).style.transform)).toBe(before);
  });

  test("falls back to a simple view when the map server can't be reached", async ({ page }) => {
    await page.route("**/tiles.openfreemap.org/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText(/interactive map couldn't load/)).toBeVisible();
    await expect(page.getByRole("img", { name: /demonstration vehicle routes/ })).toBeVisible();
    await page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /FP-2178/ }).click();
    await expect(page.getByText("Oshodi depot, Lagos")).toBeVisible();
  });

  test("reserves its space, so the page doesn't shift when the map loads", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { shift: number }).shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) (window as unknown as { shift: number }).shift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(".fleet-marker")).toHaveCount(5);
    const shift = await page.evaluate(() => (window as unknown as { shift: number }).shift);
    expect(shift).toBeLessThan(0.1);
  });
});

test("the skip link moves keyboard users to the content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("the mobile menu navigates between pages", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Mobile" })
    .getByRole("link", { name: "Pricing" })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("navigation", { name: "Mobile" })).toHaveCount(0);
});

test("the design system page is not available in production builds", async ({ request }) => {
  expect((await request.get("/design-system")).status()).toBe(404);
});

test("the contact form works, using a stubbed API", async ({ page }) => {
  await page.route("**/api/v1/contact", (route) =>
    route.fulfill({ status: 202, json: { message: "ok" }, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.goto("/contact");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await page.getByLabel("Your name").fill("Ada Obi");
  await page.getByLabel("Work email").fill("ada@example.com");
  await page.getByLabel("How can we help?").fill("We run thirty vans and want to know more.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Your message has been sent/)).toBeVisible();
});

test("contact form reaches a real inbox", async ({ page, request }) => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  const marker = `e2e-${Date.now()}-${test.info().project.name}`;
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("Live Test");
  await page.getByLabel("Work email").fill("live@example.com");
  await page.getByLabel("How can we help?").fill(`Live test message ${marker}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Your message has been sent/)).toBeVisible();
  await expect
    .poll(async () => {
      const inbox = await request.get(`http://localhost:8027/api/v1/search?query=${marker}`);
      return (await inbox.json()).messages_count;
    })
    .toBe(1);
});
