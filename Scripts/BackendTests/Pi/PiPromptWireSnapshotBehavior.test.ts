import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { AgentNativeToolApi } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
import {
  createAgentPromptWireCapture,
  projectAgentPromptCacheRetention,
  projectAgentStablePrefixBytes,
  projectAgentStablePrefixRevision,
  resolveAgentPromptCacheObservation,
  resolveAgentPromptCacheStrategy,
  verifyAgentPromptWireStablePrefix,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentPromptWireSnapshot.js";

describe("Pi prompt wire snapshot", () => {
  test("captures the post-projection payload and exact HTTP body identity", async () => {
    const capture = createAgentPromptWireCapture({
      fetch: async () => new Response("", { status: 200 }),
    });
    const model = modelFor("openai-responses");
    await capture.onPayload({ messages: [{ role: "system", content: "stable" }] }, model);
    await capture.fetch("https://example.test/v1/responses", {
      method: "POST",
      body: '{"messages":[{"role":"system","content":"stable"}]}',
    });

    const snapshot = capture.snapshot({
      model,
      sessionId: "session-a",
      logicalCacheScope: "logical-a",
      providerCacheScope: "provider-a",
      stablePrefixRevision: "stable-revision",
      stablePrefixBytes: 12,
      retention: "long",
      observation: "hit",
      usage: { cacheRead: 128, cacheWrite: 0 },
    });

    expect(snapshot).toMatchObject({
      api: "openai-responses",
      sessionId: "session-a",
      logicalCacheScope: "logical-a",
      providerCacheScope: "provider-a",
      observation: "hit",
      wireBodyBytes: 51,
      cacheReadTokens: 128,
    });
    expect(snapshot.payloadDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.wireBodyDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.wireStablePrefixDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("verifies the exact serialized prefix across volatile request changes", async () => {
    const capture = createAgentPromptWireCapture({
      fetch: async () => new Response("", { status: 200 }),
    });
    const model = modelFor("openai-responses");
    const stable = '{"system":"stable","tools":[{"name":"ToolSearch"}],"messages":';
    await capture.fetch("https://example.test/v1/responses", { body: `${stable}[{"content":"one"}]` });
    const first = capture.snapshot({
      model,
      stablePrefixRevision: "stable",
      stablePrefixBytes: Buffer.byteLength(stable),
      retention: "long",
      observation: "requested",
      usage: { cacheRead: 0, cacheWrite: 0 },
    });
    await capture.fetch("https://example.test/v1/responses", { body: `${stable}[{"content":"two"}]` });
    const second = capture.snapshot({
      model,
      stablePrefixRevision: "stable",
      stablePrefixBytes: Buffer.byteLength(stable),
      retention: "long",
      observation: "requested",
      usage: { cacheRead: 0, cacheWrite: 0 },
    });

    expect(first.wireBodyDigest).not.toBe(second.wireBodyDigest);
    expect(verifyAgentPromptWireStablePrefix(first, second)).toEqual({ stable: true });
  });

  test("projects the provider payload instead of slicing the JSON envelope", async () => {
    const capture = createAgentPromptWireCapture({
      fetch: async () => new Response("", { status: 200 }),
    });
    const model = modelFor("openai-responses");
    const stablePayload = {
      model: "test-model",
      input: [
        { role: "developer", content: "stable system" },
        { role: "user", content: [{ type: "input_text", text: "volatile" }] },
      ],
      tools: [{ type: "function", name: "ToolSearch" }],
    };
    await capture.onPayload(stablePayload, model);
    const first = capture.snapshot({
      model,
      stablePrefixRevision: "stable",
      stablePrefixBytes: 1,
      retention: "long",
      observation: "requested",
      usage: { cacheRead: 0, cacheWrite: 0 },
    });
    await capture.onPayload(
      {
        ...stablePayload,
        input: [
          stablePayload.input[0],
          { role: "user", content: [{ type: "input_text", text: "another volatile turn" }] },
        ],
      },
      model,
    );
    const second = capture.snapshot({
      model,
      stablePrefixRevision: "stable",
      stablePrefixBytes: 1,
      retention: "long",
      observation: "requested",
      usage: { cacheRead: 0, cacheWrite: 0 },
    });

    expect(first.wireStablePrefixSource).toBe("provider-projection");
    expect(second.wireStablePrefixSource).toBe("provider-projection");
    expect(verifyAgentPromptWireStablePrefix(first, second)).toEqual({ stable: true });
  });

  test("does not infer a hit from a cache scope when the provider reports no cache tokens", () => {
    expect(resolveAgentPromptCacheObservation("implicit-prefix", { cacheRead: 0, cacheWrite: 0 })).toBe("requested");
    expect(resolveAgentPromptCacheObservation("implicit-prefix", { cacheRead: 0, cacheWrite: 12 })).toBe("miss");
    expect(resolveAgentPromptCacheObservation("implicit-prefix", { cacheRead: 12, cacheWrite: 0 })).toBe("hit");
    expect(resolveAgentPromptCacheObservation("unsupported", { cacheRead: 0, cacheWrite: 0 })).toBe("unsupported");
  });

  test("keeps observation best effort when an adapter payload is not canonical JSON", async () => {
    const capture = createAgentPromptWireCapture({});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(capture.onPayload(cyclic, modelFor("openai-responses"))).resolves.toBeUndefined();
    const snapshot = capture.snapshot({
      model: modelFor("openai-responses"),
      stablePrefixRevision: "revision",
      stablePrefixBytes: 1,
      retention: "long",
      observation: "requested",
      usage: { cacheRead: 0, cacheWrite: 0 },
    });
    expect(snapshot.payloadDigest).toBeUndefined();
    expect(snapshot.payloadBytes).toBeUndefined();
  });

  test("keeps stable prefix identity independent from volatile turn data", () => {
    const baseline = { systemPrompt: "system", tools: [{ name: "ToolSearch" }] };
    const changedTurn = { ...baseline, systemPrompt: "system" };
    expect(projectAgentStablePrefixRevision(baseline)).toBe(projectAgentStablePrefixRevision(changedTurn));
    expect(projectAgentStablePrefixBytes(baseline)).toBe(projectAgentStablePrefixBytes(changedTurn));
    expect(resolveAgentPromptCacheStrategy("google-generative-ai")).toBe("unsupported");
    expect(projectAgentPromptCacheRetention("unsupported", "long")).toBe("none");
  });
});

function modelFor(api: AgentNativeToolApi): Model<AgentNativeToolApi> {
  return {
    id: "test-model",
    name: "Test",
    api,
    provider: "test-provider",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
  } as Model<AgentNativeToolApi>;
}
