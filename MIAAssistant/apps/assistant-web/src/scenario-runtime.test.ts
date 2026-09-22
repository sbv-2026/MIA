import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scenarioEnvelope, type ContextSnapshot, type NavigationTarget, type SupportedFeature } from "@mia/contracts";
import { ScenarioRuntime, type ScenarioAnswer } from "./scenario-runtime";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-16T10:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  let key = "home|";
  let panelOpen = false;
  let greeted = false;
  let voiceTranscript = "";
  const spoken: string[] = [];
  const hints: Array<string | null> = [];
  const navigation: Array<Record<string, unknown>> = [];
  const posted: object[] = [];
  const target: NavigationTarget = { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền" };
  const loanTarget: NavigationTarget = { routeId: "home", screenId: "credit-information", name: "Thông tin tín dụng" };
  const features: SupportedFeature[] = [target, loanTarget];
  const todos = [{ id: "loan-1", todoType: "overdue-loan", loanAccount: "123456789", dueDate: "2026-09-20", amount: 1_000_000 }];
  const answer: ScenarioAnswer = { text: "Xác nhận Chuyển tiền?", speechText: "Xác nhận Chuyển tiền?", steps: [], suggestions: [], citations: [], navigation: target };
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("bootstrap") ? { suggestions: [], utterances: [
    { kind: "greeting", text: "Xin chào anh Minh", delayMs: 0, hideAfterMs: 1000 },
    { kind: "todos", text: "5 việc cần làm", delayMs: 0, hideAfterMs: null },
    { kind: "offering", text: "Sản phẩm ABC", delayMs: 2000, hideAfterMs: null },
  ] } : {}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new ScenarioRuntime({ sessionId: "s1", changed: () => {}, readSse: async () => answer, post: raw => {
    posted.push(raw);
    const value = raw as { type: string; requestId: string; payload: Record<string, unknown> };
    const reply = (type: Parameters<typeof scenarioEnvelope>[0], payload: Record<string, unknown>) => runtime.receive(scenarioEnvelope(type, { sessionId: "s1", ...payload }, value.requestId));
    if (value.type === "assistant.scenario.ready") update();
    if (value.type === "assistant.context.requested") {
      const snapshot: ContextSnapshot = { context: { schemaVersion: "1.0", sessionId: "s1", screenId: key.split("|")[0], routeId: "home", screenState: "idle", lastOperation: "dashboard.view", lastErrorId: null, errorCode: null, locale: "vi-VN", capturedAt: new Date().toISOString(), source: "host-api" }, error: null };
      runtime.receive({ contractVersion: "1.0", requestId: value.requestId, type: "host.context.snapshot", timestamp: new Date().toISOString(), payload: snapshot });
    }
    if (value.type === "assistant.data.requested") reply("host.data.snapshot", { features, data: { sessionId: "s1", recipient: { address: "anh Minh", pronoun: "anh" }, todoList: todos, offeringIds: [], capturedAt: new Date().toISOString() } });
    if (value.type === "assistant.hint.changed") hints.push(value.payload.text as string | null);
    if (value.type === "assistant.greeting.started") greeted = true;
    if (value.type === "assistant.speech.requested") { spoken.push(value.payload.text as string); reply("host.speech.completed", { status: "completed" }); }
    if (value.type === "assistant.voice.requested") reply("host.voice.result", { status: "completed", transcript: voiceTranscript });
    if (value.type === "assistant.navigation.requested") navigation.push(value as unknown as Record<string, unknown>);
  } });
  function update() { runtime.receive(scenarioEnvelope("host.runtime.updated", { sessionId: "s1", contextKey: key, panelOpen, active: true, greeted, promptedErrors: [], features })); }
  return { runtime, spoken, hints, navigation, posted, fetchMock, update, setVoiceTranscript: (value: string) => { voiceTranscript = value; }, setKey: (value: string) => { key = value; update(); }, open: () => { panelOpen = true; update(); }, close: () => { panelOpen = false; update(); } };
}
it("preserves the previous answer on reopen and normal navigation", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000); f.open(); await vi.advanceTimersByTimeAsync(0);
  await f.runtime.send("Chuyển tiền", "navigate:transfer-create");
  const previous = f.runtime.view.answer;
  f.close(); await vi.advanceTimersByTimeAsync(0); f.open(); await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.view.answer).toBe(previous);
  f.setKey("another-screen|"); await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.view.answer).toBe(previous);
  expect(f.runtime.view.navigation).toBeNull();
  f.runtime.dispose();
});
it("hides greeting after 1 second and starts offering 2 seconds after previous speech", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(0);
  expect(f.spoken).toEqual(["Xin chào anh Minh"]);
  await vi.advanceTimersByTimeAsync(999); expect(f.hints).not.toContain(null);
  await vi.advanceTimersByTimeAsync(1); expect(f.hints).toContain(null); expect(f.spoken).toEqual(["Xin chào anh Minh", "5 việc cần làm"]);
  await vi.advanceTimersByTimeAsync(1999); expect(f.spoken).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(f.spoken[2]).toBe("Sản phẩm ABC");
  f.runtime.dispose();
});
it("cancels delayed offering on route change and does not greet again on panel open", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(1000);
  f.setKey("transfer-create|"); await vi.advanceTimersByTimeAsync(3000);
  expect(f.spoken).not.toContain("Sản phẩm ABC");
  f.setKey("home|"); f.open(); await vi.advanceTimersByTimeAsync(3000);
  expect(f.spoken.filter(text => text === "Xin chào anh Minh")).toHaveLength(1);
  f.runtime.dispose();
});
it("navigation is only sent after confirmation and Done waits for Host acknowledgement", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000); f.open(); await vi.advanceTimersByTimeAsync(0);
  await f.runtime.send("Chuyển tiền", "navigate:transfer-create");
  expect(f.navigation).toHaveLength(0);
  const confirmation = f.runtime.confirm(); await vi.advanceTimersByTimeAsync(0);
  expect(f.navigation).toHaveLength(1); expect(f.runtime.view.state).toBe("Working");
  const request = f.navigation[0] as { requestId: string };
  f.runtime.receive(scenarioEnvelope("host.navigation.completed", { sessionId: "s1", status: "completed" }, request.requestId));
  await vi.advanceTimersByTimeAsync(0); expect(f.runtime.view.state).toBe("Done");
  await vi.advanceTimersByTimeAsync(1000); await confirmation; expect(f.runtime.view.state).toBe("Idle");
  f.runtime.dispose();
});
it("changed context removes a pending destination and rejected navigation never becomes Done", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000); f.open(); await vi.advanceTimersByTimeAsync(0);
  await f.runtime.send("Chuyển tiền", "navigate:transfer-create"); f.setKey("another-screen|"); await vi.advanceTimersByTimeAsync(0);
  await f.runtime.confirm(); expect(f.navigation).toHaveLength(0);
  await f.runtime.send("Chuyển tiền", "navigate:transfer-create");
  const promise = f.runtime.confirm(); await vi.advanceTimersByTimeAsync(0);
  const request = f.navigation[0] as { requestId: string };
  f.runtime.receive(scenarioEnvelope("host.navigation.completed", { sessionId: "s1", status: "rejected" }, request.requestId));
  await promise; expect(f.runtime.view.state).toBe("Idle"); expect(f.runtime.view.status).toContain("từ chối");
  f.runtime.dispose();
});

