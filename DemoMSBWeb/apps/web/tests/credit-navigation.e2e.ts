import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const taskWindow = window as typeof window & { transcripts: string[]; spoken: string[] };
    taskWindow.transcripts = []; taskWindow.spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [], cancel: () => {},
      speak: (utterance: SpeechSynthesisUtterance) => { taskWindow.spoken.push(utterance.text); setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 20); },
    } });
    class Recognition {
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      start() { const text = taskWindow.transcripts.shift(); setTimeout(() => text ? this.onresult?.({ results: [[{ transcript: text }]] }) : this.onerror?.(), 30); }
      abort() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
  });
});
async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
}
for (const index of [0,1,2]) {
  test(`todo ${index+1} maps to its exact account and drawer`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);
    const response = await page.request.get(`/api/host/assistant-data/${await page.evaluate(() => document.querySelector("iframe")!.src.split("sessionId=")[1].split("&")[0])}?details=true`);
    const loans = (await response.json()).todoList.filter((todo: {todotype: string}) => todo.todotype === "overdue-loan");
    const account = loans[index].loanAccount;
    await page.getByRole("button", { name: /Việc cần làm/ }).click();
    await selectTodo(page, account);
    const mia = page.frameLocator('iframe[title="MIA Assistant"]');
    await expect(mia.getByRole("region", { name: "Xác nhận điều hướng" })).toContainText(account);
    await expect(page.locator(".loan-drawer")).toHaveCount(0);
    await page.screenshot({ path: `test-results/mia-confirmation-${index}.png` });
    await mia.getByRole("button", { name: "Mở ngay" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: `Chi tiết tài khoản vay ${account}` })).toBeVisible();
    await expect(page.locator(".credit-selected-row")).toContainText(account);
    const drawer = await page.getByRole("dialog").boundingBox();
    expect(drawer?.width).toBeCloseTo(480, 0);
    await page.screenshot({ path: `test-results/credit-drawer-${index}.png` });
    await page.getByRole("button", { name: "Lịch sử giao dịch", exact: true }).click();
    await expect(page.locator(".loan-history-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Lịch trả nợ dự kiến", exact: true }).click();
    await expect(page.locator(".loan-history-row")).toContainText("15/09/2026");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
async function selectTodo(page: Page, text: string) {
  await expect(page.locator(".mia-todo-action").first()).toBeVisible();
  const target = page.locator(".mia-todo-action").filter({ hasText: text });
  for (let i = 0; i < 3 && await target.count() === 0; i++) {
    await page.getByRole("button", { name: "Ti\u1ebfp", exact: true }).click();
  }
  await target.click();
}

test("voice request and spoken confirmation open the same account", async ({ page }) => {
  await login(page);
  await page.evaluate(() => { (window as typeof window & {transcripts: string[]}).transcripts = ["Xem khoản vay 105010000002", "đồng ý"]; });
  await page.getByRole("button", { name: /Chạm vào MIA để nói/ }).click();
  await expect(page.getByRole("heading", { name: "Chi tiết tài khoản vay 105010000002" })).toBeVisible();
  const spoken = await page.evaluate(() => (window as typeof window & {spoken: string[]}).spoken);
  expect(spoken.some(text => text.includes("105010000002") && text.includes("đúng không"))).toBe(true);
  expect(spoken.every(text => !/\bMIA\b/.test(text))).toBe(true);
});
test("unknown account never selects another loan", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Yêu cầu khác/ }).click();
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await mia.getByRole("textbox", { name: "Câu hỏi cho MIA" }).fill("Xem khoản vay 1050100000019");
  await mia.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(mia.getByRole("status")).toContainText("chưa tìm thấy tài khoản vay");
  await expect(mia.getByRole("button", { name: "Mở ngay" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("Home clears pending confirmation and spoken disbursement intent keeps its feature", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await selectTodo(page, "105010000001");
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await expect(mia.getByRole("button", { name: "Mở ngay" })).toBeVisible();
  await page.getByRole("button", { name: "Trang chủ tương tác MIA" }).click();
  await page.getByRole("button", { name: /Yêu cầu khác/ }).click();
  await expect(mia.getByRole("button", { name: "Mở ngay" })).toHaveCount(0);
  await mia.getByRole("textbox", { name: "Câu hỏi cho MIA" }).fill("Tạo yêu cầu giải ngân");
  await mia.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(mia.getByRole("button", { name: "Xác nhận", exact: true })).toBeVisible();
  await expect(mia.getByRole("region", { name: "Xác nhận điều hướng" })).toContainText("Tạo yêu cầu giải ngân");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("mobile loan detail fills the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await selectTodo(page, "105010000003");
  await page.frameLocator('iframe[title="MIA Assistant"]').getByRole("button", { name: "Mở ngay" }).click();
  await expect(page.getByRole("dialog")).toContainText("105010000003");
  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.width).toBeCloseTo(390, 0);
  await page.screenshot({ path: "test-results/credit-drawer-mobile.png" });
});
test("postpone leaves host unchanged and document/password tasks use their own destinations", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await selectTodo(page, "105010000001");
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await mia.getByRole("button", { name: "Để sau" }).click();
  await expect(page.locator(".loan-drawer")).toHaveCount(0);
  await page.getByRole("button", { name: "Trang chủ tương tác MIA" }).click();
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await selectTodo(page, "Thanh toán T/T từ vốn tự có");
  await mia.getByRole("button", { name: "Mở ngay" }).click();
  await expect(page.locator(".todo-destination-list article.selected")).toContainText("Thanh toán T/T từ vốn tự có");
  await page.locator(".side-home").click();
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  await selectTodo(page, "Đến hạn đổi mật khẩu");
  await mia.getByRole("button", { name: "Mở ngay" }).click();
  await expect(page.getByRole("heading", { name: "Thay đổi mật khẩu", exact: true })).toBeVisible();
});
