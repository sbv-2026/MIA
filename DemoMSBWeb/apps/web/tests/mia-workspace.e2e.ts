import { test, expect } from "@playwright/test";

for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 690, height: 540 }]) {
  test(`MIA task groups and responsive height ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
    await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
    await expect(page.getByRole("button", { name: /Đề xuất sản phẩm/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Thực hiện giao dịch/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Ưu đãi/ })).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect((await page.locator(".mia-runtime-panel").boundingBox())?.y).toBe(0);
    await page.screenshot({ path: `test-results/mia-home-${size.width}.png` });
    await page.getByRole("button", { name: /Việc cần làm/ }).click();
    await expect(page.getByRole("heading", { name: "Việc cần làm", exact: true })).toBeVisible();
    await expect(page.locator(".mia-todo-card")).toHaveCount(6);
    const scroll = page.locator(".mia-scroll-viewport");
    await expect(page.getByRole("button", { name: /Kéo xuống/ })).toBeVisible();
    await scroll.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect(page.getByRole("button", { name: /Kéo lên/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Kéo xuống/ })).toHaveCount(0);
    expect(await scroll.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe("none");
    await expect(page.getByText(/25\/09\/2026/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Thực hiện giao dịch/ })).toHaveCount(0);
    const panel = await page.locator(".mia-runtime-panel").boundingBox();
    expect(panel?.height).toBeCloseTo(size.height, 0);
    expect(await page.locator(".mia-glass-workspace").evaluate(element => getComputedStyle(element).overflowY)).toBe("hidden");
    const voice = await page.locator(".mia-start-voice").boundingBox();
    const workspace = await page.locator(".mia-glass-workspace").boundingBox();
    const hint = await page.getByRole("button", { name: /Kéo lên/ }).boundingBox();
    expect(hint!.width).toBeCloseTo(workspace!.width, 0);
    expect(hint!.x).toBeCloseTo(workspace!.x, 0);
    await expect(page.locator(".assistant-connection-status")).toHaveCount(0);
    expect(voice!.height).toBeLessThanOrEqual(33);
    expect(voice!.width).toBeCloseTo(workspace!.width - 28, 0);
    expect((await page.locator(".mia-utilities").boundingBox())!.y).toBeGreaterThan(voice!.y);
    await page.screenshot({ path: `test-results/mia-todos-${size.width}.png` });
    await page.getByRole("button", { name: "Trang chủ tương tác MIA" }).click();
    await expect(page.getByRole("button", { name: /Thực hiện giao dịch/ })).toBeVisible();
    await page.getByRole("button", { name: /Đề xuất sản phẩm/ }).click();
    await expect(page.frameLocator('iframe[title="MIA Assistant"]').getByRole("heading", { name: /Tín dụng doanh nghiệp/ })).toBeVisible();
    await expect(page.locator(".mia-todo-group")).toHaveCount(0);
  });
}