it("ignores an obsolete error menu after leaving the error screen", async () => {
  const utterance = vi.fn();
  const runtime = new ScenarioRuntime({ sessionId: "s1", changed: () => {}, post: () => {}, readSse: async () => { throw new Error("unexpected"); }, utterance });
  await runtime.send("error", "error");
  expect(utterance).not.toHaveBeenCalled();
  expect(runtime.view.busy).toBe(false);
  runtime.dispose();
});
it("shows a wait message instead of accepting another request while busy", async () => {
  const changed = vi.fn();
  const runtime = new ScenarioRuntime({ sessionId: "s1", changed, post: () => {}, readSse: async () => { throw new Error("unexpected"); } });
  runtime.view.busy = true;

  await runtime.send("Yêu cầu khác");

  expect(runtime.view.status).toBe("MIA đang xử lý, quý khách vui lòng chờ MIA thực hiện xong.");
  expect(changed).toHaveBeenCalled();
  runtime.dispose();
});
it("resets conversation when switching functional groups but not within one group", async () => {
  const groupChanged = vi.fn();
  let runtime!: ScenarioRuntime;
  runtime = new ScenarioRuntime({
    sessionId: "s1",
    changed: () => {},
    readSse: async () => { throw new Error("unexpected"); },
    conversationGroupChanged: groupChanged,
    post: raw => {
      const value = raw as { type?: string; requestId?: string };
      if (value.type === "assistant.speech.requested" && value.requestId) {
        runtime.receive(scenarioEnvelope("host.speech.completed", { sessionId: "s1", status: "completed" }, value.requestId));
      }
    },
  });

  await runtime.send("Phát hành LC", "transaction:lc");
  expect(groupChanged).toHaveBeenLastCalledWith("transactions");
  await runtime.send("LC thường", "lc:type:normal");
  expect(groupChanged).toHaveBeenCalledTimes(1);

  const pending = runtime.send("Tôi muốn xem việc cần làm");
  expect(groupChanged).toHaveBeenLastCalledWith("todos");
  expect(groupChanged).toHaveBeenCalledTimes(2);
  expect(runtime.view.busy).toBe(true);
  runtime.dispose();
  await pending;
});

