type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; abort(): void;
};

export type WebVoiceOptions = {
  lang?: string;
  preferredVoiceNames?: readonly string[];
  voiceSelection?: "first-vietnamese" | "preferred";
  rate?: number;
  pitch?: number;
  voiceLoadTimeoutMs?: number;
};

export type VoiceStatus = "completed" | "unavailable" | "cancelled";

export type WebVoice = {
  stop(): void;
  unlock(): void;
  speak(text: string): Promise<VoiceStatus>;
  listen(): Promise<string>;
};

export type VieNeuVoiceOptions = {
  endpoint: string;
  fallback: WebVoice;
  gender?: () => "Nam" | "Nữ" | "Không xác định";
  fetch?: typeof fetch;
  audioContext?: () => AudioContext;
};

const DEFAULT_VOICE_NAMES = [
  "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)",
  "Microsoft HoaiMy",
  "Google Ti\u1ebfng Vi\u1ec7t",
];

function normalized(value: string) { return value.trim().toLocaleLowerCase("vi"); }

function spokenText(text: string) {
  return text
    .replace(/\bMIA\b|M\u00cdA/gi, "mi a")
    .replace(/\bL\s*\/?\s*C\b/gi, "eo xi");
}

function selectVoice(voices: readonly SpeechSynthesisVoice[], lang: string, preferredNames: readonly string[]) {
  const preferred = preferredNames.map(normalized).filter(Boolean);
  return [...voices]
    .filter(voice => voice.lang.toLowerCase().startsWith(lang.split("-")[0].toLowerCase()))
    .map((voice, index) => {
      const name = normalized(voice.name);
      const exactPreference = preferred.indexOf(name);
      const partialPreference = preferred.findIndex(candidate => name.includes(candidate) || candidate.includes(name));
      const score =
        (exactPreference >= 0 ? 10_000 - exactPreference : 0) +
        (partialPreference >= 0 ? 5_000 - partialPreference : 0) +
        (voice.lang.toLowerCase() === lang.toLowerCase() ? 500 : 0) +
        (/natural|neural|online/.test(name) ? 200 : 0) +
        (/hoa.?my/.test(name) ? 100 : 0) +
        (voice.default ? 10 : 0);
      return { voice, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.voice;
}

async function loadVoices(synthesis: SpeechSynthesis, timeoutMs: number) {
  const current = synthesis.getVoices();
  if (current.length || timeoutMs <= 0) return current;
  return await new Promise<SpeechSynthesisVoice[]>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      synthesis.removeEventListener?.("voiceschanged", finish);
      resolve(synthesis.getVoices());
    };
    const timer = setTimeout(finish, timeoutMs);
    synthesis.addEventListener?.("voiceschanged", finish, { once: true });
  });
}

export function createWebVoice(options: WebVoiceOptions = {}): WebVoice {
  let recognition: Recognition | null = null;
  let cancelled: (() => void) | null = null;
  const lang = options.lang?.trim() || "vi-VN";
  const preferredVoiceNames = options.preferredVoiceNames?.length ? options.preferredVoiceNames : DEFAULT_VOICE_NAMES;
  const voiceSelection = options.voiceSelection ?? "preferred";
  const rate = Math.min(2, Math.max(0.5, options.rate ?? 1));
  const pitch = Math.min(2, Math.max(0, options.pitch ?? 1));
  const voiceLoadTimeoutMs = Math.min(2_000, Math.max(0, options.voiceLoadTimeoutMs ?? 500));
  return {
    stop() { cancelled?.(); cancelled = null; recognition?.abort(); recognition = null; window.speechSynthesis?.cancel(); },
    unlock() {},
    speak(text: string): Promise<VoiceStatus> {
      this.stop();
      return new Promise(resolve => {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { resolve("unavailable"); return; }
        const utterance = new SpeechSynthesisUtterance(spokenText(text));
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.pitch = pitch;
        let settled = false;
        const timer = setTimeout(() => finish("unavailable"), 45_000);
        const finish = (status: "completed" | "unavailable" | "cancelled") => {
          if (settled) return; settled = true; clearTimeout(timer); cancelled = null; resolve(status);
        };
        cancelled = () => finish("cancelled");
        utterance.onend = () => finish("completed"); utterance.onerror = () => finish("unavailable");
        if (voiceSelection === "first-vietnamese") {
          try {
            const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith("vi"));
            if (voice) utterance.voice = voice;
            window.speechSynthesis.speak(utterance);
          } catch { finish("unavailable"); }
          return;
        }
        void loadVoices(window.speechSynthesis, voiceLoadTimeoutMs).then(voices => {
          if (settled) return;
          const voice = selectVoice(voices, lang, preferredVoiceNames);
          if (voice) utterance.voice = voice;
          try { window.speechSynthesis.speak(utterance); } catch { finish("unavailable"); }
        }).catch(() => finish("unavailable"));
      });
    },
    listen(): Promise<string> {
      this.stop();
      return new Promise((resolve, reject) => {
        const Constructor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
        if (!Constructor) { reject(new Error("MICROPHONE_UNAVAILABLE")); return; }
        recognition = new Constructor();
        recognition.lang = lang; recognition.interimResults = false; recognition.continuous = false;
        let settled = false;
        const timer = setTimeout(() => finish(), 20_000);
        const finish = (text?: string) => {
          if (settled) return; settled = true; clearTimeout(timer); cancelled = null;
          const current = recognition; recognition = null; current?.abort();
          if (text?.trim()) resolve(text.trim()); else reject(new Error("MICROPHONE_UNAVAILABLE"));
        };
        cancelled = () => finish();
        recognition.onresult = event => finish(event.results[0]?.[0]?.transcript);
        recognition.onerror = () => finish(); recognition.onend = () => finish();
        try { recognition.start(); } catch { finish(); }
      });
    },
  };
}

