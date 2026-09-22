import { test, expect } from "@playwright/test";

test("configured GLM resolves three service levels and asks before navigating", async ({ page }) => {
  test.skip(process.env.MIA_E2E_LIVE_MODEL !== "true", "Explicit live provider check");
  test.setTimeout(120_000);
  await page.addInitScript(() => Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel: () => {}, speak: (utterance: SpeechSynthesisUtterance) => setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 20) } }));
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("khoi");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  await page.getByRole("button", { name: "Yêu cầu khác", exact: true }).click();
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  const ask = async (message: string) => {
    await mia.getByRole("textbox", { name: "Câu hỏi cho MIA" }).fill(message);
    const pending = page.waitForResponse(response => response.url().endsWith("/api/agent/chat") && response.request().postDataJSON()?.message === message, { timeout: 60_000 });
    await mia.getByRole("button", { name: "Gửi", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBe(true);
    const line = (await response.text()).split("\n").find(line => line.startsWith("data: ") && line.includes('"reasoning"'));
    expect(line).toBeTruthy();
    return JSON.parse(line!.slice(6));
  };
  const broad = await ask("Tôi muốn tìm dịch vụ tín dụng");
  expect(broad.navigation).toBeUndefined();
  expect(broad.reasoning.provider).toBe("glm");
  expect(broad.reasoning.model).toBe("z-ai/glm-5.2-hackathon");
  const leaf = await ask("Tôi muốn tạo yêu cầu giải ngân");
  expect(leaf.navigation.screenId).toBe("domestic-disbursement-create");
  expect(leaf.categoryPath).toEqual(["Tín dụng", "Giải ngân", "Tạo yêu cầu giải ngân"]);
  await expect(mia.getByRole("region", { name: "Xác nhận điều hướng" })).toBeVisible();
  await expect(mia.getByLabel("Danh mục dịch vụ")).toContainText("Tín dụng");
  await expect(page.getByRole("heading", { name: "Tạo yêu cầu Đề nghị giải ngân", exact: true })).toHaveCount(0);
  const voice = await mia.locator(".mia-primary-voice").boundingBox();
  const utilities = await mia.locator(".mia-utilities").boundingBox();
  expect(utilities!.y).toBeGreaterThanOrEqual(voice!.y + voice!.height);
  await page.screenshot({ path: "test-results/mia-glm-category-confirmation.png" });
});


test("GLM confirms a selected task without changing the loan identity", async ({ page }) => {
  test.skip(process.env.MIA_E2E_LIVE_MODEL !== "true", "Explicit live provider check");
  test.setTimeout(90_000);
  await page.addInitScript(() => Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel: () => {}, speak: (utterance: SpeechSynthesisUtterance) => setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 20) } }));
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: /Mở trợ lý MIA/ }).click();
  await page.getByRole("button", { name: /Việc cần làm/ }).click();
  const pending = page.waitForResponse(response => response.url().endsWith("/api/agent/chat") && response.request().postDataJSON()?.actionId?.startsWith("todo:"), { timeout: 60_000 });
  await page.locator(".mia-todo-action").filter({ hasText: "105010000001" }).click();
  const response = await pending;
  const expectedId = response.request().postDataJSON().actionId.slice(5);
  const line = (await response.text()).split("\n").find(line => line.startsWith("data: ") && line.includes('"reasoning"'));
  expect(line).toBeTruthy();
  const answer = JSON.parse(line!.slice(6));
  expect(answer.reasoning.model).toBe("z-ai/glm-5.2-hackathon");
  expect(answer.navigation.todoId).toBe(expectedId);
  expect(answer.navigation.screenId).toBe("credit-information");
  expect(answer.speechText).toContain("105010000001");
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await expect(mia.getByRole("button", { name: "Mở ngay", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await mia.getByRole("button", { name: "Mở ngay", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("105010000001");
});
