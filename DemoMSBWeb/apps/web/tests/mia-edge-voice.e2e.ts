import { test, expect } from "@playwright/test";

test("Edge uses browser speech for the greeting", async ({ page }) => {
  test.skip(process.env.MIA_E2E_BROWSER_CHANNEL !== "msedge", "Edge-only voice check");
  const events: string[] = [];
  await page.exposeFunction("recordEdgeVoice", (message: string) => events.push(message));
  await page.addInitScript(() => {
    const record = (message: string) => void (window as unknown as { recordEdgeVoice: (message: string) => void }).recordEdgeVoice(message);
    const synth = window.speechSynthesis;
    const original = synth.speak.bind(synth);
    synth.speak = utterance => {
      record(`speak:${utterance.voice?.name ?? "browser-default"}:${utterance.lang}:${navigator.userActivation.isActive}`);
      utterance.addEventListener("start", () => record("start"));
      utterance.addEventListener("end", () => record("end"));
      utterance.addEventListener("error", event => record(`error:${event.error}`));
      original(utterance);
    };
  });
  await page.route("**/api/tts/vieneu/stream", route => {
    events.push("unexpected-vieneu-request");
    return route.abort();
  });
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: /Mở trợ lý MIA/ })).toBeVisible();
  await expect.poll(() => events.some(event => event.startsWith("speak:")), { timeout: 15_000 }).toBe(true);
  expect(events.find(event => event.startsWith("speak:"))).toMatch(/^speak:.*:vi-VN:/);
  await expect.poll(() => events.includes("end") || events.some(event => event.startsWith("error:")), { timeout: 15_000 }).toBe(true);
  console.log("Edge speech trace:", events);
  expect(events).not.toContain("unexpected-vieneu-request");
});
