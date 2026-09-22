import { useEffect, useMemo, useRef, useState } from "react";
import { createMiaWebContextAdapter, createMiaScenarioHostHandler, createVieNeuVoice, createWebVoice, isVieNeuTtsBrowser, type WebVoice } from "@mia/web-context-adapter";
import { MiaWorkspace, type WorkspaceData, type MenuChoice } from "./MiaWorkspace";
import { scenarioEnvelope, isScenarioEnvelope, type AssistantData, type MiaState, type NavigationTarget, type ScenarioEnvelope, type ScreenContext, type SupportedFeature } from "@mia/contracts";

type AppError = { errorId: string; errorCode: string; scenarioId?: string; field: string | null; title?: string | null; message: string; operation?: string };
type VieNeuTtsCapability = { enabled: boolean; ready: boolean; endpoint: string; provider: "vieneu-cloud" };
type Config = { assistantUrl: string; assistantOrigin: string; contractVersion: string; scenarioContractVersion?: string; enabled?: boolean; vieneuTts?: VieNeuTtsCapability };
const features: SupportedFeature[] = [
  { routeId: "home", screenId: "certificate-of-deposit", name: "Chứng chỉ tiền gửi", aliases: ["chứng chỉ tiền gửi", "tiền gửi và đầu tư"], categoryPath: ["Tài khoản", "Tiền gửi và đầu tư", "Chứng chỉ tiền gửi"] },
  { routeId: "home", screenId: "credit-information", name: "Quản lý thông tin tín dụng", aliases: ["thông tin khoản vay", "thông tin tín dụng"] },
  { routeId: "home", screenId: "documents-management", name: "Quản lý chứng từ", aliases: ["nợ chứng từ"] },
  { routeId: "home", screenId: "password-change", name: "Thay đổi mật khẩu", aliases: ["đổi mật khẩu"] },
  { routeId: "home", screenId: "home", name: "Trang chủ", aliases: ["home"] },
  { routeId: "disbursement", screenId: "disbursement-dashboard", name: "Quản lý giải ngân", aliases: ["danh sách giải ngân"] },
  { routeId: "disbursement", screenId: "domestic-disbursement-create", name: "Tạo yêu cầu giải ngân", aliases: ["tạo giải ngân", "đề nghị giải ngân"] },
  { routeId: "disbursement", screenId: "domestic-disbursement-review", name: "Kết quả giải ngân" },
  { routeId: "home", screenId: "letter-of-credit-issue", name: "Phát hành thư tín dụng", aliases: ["phát hành lc", "phát hành l/c", "mở lc", "thư tín dụng"], categoryPath: ["Tín dụng", "Thư tín dụng (L/C nhập)", "Phát hành thư tín dụng"] },
  { routeId: "transfer", screenId: "single-transfer-create", name: "Chuyển tiền trong nước", aliases: ["chuyển tiền trong nước", "chuyển khoản trong nước"], categoryPath: ["Chuyển khoản & Thanh toán", "Chuyển khoản trong nước", "Chuyển khoản đơn"] },
];
const faces: Record<MiaState, string> = { Idle: "•ᴗ•", Listening: "◉‿◉", Thinking: "•︵•", Working: "•̀ᴗ•́", Done: "ᵔᴗᵔ ✓" };

