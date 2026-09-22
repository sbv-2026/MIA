import { expect, test } from "@playwright/test";

test("MIA automatically detects and reads a guarantee error even when it appears during startup", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        cancel: () => {},
        speak: (utterance: SpeechSynthesisUtterance) => setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 5),
      },
    });
  });
  await page.route("**/api/config/guarantee-error", route => route.fulfill({ json: {
    enabled: true,
    feature: "Bảo lãnh",
    operation: "guarantee.create",
    error: {
      errorCode: "50002",
      title: "Chưa xác định Người đại diện vay vốn",
      message: "Dịch vụ tín dụng yêu cầu người dùng cuối phải là Người đại diện vay vốn.",
    },
  } }));

  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // Click immediately: this covers the race where the error precedes the
  // assistant iframe's ready handshake.
  const errorBootstrap = page.waitForRequest(request => request.url().endsWith("/api/agent/bootstrap") && request.postDataJSON()?.contextSnapshot?.error?.errorCode === "50002");
  const errorBootstrapResponse = page.waitForResponse(async response => response.url().endsWith("/api/agent/bootstrap") && (await response.request().postDataJSON())?.contextSnapshot?.error?.errorCode === "50002");
  await page.getByRole("button", { name: "Bảo lãnh", exact: true }).last().click();

  await expect(page.getByRole("alertdialog")).toContainText("50002");
  await errorBootstrap;
  const bootstrap = await (await errorBootstrapResponse).json();
  expect(bootstrap.utterances).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "error", text: expect.stringContaining("50002") })]));
  await expect(page.locator(".mia-greeting")).toContainText("mã lỗi 50002", { timeout: 15_000 });
});
