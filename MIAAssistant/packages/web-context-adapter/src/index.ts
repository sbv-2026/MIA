import { CONTRACT_VERSION, isBridgeEnvelope, type ContextSnapshot, type CurrentErrorSnapshot, type ErrorKind, type RouteId, type ScreenContext, type ScreenState } from "@mia/contracts";
export { CONTRACT_VERSION } from "@mia/contracts";
export type { ContextSnapshot, CurrentErrorSnapshot, ErrorKind, RouteId, ScreenContext, ScreenState } from "@mia/contracts";
export type ContextProvider = () => ScreenContext | ContextSnapshot | Promise<ScreenContext | ContextSnapshot>;

export type DomAdapterOptions = {
  root?: Document;
  errorSelector?: string;
  operationSelector?: string;
};

export type WebContextAdapterOptions = {
  sessionId: string;
  contextProvider: ContextProvider;
  dom?: DomAdapterOptions;
  maxErrorAgeMs?: number;
  onRejected?: (reason: string) => void;
};

export type BridgeOptions = {
  assistantWindow: Window;
  allowedOrigin: string;
};

const DEFAULT_ERROR_SELECTOR = '[data-agent-field="error-code"]';
const DEFAULT_OPERATION_SELECTOR = '[data-agent-field="operation"]';
const ROUTES: RouteId[] = ["home", "transfer", "qr-payment", "disbursement"];
const STATES: ScreenState[] = ["idle", "editing", "submitting", "success", "error"];

function safeSelector(selector: string): string {
  const lowered = selector.toLocaleLowerCase();
  if (!selector.startsWith('[data-agent-field="') || ["script", "iframe", "html", "body", ",", "*"].some((token) => lowered.includes(token))) {
    throw new Error("UNSAFE_DOM_SELECTOR");
  }
  return selector;
}

function validDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function isCurrentErrorSnapshot(value: unknown): value is CurrentErrorSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const allowed = ["errorId", "errorCode", "operation", "screenId", "field", "kind", "occurredAt", "observedAt", "source"];
  return Object.keys(item).every((key) => allowed.includes(key)) &&
    [item.errorId, item.errorCode, item.operation, item.screenId].every((part) => typeof part === "string" && part.length > 0 && part.length <= 128) &&
    (item.field === null || typeof item.field === "string") &&
    ["inline", "popup", "page", "toast"].includes(String(item.kind)) &&
    typeof item.occurredAt === "string" && validDate(item.occurredAt) &&
    typeof item.observedAt === "string" && validDate(item.observedAt) &&
    ["host-provider", "network-interceptor", "dom-extractor"].includes(String(item.source));
}

export function isScreenContext(value: unknown): value is ScreenContext {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const allowed = ["schemaVersion", "sessionId", "screenId", "routeId", "screenState", "lastOperation", "lastErrorId", "errorCode", "locale", "capturedAt", "source"];
  return Object.keys(item).every((key) => allowed.includes(key)) &&
    item.schemaVersion === "1.0" && typeof item.sessionId === "string" && item.sessionId.length > 0 &&
    typeof item.screenId === "string" && item.screenId.length > 0 && ROUTES.includes(item.routeId as RouteId) &&
    STATES.includes(item.screenState as ScreenState) && item.locale === "vi-VN" &&
    typeof item.capturedAt === "string" && validDate(item.capturedAt) &&
    ["host-api", "dom-extractor"].includes(String(item.source));
}

function sanitizeContext(value: ScreenContext): ScreenContext {
  const sanitized: ScreenContext = {
    schemaVersion: value.schemaVersion,
    sessionId: value.sessionId,
    screenId: value.screenId,
    routeId: value.routeId,
    screenState: value.screenState,
    lastOperation: value.lastOperation ?? null,
    lastErrorId: value.lastErrorId ?? null,
    errorCode: value.errorCode ?? null,
    locale: value.locale,
    capturedAt: value.capturedAt,
    source: value.source,
  };
  if (!isScreenContext(sanitized)) throw new Error("INVALID_HOST_SCREEN_CONTEXT");
  return sanitized;
}

