import { expect, test } from "@playwright/test";

const MAP_STYLE = { version: 8, sources: {}, layers: [] };

test("a page's own scripts run under the policy, with no violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));
  await page.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({ status: 200, json: MAP_STYLE }),
  );
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src");
  expect(policy).toContain("'nonce-");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  // React has hydrated, so the bundled scripts were allowed, and the map's worker started.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.getByRole("list", { name: "Vehicles" }).getByRole("button").nth(1).click();
  expect(violations).toEqual([]);
});

test("each response has its own nonce", async ({ request }) => {
  const nonce = async () =>
    /'nonce-([^']+)'/.exec((await request.get("/login")).headers()["content-security-policy"])?.[1];
  const [first, second] = [await nonce(), await nonce()];
  expect(first).toBeTruthy();
  expect(first).not.toBe(second);
});

test("script injected into a page's HTML is refused", async ({ page }) => {
  // What cross-site scripting looks like: markup in the page that the server didn't mean to send.
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "</head>",
        "<script>window.__injected = true</script></head>",
      ),
    });
  });
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) blocked.push(message.text());
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  const ran = await page.evaluate(
    () => (window as unknown as { __injected?: boolean }).__injected === true,
  );
  expect(ran).toBe(false);
  expect(blocked.length).toBeGreaterThan(0);
});

test("an inline event handler in injected markup is refused", async ({ page }) => {
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "</body>",
        `<img src="/missing-image" onerror="window.__handler = true"></body>`,
      ),
    });
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  const ran = await page.evaluate(
    () => (window as unknown as { __handler?: boolean }).__handler === true,
  );
  expect(ran).toBe(false);
});

test("pages can't be framed by other sites", async ({ request }) => {
  const headers = (await request.get("/login")).headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});
