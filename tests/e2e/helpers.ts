import { expect, type Page } from "@playwright/test";

export const ADMIN_EMAIL = "admin@pvcon.in";
export const SEED_PASSWORD = "ChangeMe@2026";
export const ADMIN_PASSWORD = "Adm1n-Strong-Pass";

/**
 * Sign-ins are limited to 20 per 15 minutes per client IP, and a password change signs in again. Each spec file
 * passes its own address to `test.use(clientIp(n))` so the limiter counts per spec rather than for the whole suite.
 */
export function clientIp(n: number) {
  return { extraHTTPHeaders: { "x-forwarded-for": `10.0.0.${n}` } };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Update password" }).click();
}

/** Signs in as the seeded admin, replacing the seed password first when no earlier spec has done so. */
export async function signInAsAdmin(page: Page) {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const home = page.waitForURL((url) => url.pathname === "/").then(() => "home" as const, () => "timeout" as const);
  const wrong = page
    .getByText("Incorrect email or password.")
    .waitFor()
    .then(() => "wrong" as const, () => "timeout" as const);
  const limited = page
    .getByText("Too many sign-in attempts")
    .waitFor()
    .then(() => "limited" as const, () => "timeout" as const);
  const outcome = await Promise.race([home, wrong, limited]);
  if (outcome === "limited") throw new Error("Sign-in rate limit hit: give this spec its own clientIp() (see below).");
  if (outcome === "wrong") {
    await signIn(page, ADMIN_EMAIL, SEED_PASSWORD);
    await changePassword(page, SEED_PASSWORD, ADMIN_PASSWORD);
  }
  await expect(page).toHaveURL(/\/$/);
}

/** Creates an employee who joined on 1 Jan 2025, with a login; returns the temporary password. */
export async function addEmployee(
  page: Page,
  person: { first: string; last: string; email: string },
  managerName?: string,
): Promise<string> {
  await page.goto("/org/employees/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First name").fill(person.first);
  await page.getByLabel("Last name").fill(person.last);
  await page.getByLabel("Work email").fill(person.email);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Date of joining").fill("2025-01-01");
  if (managerName) {
    const select = page.getByLabel("Reporting manager");
    const value = await select.locator("option", { hasText: managerName }).getAttribute("value");
    await select.selectOption(value!);
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Login", { exact: true }).selectOption("create");
  await page.getByRole("button", { name: "Create employee" }).click();
  const dialog = page.getByRole("dialog", { name: "Temporary password" });
  await expect(dialog).toBeVisible();
  const password = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/org\/employees\/\d+$/);
  return password;
}
