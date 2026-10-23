import { expect, test } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

test.use(clientIp(3));

const MANAGER = { first: "Ravi", last: "Kumar", email: "ravi.kumar@pvcon.in", password: "Ravi-Strong-Pass1" };
const EMPLOYEE = { first: "Meera", last: "Iyer", email: "meera.iyer@pvcon.in", password: "Meera-Strong-Pass1" };

/** The first Monday–Friday at least two days ahead (casual leave needs a day's notice), in this calendar year. */
function leaveDate(): string | null {
  const d = new Date();
  const year = d.getUTCFullYear();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCFullYear() === year ? d.toISOString().slice(0, 10) : null;
}

test.describe.serial("leave", () => {
  const date = leaveDate();
  let managerTemp = "";
  let employeeTemp = "";

  test.skip(date === null, "The last days of December leave no working day this leave year for the casual leave test.");

  test("HR adds a manager and an employee who reports to them", async ({ page }) => {
    await signInAsAdmin(page);
    managerTemp = await addEmployee(page, MANAGER);
    employeeTemp = await addEmployee(page, EMPLOYEE, `${MANAGER.first} ${MANAGER.last}`);
    expect(managerTemp).toHaveLength(14);
    expect(employeeTemp).toHaveLength(14);
  });

  test("the employee sees a full casual leave balance and applies for a day", async ({ page }) => {
    await signIn(page, EMPLOYEE.email, employeeTemp);
    await changePassword(page, employeeTemp, EMPLOYEE.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/leave");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("balance-CL")).toContainText("12");

    await page.getByRole("button", { name: "Apply for leave" }).click();
    const sheet = page.getByRole("dialog", { name: "Apply for leave" });
    await sheet.getByLabel("Leave type").selectOption({ label: "Casual leave (CL)" });
    await sheet.getByLabel("From").fill(date!);
    await sheet.getByLabel("To").fill(date!);
    await expect(sheet.getByTestId("leave-day-count")).toContainText("1 day");
    await sheet.getByLabel("Reason").fill("Family function");
    await sheet.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Leave request sent")).toBeVisible();
    await expect(page.getByRole("row", { name: /Pending/ })).toBeVisible();
  });

  test("the manager approves it from the approvals inbox", async ({ page }) => {
    await signIn(page, MANAGER.email, managerTemp);
    await changePassword(page, managerTemp, MANAGER.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("tab", { name: /Leave \(1\)/ })).toBeVisible();
    await expect(page.getByText(`${EMPLOYEE.first} ${EMPLOYEE.last}`)).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("No pending leave requests")).toBeVisible();
  });

  test("the employee sees it approved, then cancels it and gets the day back", async ({ page }) => {
    await signIn(page, EMPLOYEE.email, EMPLOYEE.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/leave");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("row", { name: /Approved/ })).toBeVisible();
    await expect(page.getByTestId("balance-CL")).toContainText("11");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel leave" }).click();
    await expect(page.getByText("Leave cancelled")).toBeVisible();
    await expect(page.getByRole("row", { name: /Cancelled/ })).toBeVisible();
    await expect(page.getByTestId("balance-CL")).toContainText("12");
  });
});
