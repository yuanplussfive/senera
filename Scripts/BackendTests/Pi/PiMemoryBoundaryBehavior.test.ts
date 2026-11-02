import {
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type Context,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { AgentPiRuntimeExtensionFactory } from "../../../Source/AgentSystem/Pi/AgentPiRuntimeExtensionFactory.js";
import { createTestToolObservationCompressor } from "../Support/PiToolObservationFixtures.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { projectAgentPiMemorySystemPrompt } from "../../../Source/AgentSystem/Pi/AgentPiMemoryBoundary.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { AgentPiNativeToolProvider } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolProvider.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  completedStream,
  createFrame,
  createTurnState,
  nativeApiStreams,
  tool,
  failureMessage,
} from "../Support/PiNativeToolProviderFixtures.js";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) removeDirectory(directory);
});

describe("Pi memory boundaries", () => {
  test("refreshes through the registered native compaction hook and replaces repeated boundaries without appending", async () => {
    const directory = createTemporaryDirectory("senera-pi-memory-hook");
    directories.push(directory);
    const manager = SessionManager.inMemory(directory);
    const initial = createFrame(createTurnState("test-model"), "session", "request");
    const refresh = vi.fn(async (boundary: { id: string; summary: string }) => `Host ${boundary.summary}`);
    const onEvent = vi.fn();
    const frame = new AgentPiMutableSessionFrame({
      ...initial.snapshot(),
      systemPrompt: "Host original",
      refreshMemoryBoundary: refresh,
      interaction: { surface: "console" },
      onEvent,
    });
    const registration = new AgentPiRuntimeExtensionFactory({
      observationCompressor: createTestToolObservationCompressor(),
      observationTokenBudget: 1024,
    }).create(frame, manager);
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [registration],
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    expect(loaded.errors).toEqual([]);
    const hooks = loaded.extensions.find((extension) => extension.handlers.has("session_compact"))!.handlers;
    const before = hooks.get("before_agent_start")![0]!;
    expect(await before({ systemPrompt: "Pi prompt" })).toEqual({
      systemPrompt: "Host original\n\nPi prompt",
    });
    const context: Context = {
      systemPrompt: "Host original\n\nPi prompt",
      tools: [tool("ToolSearch")],
      messages: [{ role: "user", content: "Continue", timestamp: 1 }],
    };
    const compact = hooks.get("session_compact")![0]!;
    const event = (id: string, summary: string) => ({
      type: "session_compact",
      compactionEntry: {
        id,
        type: "compaction",
        parentId: null,
        timestamp: new Date().toISOString(),
        summary,
        firstKeptEntryId: "kept",
        tokensBefore: 1000,
      },
      reason: "threshold",
      fromExtension: false,
    });
    await compact(event("first", "summary one"));
    await compact(event("first", "summary one"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      onEvent.mock.calls.map(([event]) => event).filter((event) => event.kind === AgentEventKinds.SessionCompacted),
    ).toEqual([
      {
        kind: AgentEventKinds.SessionCompacted,
        context: { sessionId: "session", requestId: "request", step: 1 },
        data: { sessionId: "session", tokensBefore: 1000, boundaryId: "first" },
      },
    ]);
    expect(getCurrentSystemPrompt((await frame.snapshot().prepareModelInput!(context)).messages)).toBe(
      "Host summary one\n\nPi prompt",
    );
    await compact(event("second", "summary two"));
    const second = await frame.snapshot().prepareModelInput!(context);
    expect(getCurrentSystemPrompt(second.messages)).toBe("Host summary two\n\nPi prompt");
    expect(getCurrentTools(second.messages).map((entry) => entry.name)).toContain("ToolSearch");
  });
  test("replaces the actual system transcript while preserving extension instructions and active tools", () => {
    const messages: Context["messages"] = [
      {
        role: "system",
        content: "Host background v1\n\nExtension instructions",
        toolsAdded: [tool("ToolSearch")],
        timestamp: 1,
      },
      { role: "user", content: "Continue", timestamp: 2 },
    ];
    const context = { messages };
    const updated = projectAgentPiMemorySystemPrompt(context, "Host background v1", "Host background v2");
    expect(getCurrentSystemPrompt(updated.messages)).toBe("Host background v2\n\nExtension instructions");
    expect(getCurrentTools(updated.messages).map((entry) => entry.name)).toEqual(["ToolSearch"]);
    expect(updated.messages.filter((entry) => entry.role !== "system")).toEqual(messages.slice(1));
    expect(projectAgentPiMemorySystemPrompt(updated, "Host background v1", "Host background v2")).toBe(updated);
    expect(() => projectAgentPiMemorySystemPrompt(context, "Unknown boundary", "Replacement")).toThrow("expected host");
  });

  test("does not let a delayed boundary overwrite the next leased turn", async () => {
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const initial = createFrame(createTurnState("test-model"), "session", "first").snapshot();
    const frame = new AgentPiMutableSessionFrame({
      ...initial,
      systemPrompt: "first",
      refreshMemoryBoundary: () => pending,
    });
    const refresh = frame.refreshMemoryBoundary({ id: "compaction", summary: "summary" });
    frame.update({ ...initial, requestId: "second", systemPrompt: "second" }, []);
    release("stale first");
    await refresh;
    expect(frame.snapshot().systemPrompt).toBe("second");
  });

  test("sends refreshed memory on normal requests, preserves Pi compaction instructions, and acknowledges only a response", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const base = createFrame(createTurnState(modelProvider.Model), "session", "request");
    const acknowledge = vi.fn();
    const prepare = vi.fn(async (context: Context) =>
      projectAgentPiMemorySystemPrompt(context, "Original host", "Refreshed host"),
    );
    const frame = new AgentPiMutableSessionFrame({
      ...base.snapshot(),
      prepareModelInput: prepare,
      onModelMemoryDelivered: acknowledge,
    });
    const requests: Context[] = [];
    let fail = false;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        requests.push(context);
        if (!fail) return completedStream(model, [{ type: "text", text: "done" }]);
        const stream = createAssistantMessageEventStream();
        const error = failureMessage(model, "Disconnected");
        stream.push({ type: "error", reason: "error", error });
        stream.end(error);
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0]!;
    const context: Context = {
      systemPrompt: "Original host\n\nNative tools",
      messages: [{ role: "user", content: "Continue", timestamp: 1 }],
      tools: [tool("ToolSearch")],
    };
    expect((await provider.streamSimple(model, context).result()).stopReason).toBe("stop");
    expect(getCurrentSystemPrompt(requests[0]!.messages)).toBe("Refreshed host\n\nNative tools");
    expect(getCurrentTools(requests[0]!.messages).map((entry) => entry.name)).toContain("ToolSearch");
    expect(acknowledge).toHaveBeenCalledTimes(1);
    await provider
      .streamSimple(
        model,
        { systemPrompt: "Pi native summary instructions", messages: context.messages },
        { cacheRetention: "none" },
      )
      .result();
    expect(getCurrentSystemPrompt(normalizeContext(requests[1]!).messages)).toBe("Pi native summary instructions");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    fail = true;
    expect((await provider.streamSimple(model, context).result()).stopReason).toBe("error");
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});
