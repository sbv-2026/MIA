import { isAssistantData, isBridgeEnvelope, isContextSnapshot, isScenarioEnvelope, scenarioEnvelope, type AssistantTodo, type AssistantData, type ContextSnapshot, type MiaState, type NavigationTarget, type ScenarioEnvelope, type SupportedFeature } from "@mia/contracts";

export type Choice = { id: string; label: string; actionId?: string; action?: string; routeId?: string };
export type ScenarioAnswer = {
  advisory?: { level: 1 | 2 | 3; errorCode: string; description: string; publishedSteps: string[]; turns: number; limit: number; handoffReady?: boolean; handoffOffered?: boolean; history: Array<{ question: string; answer: string; steps: string[] }> };
  text?: string; errorSummary?: string; speechText: string;
  steps: Array<string | { order: number; instruction: string }>;
  suggestions: Choice[]; clarificationQuestion?: string | null;
  citations: Array<{ fileName: string; section: string | null }>;
  navigation?: NavigationTarget; categoryPath?: string[]; reasoning?: { provider: string; model: string }; todoList?: AssistantTodo[];
  attachmentRequest?: { accept: string; label: string }; extractedData?: Record<string, string>; missingFields?: string[];
  fieldPrompt?: { key: string; label: string; kind: "radio" | "checkbox"; options: string[] };
};
type Runtime = { sessionId: string; contextKey: string; panelOpen: boolean; active: boolean; greeted: boolean; promptedErrors: string[]; features: SupportedFeature[] };
type Utterance = { kind: string; text: string; delayMs: number; hideAfterMs: number | null };
type View = { recipient?: { address: string; pronoun: string }; todos: AssistantTodo[]; state: MiaState; status: string; answer: ScenarioAnswer | null; choices: Choice[]; streamedText: string; snapshot: ContextSnapshot | null; busy: boolean; navigation: NavigationTarget | null; audioUnavailable: boolean };
type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; type: string };
type ConversationGroup = "home" | "error" | "todos" | "transactions" | "offering";
type Options = { sessionId: string; post: (value: object) => void; readSse: (response: Response, onToken: (delta: string) => void, onError: (message: string) => void) => Promise<ScenarioAnswer>; changed: (view: View) => void; utterance?: (role: "user" | "assistant", text: string) => void; conversationGroupChanged?: (group: ConversationGroup) => void };

