import { expect, type Page } from "@playwright/test";

export const ADMIN_EMAIL = "admin@pvcon.in";
export const SEED_PASSWORD = "ChangeMe@2026";
export const ADMIN_PASSWORD = "Adm1n-Strong-Pass";

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
  if ((await Promise.race([home, wrong])) === "wrong") {
    await signIn(page, ADMIN_EMAIL, SEED_PASSWORD);
    await changePassword(page, SEED_PASSWORD, ADMIN_PASSWORD);
  }
  await expect(page).toHaveURL(/\/$/);
}
