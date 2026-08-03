import { describe, expect, test } from "vitest";
import {
  AgentPiTurnContextRegistry,
  type AgentPiTurnContext,
} from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi turn context registry", () => {
  test("retains a context until its owner and all request readers release it", async () => {
    const registry = new AgentPiTurnContextRegistry();
    let contextId = "";
    let reader: ReturnType<AgentPiTurnContextRegistry["acquire"]>;

    await registry.withContext(createContext("owner"), (registeredId) => {
      contextId = registeredId;
      reader = registry.acquire(registeredId);
      expect(reader?.context.requestId).toBe("owner");
      expect(registry.size).toBe(1);
    });

    expect(registry.acquire(contextId)).toBeUndefined();
    expect(registry.size).toBe(1);
    reader?.release();
    reader?.release();
    expect(registry.size).toBe(0);
  });

  test("isolates concurrent contexts even when tool call ids collide", async () => {
    const registry = new AgentPiTurnContextRegistry();

    const [firstBatch, secondBatch] = await Promise.all([
      registry.withContext(createContext("first"), async (contextId) => {
        registry.registerToolCallBatch(contextId, "first-batch", ["shared-call"]);
        await Promise.resolve();
        return registry.readToolCallBatchId(contextId, "shared-call");
      }),
      registry.withContext(createContext("second"), async (contextId) => {
        registry.registerToolCallBatch(contextId, "second-batch", ["shared-call"]);
        await Promise.resolve();
        return registry.readToolCallBatchId(contextId, "shared-call");
      }),
    ]);

    expect([firstBatch, secondBatch]).toEqual(["first-batch", "second-batch"]);
    expect(registry.size).toBe(0);
  });

  test("rejects missing and stale ids without reviving released state", () => {
    const registry = new AgentPiTurnContextRegistry();
    const contextId = registry.register(createContext("stale"));
    registry.registerToolCallBatch(contextId, "stale-batch", ["stale-call"]);
    registry.release(contextId);

    expect(registry.acquire(undefined)).toBeUndefined();
    expect(registry.acquire("missing-context")).toBeUndefined();
    expect(registry.acquire(contextId)).toBeUndefined();
    expect(registry.readToolCallBatchId(contextId, "stale-call")).toBeUndefined();
    expect(registry.size).toBe(0);
  });
});

function createContext(requestId: string): AgentPiTurnContext {
  const toolAccessGrant = emptyAgentToolAccessGrant();
  return {
    requestId,
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
  };
}
