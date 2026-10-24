import { expect, test } from "@playwright/test";
import { addEmployee, changePassword, clientIp, signIn, signInAsAdmin } from "./helpers";

const CLIENT = clientIp(8);
test.use(CLIENT);

const EMPLOYEE = { first: "Pia", last: "Photo", email: "pia.photo@pvcon.in", password: "Pia-Strong-Pass1" };
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("an employee adds a profile photo that colleagues see in the directory", async ({ page, browser }) => {
  await signInAsAdmin(page);
  const temp = await addEmployee(page, EMPLOYEE);

  const employee = await (await browser.newContext(CLIENT)).newPage();
  await signIn(employee, EMPLOYEE.email, temp);
  await changePassword(employee, temp, EMPLOYEE.password);
  await expect(employee).toHaveURL(/\/$/);

  await employee.goto("/me/profile");
  await employee.getByLabel("Photo file").setInputFiles({ name: "pia.png", mimeType: "image/png", buffer: PNG });
  await expect(employee.getByText("Photo saved")).toBeVisible();
  await expect(employee.getByRole("button", { name: "Change photo" })).toBeVisible();

  await page.goto("/org/directory");
  const card = page.locator("div", { hasText: "Pia Photo" }).filter({ has: page.locator("img") }).last();
  await expect(card.locator('img[src^="/api/files/"]')).toBeVisible();
});
