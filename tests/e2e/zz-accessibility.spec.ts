import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

const CLIENT = clientIp(7);
test.use(CLIENT);

const EMPLOYEE = { first: "Zara", last: "Axe", email: "zara.axe@pvcon.in", password: "Zara-Strong-Pass1" };

const ADMIN_PAGES = [
  "/", "/approvals", "/notifications", "/announcements", "/reports", "/reports/headcount", "/org/employees", "/org/directory",
  "/time/attendance", "/time/muster", "/time/projects", "/leave/requests", "/leave/balances", "/leave/holidays", "/payroll/runs",
  "/payroll/salaries", "/settings/company", "/settings/email", "/settings/audit",
];
const EMPLOYEE_PAGES = ["/", "/me/attendance", "/me/leave", "/me/comp-off", "/me/timesheets", "/me/payslips", "/me/claims", "/me/profile"];

/** Serious and critical WCAG 2.1 A/AA violations on the current page, outside the Next.js dev overlay. */
async function violations(page: Page) {
  // Not "networkidle": in dev mode the Next.js overlay can hold a font request open.
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  const { violations: found } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .analyze();
  return found
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

async function checkAll(page: Page, paths: string[]) {
  const report: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    for (const v of await violations(page)) report.push(`${path} ${v}`);
  }
  expect(report).toEqual([]);
}

test.describe.serial("accessibility", () => {
  let temp = "";

  test("the sign-in page has no serious issues", async ({ page }) => {
    await page.goto("/login");
    expect(await violations(page)).toEqual([]);
  });

  test("an administrator's main pages have no serious issues", async ({ page }) => {
    test.setTimeout(240_000);
    await signInAsAdmin(page);
    temp = await addEmployee(page, EMPLOYEE);
    await checkAll(page, ADMIN_PAGES);
  });

  test("an employee's main pages have no serious issues, in light and dark themes", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await (await browser.newContext(CLIENT)).newPage();
    await signIn(page, EMPLOYEE.email, temp);
    await changePassword(page, temp, EMPLOYEE.password);
    await expect(page).toHaveURL(/\/$/);
    await checkAll(page, EMPLOYEE_PAGES);
    await page.emulateMedia({ colorScheme: "dark" });
    await checkAll(page, ["/", "/me/leave", "/me/timesheets"]);
  });
});
