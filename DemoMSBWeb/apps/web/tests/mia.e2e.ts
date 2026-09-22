import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const miaWindow = window as typeof window & { miaSpoken: Array<{ text: string; time: number }> };
    miaWindow.miaSpoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [], cancel: () => {},
      speak: (utterance: SpeechSynthesisUtterance) => {
        miaWindow.miaSpoken.push({ text: utterance.text, time: Date.now() });
        setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 20);
      },
    } });
  });
});
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill(username);
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}
for (const [user, address, pronoun] of [["so", "anh Sô", "anh"], ["Ly", "chị Ly", "chị"], ["not-configured", "anh/chị", "anh/chị"]]) {
  test("personalized greeting: " + user, async ({ page }) => {
    await login(page, user);
    const text = "Xin chào " + address + ", MIA sẵn sàng hỗ trợ " + pronoun + " ạ.";
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText(text, { exact: true })).toBeHidden({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /Mở trợ lý MIA/ })).toBeVisible();
    await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
    const assistant = page.frameLocator('iframe[title="MIA Assistant"]');
    await expect(page.getByRole("button", { name: /Việc cần làm/ })).toHaveCount(user === "not-configured" ? 0 : 1);
    await page.getByRole("button", { name: "Đóng MIA", exact: true }).click();
    await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
    const count = await page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string}> }).miaSpoken.filter(item => item.text.startsWith("Xin chào")).length);
    expect(count).toBe(1);
    await page.getByRole("button", { name: "Đóng MIA", exact: true }).click();
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await login(page, "not-configured");
    await expect(page.getByText("Xin chào anh/chị, MIA sẵn sàng hỗ trợ anh/chị ạ.", { exact: true })).toBeVisible();
  });
}
test("home reminders and navigation need confirmation", async ({ page }) => {
  await login(page, "so");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string;time:number}> }).miaSpoken.length)).toBe(3);
  const spoken = await page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string;time:number}> }).miaSpoken);
  expect(spoken[1].text).toContain("6 việc cần làm");
  expect(spoken[1].text).not.toContain("thanh toán");
  expect(spoken[2].time - spoken[1].time).toBeGreaterThanOrEqual(2000);
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  const assistant = page.frameLocator('iframe[title="MIA Assistant"]');
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await page.locator(".mia-todo-action").filter({ hasText: "105010000001" }).click();
  await expect(assistant.getByRole("button", { name: "Mở ngay" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await assistant.getByRole("button", { name: "Mở ngay" }).click();
  await expect(page.getByRole("dialog")).toContainText("105010000001");

});
test("home guide drills down without automatically navigating", async ({ page }) => {
  await login(page, "so");
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  const assistant = page.frameLocator('iframe[title="MIA Assistant"]');
  await page.getByRole("button", { name: "Hướng dẫn sử dụng", exact: true }).click();

  await expect(assistant.getByRole("heading", { name: "Anh Sô muốn tìm hướng dẫn sử dụng phần nào ạ?", exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Tạo yêu cầu giải ngân", exact: true }).click();
  await assistant.getByRole("button", { name: "Tạo yêu cầu giải ngân", exact: true }).click();
  await expect(assistant.getByText("Chọn mục đích thanh toán và loại chuyển tiền.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tạo yêu cầu Đề nghị giải ngân", exact: true })).toHaveCount(0);
});
test("assistant down does not block login or host navigation", async ({ page }) => {
  await page.route("http://127.0.0.1:18090/**", route => route.abort());
  await login(page, "not-configured");
  await expect(page.locator(".mia-greeting").filter({ hasText: "Không thể kết nối MIA." })).toBeVisible();
  await page.getByRole("button", { name: "Giải ngân", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Giải ngân", exact: true })).toBeVisible();
});

for (const [user, todos, offers] of [["khoi", false, false], ["thu", false, true], ["tanh", true, false]] as const) {
  test("home functions depend on customer data: " + user, async ({ page }) => {
    await login(page, user);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string}> }).miaSpoken.length)).toBeGreaterThan(0);
    await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
    await expect(page.getByText("Đang tải thông tin…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Việc cần làm/ })).toHaveCount(todos ? 1 : 0);
    await expect(page.getByRole("button", { name: /Thực hiện giao dịch/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Đề xuất sản phẩm/ })).toHaveCount(offers ? 1 : 0);
    await expect(page.getByRole("button", { name: "Hướng dẫn sử dụng", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yêu cầu khác", exact: true })).toBeVisible();
    if (Number(todos) + Number(offers) === 0) {
      const mainButton = await page.locator(".mia-function-groups button").boundingBox();
      const support = await page.locator(".mia-home-support").boundingBox();
      expect(mainButton!.width).toBeCloseTo(support!.width, 0);
    }
    await page.screenshot({ path: `test-results/mia-menu-${user}.png` });
    const bounds = await page.locator(".mia-runtime-panel").boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.width).toBeCloseTo(viewport.width / 3, 0);
    expect(bounds!.height).toBeCloseTo(viewport.height, 0);
    expect(bounds!.x + bounds!.width).toBeCloseTo(viewport.width, 0);
    expect(bounds!.y + bounds!.height).toBeCloseTo(viewport.height, 0);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string}> }).miaSpoken.length)).toBeGreaterThan(0);
    const spoken = await page.evaluate(() => (window as typeof window & { miaSpoken: Array<{text:string}> }).miaSpoken);
    expect(spoken[0].text).toContain("mi a");
    expect(spoken[0].text).not.toContain("Mi - A");
  });
}
