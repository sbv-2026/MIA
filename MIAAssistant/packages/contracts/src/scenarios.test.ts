import { describe, expect, it, vi } from "vitest";
import vectors from "../test-vectors/scenario-data.json";
import { isAssistantData, isScenarioEnvelope, scenarioEnvelope } from "./scenarios";
import { createScenarioHostHandler } from "./scenario-host";

describe("scenario data shared vectors", () => {
  for (const vector of vectors) it(vector.name, () => expect(isAssistantData(vector.data)).toBe(vector.valid));
  it("does not accept a 1.0 envelope as scenario data", () => expect(isScenarioEnvelope({ ...scenarioEnvelope("assistant.data.requested", { sessionId: "s1" }), contractVersion: "1.0" })).toBe(false));
});

function fixture() {
  const navigate = vi.fn(async () => true);
  const rejected = vi.fn();
  const replies: unknown[] = [];
  let contextKey = "home|";
  const handler = createScenarioHostHandler({
    sessionId: "s1", data: async () => ({ ...vectors[0].data, capturedAt: new Date().toISOString() } as never),
    features: [{ routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền" }],
    runtime: () => ({ contextKey, panelOpen: true, active: true, greeted: false, promptedErrors: [] }),
    navigate, speak: async () => "completed", stopSpeech: () => {}, listen: async () => "chuyển tiền",
    onState: () => {}, onHint: () => {}, onGreeting: () => {}, onErrorPrompted: () => {}, onRejected: rejected,
  });
  const post = (value: unknown) => { replies.push(value); };
  const receive = (type: Parameters<typeof scenarioEnvelope>[0], payload: Record<string, unknown> = {}) => handler.receive(scenarioEnvelope(type, { sessionId: "s1", ...payload }), post);
  return { handler, navigate, rejected, replies, post, receive, changeContext: () => { contextKey = "other|"; } };
}
describe("scenario host navigation", () => {
  it("passes only a session-owned todo to its matching destination", async () => {
    const navigate = vi.fn(async () => true);
    const replies: unknown[] = [];
    const handler = createScenarioHostHandler({
      sessionId: "s1", features: [{ routeId: "home", screenId: "credit-information", name: "Credit" }, { routeId: "home", screenId: "password-change", name: "Password" }],
      data: async () => ({ sessionId: "s1", recipient: { address: "anh Minh", pronoun: "anh" }, todoList: [{ id: "loan-1", todoType: "overdue-loan", loanAccount: "105010000001" }], offeringIds: [], capturedAt: new Date().toISOString() }),
      runtime: () => ({ contextKey: "home|", panelOpen: true, active: true, greeted: true, promptedErrors: [] }),
      navigate, speak: async () => "completed", stopSpeech: () => {}, listen: async () => "",
      onState: () => {}, onHint: () => {}, onGreeting: () => {}, onErrorPrompted: () => {},
    });
    const receive = (screenId: string, todoId: string, confirmed = true) => handler.receive(scenarioEnvelope("assistant.navigation.requested", { sessionId: "s1", contextKey: "home|", routeId: "home", screenId, todoId, confirmed }), value => replies.push(value));
    await handler.receive(scenarioEnvelope("assistant.scenario.ready", { sessionId: "s1" }), () => {});
    await receive("credit-information", "another-customer-loan");
    await receive("password-change", "loan-1");
    await receive("credit-information", "loan-1", false);
    expect(navigate).not.toHaveBeenCalled();
    await receive("credit-information", "loan-1");
    expect(navigate).toHaveBeenCalledWith({ routeId: "home", screenId: "credit-information", name: "Credit", todoId: "loan-1" });
  });
  it("requires negotiation and a confirmed allowlisted destination", async () => {
    const f = fixture();
    await f.receive("assistant.navigation.requested", { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền", contextKey: "home|", confirmed: true });
    expect(f.navigate).not.toHaveBeenCalled();
    await f.receive("assistant.scenario.ready");
    await f.receive("assistant.navigation.requested", { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền", contextKey: "home|", confirmed: false });
    expect(f.navigate).not.toHaveBeenCalled();
    await f.receive("assistant.navigation.requested", { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền", contextKey: "home|", confirmed: true });
    expect(f.navigate).toHaveBeenCalledOnce();
    expect(f.replies).toContainEqual(expect.objectContaining({ type: "host.navigation.completed", payload: { sessionId: "s1", status: "completed" } }));
  });
  it("rejects stale, replayed, wrong-session and changed-context requests", async () => {
    const f = fixture(); await f.receive("assistant.scenario.ready");
    const value = scenarioEnvelope("assistant.data.requested", { sessionId: "s1" });
    await f.handler.receive(value, f.post); await f.handler.receive(value, f.post);
    expect(f.rejected).toHaveBeenCalledWith("STALE_OR_REPLAY");
    await f.handler.receive(scenarioEnvelope("assistant.data.requested", { sessionId: "s2" }), f.post);
    expect(f.rejected).toHaveBeenCalledWith("SESSION_MISMATCH");
    await f.handler.receive({ ...scenarioEnvelope("assistant.data.requested", { sessionId: "s1" }), timestamp: "2000-01-01T00:00:00Z" }, f.post);
    expect(f.rejected).toHaveBeenCalledWith("STALE_OR_REPLAY");
    f.changeContext();
    await f.receive("assistant.navigation.requested", { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền", contextKey: "home|", confirmed: true });
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it("does not emit completion before Host finishes navigation", async () => {
    const f = fixture(); await f.receive("assistant.scenario.ready");
    let finish!: (value: boolean) => void;
    f.navigate.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const promise = f.receive("assistant.navigation.requested", { routeId: "transfer", screenId: "transfer-create", name: "Chuyển tiền", contextKey: "home|", confirmed: true });
    expect(f.replies).not.toContainEqual(expect.objectContaining({ type: "host.navigation.completed" }));
    finish(false); await promise;
    expect(f.replies).toContainEqual(expect.objectContaining({ type: "host.navigation.completed", payload: { sessionId: "s1", status: "rejected" } }));
  });
});
