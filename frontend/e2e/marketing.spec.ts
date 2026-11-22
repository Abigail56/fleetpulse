import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// A valid map with no background, so tests don't need the map server.
const MAP_STYLE = { version: 8, sources: {}, layers: [] };
const MAP_SELECTOR = ".maplibregl-map, .leaflet-container";
const MAP_POPUP_SELECTOR = ".maplibregl-popup-content, .leaflet-popup-content";
const MAP_ATTRIBUTION_SELECTOR = ".maplibregl-ctrl-attrib, .leaflet-control-attribution";

const PAGES = [
  { path: "/", heading: "Every Vehicle. Every Journey. Under Control." },
  { path: "/features", heading: "Everything a fleet operation runs on" },
  { path: "/solutions", heading: "Built for fleets of many kinds" },
  { path: "/pricing", heading: "Simple pricing per vehicle" },
  { path: "/about", heading: "Driving Smarter Operations. Powering Business Growth." },
  { path: "/contact", heading: "Talk to us" },
  { path: "/terms", heading: "Terms and Conditions" },
  { path: "/privacy", heading: "Privacy Policy" },
];

async function themeButton(page: Page, label: "Light" | "Dark" | "System") {
  return page
    .getByRole("group", { name: "Appearance" })
    .first()
    .getByRole("button", { name: `${label} theme` });
}

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
      expect(
        results.violations.map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map((node) => node.target),
        })),
      ).toEqual([]);
    });

    test("has no detectable accessibility violations in dark mode", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map((node) => node.target),
        })),
      ).toEqual([]);
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

test("the development notice is absent from every marketing page", async ({ page }) => {
  for (const { path } of PAGES) {
    await page.goto(path);
    await expect(page.getByLabel("Development notice")).toHaveCount(0);
  }
});

test.describe("appearance preference", () => {
  test("supports light, dark and system themes and remembers the selection", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await (await themeButton(page, "Dark")).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("fleetpulse-theme"))).toBe("dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await (await themeButton(page, "System")).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("fleetpulse-theme"))).toBe("system");
  });

  test("keeps the selected vehicle visible while the map changes theme", async ({ page }) => {
    await page.route("**/tiles.openfreemap.org/**", (route) =>
      route.fulfill({ status: 200, json: MAP_STYLE }),
    );
    await page.goto("/");
    const selectedVehicle = page
      .getByRole("list", { name: "Vehicles" })
      .getByRole("button", { name: /FP-3306/ });
    await selectedVehicle.click();
    await (await themeButton(page, "Dark")).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(selectedVehicle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".fleet-marker")).toHaveCount(5);
    await expect(page.locator(MAP_SELECTOR)).toBeVisible();
  });

  test("keeps the theme control visible in the mobile navigation header", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const appearance = page.getByRole("group", { name: "Appearance" });
    await expect(appearance).toBeVisible();
    const darkButton = appearance.getByRole("button", { name: "Dark theme" });
    const bounds = await darkButton.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await darkButton.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("keeps the theme controls reachable without horizontal overflow on narrow phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto("/");
    const appearance = page.getByRole("group", { name: "Appearance" });
    await expect(appearance).toBeVisible();
    const bounds = await appearance.getByRole("button", { name: "Dark theme" }).boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await appearance.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test("the About page connects its calls to action and security information", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("link", { name: /Explore FleetPulse/ })).toHaveAttribute(
    "href",
    "/features",
  );
  await expect(page.getByRole("link", { name: "Get in Touch" }).first()).toHaveAttribute(
    "href",
    "/contact",
  );
  await expect(
    page.getByRole("heading", { name: "Connecting People, Assets, and Operations" }),
  ).toBeVisible();
  await expect(page.locator("#security")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Trust & Legal" }).getByRole("link", {
      name: "Security & Trust",
    }),
  ).toHaveAttribute("href", "/about#security");
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
    await expect(page.locator(MAP_ATTRIBUTION_SELECTOR)).toContainText("OpenStreetMap", {
      useInnerText: false,
    });
  });

  test("is clearly labelled as simulated, and shows a real map", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Fleet preview · Simulated locations")).toBeVisible();
    await expect(page.locator(MAP_SELECTOR)).toBeVisible();
    await expect(page.locator(".fleet-marker")).toHaveCount(5);
    await expect(page.getByText("5 vehicles · 2 moving")).toBeVisible();
  });

  test("choosing a vehicle in the list selects it on the map, with its details", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /FP-3306/ });
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".fleet-marker--selected")).toContainText("FP-3306");
    const popup = page.locator(MAP_POPUP_SELECTOR);
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
    await expect(page.locator(MAP_POPUP_SELECTOR)).toContainText("Idle");
  });

  test("moving vehicles move smoothly, and stopped ones stay put", async ({ page }) => {
    await page.goto("/");
    const place = (id: string) =>
      page
        .locator(`.leaflet-marker-icon[title^="${id}"], .fleet-marker[aria-label^="${id}"]`)
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
    const marker = page.locator(
      '.leaflet-marker-icon[title^="FP-1042"], .fleet-marker[aria-label^="FP-1042"]',
    );
    await expect(marker).toBeVisible();
    const before = await marker.evaluate((element) => (element as HTMLElement).style.transform);
    await page.waitForTimeout(1200);
    expect(await marker.evaluate((element) => (element as HTMLElement).style.transform)).toBe(before);
  });

  test("shows an interactive map when WebGL2 is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
          if (contextId === "webgl2") return null;
          return Reflect.apply(getContext, this, [contextId, ...args]);
        },
      });
    });
    await page.goto("/");
    const map = page.getByRole("region", { name: "Interactive map of demonstration vehicles" });
    await expect(map).toBeVisible();
    await expect(map.locator(".leaflet-control-zoom")).toBeVisible();
    await expect(map.locator(".leaflet-marker-icon")).toHaveCount(5);
    await map.locator('.leaflet-marker-icon[title^="FP-2178"]').click();
    await expect(
      page.getByRole("list", { name: "Vehicles" }).getByRole("button", { name: /FP-2178/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".leaflet-popup-content")).toContainText("Oshodi depot, Lagos");
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
