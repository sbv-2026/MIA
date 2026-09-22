// Scenario extension 1.1 is opt-in. Context messages keep their 1.0 wire shape.
export const SCENARIO_CONTRACT_VERSION = "1.1" as const;
export const MIA_STATES = ["Idle", "Listening", "Thinking", "Working", "Done"] as const;
export type MiaState = (typeof MIA_STATES)[number];
export type Recipient = { address: string; pronoun: "anh" | "chị" | "anh/chị" };
export type AssistantTodo = { id: string; todoType: string; loanAccount?: string; business?: string; dueDate?: string; amount?: number };
export type AssistantData = {
  sessionId: string; recipient: Recipient;
  todoList: AssistantTodo[];
  offeringIds: string[]; capturedAt: string;
};
export type SupportedFeature = { routeId: "home" | "transfer" | "qr-payment" | "disbursement"; screenId: string; name: string; categoryPath?: [string, string, string]; aliases?: string[] };
export type NavigationTarget = Pick<SupportedFeature, "routeId" | "screenId" | "name"> & { todoId?: string };
export const SCENARIO_MESSAGES = [
  "host.interaction.home", "host.menu.selected", "host.voice.start", "host.todo.selected", "assistant.support.requested", "host.support.result", "assistant.scenario.ready", "assistant.data.requested", "host.data.snapshot",
  "host.runtime.updated", "assistant.state.changed", "assistant.hint.changed",
  "assistant.speech.requested", "host.speech.completed", "assistant.voice.requested",
  "host.voice.result", "assistant.navigation.requested", "host.navigation.completed",
  "assistant.greeting.started", "assistant.error.prompted", "assistant.speech.cancelled",
] as const;
export type ScenarioEnvelope = {
  contractVersion: "1.1"; requestId: string; type: (typeof SCENARIO_MESSAGES)[number];
  timestamp: string; payload: Record<string, unknown>;
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 128): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function isAssistantData(value: unknown): value is AssistantData {
  if (!record(value) || !keys(value, ["sessionId", "recipient", "todoList", "offeringIds", "capturedAt"]) ||
      !text(value.sessionId) || !record(value.recipient) || !keys(value.recipient, ["address", "pronoun"]) ||
      !text(value.recipient.address) || !["anh", "chị", "anh/chị"].includes(String(value.recipient.pronoun)) ||
      typeof value.capturedAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value.capturedAt) || Number.isNaN(Date.parse(value.capturedAt))) return false;
  const { address, pronoun } = value.recipient;
  if (pronoun === "anh/chị" ? address !== pronoun : !(address as string).startsWith(pronoun + " ") || !(address as string).slice(String(pronoun).length + 1).trim()) return false;
  if (!Array.isArray(value.todoList) || value.todoList.length > 1000 || !value.todoList.every(todo => record(todo) && keys(todo, ["id", "todoType", "loanAccount", "business", "dueDate", "amount"]) && text(todo.id) && text(todo.todoType) && (todo.loanAccount === undefined || text(todo.loanAccount, 64)) && (todo.business === undefined || text(todo.business)) && (todo.dueDate === undefined || (typeof todo.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todo.dueDate) && !Number.isNaN(Date.parse(todo.dueDate)))) && (todo.amount === undefined || (typeof todo.amount === "number" && Number.isFinite(todo.amount) && todo.amount > 0)))) return false;
  if (new Set(value.todoList.map(todo => todo.id)).size !== value.todoList.length) return false;
  return Array.isArray(value.offeringIds) && value.offeringIds.length <= 100 && value.offeringIds.every(id => text(id)) && new Set(value.offeringIds).size === value.offeringIds.length;
}
export function isScenarioEnvelope(value: unknown): value is ScenarioEnvelope {
  return record(value) && keys(value, ["contractVersion", "requestId", "type", "timestamp", "payload"]) &&
    value.contractVersion === SCENARIO_CONTRACT_VERSION && text(value.requestId) &&
    SCENARIO_MESSAGES.includes(value.type as ScenarioEnvelope["type"]) &&
    typeof value.timestamp === "string" && !Number.isNaN(Date.parse(value.timestamp)) && record(value.payload);
}
export function scenarioEnvelope(type: ScenarioEnvelope["type"], payload: Record<string, unknown>, requestId: string = crypto.randomUUID()): ScenarioEnvelope {
  return { contractVersion: SCENARIO_CONTRACT_VERSION, type, payload, requestId, timestamp: new Date().toISOString() };
}
