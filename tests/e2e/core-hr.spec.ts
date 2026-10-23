import { expect, test } from "@playwright/test";
import { changePassword, signIn, signInAsAdmin } from "./helpers";

const EMPLOYEE_EMAIL = "asha.rao@pvcon.in";
const EMPLOYEE_PASSWORD = "Asha-Strong-Pass1";

test.describe.serial("core HR", () => {
  let tempPassword = "";

  test("HR sets up a department and a designation", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/org/departments");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New department" }).click();
    await page.getByLabel("Name").fill("Engineering");
    await page.getByLabel("Code").fill("eng");
    await page.getByRole("button", { name: "Create department" }).click();
    await expect(page.getByRole("row", { name: /Engineering/ })).toBeVisible();

    await page.goto("/org/designations");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New designation" }).click();
    await page.getByLabel("Name").fill("Consultant");
    await page.getByRole("button", { name: "Create designation" }).click();
    await expect(page.getByRole("row", { name: /Consultant/ })).toBeVisible();
  });

  test("HR adds an employee with a login through the wizard", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/org/employees/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("First name").fill("Asha");
    await page.getByLabel("Last name").fill("Rao");
    await page.getByLabel("Work email").fill(EMPLOYEE_EMAIL);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Department", { exact: true }).selectOption({ label: "Engineering" });
    await page.getByLabel("Designation", { exact: true }).selectOption({ label: "Consultant" });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Account number").fill("111122223333");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Login", { exact: true }).selectOption("create");
    await page.getByRole("button", { name: "Create employee" }).click();

    const dialog = page.getByRole("dialog", { name: "Temporary password" });
    await expect(dialog).toBeVisible();
    tempPassword = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
    expect(tempPassword).toHaveLength(14);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/org\/employees\/\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asha Rao");
  });

  test("the employee signs in, sees their profile and updates their phone", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, tempPassword);
    await changePassword(page, tempPassword, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/PV0001/).first()).toBeVisible();
    await page.getByLabel("Phone", { exact: true }).fill("+91 98450 12345");
    await page.getByRole("button", { name: "Save contact details" }).click();
    await expect(page.getByText("Contact details saved")).toBeVisible();
  });

  test("the employee asks HR to change their bank account", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Request a change" }).click();
    await page.getByLabel("Account number").fill("444455556666");
    await page.getByLabel("IFSC").fill("HDFC0001234");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Change request pending")).toBeVisible();
  });

  test("HR approves the change", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("444455556666")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("No pending requests")).toBeVisible();
  });

  test("the employee sees the new, masked account", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await expect(page.getByText("XXXX6666")).toBeVisible();
  });
});
