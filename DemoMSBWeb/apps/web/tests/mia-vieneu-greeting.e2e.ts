import { test, expect } from "@playwright/test";

test("VieNeu greeting plays after login in Chrome", async ({ page }) => {
  const events: string[] = [];
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    class TrackedAudioContext extends Native {
      override createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          window.dispatchEvent(new CustomEvent("mia-audio-debug", { detail: `start:${this.state}:${navigator.userActivation.isActive}` }));
          start(...args);
        };
        source.addEventListener("ended", () => window.dispatchEvent(new CustomEvent("mia-audio-debug", { detail: "ended" })));
        return source;
      }
      override resume() {
        window.dispatchEvent(new CustomEvent("mia-audio-debug", { detail: `resume:${this.state}:${navigator.userActivation.isActive}` }));
        return super.resume();
      }
      override decodeAudioData(data: ArrayBuffer) {
        window.dispatchEvent(new CustomEvent("mia-audio-debug", { detail: `decode:${data.byteLength}` }));
        return super.decodeAudioData(data);
      }
    }
    window.AudioContext = TrackedAudioContext;
  });
  await page.exposeFunction("recordAudioDebug", (event: string) => events.push(event));
  await page.addInitScript(() => window.addEventListener("mia-audio-debug", event => {
    void (window as unknown as { recordAudioDebug: (message: string) => void }).recordAudioDebug((event as CustomEvent<string>).detail);
  }));
  await page.route("**/api/tts/vieneu/stream", async route => {
    events.push(`tts:${route.request().postDataJSON().gender}`);
    if (process.env.MIA_E2E_LIVE_TTS === "true") { await route.continue(); return; }
    const samples = 24_000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24_000) * 1000), 44 + i * 2);
    await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("button", { name: /Mở trợ lý MIA/ })).toBeVisible();
  await expect.poll(() => events, { timeout: 15_000 }).toContain("tts:Nam");
  await expect.poll(() => events.some(event => event.startsWith("decode:")), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => events.some(event => event.startsWith("start:")), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => events).toContain("ended");
  console.log("Audio trace:", events);
});

test("Chrome uses browser speech when VieNeu flag is disabled", async ({ page }) => {
  const events: string[] = [];
  await page.exposeFunction("recordChromeSpeech", (event: string) => events.push(event));
  await page.addInitScript(() => {
    const synth = window.speechSynthesis;
    const original = synth.speak.bind(synth);
    synth.speak = utterance => {
      void (window as unknown as { recordChromeSpeech: (event: string) => void }).recordChromeSpeech("browser-speak");
      utterance.addEventListener("end", () => void (window as unknown as { recordChromeSpeech: (event: string) => void }).recordChromeSpeech("browser-end"));
      original(utterance);
    };
  });
  await page.route("**/readyz", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.vieneuTts = { ...data.vieneuTts, enabled: false, ready: false };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/tts/vieneu/stream", route => {
    events.push("unexpected-vieneu-request");
    return route.abort();
  });
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("so");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect.poll(() => events, { timeout: 15_000 }).toContain("browser-speak");
  await expect.poll(() => events, { timeout: 15_000 }).toContain("browser-end");
  expect(events).not.toContain("unexpected-vieneu-request");
});

test("Ly sends the female branch to the VieNeu proxy", async ({ page }) => {
  const genders: string[] = [];
  await page.route("**/api/tts/vieneu/stream", route => {
    genders.push(route.request().postDataJSON().gender);
    return route.abort();
  });
  await page.goto("/");
  await page.getByPlaceholder("Nhập tên đăng nhập").fill("ly");
  await page.getByPlaceholder("Nhập mật khẩu").fill("demo");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect.poll(() => genders, { timeout: 15_000 }).toContain("Nữ");
});
