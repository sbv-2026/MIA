import { isAssistantData, isScenarioEnvelope, MIA_STATES, scenarioEnvelope, type AssistantData, type MiaState, type NavigationTarget, type ScenarioEnvelope, type SupportedFeature } from "./scenarios.js";

export type ScenarioHostConfig = {
  sessionId: string;
  data: () => Promise<AssistantData>;
  features: SupportedFeature[];
  runtime: () => { contextKey: string; panelOpen: boolean; active: boolean; greeted: boolean; promptedErrors: string[] };
  navigate: (target: NavigationTarget) => Promise<boolean>;
  speak: (text: string) => Promise<"completed" | "unavailable" | "cancelled">;
  stopSpeech: () => void;
  listen: () => Promise<string>;
  onState: (state: MiaState) => void;
  onHint: (text: string | null) => void;
  onGreeting: () => void;
  onErrorPrompted: (errorId: string) => void;
  onRejected?: (reason: string) => void;
};

export function createScenarioHostHandler(config: ScenarioHostConfig) {
  let ready = false;
  const seen = new Set<string>();
  let generation = 0;
  const reply = (post: (value: ScenarioEnvelope) => void, type: ScenarioEnvelope["type"], payload: Record<string, unknown>, requestId: string) =>
    post(scenarioEnvelope(type, { sessionId: config.sessionId, ...payload }, requestId));
  return {
    update(post: (value: ScenarioEnvelope) => void) {
      if (ready) post(scenarioEnvelope("host.runtime.updated", { sessionId: config.sessionId, ...config.runtime(), features: config.features }));
    },
    dispose() { ready = false; generation++; config.stopSpeech(); seen.clear(); },
    async receive(value: unknown, post: (value: ScenarioEnvelope) => void) {
      if (!isScenarioEnvelope(value)) return;
      const reject = (reason: string) => config.onRejected?.(reason);
      if (value.payload.sessionId !== config.sessionId) return reject("SESSION_MISMATCH");
      const age = Date.now() - Date.parse(value.timestamp);
      if (age > 300_000 || age < -60_000 || seen.has(value.requestId)) return reject("STALE_OR_REPLAY");
      if (!ready && value.type !== "assistant.scenario.ready") return reject("SCENARIO_NOT_NEGOTIATED");
      seen.add(value.requestId);
      if (seen.size > 200) seen.delete(seen.values().next().value!);
      const payload = value.payload;
      const allowed: Partial<Record<ScenarioEnvelope["type"], string[]>> = {
        "assistant.scenario.ready": ["sessionId"],
        "assistant.data.requested": ["sessionId"],
        "assistant.state.changed": ["sessionId", "state"],
        "assistant.hint.changed": ["sessionId", "text"],
        "assistant.speech.requested": ["sessionId", "text", "contextKey"],
        "assistant.voice.requested": ["sessionId", "contextKey"],
        "assistant.navigation.requested": ["sessionId", "routeId", "screenId", "name", "contextKey", "confirmed", "todoId"],
        "assistant.greeting.started": ["sessionId"],
        "assistant.error.prompted": ["sessionId", "errorId"],
        "assistant.speech.cancelled": ["sessionId"],
      };
      if (!allowed[value.type] || Object.keys(payload).some(key => !allowed[value.type]!.includes(key))) return reject("INVALID_PAYLOAD");
      if (value.type === "assistant.scenario.ready") { ready = true; this.update(post); return; }
      if (value.type === "assistant.data.requested") {
        try {
          const data = await config.data();
          if (!isAssistantData(data) || data.sessionId !== config.sessionId) throw new Error();
          reply(post, "host.data.snapshot", { data, features: config.features }, value.requestId);
        } catch { reply(post, "host.data.snapshot", { error: "ASSISTANT_DATA_UNAVAILABLE" }, value.requestId); }
        return;
      }
      if (value.type === "assistant.state.changed") {
        if (!MIA_STATES.includes(payload.state as MiaState)) return reject("INVALID_STATE");
        config.onState(payload.state as MiaState); return;
      }
      if (value.type === "assistant.hint.changed") {
        if (payload.text !== null && (typeof payload.text !== "string" || payload.text.length > 5000)) return reject("INVALID_HINT");
        config.onHint(payload.text as string | null); return;
      }
      if (value.type === "assistant.greeting.started") { config.onGreeting(); return; }
      if (value.type === "assistant.error.prompted") {
        if (typeof payload.errorId !== "string" || payload.errorId !== config.runtime().contextKey.split("|")[1]) return reject("INVALID_ERROR");
        config.onErrorPrompted(payload.errorId); return;
      }
      if (value.type === "assistant.speech.cancelled") { generation++; config.stopSpeech(); return; }
      if (["assistant.speech.requested", "assistant.voice.requested", "assistant.navigation.requested"].includes(value.type) &&
          (payload.contextKey !== config.runtime().contextKey || !config.runtime().active)) return reject("CONTEXT_CHANGED");
      if (value.type === "assistant.speech.requested") {
        if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 5000) return reject("INVALID_SPEECH");
        const currentGeneration = ++generation;
        const status = await config.speak(payload.text);
        reply(post, "host.speech.completed", { status: currentGeneration === generation ? status : "cancelled" }, value.requestId); return;
      }
      if (value.type === "assistant.voice.requested") {
        if (!config.runtime().panelOpen) return reject("PANEL_CLOSED");
        const currentGeneration = ++generation;
        config.stopSpeech();
        try {
          const transcript = await config.listen();
          reply(post, "host.voice.result", currentGeneration === generation && payload.contextKey === config.runtime().contextKey ? { transcript } : { error: "VOICE_CANCELLED" }, value.requestId);
        } catch { reply(post, "host.voice.result", { error: "MICROPHONE_UNAVAILABLE" }, value.requestId); }
        return;
      }
      if (value.type === "assistant.navigation.requested") {
        const target = config.features.find(feature => feature.screenId === payload.screenId && feature.routeId === payload.routeId);
        if (!target || payload.confirmed !== true) {
          reply(post, "host.navigation.completed", { status: "rejected" }, value.requestId); return;
        }
        try {
          if (payload.todoId !== undefined) {
            const data = await config.data();
            const todo = data.todoList.find(item => item.id === payload.todoId);
            const screens: Record<string, string> = { "overdue-loan": "credit-information", "document-debt": "documents-management", "password-change": "password-change" };
            if (!todo || screens[todo.todoType] !== target.screenId || payload.contextKey !== config.runtime().contextKey) {
              reply(post, "host.navigation.completed", { status: "rejected" }, value.requestId); return;
            }
          }
          const completed = await config.navigate(payload.todoId === undefined ? target : { ...target, todoId: String(payload.todoId) });
          reply(post, "host.navigation.completed", { status: completed ? "completed" : "rejected" }, value.requestId);
        } catch { reply(post, "host.navigation.completed", { status: "rejected" }, value.requestId); }
      }
    },
  };
}