export class ScenarioRuntime {
  view: View = { todos: [], state: "Idle", status: "Đang kết nối MIA…", answer: null, choices: [], streamedText: "", snapshot: null, busy: false, navigation: null, audioUnavailable: false };
  readonly supportDrafts = new Map<string, Record<string, unknown>>();
  private runtime: Runtime | null = null;
  private data: AssistantData | null = null;
  private pending = new Map<string, Pending>();
  private epoch = 0;
  private abort: AbortController | null = null;
  private greeted = false;
  private errors = new Set<string>();
  private seen = new Set<string>();
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private lastSpeech = "";
  private otherRequest = false;
  private advisoryMode = false;
  private lcStage: "idle" | "type" | "mode" | "upload" | "continue" | "missing" | "confirm-field" | "done" = "idle";
  private lcDraft: Record<string, string> = {};
  private lcMissing: string[] = [];
  private lcLabels: Record<string, string> = {};
  private lcDefinitions: Record<string, { key: string; label: string; kind?: string; options?: string[] }> = {};
  private lcSkipFieldConfirmation = false;
  private lcHasConfirmedField = false;
  private conversationGroup: ConversationGroup = "home";
  private emotionPhrases = ["buc minh", "buc qua", "kho chiu", "tuc gian", "cau gat", "gian du", "that vong", "qua te", "lom", "cui bap", "chan qua", "vo ly", "mat thoi gian", "khong hai long", "khong chap nhan", "lam an"];
  private disposed = false;
  constructor(private options: Options) {}
  private patch(value: Partial<View>) {
    if (value.answer && value.answer !== this.view.answer) {
      this.options.utterance?.("assistant", [value.answer.text ?? value.answer.errorSummary ?? "", ...value.answer.steps.map(step => typeof step === "string" ? step : step.instruction)].join("\n"));
    }
    this.view = { ...this.view, ...value }; this.options.changed(this.view);
  }
  private state(state: MiaState) {
    this.patch({ state });
    this.post("assistant.state.changed", { state });
  }
  private post(type: ScenarioEnvelope["type"], payload: Record<string, unknown> = {}) {
    this.options.post(scenarioEnvelope(type, { sessionId: this.options.sessionId, ...payload }));
  }
  start() {
    this.options.post({ contractVersion: "1.0", requestId: crypto.randomUUID(), type: "assistant.ready", timestamp: new Date().toISOString(), payload: { assistantInstanceId: crypto.randomUUID(), supportedContractVersions: ["1.0"] } });
    this.post("assistant.scenario.ready");
  }
  receive(value: unknown) {
    if (isBridgeEnvelope(value) && value.type === "host.context.snapshot" && isContextSnapshot(value.payload)) {
      if (value.payload.context.sessionId !== this.options.sessionId) return;
      const pending = this.pending.get(value.requestId);
      if (!pending || pending.type !== "host.context.snapshot") return;
      this.finish(value.requestId, { snapshot: value.payload }); return;
    }
    if (!isScenarioEnvelope(value) || value.payload.sessionId !== this.options.sessionId) return;
    const age = Date.now() - Date.parse(value.timestamp);
    if (age > 300_000 || age < -60_000 || this.seen.has(value.requestId + value.type)) return;
    this.seen.add(value.requestId + value.type);
    if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!);
    if (value.type === "host.runtime.updated") {
      const payload = value.payload as unknown as Runtime;
      if (typeof payload.contextKey !== "string" || typeof payload.panelOpen !== "boolean" || typeof payload.active !== "boolean" || typeof payload.greeted !== "boolean" || !Array.isArray(payload.promptedErrors) || !Array.isArray(payload.features)) return;
      const previous = this.runtime;
      this.runtime = payload;
      this.greeted ||= payload.greeted;
      payload.promptedErrors.forEach(id => this.errors.add(id));
      if (previous?.contextKey !== payload.contextKey || previous?.panelOpen !== payload.panelOpen || previous?.active !== payload.active) {
        this.cancel();
        const contextChanged = previous?.contextKey !== payload.contextKey;
        const newError = contextChanged && !!payload.contextKey.split("|")[1];
        this.patch({ ...(contextChanged ? { navigation: null } : {}), ...(newError ? { answer: null } : {}), streamedText: "", busy: false });
        if (payload.active) void this.refreshAndBootstrap();
      }
      return;
    }
    if (value.type === "host.voice.start") { void this.listen(); return; }
    if (value.type === "host.interaction.home") { this.home(); return; }
    if (value.type === "host.menu.selected" && typeof value.payload.actionId === "string") {
      if (value.payload.actionId === "replay") { void this.replay(); return; }
      void this.send(value.payload.actionId, value.payload.actionId); return;
    }
    if (value.type === "host.todo.selected" && typeof value.payload.todoId === "string") {
      void this.send("todo", "todo:" + value.payload.todoId); return;
    }
    const pending = this.pending.get(value.requestId);
    if (pending?.type === value.type) this.finish(value.requestId, value.payload);
  }
  private finish(id: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id);
    if (payload.error) pending.reject(new Error(String(payload.error)));
    else pending.resolve(payload);
  }
  private request(type: ScenarioEnvelope["type"], expected: string, payload: Record<string, unknown> = {}, timeout = 5000) {
    const requestId = crypto.randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error("MIA_REQUEST_TIMEOUT")); }, timeout);
      this.pending.set(requestId, { resolve, reject, timer, type: expected });
      this.options.post(scenarioEnvelope(type, { sessionId: this.options.sessionId, ...payload }, requestId));
    });
  }
  private context() {
    const requestId = crypto.randomUUID();
    return new Promise<ContextSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error("CONTEXT_REQUEST_TIMEOUT")); }, 3000);
      this.pending.set(requestId, { resolve: value => resolve(value.snapshot as ContextSnapshot), reject, timer, type: "host.context.snapshot" });
      this.options.post({ contractVersion: "1.0", requestId, type: "assistant.context.requested", timestamp: new Date().toISOString(), payload: { sessionId: this.options.sessionId, reason: "context-missing" } });
    });
  }
  private async refresh() {
    const [snapshot, payload] = await Promise.all([this.context().then(snapshot => { this.patch({ snapshot }); return snapshot; }), this.request("assistant.data.requested", "host.data.snapshot")]);
    if (!isAssistantData(payload.data) || payload.data.sessionId !== this.options.sessionId) throw new Error("ASSISTANT_DATA_INVALID");
    if (this.runtime?.contextKey !== snapshot.context.screenId + "|" + (snapshot.error?.errorId ?? "")) throw new Error("CONTEXT_CHANGED");
    this.data = payload.data;
    this.patch({ snapshot, todos: payload.data.todoList, recipient: payload.data.recipient });
    return snapshot;
  }
  private body(snapshot: ContextSnapshot, actionId?: string, message = "Mở MIA") {
    return { sessionId: this.options.sessionId, contextSnapshot: snapshot, assistantData: this.data, features: this.runtime?.features ?? [], ...(actionId ? { actionId } : {}), message };
  }
  private async refreshAndBootstrap() {
    const epoch = this.epoch;
    this.state("Thinking");
    try {
      const snapshot = await this.refresh();
      if (epoch !== this.epoch || this.disposed) return;
      const response = await fetch("/api/agent/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.body(snapshot)) });
      if (!response.ok) throw new Error("Không thể tải kịch bản MIA. Vui lòng thử lại.");
      const result = await response.json() as { utterances: Utterance[]; suggestions: Choice[]; emotionPhrases?: string[] };
      if (epoch !== this.epoch) return;
      if (Array.isArray(result.emotionPhrases)) {
        this.emotionPhrases = [...new Set([...this.emotionPhrases, ...result.emotionPhrases.map(phrase => this.normalize(phrase)).filter(Boolean)])];
      }
      this.patch({ choices: result.suggestions, status: "MIA sẵn sàng hỗ trợ." });
      const isHome = snapshot.context.screenId === "home";
      const errorId = snapshot.error?.errorId;
      // A presented business error always has priority over the home greeting.
      // This matters when the user triggers an error while the assistant iframe
      // is still starting: greeting first would otherwise consume the bootstrap
      // cycle and the error would never be announced automatically.
      if (errorId && !this.errors.has(errorId)) {
        this.errors.add(errorId); this.post("assistant.error.prompted", { errorId });
        const utterance = result.utterances.find(item => item.kind === "error");
        if (utterance) await this.speak(utterance.text, epoch);
      } else if (isHome && !this.greeted && !this.runtime?.panelOpen) {
        this.greeted = true; this.post("assistant.greeting.started");
        for (const utterance of result.utterances) {
          await this.wait(utterance.delayMs, epoch);
          if (epoch !== this.epoch) return;
          await this.speak(utterance.text, epoch);
          if (epoch !== this.epoch) return;
          if (utterance.hideAfterMs !== null) {
            const timer = setTimeout(() => { this.timers.delete(timer); if (epoch === this.epoch) this.post("assistant.hint.changed", { text: null }); }, utterance.hideAfterMs);
            this.timers.set(timer, () => {});
            if (utterance.kind === "greeting" && result.utterances.some(item => item.kind === "todos")) {
              await this.wait(utterance.hideAfterMs, epoch);
              if (epoch !== this.epoch) return;
            }
          }
        }
      }
      if (epoch === this.epoch) {
        this.state("Idle");
        if (snapshot.error && this.runtime?.panelOpen && !this.view.answer && !this.otherRequest) void this.send("Hướng dẫn xử lý lỗi", "advisory:explain", false);
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error); }
  }
  private wait(ms: number, epoch: number) {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, ms);
      this.timers.set(timer, resolve);
    });
  }
  private async speak(text: string, epoch: number) {
    text = text.replace(/quý khách|\bbạn\b/gi, this.data?.recipient.address ?? "anh/chị");
    this.lastSpeech = text;
    this.post("assistant.hint.changed", { text });
    this.state("Working");
    const result = await this.request("assistant.speech.requested", "host.speech.completed", { text, contextKey: this.runtime?.contextKey }, 60_000);
    if (epoch !== this.epoch) return;
    if (result.status === "unavailable") this.patch({ audioUnavailable: true, status: "Giọng nói chưa khả dụng. Nội dung vẫn hiển thị bằng chữ." });
  }
  cancel() {
    this.epoch++; this.abort?.abort(); this.abort = null;
    this.post("assistant.speech.cancelled");
    this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear();
    for (const [id, pending] of this.pending) {
      // Host may publish the new route before its navigation acknowledgement.
      if (["host.navigation.completed", "host.support.result"].includes(pending.type)) continue;
      clearTimeout(pending.timer); pending.reject(new Error("MIA_CANCELLED")); this.pending.delete(id);
    }
    this.state("Idle");
  }
  private fail(error: unknown) {
    this.patch({ status: error instanceof Error ? error.message : "MIA chưa phản hồi. Vui lòng thử lại.", busy: false });
    this.state("Idle");
  }
  async send(message: string, actionId?: string, logUser = true) {
    if (!message.trim()) return;
    if (this.view.busy) {
      this.patch({ status: "MIA đang xử lý, quý khách vui lòng chờ MIA thực hiện xong." });
      return;
    }
    const normalizedMessage = this.normalize(message);
    if (this.lcStage === "idle" && this.isUpset(normalizedMessage)) {
      await this.localLcAnswer(`MIA thành thật xin lỗi vì trải nghiệm chưa tốt. ${this.recipientPronoun()} muốn MIA tiếp tục hỗ trợ việc đang làm hay điều hướng sang một giao dịch khác?`, this.view.choices.filter(choice => !["guide", "other"].includes(choice.id)), {}, logUser ? message : undefined);
      return;
    }
    const acceptedSpokenOffering = !actionId && !this.view.navigation && !this.view.answer &&
      this.view.snapshot?.context.screenId === "home" && this.lastSpeech.includes("sản phẩm") &&
      ["xac nhan", "dong y", "dung", "dung roi", "vang", "ok", "co", "duoc"].includes(normalizedMessage);
    if (acceptedSpokenOffering) {
      const offering = this.view.choices.find(choice => choice.id === "offering");
      if (offering?.actionId) actionId = offering.actionId;
    }
    if (actionId === "error") actionId = "advisory:explain";
    if (actionId === "advisory:explain") {
      if (!this.view.snapshot?.error) return;
      this.options.post({ type: "assistant.workspace.error", sessionId: this.options.sessionId });
      message = "Hỗ trợ xử lý lỗi";
    }
    const conversationGroup = this.groupForAction(actionId, normalizedMessage);
    if (conversationGroup && conversationGroup !== this.conversationGroup) {
      if (conversationGroup !== "transactions") this.resetLcFlow();
      this.conversationGroup = conversationGroup;
      this.options.conversationGroupChanged?.(conversationGroup);
    }
    if ((actionId === "transaction:lc" || this.lcStage !== "idle") && await this.handleLcInput(message, actionId, normalizedMessage, logUser)) return;
    const spoken = this.normalize(message);
    if (this.view.navigation && !actionId) {
      if (["xac nhan", "dong y", "dung", "dung roi", "vang", "ok", "mo di", "u", "co", "duoc", "dong y mo"].includes(spoken)) { await this.confirm(); return; }
      if (["huy", "khong", "khong dung", "thoi", "de sau", "bo qua"].includes(spoken)) { this.dismiss(); return; }
    }
    if (logUser) this.options.utterance?.("user", actionId?.startsWith("todo:") ? "Xem chi tiết " + ({ "overdue-loan": "khoản vay", "document-debt": "chứng từ", "password-change": "thay đổi mật khẩu" }[this.data?.todoList.find(todo => todo.id === actionId?.slice(5))?.todoType ?? ""] ?? "công việc") : actionId?.startsWith("offering:") ? "Xem đề xuất sản phẩm" : actionId === "other" ? "Yêu cầu khác" : actionId === "guide" ? "Hướng dẫn sử dụng" : message);
    if (actionId) { this.otherRequest = actionId === "other"; this.advisoryMode = actionId.startsWith("advisory:"); }
    if (!actionId && this.advisoryMode && this.view.snapshot?.error) actionId = "advisory:followup";
    if (!actionId && (this.otherRequest || !this.view.snapshot?.error)) actionId = "freeform";
    this.cancel(); const epoch = this.epoch;
    this.patch({ busy: true, navigation: null, answer: null, streamedText: "", status: actionId === "advisory:followup" ? "MIA đang làm rõ hướng dẫn…" : "MIA đang xử lý yêu cầu…" }); this.state("Thinking");
    try {
      const snapshot = await this.refresh();
      if (epoch !== this.epoch) return;
      if (await this.handleTodoIntent(message, actionId, epoch)) return;
      this.abort = new AbortController();
      const response = await fetch("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.body(snapshot, actionId, message)), signal: this.abort.signal });
      if (!response.ok) throw new Error("MIA chưa xử lý được yêu cầu. Hãy thử lại.");
      const answer = await this.options.readSse(response, delta => {
        if (epoch === this.epoch) this.patch({ streamedText: this.view.streamedText + delta });
      }, status => { if (epoch === this.epoch) this.patch({ status }); });
      if (epoch !== this.epoch) return;
      this.advisoryMode = !!answer.advisory;
      if (answer.advisory?.turns && answer.advisory.turns >= 1) {
        this.options.post({ type: "assistant.workspace.support-available", sessionId: this.options.sessionId, available: true });
      }
      this.patch({ answer, navigation: answer.navigation ?? null, streamedText: "", busy: false, status: answer.navigation ? "Vui lòng xác nhận đích đến." : "MIA đã trả lời." });
      if (acceptedSpokenOffering && answer.navigation) {
        await this.confirm();
        return;
      }
      await this.speak(answer.speechText, epoch);
      if (epoch === this.epoch) {
        this.state(answer.navigation ? "Idle" : "Done");
        if (!answer.navigation) { await this.wait(1000, epoch); if (epoch === this.epoch) this.state("Idle"); }
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  private normalize(text: string) {
    return text.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[.!?,]/g, "").trim();
  }
  private groupForAction(actionId?: string, message = ""): ConversationGroup | null {
    if (actionId === "error" || actionId?.startsWith("advisory:")) return "error";
    if (actionId === "todos" || actionId?.startsWith("todo:") || actionId?.startsWith("todo-type:")) return "todos";
    if (actionId === "transactions" || actionId?.startsWith("transaction:") || actionId?.startsWith("navigate:") || actionId?.startsWith("lc:")) return "transactions";
    if (actionId === "offering" || actionId?.startsWith("offering:")) return "offering";
    if (/\b(ma loi|loi)\b/.test(message)) return "error";
    if (/\b(viec can lam|cong viec)\b/.test(message)) return "todos";
    if (/\b(offering|de xuat san pham|san pham phu hop)\b/.test(message)) return "offering";
    if (/\b(giao dich|chuyen tien|chuyen khoan|giai ngan|thanh toan|phat hanh lc)\b/.test(message)) return "transactions";
    return null;
  }
  private resetLcFlow() {
    this.lcStage = "idle";
    this.lcDraft = {};
    this.lcMissing = [];
    this.lcLabels = {};
    this.lcDefinitions = {};
    this.lcSkipFieldConfirmation = false;
    this.lcHasConfirmedField = false;
  }
  private async localLcAnswer(text: string, suggestions: Choice[] = [], extra: Partial<ScenarioAnswer> = {}, logUser?: string) {
    if (logUser) this.options.utterance?.("user", logUser);
    this.cancel(); const epoch = this.epoch;
    const answer: ScenarioAnswer = { text, speechText: text, steps: [], suggestions, citations: [], ...extra };
    this.patch({ answer, navigation: null, busy: false, streamedText: "", status: this.lcStage === "idle" ? "MIA đang chờ xác nhận bước tiếp theo." : "MIA đang hỗ trợ phát hành L/C." });
    await this.speak(text, epoch);
    if (epoch === this.epoch) this.state("Idle");
  }
  private isUpset(text: string) {
    return this.emotionPhrases.some(phrase => text.includes(phrase));
  }
  private recipientPronoun() {
    return this.data?.recipient.pronoun ?? "anh/chị";
  }
  private lcFieldName(key: string) {
    const label = this.lcLabels[key] ?? key;
    const swift = label.match(/^\s*(\d{2}[A-Z])\s*:\s*(.+)$/i);
    return swift ? `trường thông tin ${swift[1].toUpperCase()}, ${swift[2]}` : `trường thông tin ${label}`;
  }
  private async askCurrentLcField(logUser?: string) {
    const key = this.lcMissing[0];
    if (!key) { await this.finishLc(logUser); return; }
    this.lcStage = "missing";
    const definition = this.lcDefinitions[key];
    const options = Array.isArray(definition?.options) ? definition.options.filter(item => typeof item === "string" && item.trim()) : [];
    const kind = definition?.kind === "checkbox" ? "checkbox" : definition?.kind === "choice" ? "radio" : undefined;
    await this.localLcAnswer(`${this.recipientPronoun()} vui lòng cung cấp ${this.lcFieldName(key)}.`, [], kind && options.length ? {
      fieldPrompt: { key, label: this.lcFieldName(key), kind, options },
    } : {}, logUser);
  }
  private async confirmNextLcField(logUser?: string) {
    if (!this.lcMissing.length) { await this.finishLc(logUser); return; }
    if (this.lcSkipFieldConfirmation) { await this.askCurrentLcField(logUser); return; }
    this.lcStage = "confirm-field";
    const suggestions: Choice[] = [
      { id: "lc-continue-mia", label: "Tiếp tục cung cấp trên MIA", actionId: "lc:field:continue" },
      { id: "lc-continue-screen", label: "Tự điền trên form", actionId: "lc:field:screen" },
    ];
    if (!this.lcHasConfirmedField) suggestions.push({ id: "lc-no-more-confirm", label: "Không hỏi lại", actionId: "lc:field:no-confirm" });
    this.lcHasConfirmedField = true;
    await this.localLcAnswer(`${this.recipientPronoun()} muốn tiếp tục cung cấp thông tin cho MIA hay sẽ điền trên form Thông tin L/C?`, suggestions, {}, logUser);
  }
  private async handleLcInput(message: string, actionId: string | undefined, text: string, logUser: boolean) {
    if (actionId?.startsWith("transaction:switch:")) {
      const screenId = actionId.endsWith("disbursement") ? "domestic-disbursement-create" : "single-transfer-create";
      this.lcStage = "idle";
      this.options.post({ type: "assistant.direct.navigate", sessionId: this.options.sessionId, screenId });
      return true;
    }
    if (actionId === "transaction:resume:lc") {
      const pronoun = this.recipientPronoun();
      const prompt = this.lcStage === "type" ? `${pronoun} vui lòng chọn LC thường, LC UPAS hoặc LC khác.` : this.lcStage === "mode" ? `${pronoun} vui lòng chọn LC nháp hoặc LC chính thức.` : this.lcStage === "upload" ? `${pronoun} vui lòng tải file PO để MIA tiếp tục bóc tách.` : "MIA sẽ tiếp tục hỗ trợ hồ sơ L/C đang thực hiện.";
      const suggestions = this.lcStage === "type" ? [{ id: "lc-normal", label: "LC thường", actionId: "lc:type:normal" }, { id: "lc-upas", label: "LC UPAS", actionId: "lc:type:upas" }, { id: "lc-other", label: "LC khác", actionId: "lc:type:other" }] : this.lcStage === "mode" ? [{ id: "lc-draft", label: "LC nháp", actionId: "lc:mode:draft" }, { id: "lc-official", label: "LC chính thức", actionId: "lc:mode:official" }] : [];
      await this.localLcAnswer(prompt, suggestions, this.lcStage === "upload" ? { attachmentRequest: { accept: ".pdf,.doc,.docx,.xls,.xlsx,.txt", label: "Tải file PO" } } : {});
      return true;
    }
    const startsLc = actionId === "transaction:lc";
    if (!startsLc && this.lcStage === "idle") return false;
    const pronoun = this.recipientPronoun();
    const upset = this.isUpset(text);
    const apology = upset ? "MIA thành thật xin lỗi vì trải nghiệm chưa tốt. " : "";
    if (upset) {
      const current = this.lcStage === "type" ? `${pronoun} muốn chọn LC thường, LC UPAS hay LC khác?` : this.lcStage === "mode" ? `${pronoun} muốn phát hành LC nháp hay LC chính thức?` : `${pronoun} muốn MIA tiếp tục hỗ trợ hay chuyển sang màn hình giao dịch?`;
      await this.localLcAnswer(apology + current, this.view.answer?.suggestions ?? [], {}, logUser ? message : undefined);
      return true;
    }
    if (text.includes("giai ngan") || text.includes("chuyen tien") || text.includes("chuyen khoan")) {
      const disbursement = text.includes("giai ngan");
      await this.localLcAnswer(`${pronoun} muốn dừng phần chuẩn bị L/C và chuyển sang ${disbursement ? "giải ngân thanh toán trong nước" : "chuyển tiền trong nước"}, đúng không ạ?`, [
        { id: "switch-confirm", label: "Đúng, chuyển giao dịch", actionId: `transaction:switch:${disbursement ? "disbursement" : "transfer"}` },
        { id: "switch-cancel", label: "Tiếp tục phát hành L/C", actionId: "transaction:resume:lc" },
      ], {}, logUser ? message : undefined);
      return true;
    }
    if (startsLc) {
      this.lcStage = "type";
      await this.localLcAnswer(`Loại LC ${pronoun} muốn phát hành:`, [
        { id: "lc-normal", label: "LC thường", actionId: "lc:type:normal" },
        { id: "lc-upas", label: "LC UPAS", actionId: "lc:type:upas" },
        { id: "lc-other", label: "LC khác", actionId: "lc:type:other" },
      ], {}, logUser ? (actionId ? "Phát hành LC" : message) : undefined);
      return true;
    }
    if (this.lcStage === "type") {
      const type = actionId?.startsWith("lc:type:") ? actionId.split(":")[2] : text.includes("upas") ? "upas" : text.includes("thuong") ? "normal" : text.includes("khac") ? "other" : "";
      if (!type) { await this.localLcAnswer(`MIA cần xác nhận loại L/C. ${pronoun} chọn LC thường, LC UPAS hay LC khác?`, this.view.answer?.suggestions ?? [], {}, logUser ? message : undefined); return true; }
      this.lcDraft.lcType = type === "normal" ? "LC thường" : type === "upas" ? "LC UPAS" : "LC khác";
      this.lcStage = "mode";
      await this.localLcAnswer(`${pronoun} muốn phát hành LC nháp hay phát hành LC chính thức?`, [
        { id: "lc-draft", label: "LC nháp", actionId: "lc:mode:draft" },
        { id: "lc-official", label: "LC chính thức", actionId: "lc:mode:official" },
      ], {}, logUser ? message : undefined);
      return true;
    }
    if (this.lcStage === "mode") {
      const mode = actionId?.startsWith("lc:mode:") ? actionId.split(":")[2] : text.includes("nhap") ? "draft" : text.includes("chinh thuc") ? "official" : "";
      if (!mode) { await this.localLcAnswer("MIA cần xác nhận: LC nháp hay LC chính thức?", this.view.answer?.suggestions ?? [], {}, logUser ? message : undefined); return true; }
      this.lcDraft.issueMode = mode === "draft" ? "LC nháp" : "LC chính thức";
      this.lcStage = "upload";
      const address = this.data?.recipient.address ?? "anh/chị";
      await this.localLcAnswer(`${address} ơi, để phát hành ${this.lcDraft.lcType}, ${pronoun} cần thực hiện các bước sau:`, [], {
        steps: ["Bước 1: Upload file PO", "Bước 2: Điền các thông tin còn thiếu", "Bước 3: Submit yêu cầu cho checker", "Bước 4: Checker duyệt yêu cầu", "Bước 5: Chờ MSB xử lý hồ sơ", "Bước 6: Nhận điện LC", `MIA sẽ hỗ trợ ${pronoun} các Bước 1 và Bước 2. Trước hết ${pronoun} hãy tải file PO lên đây giúp.`],
        attachmentRequest: { accept: ".pdf,.doc,.docx,.xls,.xlsx,.txt", label: "Tải file PO" },
      }, logUser ? message : undefined);
      return true;
    }
    if (this.lcStage === "continue") {
      const goScreen = actionId === "lc:continue:screen" || text.includes("man hinh") || text.includes("giao dich") || text.includes(" ve ib") || text === "ib";
      const keepMia = actionId === "lc:continue:mia" || text.includes("mia") || text.includes("tiep tuc") || text.includes("cung cap");
      if (goScreen) { await this.finishLc(logUser ? message : undefined); return true; }
      if (!keepMia) { await this.localLcAnswer(`${pronoun} muốn tiếp tục cung cấp thông tin cho MIA hay tự thực hiện trên màn hình giao dịch?`, this.view.answer?.suggestions ?? [], {}, logUser ? message : undefined); return true; }
      if (!this.lcMissing.length) { await this.finishLc(logUser ? message : undefined); return true; }
      await this.askCurrentLcField(logUser ? message : undefined);
      return true;
    }
    if (this.lcStage === "confirm-field") {
      const goScreen = actionId === "lc:field:screen" || text.includes("form") || text.includes("man hinh");
      const noConfirm = actionId === "lc:field:no-confirm" || text.includes("khong hoi lai");
      const keepMia = actionId === "lc:field:continue" || text.includes("mia") || text.includes("tiep tuc");
      if (goScreen) { await this.finishLc(logUser ? message : undefined); return true; }
      if (noConfirm) this.lcSkipFieldConfirmation = true;
      if (noConfirm || keepMia) { await this.askCurrentLcField(logUser ? message : undefined); return true; }
      await this.localLcAnswer(`${pronoun} muốn tiếp tục cung cấp thông tin cho MIA hay sẽ điền trên form Thông tin L/C?`, this.view.answer?.suggestions ?? [], {}, logUser ? message : undefined);
      return true;
    }
    if (this.lcStage === "missing") {
      const key = this.lcMissing.shift();
      if (key) this.lcDraft[key] = message.trim();
      await this.confirmNextLcField(logUser ? message : undefined);
      return true;
    }
    return this.lcStage !== "idle";
  }
  async uploadPo(file: File) {
    if (this.lcStage !== "upload" || this.view.busy) return;
    if (file.size > 10_000_000) { this.patch({ status: "File PO vượt quá 10 MB." }); return; }
    this.options.utterance?.("user", `Tải file PO: ${file.name}`);
    this.cancel(); const epoch = this.epoch;
    this.patch({
      busy: true,
      status: "MIA đang bóc tách dữ liệu từ file PO…",
      streamedText: "MIA đang xử lý file PO và đối chiếu các trường trên màn hình Thông tin L/C…",
    });
    this.state("Thinking");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const response = await fetch("/api/agent/lc/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: this.options.sessionId, fileName: file.name, contentBase64: btoa(binary), lcType: this.lcDraft.lcType, issueMode: this.lcDraft.issueMode }) });
      if (!response.ok) throw new Error(`MIA chưa đọc được file PO. ${this.recipientPronoun()} vui lòng kiểm tra định dạng và thử lại.`);
       const result = await response.json() as { fields: Record<string, string>; missingFields: string[]; fieldLabels: Record<string, string>; fieldDefinitions?: Array<{ key: string; label: string; kind?: string; options?: string[] }>; reasoning?: { provider: string; model: string } };
      if (epoch !== this.epoch) return;
       this.lcDraft = { ...this.lcDraft, ...result.fields }; this.lcMissing = result.missingFields; this.lcLabels = result.fieldLabels;
       this.lcDefinitions = Object.fromEntries((result.fieldDefinitions ?? []).map(item => [item.key, item])); this.lcStage = "continue";
      const address = this.data?.recipient.address ?? "anh/chị"; const pronoun = this.data?.recipient.pronoun ?? "anh/chị";
      const extracted = Object.entries(this.lcDraft)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => (this.lcLabels[key] ?? key) + ": " + value);
      const extractionSteps = [
        ...(extracted.length ? ["Thông tin đã bóc tách:", ...extracted] : ["MIA chưa bóc tách được giá trị nào từ file PO."]),
        ...(this.lcMissing.length
          ? ["Các thông tin cần tiếp tục cung cấp:", ...this.lcMissing.map(key => this.lcLabels[key] ?? key)]
          : ["File PO đã có đủ các trường của bước Thông tin L/C."]),
      ];
      await this.localLcAnswer(`${address} ơi, MIA đã bóc tách xong dữ liệu từ file PO. MIA muốn xác nhận với ${pronoun} về việc ${pronoun} sẽ tiếp tục cung cấp thông tin cho MIA hay sẽ tự thực hiện trên màn hình giao dịch.`, [
        { id: "lc-mia", label: "Tiếp tục cung cấp trên MIA", actionId: "lc:continue:mia" },
        { id: "lc-screen", label: "Tiếp tục thực hiện trên màn hình", actionId: "lc:continue:screen" },
      ], { steps: extractionSteps, extractedData: this.lcDraft, missingFields: this.lcMissing });
    } catch (error) {
      if (epoch === this.epoch) {
        const message = error instanceof Error ? error.message : `MIA chưa đọc được file PO. ${this.recipientPronoun()} vui lòng thử lại.`;
        this.lcStage = "upload";
        await this.localLcAnswer(message, [], {
          attachmentRequest: { accept: ".pdf,.doc,.docx,.xls,.xlsx,.txt", label: "Tải lại file PO" },
        });
      }
    }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  async submitLcField(value: string | string[]) {
    if (this.lcStage !== "missing" || this.view.busy) return;
    const normalized = Array.isArray(value) ? value.filter(Boolean).join(" | ") : value.trim();
    if (!normalized) { this.patch({ status: "Vui lòng chọn ít nhất một giá trị." }); return; }
    await this.handleLcInput(normalized, undefined, this.normalize(normalized), true);
  }
  private async finishLc(logUser?: string) {
    this.lcStage = "done";
    if (logUser) this.options.utterance?.("user", logUser);
    this.options.post({ type: "assistant.lc.autofill", sessionId: this.options.sessionId, draft: this.lcDraft, missingFields: this.lcMissing });
    this.patch({ answer: { text: `MIA đã chuyển dữ liệu sang màn hình phát hành L/C. Các trường còn thiếu được đánh dấu màu đỏ để ${this.recipientPronoun()} bổ sung.`, speechText: "MIA đã chuyển dữ liệu sang màn hình phát hành L/C.", steps: [], suggestions: [], citations: [], extractedData: this.lcDraft, missingFields: this.lcMissing }, navigation: null, busy: false, status: "Đã chuyển sang giao dịch phát hành L/C." });
    this.state("Done");
  }
  support(kind: "profile" | "submit", payload: Record<string, unknown> = {}) {
    return this.request("assistant.support.requested", "host.support.result", { kind, ...payload }, 60_000);
  }
  private async handleTodoIntent(message: string, actionId: string | undefined, epoch: number) {
    const freeform = actionId === "freeform";
    const todos = this.data?.todoList ?? [];
    const selected = actionId?.startsWith("todo:")
      ? todos.find(todo => todo.id === actionId.slice(5))
      : (freeform || !actionId || actionId === "advisory:followup") ? this.matchLoanTodo(message, todos) : undefined;
    if (actionId?.startsWith("todo:") && !selected) throw new Error("Việc này không còn trong danh sách. Hãy chọn lại nhé.");
    if (selected) {
      const screens: Record<string, string> = { "overdue-loan": "credit-information", "document-debt": "documents-management", "password-change": "password-change" };
      const screenId = screens[selected.todoType];
      const feature = this.runtime?.features.find(item => item.screenId === screenId);
      if (!feature) throw new Error("Ứng dụng chưa hỗ trợ tính năng này.");
      const contextKey = this.runtime?.contextKey;
      if (!contextKey) throw new Error("MIA chưa nhận được ngữ cảnh màn hình.");
      const target: NavigationTarget = { routeId: feature.routeId, screenId: feature.screenId, name: feature.name, todoId: selected.id };
      this.patch({ navigation: null, answer: null, status: `Đang mở ${feature.name}…` });
      this.state("Working");
      const result = await this.request("assistant.navigation.requested", "host.navigation.completed", { ...target, contextKey, confirmed: true }, 5000);
      if (result.status !== "completed") throw new Error("Host từ chối chuyển màn hình.");
      this.patch({ busy: false, status: `Đã chuyển đến ${feature.name}.` });
      this.state("Done");
      return true;
    }
    if (actionId?.startsWith("todo-type:")) {
      const selectedType = actionId.slice("todo-type:".length);
      const list = todos.filter(todo => todo.todoType === selectedType);
      const speechText = list.length ? `Có ${list.length} việc cần làm. Bạn muốn xem việc nào?` : "Bạn không có việc cần làm trong nhóm này.";
      this.patch({ navigation: null, answer: { text: speechText, speechText, steps: [], citations: [], todoList: list, suggestions: [] }, busy: false, status: "Chọn công việc bạn muốn xem." });
      await this.speak(speechText, epoch);
      if (epoch === this.epoch) this.state("Idle");
      return true;
    }
    return false;
  }
  private matchLoanTodo(message: string, todos: AssistantTodo[]) {
    const loans = todos.filter(todo => todo.todoType === "overdue-loan" && todo.loanAccount);
    const text = this.normalize(message);
    if (!loans.length || !/(khoan vay|tai khoan vay|vay qua han)/.test(text)) return undefined;

    const ordinal = text.match(/(?:khoan vay|tai khoan vay)(?: qua han)?\s*(?:(?:so|thu)\s*)?(\d{1,2})\b/);
    if (ordinal) {
      const position = Number(ordinal[1]);
      if (position >= 1 && position <= loans.length) return loans[position - 1];
    }

    const spokenDigits = (message.match(/\d/g) ?? []).join("");
    if (spokenDigits.length < 4) return loans.length === 1 ? loans[0] : undefined;
    const candidates = loans.map(todo => ({ todo, account: (todo.loanAccount ?? "").replace(/\D/g, "") }));
    const exact = candidates.find(item => item.account === spokenDigits);
    if (exact) return exact.todo;
    const suffixMatches = candidates.filter(item => item.account.endsWith(spokenDigits) || spokenDigits.endsWith(item.account));
    if (suffixMatches.length === 1) return suffixMatches[0].todo;

    const ranked = candidates.map(item => ({ ...item, distance: this.editDistance(item.account, spokenDigits) })).sort((a, b) => a.distance - b.distance);
    const threshold = Math.max(1, Math.floor(Math.max(spokenDigits.length, ranked[0]?.account.length ?? 0) * 0.15));
    return ranked[0] && ranked[0].distance <= threshold && ranked[0].distance < (ranked[1]?.distance ?? Number.POSITIVE_INFINITY) ? ranked[0].todo : undefined;
  }
  private editDistance(left: string, right: string) {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
      let diagonal = row[0]; row[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const above = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[right.length];
  }
  async confirm() {
    const target = this.view.navigation;
    const contextKey = this.runtime?.contextKey;
    if (!target || !contextKey || this.view.busy) return;
    if (target.screenId === "letter-of-credit-issue") {
      this.patch({ navigation: null });
      await this.handleLcInput("Phát hành LC", "transaction:lc", "phat hanh lc", true);
      return;
    }
    this.options.utterance?.("user", "Đúng rồi");
    this.cancel(); this.patch({ busy: true, navigation: null }); this.state("Working");
    try {
      const snapshot = await this.refresh();
      if (this.runtime?.contextKey !== contextKey) throw new Error("Màn hình đã thay đổi; vui lòng chọn lại.");
      if (contextKey !== snapshot.context.screenId + "|" + (snapshot.error?.errorId ?? "")) throw new Error("Màn hình đã thay đổi; vui lòng chọn lại.");
      const result = await this.request("assistant.navigation.requested", "host.navigation.completed", { ...target, contextKey, confirmed: true }, 5000);
      if (result.status !== "completed") throw new Error("Host từ chối chuyển màn hình.");
      this.patch({ status: "Đã chuyển đến " + target.name + ".", busy: false });
      this.state("Done"); const epoch = this.epoch; await this.wait(1000, epoch); if (epoch === this.epoch) this.state("Idle");
    } catch (error) { this.fail(error); }
    finally { this.patch({ busy: false }); }
  }
  dismiss() { this.options.utterance?.("user", "Bỏ qua"); this.cancel(); this.patch({ navigation: null, answer: null, busy: false, streamedText: "", status: "Đã hủy yêu cầu." }); }
  home() {
    this.otherRequest = false; this.advisoryMode = false;
    this.resetLcFlow();
    if (this.conversationGroup !== "home") {
      this.conversationGroup = "home";
      this.options.conversationGroupChanged?.("home");
    }
    this.cancel(); this.patch({ navigation: null, answer: null, streamedText: "", busy: false });
  }
  async listen() {
    if (this.view.busy) return;
    this.cancel(); const epoch = this.epoch; this.state("Listening"); this.patch({ busy: true });
    try {
      const result = await this.request("assistant.voice.requested", "host.voice.result", { contextKey: this.runtime?.contextKey }, 25_000);
      if (epoch !== this.epoch) return;
      this.patch({ busy: false }); this.state("Idle");
      const text = typeof result.transcript === "string" ? result.transcript.trim() : "";
      const normalized = text.toLocaleLowerCase("vi").replace(/[.!?]/g, "").trim();
      if (this.view.navigation && ["xác nhận", "đồng ý", "đúng", "đúng rồi"].includes(normalized)) await this.confirm();
      else if (this.view.navigation && ["hủy", "không", "không đúng", "bỏ qua"].includes(normalized)) this.dismiss();
      else if (text) {
        const wasConfirming = !!this.view.navigation;
        await this.send(text);
        if (!wasConfirming && this.view.navigation && !this.view.busy && !this.view.audioUnavailable) await this.listen();
      }
      else throw new Error("MIA chưa nghe rõ. Vui lòng nhập bằng chữ.");
    } catch (error) { if (epoch === this.epoch) this.fail(error); }
    finally { if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  async replay() {
    this.cancel(); const epoch = this.epoch;
    try {
      const text = this.view.answer?.speechText ?? this.lastSpeech;
      if (text) await this.speak(text, epoch);
      this.state("Idle");
    } catch (error) { this.fail(error); }
  }
  dispose() {
    this.disposed = true; this.cancel();
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error("MIA_DISPOSED")); }); this.pending.clear();
    this.data = null; this.runtime = null;
  }
}
