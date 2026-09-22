import React, { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { CONTRACT_VERSION, isBridgeEnvelope, isContextSnapshot, type ContextSnapshot } from "@mia/contracts";
import "./styles.css";
import "./liquid-glass.css";

import { SupportHandoff } from "./SupportHandoff";
import { ScrollArea } from "./ScrollArea";
import { ScenarioRuntime, type ScenarioAnswer as Answer } from "./scenario-runtime";
const params = new URLSearchParams(location.search);
const sessionId = params.get("sessionId") ?? "";
const hostOrigin = params.get("hostOrigin") ?? "";
const nativeBridge = (window as unknown as { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;

function sendHost(envelope: object) {
  if (nativeBridge) nativeBridge.postMessage(JSON.stringify(envelope));
  else window.parent.postMessage(envelope, hostOrigin);
}

function parseSse(body: string): Answer {
  const block = body.split("\n\n").find((item) => item.includes("event: response"));
  const line = block?.split(/\r?\n/).find((item) => item.startsWith("data: "));
  if (!line) throw new Error("ADVISORY_RESPONSE_MISSING");
  return JSON.parse(line.slice(6)) as Answer;
}

async function readSse(
  response: Response,
  onToken: (delta: string) => void,
  onModelError: (message: string) => void,
): Promise<Answer> {
  if (!response.body) return parseSse(await response.text());
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Answer | null = null;
  const consume = (block: string) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find(line => line.startsWith("event: "))?.slice(7);
    const data = lines.find(line => line.startsWith("data: "))?.slice(6);
    if (!event || !data) return;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (event === "token" && typeof payload.delta === "string") onToken(payload.delta);
    if (event === "model_error" && typeof payload.message === "string") onModelError(payload.message);
    if (event === "response") result = payload as unknown as Answer;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error("ADVISORY_RESPONSE_MISSING");
  return result;
}

function stepText(step: Answer["steps"][number]) {
  return typeof step === "string" ? step : step.instruction;
}

function lcHeadingClass(step: Answer["steps"][number]) {
  const text = stepText(step);
  if (text === "Thông tin đã bóc tách:") return "mia-lc-section-title mia-lc-section-title-extracted";
  if (text === "Các thông tin cần tiếp tục cung cấp:") return "mia-lc-section-title mia-lc-section-title-missing";
  return undefined;
}

function LcFieldPrompt({ prompt, runtime, busy }: { prompt: NonNullable<Answer["fieldPrompt"]>; runtime: ScenarioRuntime | null; busy: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const choose = (option: string, checked: boolean) => setSelected(current => prompt.kind === "radio" ? [option] : checked ? [...current, option] : current.filter(item => item !== option));
  return <fieldset className="mia-lc-field-prompt">
    <legend>{prompt.label}</legend>
    {prompt.options.map(option => <label key={option}><input type={prompt.kind} name={`lc-${prompt.key}`} checked={selected.includes(option)} onChange={event => choose(option, event.currentTarget.checked)}/><span>{option}</span></label>)}
    <button type="button" disabled={busy || selected.length === 0} onClick={() => void runtime?.submitLcField(prompt.kind === "radio" ? selected[0] : selected)}>Xác nhận lựa chọn</button>
  </fieldset>;
}

function App() {
  const [view, setView] = useState({ todos: [], state: "Idle", status: "Đang kết nối MIA…", answer: null, choices: [], streamedText: "", snapshot: null, busy: false, navigation: null, audioUnavailable: false } as ScenarioRuntime["view"]);
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<Array<{ role: "user" | "assistant"; text: string; separator?: boolean }>>([]);
  const embedded = params.get("embeddedConversation") === "1";
  const previousScreen = useRef<string | null>(null);
  const supportErrorId = useRef<string | null>(null);
  const lastGroupAnswer = useRef<Answer | null>(null);
  const lastGroupNavigation = useRef<ScenarioRuntime["view"]["navigation"]>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation, view.answer, view.navigation, view.streamedText]);
  const [activeGroup, setActiveGroup] = useState("home");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (["other", "interaction"].includes(activeGroup)) input.current?.focus(); }, [activeGroup]);
  const controller = useRef<ScenarioRuntime | null>(null);
  const enabled = params.get("scenarioVersion") === "1.1";
  useEffect(() => {
    if (!enabled || !sessionId || !hostOrigin) return;
    const runtime = new ScenarioRuntime({ sessionId, post: sendHost, readSse, changed: next => {
      if (next.answer?.advisory?.handoffReady && next.snapshot?.error) supportErrorId.current = next.snapshot.error.errorId;
      setView(next);
      const screen = next.snapshot?.context.screenId;
      if (screen && screen !== previousScreen.current) {
        if (previousScreen.current) setConversation(previous => previous.at(-1)?.separator ? previous : [...previous, { role: "assistant", text: "Đã chuyển màn hình", separator: true }]);
        previousScreen.current = screen;
      }
      const groupChanged = next.answer !== lastGroupAnswer.current || next.navigation !== lastGroupNavigation.current;
      lastGroupAnswer.current = next.answer;
      lastGroupNavigation.current = next.navigation;
      if (embedded && groupChanged && (next.answer?.todoList || next.navigation?.todoId || ["credit-information", "documents-management", "password-change"].includes(next.navigation?.screenId ?? ""))) sendHost({ type: "assistant.workspace.group", sessionId, group: "todos" });
    }, utterance: (role, text) => setConversation(previous => [...previous, { role, text }]), conversationGroupChanged: () => setConversation([]) });
    controller.current = runtime;
    const receive = (event: MessageEvent) => {
      if (!nativeBridge && (event.origin !== hostOrigin || event.source !== window.parent)) return;
      let value: unknown = event.data;
      if (typeof value === "string") { try { value = JSON.parse(value); } catch { return; } }
      if ((value as { type?: string })?.type === "host.interaction.home") setActiveGroup("home");
      if ((value as { type?: string })?.type === "host.menu.selected") setActiveGroup("interaction");
      runtime.receive(value);
    };
    window.addEventListener("message", receive);
    document.addEventListener("message", receive as EventListener);
    runtime.start();
    return () => { runtime.dispose(); controller.current = null; window.removeEventListener("message", receive); document.removeEventListener("message", receive as EventListener); };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    void controller.current?.send(message);
    if (!view.busy) setMessage("");
  };
  const faces: Record<string, string> = { Idle: "•ᴗ•", Listening: "◉‿◉ 🎙", Thinking: "•︵• …", Working: "•̀ᴗ•́ ⚙", Done: "ᵔᴗᵔ ✓" };
  const answer = view.answer;
  const currentAnswerTurn = answer
    ? [answer.text ?? answer.errorSummary ?? "", ...answer.steps.map(step => typeof step === "string" ? step : step.instruction)].join("\n")
    : null;
  useEffect(() => { setActiveGroup(view.snapshot?.context.screenId === "home" ? "home" : "context"); }, [view.snapshot?.context.screenId]);
  if (!enabled) return <LegacyApp/>;
  const display = (text: string) => text.replace(/\bMIA\b/gi, "MIA").replace(/quý khách|\bbạn\b/gi, view.recipient?.address ?? "anh/chị");
  if (embedded) return <main className="mia-embedded-conversation" aria-label="Khung trao đổi">
    <div className="mia-transcript" ref={transcript} role="log" aria-live="polite">
      {!conversation.length && <p className="mia-chat-empty">Trao đổi với MIA bằng cách nhập hoặc nói.</p>}
      {conversation.map((turn, index) => {
        if (index === conversation.length - 1 && turn.role === "assistant" && turn.text === currentAnswerTurn) return null;
        return turn.separator ? <hr className="mia-screen-divider" key={index} aria-label="Đã chuyển màn hình"/> : <p className={`mia-turn mia-turn-${turn.role}`} key={index}><span className="mia-turn-content"><b>{turn.role === "user" ? (view.recipient?.address ?? "anh/chị") : "MIA"}:</b> {display(turn.text)}</span></p>;
      })}
      {view.streamedText && <p className="mia-turn mia-turn-assistant"><span className="mia-turn-content">{display(view.streamedText)}</span></p>}
      {view.navigation && <div className="confirmation" role="region" aria-label="Xác nhận điều hướng"><p>{display(answer?.text ?? answer?.errorSummary ?? "")}</p><button disabled={view.busy} onClick={() => void controller.current?.confirm()}>{view.navigation.todoId ? "Mở ngay" : "Đúng rồi"}</button><button disabled={view.busy} onClick={() => controller.current?.dismiss()}>{view.navigation.todoId ? "Để sau" : "Bỏ qua"}</button></div>}
      {answer && !view.navigation && <div className="mia-embedded-answer"><h2>{display(answer.text ?? answer.errorSummary ?? "")}</h2>{answer.steps.length > 0 && <ol>{answer.steps.map((step, index) => <li className={lcHeadingClass(step)} key={index}>{display(stepText(step))}</li>)}</ol>}</div>}
      {answer?.attachmentRequest && <label className="mia-file-upload"><input type="file" accept={answer.attachmentRequest.accept} disabled={view.busy} onChange={event => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void controller.current?.uploadPo(file).finally(() => { input.value = ""; }); }}/><span>{answer.attachmentRequest.label}</span></label>}
      {answer?.fieldPrompt && <LcFieldPrompt key={answer.fieldPrompt.key} prompt={answer.fieldPrompt} runtime={controller.current} busy={view.busy}/>}
      {!view.navigation && <div className="suggestions mia-answer-actions">{answer?.suggestions.filter(choice => !["todos", "offering", "guide", "other"].includes(choice.id)).map(choice => <button key={choice.id} disabled={view.busy} onClick={() => void controller.current?.send(choice.label, choice.actionId)}>{display(choice.label)}</button>)}</div>}
      {supportErrorId.current && view.snapshot?.error?.errorId === supportErrorId.current && <SupportHandoff key={supportErrorId.current} runtime={controller.current} errorId={supportErrorId.current} onDismiss={() => controller.current?.dismiss()}/>}
      {view.busy && <small role="status">{view.state === "Listening" ? "Đang nghe…" : display(view.status)}</small>}
      {!view.busy && !view.status.includes("sẵn sàng hỗ trợ") && <small role="status">{display(view.status)}</small>}
    </div>
    <form onSubmit={submit}><input ref={input} aria-label="Câu hỏi cho MIA" placeholder="Nhập yêu cầu…" value={message} onChange={event => setMessage(event.target.value)}/><button aria-disabled={view.busy}>Gửi</button></form>
  </main>;
  return <main><header><b><span role="img" aria-label={view.state}>{faces[view.state]}</span> MIA</b><button className="mia-home" onClick={() => { controller.current?.home(); setActiveGroup("home"); }}>⌂ Home</button><small role="status">{view.status}</small></header><ScrollArea resetKey={view.answer}><section>
    {view.snapshot?.error && <div className="error"><small>Lỗi hiện tại</small><strong>{view.snapshot.error.errorCode}</strong></div>}
    <div className="suggestions mia-group-menu" hidden={!["home", "context"].includes(activeGroup) || !!view.navigation}>{view.choices.filter(choice => !["guide", "other"].includes(choice.id)).filter(choice => activeGroup === "home" || ["error", "guide", "other"].includes(choice.id)).map(choice => <button key={choice.id} disabled={view.busy} onClick={() => { setActiveGroup(choice.id); void controller.current?.send(choice.label, choice.actionId); }}>{choice.label}</button>)}</div>
    {answer?.advisory && <small className="mia-advisory-stage">{answer.advisory.level === 1 ? "Hướng dẫn xử lý lỗi" : answer.advisory.level === 2 ? `Trao đổi thêm ${answer.advisory.turns}/3` : "Tiếp nhận hỗ trợ"}</small>}
    {answer && !view.navigation && <article><h2>{answer.text ?? answer.errorSummary}</h2><ol>{answer.steps.map((step, index) => <li className={lcHeadingClass(step)} key={index}>{stepText(step)}</li>)}</ol>
    {answer.todoList && <div className="mia-todo-list">{answer.todoList.map(todo => <button className="mia-todo-item" key={todo.id} disabled={view.busy} onClick={() => void controller.current?.send("Xem công việc", "todo:" + todo.id)}><span aria-hidden="true">{todo.todoType === "overdue-loan" ? "↗" : todo.todoType === "document-debt" ? "▤" : "♧"}</span><div><strong>{todo.loanAccount ? `Khoản vay ${todo.loanAccount}` : todo.business ?? (todo.todoType === "password-change" ? "Thay đổi mật khẩu" : todo.id)}</strong><small>{todo.dueDate ? `Hạn xử lý: ${todo.dueDate.split("-").reverse().join("/")}` : todo.todoType}</small></div><span>›</span></button>)}</div>}
    {answer.clarificationQuestion && <p>{answer.clarificationQuestion}</p>}
    {answer.citations.map((citation, index) => <small key={index}>Nguồn: {citation.fileName} · {citation.section}</small>)}
    <div className="suggestions">{answer.suggestions.filter(choice => !["guide", "other"].includes(choice.id)).map(choice => <button key={choice.id} disabled={view.busy} onClick={() => void controller.current?.send(choice.label, choice.actionId)}>{choice.label}</button>)}</div></article>}
    {answer?.attachmentRequest && <label className="mia-file-upload"><input type="file" accept={answer.attachmentRequest.accept} disabled={view.busy} onChange={event => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void controller.current?.uploadPo(file).finally(() => { input.value = ""; }); }}/><span>{answer.attachmentRequest.label}</span></label>}
    {answer?.fieldPrompt && <LcFieldPrompt key={answer.fieldPrompt.key} prompt={answer.fieldPrompt} runtime={controller.current} busy={view.busy}/>}
    {answer?.advisory && answer.advisory.history.length > 1 && <details className="mia-error-history"><summary>Trao đổi trước đó</summary>{answer.advisory.history.slice(0, answer.advisory.level === 3 ? undefined : -1).map((turn, index) => <div key={index}><p><b>{view.recipient?.address ?? "anh/chị"}:</b> {turn.question}</p><p><b>MIA:</b> {turn.answer}</p><ol>{turn.steps.map((step, order) => <li key={order}>{step}</li>)}</ol></div>)}</details>}
    {supportErrorId.current && view.snapshot?.error?.errorId === supportErrorId.current && <SupportHandoff key={supportErrorId.current} runtime={controller.current} errorId={supportErrorId.current} onDismiss={() => controller.current?.dismiss()}/>} 
    {view.streamedText && <article aria-live="polite"><p>{view.streamedText}</p></article>}
    {view.navigation && <div className="confirmation" role="region" aria-label="Xác nhận điều hướng">{answer?.categoryPath && <div className="mia-category-path" aria-label="Danh mục dịch vụ">{answer.categoryPath.map((category, index) => <span key={index}>{index > 0 ? "› " : ""}{category}</span>)}</div>}<p>{answer?.text ?? answer?.errorSummary}</p><button disabled={view.busy} onClick={() => void controller.current?.confirm()}>{view.navigation.todoId ? "Mở ngay" : "Xác nhận"}</button><button onClick={() => controller.current?.dismiss()}>Bỏ qua</button></div>}
  </section></ScrollArea>
  {<nav className="mia-secondary-actions"><button disabled={view.busy} onClick={() => { setActiveGroup("guide"); void controller.current?.send("Hướng dẫn sử dụng", "guide"); }}>Hướng dẫn sử dụng</button><button disabled={view.busy} onClick={() => { setActiveGroup("other"); void controller.current?.send("Yêu cầu khác", "other"); }}>Yêu cầu khác</button></nav>}
  <form onSubmit={submit}><input ref={input} aria-label="Câu hỏi cho MIA" placeholder="Nhập câu hỏi…" value={message} onChange={event => setMessage(event.target.value)}/><button aria-disabled={view.busy}>Gửi</button><button type="button" onClick={() => controller.current?.dismiss()}>Dừng</button></form>
  <button type="button" className="mia-primary-voice" disabled={view.busy} onClick={() => void controller.current?.listen()}>♩ Chạm vào MIA để nói</button>
  <footer className="mia-utilities"><button disabled={view.busy} onClick={() => void controller.current?.replay()}>Đọc lại / bật âm thanh</button><button disabled={view.busy} onClick={() => { if (view.snapshot?.error) void controller.current?.send(message.trim() || "Hướng dẫn rõ hơn cách xử lý lỗi này", "advisory:followup"); else { setActiveGroup("other"); void controller.current?.send("Yêu cầu khác", "other"); } }}>Thử lại / gợi ý khác</button></footer></main>;

}
function LegacyApp() {
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [message, setMessage] = useState("Giải thích lỗi này");
  const [status, setStatus] = useState("Đang kết nối Host…");
  const [busy, setBusy] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const pendingContext = useRef(new Map<string, {
    resolve: (snapshot: ContextSnapshot) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>());

  const requestContext = (reason: "assistant-panel-opened" | "context-missing" | "context-stale") => {
    const requestId = crypto.randomUUID();
    return new Promise<ContextSnapshot>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingContext.current.delete(requestId);
        reject(new Error("CONTEXT_REQUEST_TIMEOUT"));
      }, 3_000);
      pendingContext.current.set(requestId, { resolve, reject, timeout });
      sendHost({ contractVersion: CONTRACT_VERSION, requestId, type: "assistant.context.requested", timestamp: new Date().toISOString(), payload: { sessionId, reason } });
    });
  };

  useEffect(() => {
    if (!sessionId || !hostOrigin) { setStatus("Thiếu sessionId hoặc hostOrigin"); return; }
    const receive = (event: MessageEvent) => {
      if (!nativeBridge && (event.origin !== hostOrigin || event.source !== window.parent)) return;
      let value: unknown = event.data;
      if (nativeBridge && typeof value === "string") { try { value = JSON.parse(value); } catch { return; } }
      if (!isBridgeEnvelope(value)) return;
      if (value.type === "host.context.snapshot" && isContextSnapshot(value.payload)) {
        setSnapshot(value.payload);
        setStatus("Đã nhận ngữ cảnh từ Host");
        const pending = pendingContext.current.get(value.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingContext.current.delete(value.requestId);
          pending.resolve(value.payload);
        }
      }
    };
    window.addEventListener("message", receive);
    sendHost({ contractVersion: CONTRACT_VERSION, requestId: crypto.randomUUID(), type: "assistant.ready", timestamp: new Date().toISOString(), payload: { assistantInstanceId: crypto.randomUUID(), supportedContractVersions: [CONTRACT_VERSION] } });
    void requestContext("assistant-panel-opened").catch(() => setStatus("Không nhận được ngữ cảnh. Hãy thử gửi lại."));
    return () => {
      window.removeEventListener("message", receive);
      for (const pending of pendingContext.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("ASSISTANT_UNMOUNTED"));
      }
      pendingContext.current.clear();
    };
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setAnswer(null);
    setStreamedText("");
    try {
      let currentSnapshot = snapshot;
      const snapshotAge = currentSnapshot ? Date.now() - Date.parse(currentSnapshot.context.capturedAt) : Number.POSITIVE_INFINITY;
      if (!currentSnapshot || snapshotAge > 30_000) {
        setStatus("Đang làm mới ngữ cảnh…");
        try {
          currentSnapshot = await requestContext(currentSnapshot ? "context-stale" : "context-missing");
        } catch (error) {
          if (!currentSnapshot) throw error;
          setStatus("Không làm mới được ngữ cảnh; đang dùng snapshot gần nhất…");
        }
      }
      if (!currentSnapshot) throw new Error("CONTEXT_SNAPSHOT_MISSING");
      setStatus("Đang gửi yêu cầu tới Agent API…");
      const response = await fetch("/api/agent/chat", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({sessionId, message: trimmed, contextSnapshot: currentSnapshot}) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? `HTTP ${response.status}`);
      }
      const nextAnswer = await readSse(
        response,
        delta => {
          setStreamedText(current => current + delta);
          setStatus("Đang làm rõ thêm từ model…");
        },
        setStatus,
      );
      setAnswer(nextAnswer);
      setStreamedText("");
      setStatus(trimmed.toLocaleLowerCase("vi").includes("làm rõ") ? "Đã làm rõ từ model hoặc dữ liệu fallback" : "Đã trả lời từ dữ liệu published");
    } catch (error) {
      setStatus(error instanceof Error && error.message !== "CONTEXT_REQUEST_TIMEOUT" ? error.message : "Không thể lấy ngữ cảnh mới từ Host.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void send(message); };
  return <main><header><b>MIA · Tư vấn mã lỗi</b><small>{status}</small></header><section>{snapshot?.error ? <div className="error"><small>Mã lỗi từ Web Context Adapter · {snapshot.error.source}</small><strong>{snapshot.error.errorCode}</strong></div> : <p>Không có lỗi hiện tại trên màn hình.</p>}{answer && <article><h2>{answer.errorSummary}</h2><ol>{answer.steps.map((step, index) => <li key={index}>{typeof step === "string" ? step : step.instruction}</li>)}</ol>{answer.clarificationQuestion && <p>{answer.clarificationQuestion}</p>}{answer.citations.map((c, index) => <small key={index}>Nguồn: {c.fileName} · {c.section}</small>)}<div className="suggestions">{answer.suggestions.map(suggestion => <button type="button" key={suggestion.id} disabled={busy} onClick={() => void send(suggestion.label)}>{suggestion.label}</button>)}</div></article>}{!answer && streamedText && <article className="streaming"><small>Đang nhận token từ model…</small><p>{streamedText}<span>▍</span></p></article>}</section><form onSubmit={submit}><input value={message} onChange={e => setMessage(e.target.value)} /><button type="submit" disabled={busy}>{busy ? "Đang gửi…" : "Gửi"}</button></form></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
