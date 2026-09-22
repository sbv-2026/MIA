import { afterEach, describe, expect, it } from "vitest";
import { createMiaWebContextAdapter, type ScreenContext } from "@mia/web-context-adapter";

const context = (): ScreenContext => ({
  schemaVersion: "1.0",
  sessionId: "session-dom",
  screenId: "domestic-disbursement-create",
  routeId: "disbursement",
  screenState: "editing",
  lastOperation: "disbursement.domestic.edit",
  lastErrorId: null,
  errorCode: null,
  locale: "vi-VN",
  capturedAt: new Date().toISOString(),
  source: "host-api",
});

describe("DemoMSBWeb Web Context Adapter integration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts the current DOM error and prepares a valid Agent snapshot", async () => {
    document.body.innerHTML = `
      <span data-agent-field="operation">disbursement.domestic.submit</span>
      <small data-agent-field="error-code" data-error-id="inline-account-not-found"
        data-error-code="11001" data-operation="disbursement.domestic.submit"
        data-error-field="accountNumber" data-error-kind="inline">11001</small>`;

    const adapter = createMiaWebContextAdapter({
      sessionId: "session-dom",
      contextProvider: context,
      dom: {
        errorSelector: '[data-agent-field="error-code"]',
        operationSelector: '[data-agent-field="operation"]',
      },
    });

    const snapshot = await adapter.capture();

    expect(snapshot.context.source).toBe("dom-extractor");
    expect(snapshot.context.lastOperation).toBe("disbursement.domestic.submit");
    expect(snapshot.context.errorCode).toBe("11001");
    expect(snapshot.error).toMatchObject({
      errorId: "inline-account-not-found",
      errorCode: "11001",
      operation: "disbursement.domestic.submit",
      source: "dom-extractor",
    });
  });

  it("captures a guarantee popup on Home with its configured operation", async () => {
    document.body.innerHTML = `
      <section data-agent-field="error-code" data-error-id="guarantee-50001"
        data-error-code="50001" data-operation="guarantee.create"
        data-error-kind="popup" data-error-priority="1000">50001</section>`;

    const adapter = createMiaWebContextAdapter({
      sessionId: "session-dom",
      contextProvider: () => ({ ...context(), screenId: "home", routeId: "home", lastOperation: "dashboard.view" }),
      dom: {
        errorSelector: '[data-agent-field="error-code"]',
        operationSelector: '[data-agent-field="operation"]',
      },
    });

    const snapshot = await adapter.capture();

    expect(snapshot.context).toMatchObject({ screenId: "home", screenState: "error", errorCode: "50001", lastOperation: "guarantee.create" });
    expect(snapshot.error).toMatchObject({ errorCode: "50001", operation: "guarantee.create", kind: "popup" });
  });
});
