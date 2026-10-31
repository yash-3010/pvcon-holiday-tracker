import { expect, test, type Browser, type Page } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

// Named so it runs after auth.spec.ts, which expects the seeded admin password to be untouched.
const MANAGER = { first: "Arjun", last: "Nair", email: "arjun.nair@pvcon.in", password: "Arjun-Strong-Pass1" };
const EMPLOYEE = { first: "Divya", last: "Menon", email: "divya.menon@pvcon.in", password: "Divya-Strong-Pass1" };

const CLIENT = clientIp(4);
test.use(CLIENT);

/** Calendar dates as the app sees them (company time zone, Asia/Kolkata by default). */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The most recent Saturday before today: a weekly off on the default shift. */
const saturday = (() => {
  let d = shift(today, -1);
  while (weekday(d) !== 6) d = shift(d, -1);
  return d;
})();
/** The first Monday–Friday at least two days ahead, if it is still in this leave year. */
const leaveDate = (() => {
  let d = shift(today, 2);
  while (weekday(d) === 0 || weekday(d) === 6) d = shift(d, 1);
  return d.slice(0, 4) === today.slice(0, 4) ? d : null;
})();

/** Each person keeps one signed-in page for the whole flow, which keeps the suite under the sign-in rate limit. */
async function signedIn(browser: Browser, person: typeof MANAGER, temp: string): Promise<Page> {
  const page = await (await browser.newContext(CLIENT)).newPage();
  await signIn(page, person.email, temp);
  await changePassword(page, temp, person.password);
  await expect(page).toHaveURL(/\/$/);
  return page;
}

async function approveFirst(page: Page, tab: string, empty: string) {
  await page.goto(`/approvals?tab=${tab}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(empty)).toBeVisible();
}

test.describe.serial("attendance and comp-off", () => {
  let employee: Page;
  let manager: Page;
  let managerTemp = "";
  let employeeTemp = "";

  test.skip(leaveDate === null, "The last days of December leave no working day this leave year for the comp-off leave.");
  test.afterAll(async () => {
    await employee?.context().close();
    await manager?.context().close();
  });

  test("HR adds a manager and an employee who reports to them", async ({ page }) => {
    await signInAsAdmin(page);
    managerTemp = await addEmployee(page, MANAGER);
    employeeTemp = await addEmployee(page, EMPLOYEE, `${MANAGER.first} ${MANAGER.last}`);
  });

  test("the employee runs the day's clock from the dashboard and the top bar, and sees today's punches", async ({ browser }) => {
    employee = await signedIn(browser, EMPLOYEE, employeeTemp);
    const card = employee.getByTestId("clock-card");
    const bar = employee.getByTestId("topbar-clock");
    await expect(card.getByText("Not clocked in", { exact: true })).toBeVisible();
    await card.getByRole("radio", { name: "Remote" }).click();
    await card.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(card.getByText(/In since \d\d:\d\d/)).toBeVisible();
    await expect(card.getByText("· Remote")).toBeVisible();
    // The top bar and the tab title carry the running clock on every page.
    await expect(bar.getByRole("button", { name: /^Working, 0 hours \d+ minutes today/ })).toBeVisible();
    await expect(employee).toHaveTitle(/^0:00:\d\d · /);
    await expect(employee.locator('link[rel~="icon"]').first()).toHaveAttribute("href", "/icons/clock-working.png");

    await bar.getByRole("button", { name: "Take a break", exact: true }).click();
    await expect(card.getByText("On a break", { exact: true })).toBeVisible();
    await expect(employee).toHaveTitle(/^Break 0:00:\d\d · /);
    await expect(employee.locator('link[rel~="icon"]').first()).toHaveAttribute("href", "/icons/clock-break.png");
    await bar.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(card.getByText("Working", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(card.getByText("Done for today", { exact: true })).toBeVisible();
    await expect(employee).not.toHaveTitle(/^(Break )?\d+:\d\d:\d\d · /);
    await expect(employee.locator('link[rel~="icon"]').first()).not.toHaveAttribute("href", /clock-/);

    await employee.goto("/me/attendance");
    await employee.waitForLoadState("networkidle");
    await employee.getByTestId(`day-${today}`).click();
    const sheet = employee.getByRole("dialog");
    const punches = sheet.getByRole("listitem");
    await expect(punches).toHaveCount(4);
    await expect(punches.nth(0)).toContainText("In");
    await expect(punches.nth(1)).toContainText("Break");
    await expect(punches.nth(2)).toContainText("In");
    await expect(punches.nth(3)).toContainText("Out");
  });

  test("the nightly close computes past days, and the employee corrects last Saturday, which they worked", async ({ request }) => {
    const run = await request.post(`/api/cron/${encodeURIComponent("attendance:close-day")}`, {
      headers: { authorization: "Bearer e2e-cron-secret" },
    });
    expect(run.ok()).toBe(true);
    await employee.goto(`/me/attendance?month=${saturday.slice(0, 7)}`);
    await employee.waitForLoadState("networkidle");
    await employee.getByTestId(`day-${saturday}`).click();
    const sheet = employee.getByRole("dialog");
    await expect(sheet.getByText("Weekly off")).toBeVisible();
    await sheet.getByLabel("In", { exact: true }).fill("10:00");
    await sheet.getByLabel("Out", { exact: true }).fill("18:30");
    await sheet.getByLabel("What happened").fill("Release support on Saturday");
    await sheet.getByRole("button", { name: "Request correction" }).click();
    await expect(employee.getByText("Correction sent for approval")).toBeVisible();
  });

  test("the manager approves the correction", async ({ browser }) => {
    manager = await signedIn(browser, MANAGER, managerTemp);
    await approveFirst(manager, "regularization", "No pending corrections");
  });

  test("the employee claims comp-off for the Saturday and the manager approves it", async () => {
    await employee.goto("/me/comp-off");
    await employee.waitForLoadState("networkidle");
    await expect(employee.getByTestId("compoff-available")).toHaveText("0");
    await employee.getByRole("row", { name: /8h 30m/ }).getByRole("button", { name: "Claim" }).click();
    await employee.getByRole("dialog").getByRole("button", { name: "Claim", exact: true }).click();
    await expect(employee.getByText("Comp-off claimed")).toBeVisible();

    await approveFirst(manager, "compoff", "No pending comp-off claims");
    await employee.goto("/me/comp-off");
    await expect(employee.getByTestId("compoff-available")).toHaveText("1");
  });

  test("the employee takes the comp-off as leave and it is used up once approved", async () => {
    await employee.goto("/me/leave");
    await employee.waitForLoadState("networkidle");
    await employee.getByRole("button", { name: "Apply for leave" }).click();
    const sheet = employee.getByRole("dialog", { name: "Apply for leave" });
    await sheet.getByLabel("Leave type").selectOption({ label: "Comp-off (CO)" });
    await sheet.getByLabel("From").fill(leaveDate!);
    await sheet.getByLabel("To").fill(leaveDate!);
    await expect(sheet.getByTestId("leave-day-count")).toContainText("1 day");
    await sheet.getByLabel("Reason").fill("Comp-off for Saturday");
    await sheet.getByRole("button", { name: "Submit request" }).click();
    await expect(employee.getByText("Leave request sent")).toBeVisible();

    await approveFirst(manager, "leave", "No pending leave requests");
    await employee.goto("/me/comp-off");
    await expect(employee.getByTestId("compoff-available")).toHaveText("0");
    await expect(employee.getByRole("cell", { name: "Used" })).toBeVisible();
  });
});
