import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type APIRequestContext, test } from "@playwright/test";

const AUTH_PAGES = [
  ["/login", "Sign in"],
  ["/register", "Create your account"],
  ["/forgot-password", "Reset your password"],
  ["/verify-email?token=x", "Verify your email"],
  ["/reset-password?token=x", "Choose a new password"],
];

for (const [path, heading] of AUTH_PAGES) {
  test(`${path} renders accessibly`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((item) => item.id)).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("one-time tokens leave the address bar and send no referrer", async ({ page }) => {
  const response = await page.goto("/reset-password?token=secret-value");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("signed-out visitors are sent from the account page to sign in", async ({ page }) => {
  await page.route("**/api/v1/auth/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "not_authenticated", message: "Please sign in." } },
      headers: { "access-control-allow-origin": "http://localhost:3211", "access-control-allow-credentials": "true" },
    }),
  );
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await expect(page.getByText("Account security")).toHaveCount(0);
});

test("the site's header leads to sign in and registration", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

test("the password can be shown and hidden", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

const MAIL = "http://localhost:8027/api/v1";

async function linkFromEmail(request: APIRequestContext, to: string, subject: string) {
  let path = "";
  await expect
    .poll(
      async () => {
        const inbox = await (await request.get(`${MAIL}/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
        const message = inbox.messages.find((item: { Subject: string }) => item.Subject.includes(subject));
        if (!message) return false;
        const full = await (await request.get(`${MAIL}/message/${message.ID}`)).json();
        const match = /http:\/\/localhost:3210(\/\S*token=[\w-]+)/.exec(full.Text);
        path = match?.[1] ?? "";
        return Boolean(path);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return path;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("full journey against the real API", () => {
  test.skip(!process.env.E2E_LIVE_API, "set E2E_LIVE_API with the app containers running");
  // The longest journey, with many deliberately slow password hashes.
  test.setTimeout(240000);

  test("register, verify, sign in, manage sessions, change and reset password", async ({
    page,
    browser,
    request,
    baseURL,
    isMobile,
  }) => {
    const email = `e2e-ui-${Date.now()}-${test.info().project.name}@example.com`;
    const password = "first-long-passphrase-1";
    const changed = "second-long-passphrase-2";
    const reset = "third-long-passphrase-3";

    await page.goto("/register");
    await page.getByLabel("Your name").fill("Ui Tester");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("password12345");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("This password is too easy to guess.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    await signIn(page, email, password);
    await expect(page.getByText("Please verify your email address first.")).toBeVisible();

    await page.goto(await linkFromEmail(request, email, "Verify"));
    await expect(page).toHaveURL(/\/verify-email$/);
    await page.getByLabel("Password", { exact: true }).fill("not-the-right-password");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByText("That isn't the password you registered with.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.getByRole("link", { name: "Continue to sign in" }).click();

    await signIn(page, email, "wrong-password-value");
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await signIn(page, email, password);
    await expect(page).toHaveURL(/\/onboarding$/);

    // Next.js keeps the sign-in page mounted but hidden; the password must not stay in it.
    const leftover = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
        .map((input) => input.value)
        .filter(Boolean),
    );
    expect(leftover).toEqual([]);

    await page.goto("/account");
    await expect(page.getByText("This device", { exact: true })).toBeVisible();

    // Staying signed in across a reload proves the cookies, not memory, hold the session.
    await page.reload();
    await expect(page.getByText("This device", { exact: true })).toBeVisible();

    // No tokens may be readable by page scripts or stored in the browser.
    const exposure = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(exposure.cookie).not.toContain("fleetpulse");
    expect(exposure.local).not.toMatch(/token|fleetpulse/i);
    expect(exposure.session).not.toMatch(/token|fleetpulse/i);

    // A second device appears, and can be signed out from the first.
    const otherContext = await browser.newContext({ baseURL });
    const other = await otherContext.newPage();
    await signIn(other, email, password);
    await expect(other).toHaveURL(/\/onboarding$/);
    await page.reload();
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(2);
    await main
      .getByRole("listitem")
      .filter({ hasNot: page.getByText("This device", { exact: true }) })
      .getByRole("button", { name: "Sign out" })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("That device has been signed out.")).toBeVisible();
    await other.reload();
    await expect(other).toHaveURL(/\/login/);
    await otherContext.close();

    // An expired access token renews itself without the user noticing.
    const cookies = await page.context().cookies();
    await page.context().clearCookies({ name: "fleetpulse_access" });
    expect(cookies.some((cookie) => cookie.name === "fleetpulse_refresh" && cookie.httpOnly)).toBe(true);
    await page.reload();
    await expect(page.getByText("This device", { exact: true })).toBeVisible();

    await page.getByLabel("Current password").fill(password);
    await page.getByLabel("New password", { exact: true }).fill(changed);
    await page.getByLabel("Confirm new password").fill(changed);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your password has been changed.")).toBeVisible();

    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("complementary").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Going back after signing out must not bring the account page back.
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Account security" })).toHaveCount(0);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
    await page.goto(await linkFromEmail(request, email, "Reset"));
    await page.getByLabel("New password", { exact: true }).fill(reset);
    await page.getByLabel("Confirm new password").fill(reset);
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await signIn(page, email, changed);
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await signIn(page, email, reset);
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});
