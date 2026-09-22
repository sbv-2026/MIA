// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVieNeuVoice, createWebVoice, isVieNeuTtsBrowser, type WebVoice } from "./voice";

class Utterance {
  lang = "";
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function voice(name: string, lang = "vi-VN", isDefault = false) {
  return { name, lang, default: isDefault, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

describe("web voice", () => {
  beforeEach(() => {
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  });

  it("selects an explicitly preferred Vietnamese voice", async () => {
    const spoken: Utterance[] = [];
    const synthesis = {
      cancel: vi.fn(),
      getVoices: () => [voice("Vietnamese default", "vi-VN", true), voice("My preferred voice")],
      speak: (utterance: Utterance) => { spoken.push(utterance); utterance.onend?.(); },
    } as unknown as SpeechSynthesis;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });

    const status = await createWebVoice({ preferredVoiceNames: ["My preferred voice"], rate: 0.9, pitch: 1.1 }).speak("MIA xin ch\u00e0o LC v\u00e0 L/C");

    expect(status).toBe("completed");
    expect(spoken[0].voice?.name).toBe("My preferred voice");
    expect(spoken[0].text).toBe("mi a xin ch\u00e0o eo xi v\u00e0 eo xi");
    expect(spoken[0].rate).toBe(0.9);
    expect(spoken[0].pitch).toBe(1.1);
  });

  it("waits for Chrome to publish voices and prefers a natural voice", async () => {
    let available: SpeechSynthesisVoice[] = [];
    let changed: (() => void) | undefined;
    const spoken: Utterance[] = [];
    const synthesis = {
      cancel: vi.fn(),
      getVoices: () => available,
      addEventListener: (_name: string, listener: () => void) => { changed = listener; },
      removeEventListener: vi.fn(),
      speak: (utterance: Utterance) => { spoken.push(utterance); utterance.onend?.(); },
    } as unknown as SpeechSynthesis;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });

    const result = createWebVoice({ voiceLoadTimeoutMs: 1_000 }).speak("Xin ch\u00e0o");
    available = [voice("Vietnamese standard"), voice("Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)")];
    changed?.();

    expect(await result).toBe("completed");
    expect(spoken[0].voice?.name).toContain("HoaiMy");
  });

  it("keeps Edge's previous browser voice selection when Vietnamese voices exist", async () => {
    const spoken: Utterance[] = [];
    const synthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => [voice("Vietnamese first"), voice("Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)")]),
      speak: (utterance: Utterance) => { spoken.push(utterance); utterance.onend?.(); },
    } as unknown as SpeechSynthesis;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });

    expect(await createWebVoice({ voiceSelection: "first-vietnamese" }).speak("Xin chào")).toBe("completed");
    expect(spoken[0].voice?.name).toBe("Vietnamese first");
    expect(spoken[0].lang).toBe("vi-VN");
    expect(synthesis.getVoices).toHaveBeenCalledOnce();
  });

  it("enables VieNeu only for Chrome and Safari, excluding Edge and Firefox", () => {
    expect(isVieNeuTtsBrowser("Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36")).toBe(true);
    expect(isVieNeuTtsBrowser("Mozilla/5.0 Version/18.6 Safari/605.1.15")).toBe(true);
    expect(isVieNeuTtsBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isVieNeuTtsBrowser("Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isVieNeuTtsBrowser("Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe(false);
    expect(isVieNeuTtsBrowser("Mozilla/5.0 Firefox/142.0")).toBe(false);
  });

  it("resumes an interrupted mobile Safari audio context before using VieNeu", async () => {
    const fallback = {
      stop: vi.fn(), unlock: vi.fn(), listen: vi.fn(), speak: vi.fn().mockResolvedValue("completed"),
    } as WebVoice;
    const source = {
      buffer: null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      start: vi.fn(function (this: typeof source) { queueMicrotask(() => this.onended?.()); }),
      stop: vi.fn(),
    };
    const audio = {
      state: "interrupted",
      destination: {},
      resume: vi.fn(function (this: { state: string }) { this.state = "running"; return Promise.resolve(); }),
      decodeAudioData: vi.fn().mockResolvedValue({ length: 1 }),
      createBufferSource: vi.fn(() => source),
    } as unknown as AudioContext;
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([82, 73, 70, 70])));
    const voice = createVieNeuVoice({ endpoint: "/api/tts/vieneu/stream", fallback, fetch: request, audioContext: () => audio });

    expect(await voice.speak("Xin chào")).toBe("completed");
    expect(audio.resume).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(fallback.speak).not.toHaveBeenCalled();
  });

  it("falls back to browser speech when realtime audio cannot start", async () => {
    const fallback = {
      stop: vi.fn(), unlock: vi.fn(), listen: vi.fn(), speak: vi.fn().mockResolvedValue("completed"),
    } as WebVoice;
    const voice = createVieNeuVoice({
      endpoint: "https://assistant.example/api/tts/vieneu/stream",
      fallback,
      fetch: vi.fn(),
      audioContext: () => ({ state: "suspended", resume: vi.fn().mockRejectedValue(new Error("blocked")) }) as unknown as AudioContext,
    });

    expect(await voice.speak("Xin chào")).toBe("completed");
    expect(fallback.speak).toHaveBeenCalledWith("Xin chào");
  });

  it("decodes VieNeu WAV audio and sends the user's gender", async () => {
    const fallback = {
      stop: vi.fn(), unlock: vi.fn(), listen: vi.fn(), speak: vi.fn().mockResolvedValue("completed"),
    } as WebVoice;
    const payload = new Uint8Array([82, 73, 70, 70]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(payload, { status: 200, headers: { "Content-Type": "audio/wav" } }));
    const source = {
      buffer: null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      start: vi.fn(function (this: typeof source) { queueMicrotask(() => this.onended?.()); }),
      stop: vi.fn(),
    };
    const audio = {
      state: "running", currentTime: 0, destination: {}, resume: vi.fn(),
      decodeAudioData: vi.fn().mockResolvedValue({ length: 1, duration: 0.01 }),
      createBufferSource: vi.fn(() => source),
    } as unknown as AudioContext;
    const voice = createVieNeuVoice({
      endpoint: "https://assistant.example/api/tts/vieneu/stream",
      fallback,
      gender: () => "Nữ",
      audioContext: () => audio,
      fetch: fetchMock,
    });

    expect(await voice.speak("Xin chào")).toBe("completed");
    expect(audio.decodeAudioData).toHaveBeenCalledOnce();
    expect(source.start).toHaveBeenCalledOnce();
    expect(fallback.speak).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ text: "Xin chào", gender: "Nữ" });
  });
});