it("uses the recipient pronoun throughout the LC setup flow", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  await f.runtime.send("Phát hành LC", "transaction:lc");
  expect(f.runtime.view.answer?.text).toBe("Loại LC anh muốn phát hành:");
  await f.runtime.send("LC thường", "lc:type:normal");
  expect(f.runtime.view.answer?.text).toBe("anh muốn phát hành LC nháp hay phát hành LC chính thức?");
  await f.runtime.send("LC chính thức", "lc:mode:official");
  expect(f.runtime.view.answer?.text).toBe("anh Minh ơi, để phát hành LC thường, anh cần thực hiện các bước sau:");
  expect(f.runtime.view.answer?.steps.at(-1)).toBe("MIA sẽ hỗ trợ anh các Bước 1 và Bước 2. Trước hết anh hãy tải file PO lên đây giúp.");
  expect(f.runtime.view.answer?.attachmentRequest?.label).toBe("Tải file PO");
  expect(f.runtime.view.answer?.text).not.toContain("Chị");
  f.runtime.dispose();
});

it("shows an in-chat processing message while the uploaded PO is being extracted", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  await f.runtime.send("Phát hành LC", "transaction:lc");
  await f.runtime.send("LC thường", "lc:type:normal");
  await f.runtime.send("LC chính thức", "lc:mode:official");
  let finishExtraction!: (response: Response) => void;
  f.fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/api/agent/lc/extract")) return new Promise<Response>(resolve => { finishExtraction = resolve; });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  const upload = f.runtime.uploadPo({
    name: "PO-001.txt", size: 20,
    arrayBuffer: async () => new TextEncoder().encode("Currency: USD").buffer,
  } as File);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.runtime.view.busy).toBe(true);
  expect(f.runtime.view.streamedText).toContain("MIA đang xử lý file PO");
  finishExtraction(new Response(JSON.stringify({
    fields: { lcType: "LC thường", issueMode: "LC chính thức", currency: "USD" },
    missingFields: ["amount"], fieldLabels: { amount: "Số tiền" },
  }), { status: 200 }));
  await upload;
  expect(f.runtime.view.streamedText).toBe("");
  expect(f.runtime.view.answer?.steps).toContain("currency: USD");
  expect(f.runtime.view.answer?.steps).toContain("Các thông tin cần tiếp tục cung cấp:");
  expect(f.runtime.view.answer?.steps.at(-1)).toBe("Số tiền");
  expect(f.runtime.view.answer?.suggestions.map(item => item.label)).toEqual([
    "Tiếp tục cung cấp trên MIA",
    "Tiếp tục thực hiện trên màn hình",
  ]);
  await f.runtime.send("Tiếp tục thực hiện trên màn hình", "lc:continue:screen");
  expect(f.posted).toContainEqual({
    type: "assistant.lc.autofill",
    sessionId: "s1",
    draft: { lcType: "LC thường", issueMode: "LC chính thức", currency: "USD" },
    missingFields: ["amount"],
  });
  f.runtime.dispose();
});

it("asks missing SWIFT fields with typed choices and supports the one-time no-confirm option", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  await f.runtime.send("Phát hành LC", "transaction:lc");
  await f.runtime.send("LC thường", "lc:type:normal");
  await f.runtime.send("LC chính thức", "lc:mode:official");
  f.fetchMock.mockImplementation(async (url: string) => String(url).endsWith("/api/agent/lc/extract")
    ? new Response(JSON.stringify({
      fields: { lcType: "LC thường", issueMode: "LC chính thức" },
      missingFields: ["partialShipments", "requiredDocuments"],
      fieldLabels: {
        partialShipments: "43P: Giao hàng từng phần (Partial Shipments)",
        requiredDocuments: "46A: Chứng từ yêu cầu (Documents required)",
      },
      fieldDefinitions: [
        { key: "partialShipments", label: "43P: Giao hàng từng phần (Partial Shipments)", kind: "choice", options: ["Cho phép", "Không cho phép"] },
        { key: "requiredDocuments", label: "46A: Chứng từ yêu cầu (Documents required)", kind: "checkbox", options: ["Hóa đơn thương mại", "Phiếu đóng gói"] },
      ],
    }), { status: 200 })
    : new Response(JSON.stringify({}), { status: 200 }));

  await f.runtime.uploadPo({ name: "PO.txt", size: 10, arrayBuffer: async () => new TextEncoder().encode("sample").buffer } as File);
  await f.runtime.send("Tiếp tục cung cấp trên MIA", "lc:continue:mia");
  expect(f.runtime.view.answer?.text).toContain("trường thông tin 43P");
  expect(f.runtime.view.answer?.fieldPrompt).toMatchObject({ kind: "radio", options: ["Cho phép", "Không cho phép"] });

  await f.runtime.submitLcField("Cho phép");
  expect(f.runtime.view.answer?.suggestions.map(item => item.label)).toEqual([
    "Tiếp tục cung cấp trên MIA", "Tự điền trên form", "Không hỏi lại",
  ]);
  await f.runtime.send("Không hỏi lại", "lc:field:no-confirm");
  expect(f.runtime.view.answer?.text).toContain("trường thông tin 46A");
  expect(f.runtime.view.answer?.fieldPrompt?.kind).toBe("checkbox");
  await f.runtime.submitLcField(["Hóa đơn thương mại", "Phiếu đóng gói"]);

  expect(f.posted).toContainEqual({
    type: "assistant.lc.autofill",
    sessionId: "s1",
    draft: {
      lcType: "LC thường", issueMode: "LC chính thức", partialShipments: "Cho phép",
      requiredDocuments: "Hóa đơn thương mại | Phiếu đóng gói",
    },
    missingFields: [],
  });
  f.runtime.dispose();
});

