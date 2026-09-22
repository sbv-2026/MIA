import { test, expect } from "@playwright/test";

test("MIA extracts a PO and opens the assisted L/C form", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  await page.getByRole("button", { name: /Thực hiện giao dịch/ }).click();
  await expect(page.getByRole("heading", { name: "Thực hiện giao dịch" })).toBeVisible();
  await page.getByRole("button", { name: /Phát hành LC/ }).click();

  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await mia.getByRole("button", { name: "LC thường", exact: true }).click();
  await mia.getByRole("button", { name: "LC nháp", exact: true }).click();
  await expect(mia.getByText("Bước 1: Upload file PO", { exact: true })).toBeVisible();
  await mia.locator('input[type="file"]').setInputFiles({
    name: "PO-001.txt", mimeType: "text/plain",
    buffer: Buffer.from("Currency: USD\nAmount: 50,000\nBuyer: ACME VIETNAM\nSeller: GLOBAL PARTS LTD\nSWIFT: BOFAUS3N\nIncoterms: CIF HAI PHONG"),
  });
  await expect(mia.getByText("Các thông tin cần tiếp tục cung cấp:", { exact: true })).toBeVisible();
  await expect(mia.getByText("Thông tin đã bóc tách:", { exact: true })).toBeVisible();
  await mia.getByRole("button", { name: "Tiếp tục thực hiện trên màn hình" }).click();

  await expect(page.getByRole("heading", { name: "Phát hành thư tín dụng", exact: true })).toBeVisible();
  await expect(page.locator(".lc-steps div").first()).toContainText("Thông tin L/C");
  await expect(page.locator(".lc-assistant-banner")).toBeVisible();
  await expect(page.getByLabel("32B: Số tiền (Currency, Amount) *")).toHaveValue("50,000");
  await expect(page.getByLabel("Mã SWIFT *")).toHaveValue("BOFAUS3N");
});
