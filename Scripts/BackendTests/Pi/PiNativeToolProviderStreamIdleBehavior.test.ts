import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentPiNativeToolProvider } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolProvider.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createFrame,
  createTurnState,
  failureMessage,
  nativeApiStreams,
  tool,
} from "../Support/PiNativeToolProviderFixtures.js";

describe("Pi native tool provider stream idle timeout", () => {
  afterEach(() => vi.useRealTimers());

  test("enforces the stream idle budget even when the upstream ignores cancellation", async () => {
    vi.useFakeTimers();
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      FirstTokenTimeoutMs: 1_000,
      MaxRequestMs: 61_000,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-idle-session", "provider-idle-request");
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model) => {
        const stream = createAssistantMessageEventStream();
        const partial = {
          ...failureMessage(model, "partial"),
          content: [{ type: "text" as const, text: "partial" }],
          stopReason: "pending" as const,
        };
        stream.push({ type: "text_delta", contentIndex: 0, delta: "partial", partial });
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const resultPromise = provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Wait for the stream idle deadline.", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();
    let settled = false;
    void resultPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("stream_idle");
  });
});