it("uses custom emotion phrases returned by bootstrap", async () => {
  const f = fixture();
  f.fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(String(url).endsWith("bootstrap") ? {
    suggestions: [], utterances: [], emotionPhrases: ["ngán tận cổ"],
  } : {}), { status: 200 }));
  f.runtime.start(); await vi.advanceTimersByTimeAsync(0);

  await f.runtime.send("Tôi ngán tận cổ rồi");

  expect(f.runtime.view.answer?.text).toContain("xin lỗi vì trải nghiệm chưa tốt");
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(false);
  f.runtime.dispose();
});

it("does not confuse normal unaccented words with negative emotion", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);

  await f.runtime.send("Tiep tuc yeu cau");

  expect(f.runtime.view.answer?.text).not.toContain("xin lỗi vì trải nghiệm chưa tốt");
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(true);
  f.runtime.dispose();
});

it("shows level-2 todo items locally and directly navigates a selected account without model reasoning", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  await f.runtime.send("1 việc khoản vay quá hạn", "todo-type:overdue-loan");
  expect(f.runtime.view.answer?.todoList?.map(todo => todo.id)).toEqual(["loan-1"]);
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(false);

  const navigation = f.runtime.send("Xem công việc", "todo:loan-1");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.navigation).toHaveLength(1);
  const request = f.navigation[0] as { requestId: string; payload: Record<string, unknown> };
  expect(request.payload).toMatchObject({ screenId: "credit-information", todoId: "loan-1", confirmed: true });
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(false);
  f.runtime.receive(scenarioEnvelope("host.navigation.completed", { sessionId: "s1", status: "completed" }, request.requestId));
  await navigation;
  f.runtime.dispose();
});

it("directly opens a loan selected by account number from typed or spoken input", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  const navigation = f.runtime.send("Mở khoản vay quá hạn 123456788");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.navigation).toHaveLength(1);
  const request = f.navigation[0] as { requestId: string; payload: Record<string, unknown> };
  expect(request.payload).toMatchObject({ screenId: "credit-information", todoId: "loan-1", confirmed: true });
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(false);
  f.runtime.receive(scenarioEnvelope("host.navigation.completed", { sessionId: "s1", status: "completed" }, request.requestId));
  await navigation;
  f.runtime.dispose();
});
it("interprets a spoken loan position using the order shown in the workspace", async () => {
  const f = fixture(); f.runtime.start(); await vi.advanceTimersByTimeAsync(3000);
  f.setVoiceTranscript("Mở khoản vay số 1 giúp tôi");
  const navigation = f.runtime.listen();
  await vi.advanceTimersByTimeAsync(0);
  const request = f.navigation[0] as { requestId: string; payload: Record<string, unknown> };
  expect(request.payload).toMatchObject({ screenId: "credit-information", todoId: "loan-1", confirmed: true });
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/chat"))).toBe(false);
  f.runtime.receive(scenarioEnvelope("host.navigation.completed", { sessionId: "s1", status: "completed" }, request.requestId));
  await navigation;
  f.runtime.dispose();
});
it("logs a friendly label for legacy error actions and focuses the host error view", async () => {
  const utterance = vi.fn(); const post = vi.fn();
  const runtime = new ScenarioRuntime({ sessionId: "s1", changed: () => {}, post, readSse: async () => { throw new Error("unexpected"); }, utterance });
  runtime.view.snapshot = { context: {} as ContextSnapshot["context"], error: { errorId: "e1" } as NonNullable<ContextSnapshot["error"]> };
  const sent = runtime.send("error", "error");
  expect(utterance).toHaveBeenCalledWith("user", "Hỗ trợ xử lý lỗi");
  expect(post).toHaveBeenCalledWith({ type: "assistant.workspace.error", sessionId: "s1" });
  runtime.dispose(); await sent;
});
