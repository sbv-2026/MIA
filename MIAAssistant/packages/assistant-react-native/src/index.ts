import { CONTRACT_VERSION, isContextSnapshot, type BridgeEnvelope, type ContextSnapshot } from "@mia/contracts";

export type AssistantBridgeConfig = {
  sessionId: string;
  assistantOrigin: string;
  snapshot: () => Promise<ContextSnapshot>;
  onRejected?: (reason: string) => void;
};

export function createAssistantMessageHandler(config: AssistantBridgeConfig) {
  return async (raw: string, postMessage: (payload: string) => void): Promise<void> => {
    let envelope: BridgeEnvelope;
    try { envelope = JSON.parse(raw) as BridgeEnvelope; } catch { config.onRejected?.("INVALID_JSON"); return; }
    if (envelope.contractVersion !== CONTRACT_VERSION || envelope.type !== "assistant.context.requested") {
      config.onRejected?.("INVALID_ENVELOPE"); return;
    }
    const payload = envelope.payload as { sessionId?: string };
    if (payload.sessionId !== config.sessionId) { config.onRejected?.("SESSION_MISMATCH"); return; }
    const snapshot = await config.snapshot();
    if (!isContextSnapshot(snapshot)) { config.onRejected?.("INVALID_SNAPSHOT"); return; }
    postMessage(JSON.stringify({
      contractVersion: CONTRACT_VERSION, requestId: envelope.requestId, type: "host.context.snapshot",
      timestamp: new Date().toISOString(), payload: snapshot,
    }));
  };
}

export { createScenarioHostHandler as createNativeScenarioHostHandler } from "@mia/contracts";
