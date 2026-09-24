import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@pvcon.in";
const SEED_PASSWORD = "ChangeMe@2026";
const ADMIN_PASSWORD = "Adm1n-Strong-Pass";
const EMPLOYEE_EMAIL = "test.employee@pvcon.in";
const EMPLOYEE_PASSWORD = "Empl0yee-Strong-Pass";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Update password" }).click();
}

test.describe.serial("authentication and user management", () => {
  let tempPassword = "";

  test("anonymous visitors are sent to login with a return path", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fusers$/);
  });

  test("a wrong password shows a generic error", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, "Wrong-password-1");
    // Not getByRole("alert"): Next.js renders its route announcer with role="alert" too.
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("first sign-in forces a password change, then shows the dashboard", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, SEED_PASSWORD);
    await changePassword(page, SEED_PASSWORD, ADMIN_PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good (morning|afternoon|evening), System/);
  });

  test("an admin creates a user and receives a temporary password", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/$/); // let the sign-in finish before navigating away
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle"); // the sheet opens client-side, so wait for hydration
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Full name").fill("Test Employee");
    await page.getByLabel("Work email").fill(EMPLOYEE_EMAIL);
    await page.getByRole("checkbox", { name: "Manager" }).check();
    await page.getByRole("button", { name: "Create user" }).click();

    const dialog = page.getByRole("dialog", { name: "Temporary password" });
    await expect(dialog).toBeVisible();
    tempPassword = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
    expect(tempPassword).toHaveLength(14);
    await dialog.getByRole("button", { name: "Done" }).click();
    // A row, not a cell: the actions button's label ("Actions for <email>") also names its cell.
    await expect(page.getByRole("row", { name: /test\.employee@pvcon\.in/ })).toBeVisible();
  });

  test("a regular user is forced to change password and cannot open admin settings", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, tempPassword);
    await changePassword(page, tempPassword, EMPLOYEE_PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Test");
    await expect(page.getByRole("link", { name: "Users & roles" })).toHaveCount(0);
    await page.goto("/settings/users");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  test("the admin sees the activity in the audit log", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/settings/audit?action=user.");
    await expect(page.getByRole("cell", { name: "user.create" })).toBeVisible();
  });
});
