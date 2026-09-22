export const CONTRACT_VERSION = "1.0" as const;
export const SCREEN_CONTEXT_VERSION = "1.0" as const;

export const ROUTE_IDS = ["home", "transfer", "qr-payment", "disbursement"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

export const SCREEN_STATES = ["idle", "editing", "submitting", "success", "error"] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

export const CONTEXT_SOURCES = ["host-api", "dom-extractor"] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

export type ScreenContext = {
  schemaVersion: typeof SCREEN_CONTEXT_VERSION;
  sessionId: string;
  screenId: string;
  routeId: RouteId;
  screenState: ScreenState;
  lastOperation: string | null;
  lastErrorId: string | null;
  errorCode: string | null;
  locale: "vi-VN";
  capturedAt: string;
  source: ContextSource;
};

export const BRIDGE_MESSAGE_TYPES = [
  "assistant.ready",
  "host.context.changed",
  "host.context.snapshot",
  "assistant.context.requested",
  "assistant.navigation.requested",
  "host.navigation.completed",
  "assistant.panel.changed",
  "host.error.changed"
] as const;
export type BridgeMessageType = (typeof BRIDGE_MESSAGE_TYPES)[number];

export type BridgeEnvelope<TPayload = Record<string, unknown>> = {
  contractVersion: typeof CONTRACT_VERSION;
  requestId: string;
  type: BridgeMessageType;
  timestamp: string;
  payload: TPayload;
};

export type AssistantReadyPayload = {
  assistantInstanceId: string;
  supportedContractVersions: string[];
};

export type ContextRequestedPayload = {
  sessionId: string;
  reason: "assistant-panel-opened" | "context-missing" | "context-stale";
};

export type NavigationRequestedPayload = { routeId: RouteId };
export type PanelChangedPayload = { state: "open" | "closed" };

export type ErrorKind = "inline" | "popup" | "page" | "toast";
export type ErrorSnapshotSource = "host-provider" | "network-interceptor" | "dom-extractor";

export type CurrentErrorSnapshot = {
  errorId: string;
  errorCode: string;
  operation: string;
  screenId: string;
  field: string | null;
  kind: ErrorKind;
  occurredAt: string;
  observedAt: string;
  source: ErrorSnapshotSource;
};

export type ContextSnapshot = { context: ScreenContext; error: CurrentErrorSnapshot | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const isNullableString = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length <= 128);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === "string" && ROUTE_IDS.includes(value as RouteId);
}

export function isScreenContext(value: unknown): value is ScreenContext {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "schemaVersion", "sessionId", "screenId", "routeId", "screenState",
    "lastOperation", "lastErrorId", "errorCode", "locale", "capturedAt", "source"
  ])) return false;

  const validBase =
    value.schemaVersion === SCREEN_CONTEXT_VERSION &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.screenId) &&
    isRouteId(value.routeId) &&
    typeof value.screenState === "string" && SCREEN_STATES.includes(value.screenState as ScreenState) &&
    isNullableString(value.lastOperation) &&
    isNullableString(value.lastErrorId) &&
    isNullableString(value.errorCode) &&
    value.locale === "vi-VN" &&
    typeof value.capturedAt === "string" && !Number.isNaN(Date.parse(value.capturedAt)) &&
    typeof value.source === "string" && CONTEXT_SOURCES.includes(value.source as ContextSource);

  if (!validBase) return false;
  if (value.screenState === "error" && !value.lastErrorId) return false;
  if (value.errorCode && !value.lastErrorId) return false;
  return true;
}

export function isContextSnapshot(value: unknown): value is ContextSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, ["context", "error"]) || !isScreenContext(value.context)) return false;
  if (value.error === null) return value.context.errorCode === null && value.context.lastErrorId === null;
  if (!isRecord(value.error) || !hasOnlyKeys(value.error, [
    "errorId", "errorCode", "operation", "screenId", "field", "kind", "occurredAt", "observedAt", "source"
  ])) return false;
  const error = value.error;
  return isNonEmptyString(error.errorId) && isNonEmptyString(error.errorCode) &&
    isNonEmptyString(error.operation) && isNonEmptyString(error.screenId) && isNullableString(error.field) &&
    ["inline", "popup", "page", "toast"].includes(String(error.kind)) &&
    typeof error.occurredAt === "string" && !Number.isNaN(Date.parse(error.occurredAt)) &&
    typeof error.observedAt === "string" && !Number.isNaN(Date.parse(error.observedAt)) &&
    ["host-provider", "network-interceptor", "dom-extractor"].includes(String(error.source)) &&
    error.screenId === value.context.screenId && error.errorId === value.context.lastErrorId &&
    error.errorCode === value.context.errorCode && error.operation === value.context.lastOperation;
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["contractVersion", "requestId", "type", "timestamp", "payload"])) return false;
  return value.contractVersion === CONTRACT_VERSION &&
    isNonEmptyString(value.requestId) &&
    typeof value.type === "string" && BRIDGE_MESSAGE_TYPES.includes(value.type as BridgeMessageType) &&
    typeof value.timestamp === "string" && !Number.isNaN(Date.parse(value.timestamp)) &&
    isRecord(value.payload);
}

export function createEnvelope<TPayload extends object>(
  type: BridgeMessageType,
  payload: TPayload,
  requestId: string = crypto.randomUUID()
): BridgeEnvelope<TPayload> {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId,
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}

export * from "./scenarios.js";
export * from "./scenario-host.js";
