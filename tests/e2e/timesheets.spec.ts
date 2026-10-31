import { expect, test, type Browser, type Page } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

const CLIENT = clientIp(5);
test.use(CLIENT);

const MANAGER = { first: "Nisha", last: "Verma", email: "nisha.verma@pvcon.in", password: "Nisha-Strong-Pass1" };
const EMPLOYEE = { first: "Rohan", last: "Gupta", email: "rohan.gupta@pvcon.in", password: "Rohan-Strong-Pass1" };

/** This week's and last week's Mondays as the app sees dates (company time zone, Asia/Kolkata by default). */
const [thisMonday, lastMonday] = (() => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const monday = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 7);
  return [monday, d.toISOString().slice(0, 10)];
})();

async function signedIn(browser: Browser, person: typeof MANAGER, temp: string): Promise<Page> {
  const page = await (await browser.newContext(CLIENT)).newPage();
  await signIn(page, person.email, temp);
  await changePassword(page, temp, person.password);
  await expect(page).toHaveURL(/\/$/);
  return page;
}

test.describe.serial("timesheets", () => {
  let employee: Page;
  let manager: Page;
  let managerTemp = "";
  let employeeTemp = "";

  test.afterAll(async () => {
    await employee?.context().close();
    await manager?.context().close();
  });

  test("HR sets up a client project with a manager and an employee as members", async ({ page }) => {
    await signInAsAdmin(page);
    managerTemp = await addEmployee(page, MANAGER);
    employeeTemp = await addEmployee(page, EMPLOYEE, `${MANAGER.first} ${MANAGER.last}`);

    await page.goto("/time/clients");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Globex");
    await page.getByRole("dialog").getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created")).toBeVisible();

    await page.goto("/time/projects");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New project" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Code").fill("GLX-APP");
    await sheet.getByLabel("Name").fill("Globex app");
    await sheet.getByLabel("Client").selectOption({ label: "Globex" });
    await sheet.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText("Project created")).toBeVisible();

    await page.getByRole("link", { name: /Globex app/ }).click();
    await expect(page).toHaveURL(/\/time\/projects\/\d+$/);
    await page.getByRole("button", { name: "Add members" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(new RegExp(`${MANAGER.first} ${MANAGER.last}`)).check();
    await dialog.getByLabel(new RegExp(`${EMPLOYEE.first} ${EMPLOYEE.last}`)).check();
    await dialog.getByRole("button", { name: /^Add 2 member/ }).click();
    await expect(page.getByText("Added 2 member(s)")).toBeVisible();
  });

  test("the employee logs last Monday on the project and submits the week", async ({ browser }) => {
    employee = await signedIn(browser, EMPLOYEE, employeeTemp);
    await employee.goto(`/me/timesheets/${lastMonday}`);
    await employee.waitForLoadState("networkidle");
    await employee.getByLabel("Project", { exact: true }).selectOption({ label: "GLX-APP · Globex app" });
    await employee.getByLabel("Task", { exact: true }).selectOption({ label: "Development" });
    await employee.getByRole("button", { name: "Add row" }).click();
    await employee.getByLabel(`GLX-APP Development ${lastMonday}`).fill("8");
    await employee.getByRole("button", { name: "Save" }).click();
    await expect(employee.getByText("Timesheet saved")).toBeVisible();
    await employee.getByRole("button", { name: "Submit" }).click();
    await expect(employee.getByText("Timesheet submitted for approval")).toBeVisible();
    await expect(employee.getByText("Waiting for approval")).toBeVisible();
  });

  test("the manager approves it from the approvals inbox", async ({ browser }) => {
    manager = await signedIn(browser, MANAGER, managerTemp);
    await manager.goto("/approvals?tab=timesheets");
    await manager.waitForLoadState("networkidle");
    await expect(manager.getByText(`${EMPLOYEE.first} ${EMPLOYEE.last}`)).toBeVisible();
    await manager.getByRole("button", { name: "Approve", exact: true }).click();
    await manager.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(manager.getByText("No timesheets waiting")).toBeVisible();
  });

  test("the employee sees the week approved and locked", async () => {
    await employee.goto(`/me/timesheets/${lastMonday}`);
    await employee.waitForLoadState("networkidle");
    await expect(employee.getByText(`Approved by ${MANAGER.first} ${MANAGER.last}`)).toBeVisible();
    await expect(employee.getByRole("button", { name: "Submit" })).toHaveCount(0);
    await expect(employee.getByLabel(`GLX-APP Development ${lastMonday}`)).toHaveCount(0);
    await expect(employee.getByTestId("row-GLX-APP-Development")).toContainText("8");
  });

  test("clocking in from the top bar logs to the task they log most, and this week's timesheet says so", async () => {
    await employee.goto("/");
    await employee.waitForLoadState("networkidle");
    const card = employee.getByTestId("clock-card");
    await expect(card.getByRole("combobox", { name: "Project", exact: true }).locator("option:checked")).toHaveText("GLX-APP · Globex app");
    await expect(card.getByRole("combobox", { name: "Task", exact: true }).locator("option:checked")).toHaveText("Development");

    const bar = employee.getByTestId("topbar-clock");
    await bar.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(employee.getByText(/Clocked in at \d\d:\d\d · GLX-APP · Globex app · Development/)).toBeVisible();
    await expect(card.getByText("GLX-APP · Globex app · Development", { exact: true })).toBeVisible();

    await employee.goto(`/me/timesheets/${thisMonday}`);
    await employee.waitForLoadState("networkidle");
    await expect(employee.getByText("Your clock is logging to GLX-APP · Development")).toBeVisible();

    await bar.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(employee.getByText(/Clocked out at \d\d:\d\d/)).toBeVisible();
    await expect(employee.getByText("Your clock is logging to GLX-APP · Development")).toHaveCount(0);
  });
});
