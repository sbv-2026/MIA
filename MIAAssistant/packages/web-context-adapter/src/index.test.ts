import { describe, expect, it } from "vitest";
import { createMiaWebContextAdapter } from "./index";

describe("Web context adapter", () => {
  it("captures and validates a Host snapshot", async () => {
    const now = new Date().toISOString();
    const adapter = createMiaWebContextAdapter({ sessionId: "s1", contextProvider: () => ({ schemaVersion:"1.0", sessionId:"s1", screenId:"home", routeId:"home", screenState:"idle", lastOperation:null, lastErrorId:null, errorCode:null, locale:"vi-VN", capturedAt:now, source:"host-api" }) });
    expect((await adapter.capture()).context.sessionId).toBe("s1");
  });
});
