import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("not-configured");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

test("beneficiary whitelist resolves names and rejects unknown accounts", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Giải ngân", exact: true }).last().click();
  await page.getByRole("button", { name: /Thanh toán nội địa/ }).click();
  const account = page.getByPlaceholder("Nhập số tài khoản hoặc chọn từ danh bạ");
  await account.fill("001100123456");
  await account.blur();
  await expect(page.getByPlaceholder("Tên người thụ hưởng được tra cứu tự động")).toHaveValue("CÔNG TY TNHH THƯƠNG MẠI MINH AN");
  await account.fill("123456789");
  await account.blur();
  await expect(page.locator(".field-error").filter({ hasText: /11001.*Không tìm thấy tài khoản thụ hưởng tại MSB/ })).toBeVisible();
});

test("letter of credit includes dashboard, form and success state", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Thư tín dụng (L/C nhập)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Thư tín dụng", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Phát hành thư tín dụng", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phát hành thư tín dụng", exact: true })).toBeVisible();
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "Tạo lệnh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tạo lệnh thành công", exact: true })).toBeVisible();
});

test("mobile navigation opens as a hamburger drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await page.getByRole("button", { name: "Thư tín dụng (L/C nhập)", exact: true }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await expect(page.getByRole("heading", { name: "Thư tín dụng", exact: true })).toBeVisible();
});