export function AssistantLauncher({ sessionId, context, currentError, onNavigate, onLcAutofill }: { sessionId: string; context: ScreenContext; currentError: AppError | null; onNavigate: (target: NavigationTarget) => Promise<boolean>; onLcAutofill: (draft: Record<string, string>, missingFields: string[]) => void }) {
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem("mia-muted") === "true"; } catch { return false; } });
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const [errorFocus, setErrorFocus] = useState(!!currentError);
  const [captureHidden, setCaptureHidden] = useState(false);
  useEffect(() => { setErrorFocus(!!currentError); }, [currentError?.errorId]);
  const [group, setGroup] = useState<"home" | "todos" | "transactions" | "offers">("home");
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [menu, setMenu] = useState<MenuChoice[]>([]);
  const [dataError, setDataError] = useState(false);
  const [dataAttempt, setDataAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(!document.hidden);
  const [state, setState] = useState<MiaState>("Idle");
  const [hint, setHint] = useState<string | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const configRef = useRef<Config | null>(null); configRef.current = config;
  const greeted = useRef(false);
  const prompted = useRef(new Set<string>());
  const latest = useRef({ context, currentError, open, active, onNavigate, onLcAutofill });
  latest.current = { context, currentError, open, active, onNavigate, onLcAutofill };
  const ttsGender = useRef<"Nam" | "Nữ" | "Không xác định">("Không xác định");
  // Match the browser-voice behavior of the September 20 GreenNode build.
  const browserVoice = useMemo(() => createWebVoice({ voiceSelection: "first-vietnamese" }), []);
  const selectedVoice = useMemo(() => {
    const currentConfig = config;
    const capability = currentConfig?.vieneuTts;
    if (!currentConfig || !capability?.enabled || !capability.ready || !isVieNeuTtsBrowser()) return browserVoice;
    return createVieNeuVoice({ endpoint: new URL(capability.endpoint, currentConfig.assistantOrigin).toString(), fallback: browserVoice, gender: () => ttsGender.current });
  }, [browserVoice, config]);
  const selectedVoiceRef = useRef<WebVoice>(selectedVoice); selectedVoiceRef.current = selectedVoice;
  const voice = useMemo<WebVoice>(() => ({
    stop: () => selectedVoiceRef.current.stop(),
    unlock: () => selectedVoiceRef.current.unlock(),
    speak: text => selectedVoiceRef.current.speak(text),
    listen: () => selectedVoiceRef.current.listen(),
  }), []);
  useEffect(() => () => selectedVoice.stop(), [selectedVoice]);
  const adapter = useMemo(() => createMiaWebContextAdapter({
    sessionId,
    contextProvider: () => {
      const { context, currentError } = latest.current;
      return { ...context, capturedAt: new Date().toISOString(), ...(currentError ? { screenState: "error" as const, lastErrorId: currentError.errorId, errorCode: currentError.errorCode, lastOperation: currentError.operation ?? "disbursement.domestic.submit" } : {}) };
    },
    dom: { errorSelector: '[data-agent-field="error-code"]', operationSelector: '[data-agent-field="operation"]' },
  }), [sessionId]);
  const handler = useMemo(() => createMiaScenarioHostHandler({
    sessionId, features,
    runtime: () => ({ contextKey: latest.current.context.screenId + "|" + (latest.current.currentError?.errorId ?? ""), panelOpen: latest.current.open, active: latest.current.active, greeted: greeted.current, promptedErrors: [...prompted.current] }),
    data: async () => {
      const response = await fetch("/api/host/assistant-data/" + encodeURIComponent(sessionId), { cache: "no-store" });
      if (!response.ok) throw new Error("ASSISTANT_DATA_UNAVAILABLE");
      const data = await response.json() as AssistantData;
      ttsGender.current = data.recipient.pronoun === "anh" ? "Nam" : data.recipient.pronoun === "chị" ? "Nữ" : "Không xác định";
      return data;
    },
    navigate: async target => { const result = await latest.current.onNavigate(target); if (result) setOpen(false); return result; },
    speak: text => mutedRef.current ? Promise.resolve("completed" as const) : voice.speak(text.replace(/\bMIA\b/gi, "mi a")), stopSpeech: () => voice.stop(), listen: () => voice.listen(),
    onState: setState, onHint: setHint, onGreeting: () => { greeted.current = true; }, onErrorPrompted: id => { prompted.current.add(id); },
  }), [sessionId, voice]);
  const post = (value: ScenarioEnvelope) => { if (config) iframe.current?.contentWindow?.postMessage(value, config.assistantOrigin); };

  useEffect(() => {
    const controller = new AbortController();
    setAssistantError(null); setReady(false); setConfig(null); setLoaded(false);
    void fetch("/api/config/assistant", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Không thể tải cấu hình MIA.");
      const candidate = await response.json() as Config;
      if (candidate.contractVersion !== "1.0" || new URL(candidate.assistantUrl).origin !== candidate.assistantOrigin) throw new Error("Cấu hình MIA không tương thích.");
      const readiness = await fetch(new URL("/readyz", candidate.assistantOrigin), { signal: controller.signal });
      if (!readiness.ok) throw new Error("MIA chưa sẵn sàng.");
      const info = await readiness.json() as { contractVersion: string; scenarioContractVersion?: string; vieneuTts?: VieNeuTtsCapability };
      if (info.contractVersion !== candidate.contractVersion || candidate.enabled !== false && candidate.scenarioContractVersion && info.scenarioContractVersion !== candidate.scenarioContractVersion) throw new Error("Phiên bản MIA không tương thích.");
      setConfig({ ...candidate, vieneuTts: info.vieneuTts });
    }).catch(error => { if (!controller.signal.aborted) setAssistantError(error instanceof TypeError ? "Không thể kết nối MIA." : error instanceof Error ? error.message : "Không thể kết nối MIA."); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const visibility = () => { setActive(!document.hidden); if (document.hidden) { voice.stop(); setHint(null); } };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [voice]);
  useEffect(() => {
    if (!config || !iframe.current?.contentWindow) return;
    const detach = adapter.attachBridge({ assistantWindow: iframe.current.contentWindow, allowedOrigin: config.assistantOrigin });
    const receive = (event: MessageEvent) => {
      if (event.origin !== config.assistantOrigin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "assistant.capture.visibility" && event.data.sessionId === sessionId) {
        setCaptureHidden(event.data.hidden === true);
        requestAnimationFrame(() => requestAnimationFrame(() => iframe.current?.contentWindow?.postMessage({ type: "host.capture.visibility", requestId: event.data.requestId }, config.assistantOrigin)));
        return;
      }
      if (event.data?.type === "assistant.workspace.error" && event.data.sessionId === sessionId && latest.current.currentError) { setErrorFocus(true); setGroup("home"); }
      if (event.data?.type === "assistant.workspace.support-available" && event.data.sessionId === sessionId) {
        const available = event.data.available === true;
        setMenu(items => items.map(item => item.id === "other" ? { ...item, label: available ? "Gửi lỗi tới MSB" : "Yêu cầu khác", actionId: available ? "advisory:handoff" : "other" } : item));
      }
      if (event.data?.type === "assistant.workspace.group" && event.data.sessionId === sessionId && ["todos", "offers"].includes(event.data.group)) setGroup(event.data.group);
      if (event.data?.type === "assistant.lc.autofill" && event.data.sessionId === sessionId && event.data.draft && typeof event.data.draft === "object") {
        const draft = event.data.draft as Record<string, string>; const missingFields = Array.isArray(event.data.missingFields) ? event.data.missingFields.filter((item: unknown): item is string => typeof item === "string") : [];
        latest.current.onLcAutofill(draft, missingFields);
        setOpen(false);
        void fetch(`/api/host/lc-draft/${encodeURIComponent(sessionId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: draft, missingFields }) })
          .then(response => { if (!response.ok) throw new Error("LC_DRAFT_REJECTED"); })
          .catch(() => setAssistantError("Dữ liệu L/C đã được điền trên màn hình nhưng chưa thể lưu bản nháp."));
        return;
      }
      if (event.data?.type === "assistant.direct.navigate" && event.data.sessionId === sessionId && typeof event.data.screenId === "string") {
        const target = features.find(item => item.screenId === event.data.screenId);
        if (target) void latest.current.onNavigate(target).then(done => { if (done) setOpen(false); });
        return;
      }
      if (event.data?.type === "assistant.ready" && event.data?.contractVersion === "1.0") {
        setReady(true);
        // Runtime updates emitted before the iframe listener is mounted are not
        // replayed by postMessage. Re-publish the current context on the ready
        // handshake so errors (including guarantee popups) are always detected
        // and spoken without requiring an explicit user request.
        if (config.enabled !== false && config.scenarioContractVersion === "1.1") queueMicrotask(() => handler.update(post));
      }
      if (isScenarioEnvelope(event.data) && event.data.type === "assistant.support.requested" && event.data.payload.sessionId === sessionId) {
        const value = event.data;
        void (async () => {
          try {
            const profile = value.payload.kind === "profile";
            const { kind, sessionId: ignored, ...submission } = value.payload;
            const response = await fetch(`/api/host/${profile ? "support-profile" : "support"}/${encodeURIComponent(sessionId)}`, profile ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...submission, screenUrl: window.location.href }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail ?? "Không thể gửi hỗ trợ");
            post(scenarioEnvelope("host.support.result", { sessionId, ...(profile ? { profile: result } : { result }) }, value.requestId));
          } catch (error) { post(scenarioEnvelope("host.support.result", { sessionId, error: error instanceof Error ? error.message : "Không thể gửi hỗ trợ" }, value.requestId)); }
        })();
        return;
      }
      if (config.enabled !== false && config.scenarioContractVersion === "1.1" && isScenarioEnvelope(event.data)) void handler.receive(event.data, post);
    };
    window.addEventListener("message", receive);
    return () => { detach(); window.removeEventListener("message", receive); };
  }, [config, loaded, adapter, handler]);
  useEffect(() => {
    let cancelled = false;
    const synchronize = async () => {
    if (currentError) {
      const now = new Date().toISOString();
      adapter.reportPresentedError({ errorId: currentError.errorId, errorCode: currentError.errorCode, operation: currentError.operation ?? "disbursement.domestic.submit", screenId: context.screenId, field: currentError.field, kind: currentError.field ? "inline" : "popup", occurredAt: now, observedAt: now, source: "host-provider" });
        await fetch(`/api/host/context/${encodeURIComponent(sessionId)}/error`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            errorId: currentError.errorId,
            errorCode: currentError.errorCode,
            scenarioId: currentError.scenarioId ?? currentError.errorId,
            operation: currentError.operation ?? "disbursement.domestic.submit",
            field: currentError.field,
            title: currentError.title ?? null,
            message: currentError.message,
          }),
        });
      } else {
        adapter.resolveError();
        await fetch(`/api/host/context/${encodeURIComponent(sessionId)}/error`, { method: "DELETE" });
      }
      if (!cancelled && config?.scenarioContractVersion === "1.1" && config.enabled !== false) handler.update(post);
    };
    setHint(null); voice.stop();
    void synchronize().catch(() => {
      if (!cancelled && config?.scenarioContractVersion === "1.1" && config.enabled !== false) handler.update(post);
    });
    return () => { cancelled = true; };
  }, [context.screenId, currentError?.errorId, open, active, config]);
  useEffect(() => () => {
    const candidate = configRef.current;
    const { context, currentError } = latest.current;
    const now = new Date().toISOString();
    const error = currentError ? { errorId: currentError.errorId, errorCode: currentError.errorCode, operation: currentError.operation ?? "disbursement.domestic.submit", screenId: context.screenId, field: currentError.field, kind: currentError.field ? "inline" : "popup", occurredAt: now, observedAt: now, source: "host-provider" } : null;
    const snapshot = { context: { ...context, capturedAt: now, ...(error ? { screenState: "error", lastErrorId: error.errorId, errorCode: error.errorCode, lastOperation: error.operation } : {}) }, error };
    if (candidate) void fetch(new URL("/api/agent/session/clear", candidate.assistantOrigin), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message: "Kết thúc phiên", contextSnapshot: snapshot }), keepalive: true }).catch(() => {});
    handler.dispose(); adapter.destroy(); voice.stop();
  }, [handler, adapter, voice]);
  useEffect(() => {
    if (!open || !config || (workspaceData && !currentError && dataAttempt === 0)) return;
    const controller = new AbortController();
    setDataError(false);

    void (async () => {
      const [details, data, snapshot] = await Promise.all([
        fetch(`/api/host/assistant-data/${encodeURIComponent(sessionId)}?details=true`, { signal: controller.signal, cache: "no-store" }),
        fetch(`/api/host/assistant-data/${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: "no-store" }),
        adapter.capture(),
      ]);
      if (!details.ok || !data.ok) throw new Error("DATA_UNAVAILABLE");
      const workspace = await details.json() as WorkspaceData;
      const response = await fetch(new URL("/api/agent/bootstrap", config.assistantOrigin), {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ sessionId, contextSnapshot: snapshot, assistantData: await data.json(), features, message: "Mở MIA" }),
      });
      if (!response.ok) throw new Error("SCENARIO_UNAVAILABLE");
      const result = await response.json() as { suggestions: MenuChoice[] };
      if (!controller.signal.aborted) { setWorkspaceData(workspace); setMenu(result.suggestions); }
    })().catch(() => { if (!controller.signal.aborted) setDataError(true); });
    return () => controller.abort();
  }, [open, sessionId, dataAttempt, config, context.screenId, currentError?.errorId, adapter]);
  const selectAction = (actionId: string) => {
    if (actionId.startsWith("direct:navigate:")) {
      const screenId = actionId.slice("direct:navigate:".length); const target = features.find(item => item.screenId === screenId);
      if (target) void latest.current.onNavigate(target).then(done => { if (done) setOpen(false); });
      return;
    }
    if (actionId === "error" || actionId === "advisory:explain") {
      if (!latest.current.currentError) return;
      actionId = "advisory:explain"; setErrorFocus(true); setGroup("home");
    }
    voice.stop();
    post(scenarioEnvelope("host.menu.selected", { sessionId, actionId }));
  };
  const extension = config?.enabled !== false && config?.scenarioContractVersion === "1.1";
  const source = config ? config.assistantUrl + "?sessionId=" + encodeURIComponent(sessionId) + "&hostOrigin=" + encodeURIComponent(window.location.origin) + (extension ? "&scenarioVersion=1.1&embeddedConversation=1" : "") : null;
  return <div className={captureHidden ? "mia-capture-hidden" : undefined}>
    {hint && !open && <div className="mia-greeting" role="status">{hint.replace(/\bMIA\b/g, "MIA")}</div>}
    <button type="button" className="assistant-bubble mia-state-bubble" data-connection={assistantError ? "error" : ready ? "connected" : "connecting"} onClick={() => { voice.unlock(); voice.stop(); setHint(null); setOpen(value => !value); }} aria-label={"Mở trợ lý MIA. " + state}><span role="img" aria-label={state}>{faces[state]}</span><small>MIA</small>{currentError && <b>!</b>}</button>
    {assistantError && !open && <div className="mia-greeting">{assistantError}<button onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
    <aside className="assistant-panel assistant-frame-panel mia-runtime-panel" data-open={open} aria-hidden={!open}>
      <div className="mia-glass-header"><strong aria-label="MIA">MIA <small>MIA · Trợ lý của bạn</small></strong>{<button onClick={() => { voice.stop(); setErrorFocus(false); setGroup("home"); post(scenarioEnvelope("host.interaction.home", { sessionId })); }} aria-label="Trang chủ tương tác MIA">⌂ Trang chủ</button>}</div>
      <MiaWorkspace group={group} setGroup={setGroup} data={workspaceData} menu={currentError ? [...menu.filter(item => item.id !== "error"), { id: "error", label: "Hỗ trợ xử lý lỗi", actionId: "advisory:explain" }] : menu.filter(item => item.id !== "error")} screenError={errorFocus ? currentError : null} muted={muted} onToggleMute={() => { const next = !mutedRef.current; mutedRef.current = next; setMuted(next); if (next) voice.stop(); else voice.unlock(); try { localStorage.setItem("mia-muted", String(next)); } catch { /* Storage may be disabled. */ } }} ready={ready} onAction={selectAction} error={dataError} retry={() => setDataAttempt(value => value + 1)} onSelectTodo={todo => { post(scenarioEnvelope("host.todo.selected", { sessionId, todoId: todo.todolistID })); }} onListen={() => { post(scenarioEnvelope("host.voice.start", { sessionId })); }} conversation={<div className="mia-chat-frame mia-conversation-frame">{source ? <iframe ref={iframe} onLoad={() => setLoaded(true)} src={source} title="MIA Assistant" allow="autoplay; microphone; display-capture" sandbox="allow-forms allow-scripts allow-same-origin"/> : <div className="assistant-frame-status">{assistantError ?? "Đang kết nối MIA…"}<button onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}</div>}/>
      <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Đóng MIA">×</button>
    </aside>
  </div>;
}
