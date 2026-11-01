import { expect, test } from "@playwright/test";

const API = process.env.E2E_PRODUCTION_API_URL ?? "https://api.fleetpulse.localhost:8443";
const MAIL = process.env.E2E_PRODUCTION_MAIL_URL ?? "http://localhost:8127/api/v1";
const PASSWORD = "journey-long-passphrase-1";

test("the site is served over HTTPS with its security headers", async ({ request, baseURL }) => {
  const page = await request.get("/login");
  expect(page.status()).toBe(200);
  const headers = page.headers();
  expect(baseURL).toMatch(/^https:/);
  expect(headers["content-security-policy"]).toContain("'nonce-");
  expect(headers["x-frame-options"]).toBe("DENY");
  const api = await request.get(`${API}/api/v1/health/ready`);
  expect(api.status()).toBe(200);
  expect(api.headers()["strict-transport-security"]).toContain("max-age");
});

test("a request from another site is refused", async ({ request }) => {
  const response = await request.post(`${API}/api/v1/auth/login`, {
    headers: { Origin: "https://evil.example.com" },
    data: { email: "a@example.com", password: "x" },
  });
  expect(response.status()).toBe(403);
});

test("forging a forwarded address doesn't get around the login limit", async ({ request, baseURL }) => {
  const email = `limit-${Date.now()}@example.com`;
  let last = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request.post(`${API}/api/v1/auth/login`, {
      headers: { Origin: new URL(baseURL!).origin, "X-Forwarded-For": `203.0.113.${attempt}` },
      data: { email, password: "wrong-password-here" },
    });
    last = response.status();
  }
  expect(last).toBe(429);
});

test("someone can sign up, sign in, upload a file and watch the live map", async ({
  page,
  request,
  context,
}) => {
  const email = `stack-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Ada Obi");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  // Sent by the real worker, through the real queue.
  let link = "";
  await expect
    .poll(
      async () => {
        const inbox = await (await request.get(`${MAIL}/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
        const message = inbox.messages[0];
        if (!message) return false;
        const full = await (await request.get(`${MAIL}/message/${message.ID}`)).json();
        link = /https:\/\/\S*token=[\w-]+/.exec(full.Text)?.[0] ?? "";
        return Boolean(link);
      },
      { timeout: 60000, intervals: [2000] },
    )
    .toBe(true);
  await page.goto(link);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const cookies = await context.cookies(API);
  const session = cookies.find((item) => item.name === "fleetpulse_access");
  expect(session?.secure).toBe(true);
  expect(session?.httpOnly).toBe(true);

  await page.getByLabel("Organisation name").fill("Stack Test Org");
  await page.getByLabel("Country code").fill("ke");
  await page.getByLabel("Default currency").fill("kes");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/vehicles/new");
  await page.getByLabel("Registration number").fill("KCA 123A");
  await page.getByLabel("Make").fill("Isuzu");
  await page.getByLabel("Model").fill("NPR");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await expect(page.getByRole("heading", { name: "KCA 123A" })).toBeVisible();

  // Upload, then fetch through a signed link from storage.
  await page.goto("/costs/expenses/new");
  await page.getByLabel(/^Vehicle/).selectOption({ index: 1 });
  await page.getByLabel(/^Amount/).fill("500");
  await page.getByLabel(/^Receipt/).setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 a real receipt"),
  });
  await expect(page.getByText("receipt.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Submit expense" }).click();
  await expect(page).toHaveURL(/\/costs$/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download receipt.pdf" }).click();
  expect((await download).suggestedFilename()).toBe("receipt.pdf");

  // The WebSocket, through the proxy, over TLS.
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await page.goto("/map");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
