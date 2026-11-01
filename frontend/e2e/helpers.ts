import { type APIRequestContext, type Browser, expect, type Page } from "@playwright/test";

const MAIL = "http://localhost:8027/api/v1";
export const PASSWORD = "journey-long-passphrase-1";

export async function emailLink(request: APIRequestContext, to: string, subject: string) {
  let path = "";
  await expect
    .poll(
      async () => {
        const inbox = await (
          await request.get(`${MAIL}/search?query=${encodeURIComponent(`to:${to}`)}`)
        ).json();
        const message = inbox.messages.find((item: { Subject: string }) =>
          item.Subject.includes(subject),
        );
        if (!message) return false;
        const full = await (await request.get(`${MAIL}/message/${message.ID}`)).json();
        path = /http:\/\/localhost:3210(\/\S*token=[\w-]+)/.exec(full.Text)?.[1] ?? "";
        return Boolean(path);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return path;
}

export async function newUser(page: Page, request: APIRequestContext, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await emailLink(request, email, "Verify"));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

export async function createOrganisation(page: Page, name: string) {
  await page.getByLabel("Organisation name").fill(name);
  await page.getByLabel("Country code").fill("ke");
  await page.getByLabel("Default currency").fill("kes");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function secondUser(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  return { context, page: await context.newPage() };
}