export function isVieNeuTtsBrowser(userAgent = navigator.userAgent): boolean {
  const chrome = /(?:Chrome|Chromium|CriOS)\//.test(userAgent) && !/(?:Edg|EdgiOS|OPR)\//.test(userAgent);
  const safari = /Safari\//.test(userAgent) && /(?:AppleWebKit|Version)\//.test(userAgent) &&
    !/(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|FxiOS)\//.test(userAgent);
  return chrome || safari;
}

export function createVieNeuVoice(options: VieNeuVoiceOptions): WebVoice {
  const request = options.fetch ?? fetch.bind(globalThis);
  const makeContext = options.audioContext ?? (() => {
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error("AUDIO_CONTEXT_UNAVAILABLE");
    return new Constructor();
  });
  let context: AudioContext | null = null;
  let active: { controller: AbortController; sources: AudioBufferSourceNode[]; cancelled: boolean } | null = null;

  const getContext = () => {
    if (context?.state === "closed") context = null;
    return context ??= makeContext();
  };
  const resumeContext = async () => {
    const audio = getContext();
    // Mobile Safari can expose the non-standard `interrupted` state after the
    // screen/app returns to the foreground. Resume it just like Chrome's
    // `suspended` context so VieNeu remains the selected TTS provider.
    if (audio.state !== "running" && audio.state !== "closed") await audio.resume();
    return audio;
  };
  const stopRemote = () => {
    if (!active) return;
    active.cancelled = true;
    active.controller.abort();
    for (const source of active.sources) {
      try { source.stop(); } catch { /* Source may already have ended. */ }
    }
    active = null;
  };

  return {
    stop() { stopRemote(); options.fallback.stop(); },
    unlock() {
      void resumeContext().catch(() => { /* The browser fallback remains available. */ });
    },
    async speak(text: string): Promise<VoiceStatus> {
      stopRemote();
      options.fallback.stop();
      const current = { controller: new AbortController(), sources: [] as AudioBufferSourceNode[], cancelled: false };
      active = current;
      let started = false;
      try {
        const audio = await resumeContext();
        if (audio.state !== "running") throw new Error("AUDIO_PLAYBACK_BLOCKED");
        const response = await request(options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spokenText(text), gender: options.gender?.() ?? "Không xác định" }),
          signal: current.controller.signal,
          cache: "no-store",
        });
        if (!response.ok || !response.body) throw new Error(`VIENEU_TTS_HTTP_${response.status}`);

        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || current.cancelled) throw new Error("VIENEU_TTS_EMPTY_AUDIO");
        const buffer = await audio.decodeAudioData(bytes);
        if (!buffer.length || current.cancelled) throw new Error("VIENEU_TTS_INVALID_AUDIO");
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        const finished = new Promise<void>(resolve => { source.onended = () => resolve(); });
        current.sources.push(source); source.start(); started = true;
        await finished;
        if (current.cancelled || active !== current) return "cancelled";
        active = null;
        return "completed";
      } catch (error) {
        if (current.cancelled || (error instanceof DOMException && error.name === "AbortError")) return "cancelled";
        for (const source of current.sources) {
          try { source.stop(); } catch { /* Source may already have ended. */ }
        }
        if (active === current) active = null;
        return started ? "unavailable" : options.fallback.speak(text);
      }
    },
    listen() { return options.fallback.listen(); },
  };
}
