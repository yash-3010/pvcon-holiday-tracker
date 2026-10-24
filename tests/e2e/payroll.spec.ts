import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

const CLIENT = clientIp(6);
test.use(CLIENT);

const EMPLOYEE = { first: "Anika", last: "Bose", email: "anika.bose@pvcon.in", password: "Anika-Strong-Pass1" };
const PAYROLL = { name: "Priya Payroll", email: "priya.payroll@pvcon.in", password: "Priya-Strong-Pass1" };

/** Last month as the app sees it (company time zone, Asia/Kolkata by default): always over, so nothing is projected. */
const lastMonth = (() => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
const lastMonthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${lastMonth}-01T00:00:00Z`));

async function signedIn(browser: Browser, email: string, temp: string, password: string): Promise<Page> {
  const page = await (await browser.newContext(CLIENT)).newPage();
  await signIn(page, email, temp);
  await changePassword(page, temp, password);
  await expect(page).toHaveURL(/\/$/);
  return page;
}

test.describe.serial("payroll", () => {
  let employeeTemp = "";
  let payrollTemp = "";
  let runUrl = "";
  let code = "";
  let netPay = "";

  test("the admin adds an employee with a salary and a payroll admin", async ({ page }) => {
    await signInAsAdmin(page);
    employeeTemp = await addEmployee(page, EMPLOYEE);

    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Full name").fill(PAYROLL.name);
    await page.getByLabel("Work email").fill(PAYROLL.email);
    await page.getByRole("checkbox", { name: "Payroll Admin" }).check();
    await page.getByRole("button", { name: "Create user" }).click();
    const dialog = page.getByRole("dialog", { name: "Temporary password" });
    payrollTemp = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.goto("/payroll/salaries");
    await page.waitForLoadState("networkidle");
    await page.getByRole("row", { name: new RegExp(`${EMPLOYEE.first} ${EMPLOYEE.last}`) }).getByRole("button", { name: "Assign" }).click();
    await page.getByLabel("From month").fill("2025-01");
    await page.getByLabel("Annual CTC (₹)").fill("600000");
    await expect(page.getByText("₹50,000.00").first()).toBeVisible();
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByText("Salary saved")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`${EMPLOYEE.first} ${EMPLOYEE.last}`) })).toContainText("₹6,00,000.00");
  });

  test("the payroll admin creates last month's run and computes it, but can't approve it", async ({ browser }) => {
    const payroll = await signedIn(browser, PAYROLL.email, payrollTemp, PAYROLL.password);
    await payroll.goto("/payroll/runs");
    await payroll.waitForLoadState("networkidle");
    await payroll.getByRole("button", { name: "New run" }).click();
    await payroll.getByLabel("Month").fill(lastMonth);
    await payroll.getByRole("button", { name: "Create run" }).click();
    await expect(payroll).toHaveURL(/\/payroll\/runs\/\d+$/);
    runUrl = new URL(payroll.url()).pathname;
    await payroll.waitForLoadState("networkidle");
    await payroll.getByRole("button", { name: "Compute", exact: true }).click();
    await expect(payroll.getByText(/Computed \d+ payslip/)).toBeVisible({ timeout: 60_000 });
    await expect(payroll.getByRole("row", { name: new RegExp(`${EMPLOYEE.first} ${EMPLOYEE.last}`) })).toBeVisible();
    await expect(payroll.getByRole("button", { name: "Approve" })).toBeDisabled();
    await payroll.context().close();
  });

  test("the super admin approves and releases it", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(runUrl);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Run approved")).toBeVisible();
    await page.getByRole("button", { name: "Release payslips" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Release" }).click();
    await expect(page.getByText(/Released \d+ payslip/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Released", { exact: true }).first()).toBeVisible();
  });

  test("the employee downloads the payslip, byte for byte the stored one", async ({ browser }) => {
    const employee = await signedIn(browser, EMPLOYEE.email, employeeTemp, EMPLOYEE.password);
    await employee.goto("/me/payslips");
    const row = employee.getByRole("row", { name: new RegExp(lastMonthLabel) });
    await expect(row).toBeVisible();
    netPay = (await row.getByRole("cell").nth(2).textContent())?.trim() ?? "";
    expect(netPay).toMatch(/^₹[\d,]+\.\d{2}$/);
    await row.getByRole("link", { name: "View" }).click();
    await expect(employee).toHaveURL(/\/me\/payslips\/\d+$/);
    const id = Number(new URL(employee.url()).pathname.split("/").pop());
    code = (await employee.locator("p.font-mono").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    const first = await (await employee.request.get(`/api/payslips/${id}/pdf`)).body();
    const second = await (await employee.request.get(`/api/payslips/${id}/pdf`)).body();
    expect(first.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(first.equals(second)).toBe(true);
    const sqlite = new Database("./data/e2e.db", { readonly: true });
    const stored = sqlite.prepare("select pdf_sha256 as sha from payslips where id = ?").get(id) as { sha: string };
    sqlite.close();
    expect(createHash("sha256").update(first).digest("hex")).toBe(stored.sha);
    await employee.context().close();
  });

  test("anyone can verify the payslip and check its net pay", async ({ browser }) => {
    const visitor = await (await browser.newContext(CLIENT)).newPage();
    await visitor.goto(`/verify/${code}`);
    await expect(visitor.getByRole("heading", { name: "Genuine payslip" })).toBeVisible();
    await expect(visitor.getByText("A*** B***")).toBeVisible();
    await expect(visitor.getByText(lastMonthLabel)).toBeVisible();
    await expect(visitor.getByText(netPay)).toHaveCount(0);
    await visitor.getByLabel("Net pay on the payslip").fill(netPay);
    await visitor.getByRole("button", { name: "Check net pay" }).click();
    await expect(visitor.getByText("The net pay matches the issued payslip.")).toBeVisible();
    await visitor.getByLabel("Net pay on the payslip").fill("1");
    await visitor.getByRole("button", { name: "Check net pay" }).click();
    await expect(visitor.getByText(/doesn't match the issued payslip/)).toBeVisible();
    await visitor.goto("/verify/AAAAAAAAAAAA");
    await expect(visitor.getByText("No payslip was issued with this code.", { exact: false })).toBeVisible();
    await visitor.context().close();
  });
});
