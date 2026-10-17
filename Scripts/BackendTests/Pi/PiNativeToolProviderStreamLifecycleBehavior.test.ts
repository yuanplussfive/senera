import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
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

describe("Pi native tool provider stream lifecycle", () => {
  test("reports an upstream stream error as a provider failure when the caller was not aborted", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-failure-session", "provider-failure-request");
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model) => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "start",
          partial: { ...failureMessage(model, "stream_read_error"), content: [], stopReason: "pending" },
        });
        stream.push({ type: "error", reason: "error", error: failureMessage(model, "stream_read_error") });
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Continue.", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result).toMatchObject({ stopReason: "error" });
    expect(result.errorMessage).toContain("stream_read_error");
  });

  test("reports the provider request deadline as an error instead of caller cancellation", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      FirstTokenTimeoutMs: -1,
      MaxRequestMs: 10,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-timeout-session", "provider-timeout-request");
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            const failure = failureMessage(model, "upstream aborted after the provider deadline");
            stream.push({ type: "error", reason: "aborted", error: failure });
            stream.end(failure);
          },
          { once: true },
        );
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Wait for the deadline.", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).not.toContain("upstream aborted after the provider deadline");
  });

  test("preserves caller cancellation when the upstream reports an error after abort", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-cancel-session", "provider-cancel-request");
    const abortController = new AbortController();
    abortController.abort(new Error("User stopped the run."));
    let observedSignal: AbortSignal | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, _context, options) => {
        observedSignal = options?.signal;
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "error", reason: "error", error: failureMessage(model, "stream_read_error") });
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(
        model,
        {
          messages: [{ role: "user", content: "Stop.", timestamp: 1 }],
          tools: [tool("ToolSearch")],
        },
        { signal: abortController.signal },
      )
      .result();

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ stopReason: "aborted", errorMessage: "User stopped the run." });
  });
});