export function isContextSnapshot(value: unknown): value is ContextSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as ContextSnapshot;
  if (!isScreenContext(snapshot.context)) return false;
  if (snapshot.error === null) return snapshot.context.errorCode === null && snapshot.context.lastErrorId === null;
  return isCurrentErrorSnapshot(snapshot.error) && snapshot.error.screenId === snapshot.context.screenId &&
    snapshot.error.errorCode === snapshot.context.errorCode && snapshot.error.errorId === snapshot.context.lastErrorId &&
    snapshot.error.operation === snapshot.context.lastOperation;
}

function isFullSnapshot(value: ScreenContext | ContextSnapshot): value is ContextSnapshot {
  return "context" in value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function contextError(context: ScreenContext, now: string): CurrentErrorSnapshot | null {
  if (!context.errorCode || !context.lastErrorId || !context.lastOperation) return null;
  return {
    errorId: context.lastErrorId, errorCode: context.errorCode, operation: context.lastOperation,
    screenId: context.screenId, field: null, kind: "page", occurredAt: context.capturedAt,
    observedAt: now, source: "host-provider",
  };
}

export class MiaWebContextAdapter {
  private reportedError: CurrentErrorSnapshot | null = null;
  private detachBridge: (() => void) | null = null;

  constructor(private readonly options: WebContextAdapterOptions) {
    if (!options.sessionId) throw new Error("SESSION_ID_REQUIRED");
  }

  reportPresentedError(error: CurrentErrorSnapshot): void {
    if (!isCurrentErrorSnapshot(error)) throw new Error("INVALID_ERROR_SNAPSHOT");
    this.reportedError = clone(error);
  }

  resolveError(errorId?: string): void {
    if (!errorId || this.reportedError?.errorId === errorId) this.reportedError = null;
  }

  async capture(): Promise<ContextSnapshot> {
    const supplied = await this.options.contextProvider();
    const baseContext = sanitizeContext(isFullSnapshot(supplied) ? supplied.context : supplied);
    if (baseContext.sessionId !== this.options.sessionId) {
      throw new Error("INVALID_HOST_SCREEN_CONTEXT");
    }
    const now = new Date().toISOString();
    const providerError = isFullSnapshot(supplied) ? supplied.error : contextError(baseContext, now);
    const reported = this.isFresh(this.reportedError) && this.reportedError?.screenId === baseContext.screenId ? clone(this.reportedError) : null;
    const domError = this.readDomError(baseContext, now);
    const error = providerError ?? reported ?? domError;
    const context: ScreenContext = error ? {
      ...baseContext, screenState: "error", lastOperation: error.operation,
      lastErrorId: error.errorId, errorCode: error.errorCode,
      capturedAt: now, source: error.source === "dom-extractor" ? "dom-extractor" : baseContext.source,
    } : {
      ...baseContext, lastErrorId: null, errorCode: null,
      screenState: baseContext.screenState === "error" ? "idle" : baseContext.screenState,
      capturedAt: now,
    };
    const snapshot = { context, error };
    if (!isContextSnapshot(snapshot)) throw new Error("INVALID_CONTEXT_SNAPSHOT");
    return snapshot;
  }

  attachBridge(options: BridgeOptions): () => void {
    this.detachBridge?.();
    const receive = (event: MessageEvent) => {
      if (event.origin !== options.allowedOrigin) return this.options.onRejected?.("ORIGIN_MISMATCH");
      if (event.source !== options.assistantWindow) return this.options.onRejected?.("SOURCE_MISMATCH");
      const envelope = event.data;
      if (!isBridgeEnvelope(envelope) || envelope.contractVersion !== CONTRACT_VERSION) {
        return this.options.onRejected?.("INVALID_CONTEXT_REQUEST");
      }
      // Valid Assistant messages such as assistant.ready belong to other Host handlers.
      if (envelope.type !== "assistant.context.requested") return;
      const payload = envelope.payload as Record<string, unknown> | null;
      if (!payload || payload.sessionId !== this.options.sessionId) return this.options.onRejected?.("SESSION_MISMATCH");
      void this.capture().then((snapshot) => {
        options.assistantWindow.postMessage({
          contractVersion: CONTRACT_VERSION, requestId: envelope.requestId,
          type: "host.context.snapshot", timestamp: new Date().toISOString(), payload: snapshot,
        }, options.allowedOrigin);
        options.assistantWindow.postMessage({
          contractVersion: CONTRACT_VERSION, requestId: envelope.requestId,
          type: "host.context.changed", timestamp: new Date().toISOString(), payload: snapshot.context,
        }, options.allowedOrigin);
        options.assistantWindow.postMessage({
          contractVersion: CONTRACT_VERSION, requestId: envelope.requestId,
          type: "host.error.changed", timestamp: new Date().toISOString(),
          payload: { sessionId: this.options.sessionId, screenId: snapshot.context.screenId,
            lastErrorId: snapshot.error?.errorId ?? null, hasError: Boolean(snapshot.error) },
        }, options.allowedOrigin);
      }).catch(() => this.options.onRejected?.("CONTEXT_CAPTURE_FAILED"));
    };
    window.addEventListener("message", receive);
    this.detachBridge = () => window.removeEventListener("message", receive);
    return this.detachBridge;
  }

  destroy(): void {
    this.detachBridge?.();
    this.detachBridge = null;
    this.reportedError = null;
  }

  private isFresh(error: CurrentErrorSnapshot | null): boolean {
    if (!error) return false;
    return Date.now() - Date.parse(error.observedAt) <= (this.options.maxErrorAgeMs ?? 300_000);
  }

  private readDomError(context: ScreenContext, observedAt: string): CurrentErrorSnapshot | null {
    const root = this.options.dom?.root ?? (typeof document === "undefined" ? undefined : document);
    if (!root) return null;
    const errorSelector = safeSelector(this.options.dom?.errorSelector ?? DEFAULT_ERROR_SELECTOR);
    const operationSelector = safeSelector(this.options.dom?.operationSelector ?? DEFAULT_OPERATION_SELECTOR);
    const elements = [...root.querySelectorAll<HTMLElement>(errorSelector)];
    if (!elements.length) return null;
    const selected = elements.reduce((best, item) => {
      const score = Number(item.dataset.errorPriority ?? (item.dataset.errorKind === "popup" ? 1000 : 0));
      const bestScore = Number(best.dataset.errorPriority ?? (best.dataset.errorKind === "popup" ? 1000 : 0));
      return score >= bestScore ? item : best;
    });
    const errorCode = selected.dataset.errorCode?.trim();
    if (!errorCode) return null;
    const operation = selected.dataset.operation?.trim() || root.querySelector<HTMLElement>(operationSelector)?.textContent?.trim() || context.lastOperation;
    if (!operation) return null;
    const occurredAt = selected.dataset.occurredAt && validDate(selected.dataset.occurredAt) ? selected.dataset.occurredAt : observedAt;
    return {
      errorId: selected.dataset.errorId?.trim() || `dom-${context.screenId}-${errorCode}`,
      errorCode, operation, screenId: context.screenId,
      field: selected.dataset.errorField?.trim() || null,
      kind: (["inline", "popup", "page", "toast"].includes(selected.dataset.errorKind ?? "") ? selected.dataset.errorKind : "inline") as ErrorKind,
      occurredAt, observedAt, source: "dom-extractor",
    };
  }
}

export function createMiaWebContextAdapter(options: WebContextAdapterOptions): MiaWebContextAdapter {
  return new MiaWebContextAdapter(options);
}

export { createScenarioHostHandler as createMiaScenarioHostHandler } from "@mia/contracts";
export { createVieNeuVoice, createWebVoice, isVieNeuTtsBrowser } from "./voice.js";
export type { VieNeuVoiceOptions, VoiceStatus, WebVoice, WebVoiceOptions } from "./voice.js";
