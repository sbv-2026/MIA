import { describe, expect, it } from "vitest";
import { createEnvelope, isBridgeEnvelope, isContextSnapshot, isScreenContext } from "./index";

describe("ScreenContext contract", () => {
  const context = {
    schemaVersion: "1.0",
    sessionId: "demo-1",
    screenId: "transfer-result",
    routeId: "transfer",
    screenState: "error",
    lastOperation: "transfer.submit",
    lastErrorId: "err-1",
    errorCode: "TRANSFER_LIMIT_EXCEEDED",
    locale: "vi-VN",
    capturedAt: "2026-09-12T00:00:00Z",
    source: "host-api"
  };

  it("accepts a valid context", () => expect(isScreenContext(context)).toBe(true));
  it("rejects arbitrary routes", () => expect(isScreenContext({ ...context, routeId: "/admin" })).toBe(false));
  it("requires an error id for error state", () =>
    expect(isScreenContext({ ...context, lastErrorId: null })).toBe(false));
});

describe("Bridge envelope contract", () => {
  it("accepts a public message", () => {
    const message = createEnvelope("assistant.context.requested", {
      sessionId: "demo-1",
      reason: "assistant-panel-opened"
    }, "req-1");
    expect(isBridgeEnvelope(message)).toBe(true);
  });

  it("rejects an unknown message", () => {
    expect(isBridgeEnvelope({
      contractVersion: "1.0",
      requestId: "req-1",
      type: "host.execute.javascript",
      timestamp: new Date().toISOString(),
      payload: {}
    })).toBe(false);
  });
});

describe("Web Context Adapter snapshot contract", () => {
  it("accepts a consistent inline error snapshot", () => {
    const now = "2026-09-14T00:00:00Z";
    expect(isContextSnapshot({
      context: {
        schemaVersion: "1.0", sessionId: "demo-1", screenId: "domestic-disbursement-create",
        routeId: "disbursement", screenState: "error", lastOperation: "disbursement.domestic.submit",
        lastErrorId: "inline-1", errorCode: "11001", locale: "vi-VN", capturedAt: now,
        source: "dom-extractor",
      },
      error: {
        errorId: "inline-1", errorCode: "11001", operation: "disbursement.domestic.submit",
        screenId: "domestic-disbursement-create", field: "accountNumber", kind: "inline",
        occurredAt: now, observedAt: now, source: "dom-extractor",
      },
    })).toBe(true);
  });
});
