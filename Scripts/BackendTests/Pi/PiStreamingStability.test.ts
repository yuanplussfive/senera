import { describe, expect, test } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import type { AgentPiTurnRequest } from "../../../Source/AgentSystem/Pi/AgentPiTurnTypes.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
import type { AgentPiRunEvent } from "../../../Source/AgentSystem/Pi/AgentPiSessionEvents.js";
import {
  AgentPiSessionMutationService,
  type AgentPiSessionMutationRuntime,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import {
  AgentPiTurnExecutor,
  type AgentPiTurnRuntimePort,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import {
  AgentPiDiagnosticSources,
  createAgentPiDiagnosticEvent,
  type AgentPiDiagnosticEvent,
} from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import type { AgentPiModelProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";

describe("Pi streaming stability", () => {
  test("projects ordered model deltas without emitting internal diagnostics as domain events", async () => {
    const emitted: Array<{ kind: string; data: unknown }> = [];
    const turnState = createTurnState("streaming-request", 1);
    const collector = new AgentPiRunCollector({
      requestId: "streaming-request",
      step: 1,
      onEvent: async (event) => {
        emitted.push(event);
      },
      turnState,
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(messageUpdate("first"));
    await collector.collect(messageUpdate("first second"));
    await collector.collect(assistantMessageEvent("message_end", "first second"));
    await collector.drain();

    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelDelta)).toEqual([
      expect.objectContaining({ data: { text: "first", messageIndex: 0 } }),
      expect.objectContaining({ data: { text: " second", messageIndex: 0 } }),
    ]);
    expect(emitted.map((event) => event.kind).filter((kind) => kind !== AgentEventKinds.RunActivityChanged)).toEqual([
      AgentEventKinds.ModelStarted,
      AgentEventKinds.ModelDelta,
      AgentEventKinds.ModelDelta,
      AgentEventKinds.ModelCompleted,
    ]);
    expect(collector.snapshot()).not.toHaveProperty("events");
  });

  test("includes provider identity on Pi model lifecycle events", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const turnState = createTurnState("provider-metadata-request", 1);
    const collector = new AgentPiRunCollector({
      requestId: "provider-metadata-request",
      step: 1,
      turnState,
      modelProvider: {
        id: "provider_pi",
        kind: "OpenAICompatible",
        endpoint: "Responses",
        baseUrl: "https://example.test/v1",
        model: "gpt-6-luna",
      },
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(assistantMessageEvent("message_end", "完成"));

    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelStarted)[0]?.data.provider).toMatchObject({
      id: "provider_pi",
      model: "gpt-6-luna",
    });
    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelCompleted)[0]?.data.provider).toMatchObject({
      id: "provider_pi",
      model: "gpt-6-luna",
    });
  });

  test("projects assistant message lifecycles and resets cumulative text between Pi turns", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const turnState = createTurnState("lifecycle-request", 2);
    const collector = new AgentPiRunCollector({
      requestId: "lifecycle-request",
      step: 2,
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
      turnState,
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(messageUpdate("first response"));
    await collector.collect(assistantMessageEvent("message_end", "first response"));
    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(messageUpdate("second response"));
    await collector.collect(assistantMessageEvent("message_end", "second response"));
    await collector.drain();

    expect(
      emitted
        .filter((event) => event.kind === AgentEventKinds.RunActivityChanged)
        .map((event) => ({ activity: event.data.activity, state: event.data.state, source: event.data.source })),
    ).toEqual([
      {
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Started,
        source: undefined,
      },
      {
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Completed,
        source: undefined,
      },
      {
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Started,
        source: undefined,
      },
      {
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Completed,
        source: undefined,
      },
    ]);
    expect(
      emitted.filter((event) => event.kind === AgentEventKinds.ModelDelta).map((event) => event.data.text),
    ).toEqual(["first response", "second response"]);
  });

  test("streams Pi thinking blocks separately and persists only the completed block", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const turnState = createTurnState("thinking-request", 3);
    const collector = new AgentPiRunCollector({
      requestId: "thinking-request",
      step: 3,
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
      turnState,
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(thinkingUpdate("thinking_start", 2));
    await collector.collect(thinkingUpdate("thinking_delta", 2, "先检查"));
    await collector.collect(thinkingUpdate("thinking_delta", 2, "输入和约束。"));
    await collector.collect(thinkingUpdate("thinking_end", 2, undefined, "先检查输入和约束。"));
    await collector.collect(messageUpdate("最终答复"));
    await collector.collect(assistantMessageEvent("message_end", "最终答复"));
    await collector.drain();

    expect(
      emitted.filter((event) => event.kind === AgentEventKinds.ModelThinkingDelta).map((event) => event.data.delta),
    ).toEqual(["先检查", "输入和约束。"]);
    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelThinkingCompleted)).toEqual([
      expect.objectContaining({
        data: {
          messageIndex: 0,
          contentIndex: 2,
          content: "先检查输入和约束。",
          status: "complete",
        },
      }),
    ]);
    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelDelta)).toEqual([
      expect.objectContaining({ data: { text: "最终答复", messageIndex: 0 } }),
    ]);
  });

  test("assigns thinking blocks distinct indexes for assistant messages in one Pi step", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const finalMessageIndexes: number[] = [];
    const turnState = createTurnState("thinking-message-index-request", 3);
    const collector = new AgentPiRunCollector({
      requestId: "thinking-message-index-request",
      step: 3,
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
      onFinalResponseAvailable: (_content, messageIndex) => {
        finalMessageIndexes.push(messageIndex);
      },
      turnState,
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(thinkingUpdate("thinking_start", 0));
    await collector.collect(thinkingUpdate("thinking_delta", 0, "first response reasoning"));
    await collector.collect(thinkingUpdate("thinking_end", 0, undefined, "first response reasoning"));
    await collector.collect(assistantMessageEvent("message_end", "tool preface", "toolUse"));
    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(thinkingUpdate("thinking_start", 0));
    await collector.collect(thinkingUpdate("thinking_delta", 0, "final response reasoning"));
    await collector.collect(thinkingUpdate("thinking_end", 0, undefined, "final response reasoning"));
    await collector.collect(assistantMessageEvent("message_end", "final response"));

    expect(
      emitted
        .filter((event) => event.kind === AgentEventKinds.ModelThinkingCompleted)
        .map((event) => event.data.messageIndex),
    ).toEqual([0, 1]);
    expect(finalMessageIndexes).toEqual([1]);
  });

  test("persists a partial thinking block as interrupted when Pi ends the agent stream", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const turnState = createTurnState("interrupted-thinking-request", 1);
    const collector = new AgentPiRunCollector({
      requestId: "interrupted-thinking-request",
      step: 1,
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
      turnState,
    });

    turnState.beginModelRequest();
    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(thinkingUpdate("thinking_start", 0));
    await collector.collect(thinkingUpdate("thinking_delta", 0, "partial reasoning"));
    await collector.collect({ type: "agent_end", messages: [], willRetry: false });

    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelThinkingCompleted)).toEqual([
      expect.objectContaining({
        data: {
          messageIndex: 0,
          contentIndex: 0,
          content: "partial reasoning",
          status: "interrupted",
        },
      }),
    ]);
  });

  test("applies model-delta backpressure through the Pi turn executor", async () => {
    const session = new BackpressurePiSession();
    const executor = new AgentPiTurnExecutor({
      runtime: createTurnRuntime(session),
    });
    let releaseDelta!: () => void;
    const deltaGate = new Promise<void>((resolve) => {
      releaseDelta = resolve;
    });
    let deltaDeliveryStarted = false;

    const run = executor.run(createRunPiTurnCommand(), async (event) => {
      if (event.kind === AgentEventKinds.ModelDelta) {
        deltaDeliveryStarted = true;
        await deltaGate;
      }
    });

    await session.promptStarted;
    await Promise.resolve();
    const promptWasBlocked = !session.promptCompleted;

    releaseDelta();
    await run;

    expect(deltaDeliveryStarted).toBe(true);
    expect(promptWasBlocked).toBe(true);
  });

  test("forwards native Pi thinking events through the turn executor", async () => {
    const session = new BackpressurePiSession(true);
    const executor = new AgentPiTurnExecutor({ runtime: createTurnRuntime(session) });
    const emitted: Array<{ kind: string; data: unknown }> = [];

    await executor.run(createRunPiTurnCommand(), async (event) => {
      emitted.push(event);
    });

    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.ModelStarted,
          data: expect.objectContaining({
            provider: expect.objectContaining({ id: "backpressure-model" }),
          }),
        }),
      ]),
    );
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.ModelThinkingDelta,
          data: { messageIndex: 0, contentIndex: 1, delta: "checking live wiring" },
        }),
        expect.objectContaining({
          kind: AgentEventKinds.ModelThinkingCompleted,
          data: {
            messageIndex: 0,
            contentIndex: 1,
            content: "checking live wiring",
            status: "complete",
          },
        }),
      ]),
    );
  });

  test("reports Pi session mutations through diagnostics and releases their runtime lease", async () => {
    let releases = 0;
    const diagnostics: AgentPiDiagnosticEvent[] = [];
    const runtime = {
      services: {
        pi: {
          rewindSession: async () => true,
          resetSession: async () => false,
          forkSession: async () => false,
          compactSession: async () => undefined,
          sessionStatus: async () => undefined,
          exportSession: async () => undefined,
        },
      },
    } satisfies AgentPiSessionMutationRuntime;
    const mutations = new AgentPiSessionMutationService({
      acquireRuntime: () => ({
        runtime,
        release: () => {
          releases += 1;
        },
      }),
      diagnostics: (event) => {
        diagnostics.push(event);
      },
    });

    await expect(
      mutations.rewind({
        sessionId: "rewind-session",
        entryId: "turn-boundary",
      }),
    ).resolves.toBe(true);
    await expect(mutations.reset({ sessionId: "missing-session" })).resolves.toBe(false);
    await expect(mutations.status({ sessionId: "missing-session" })).resolves.toBeUndefined();

    expect(releases).toBe(3);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: AgentPiDiagnosticSources.Substrate,
        name: "session.rewind.completed",
        details: expect.objectContaining({
          outcome: "completed",
          runtimeAcquireMs: expect.any(Number),
          operationMs: expect.any(Number),
          durationMs: expect.any(Number),
        }),
      }),
      expect.objectContaining({
        name: "session.reset.completed",
        details: expect.objectContaining({ outcome: "unchanged" }),
      }),
      expect.objectContaining({
        name: "session.status.completed",
        details: expect.objectContaining({ outcome: "unavailable" }),
      }),
    ]);
  });

  test("bounds Pi diagnostic details before they reach a sink", () => {
    const diagnostic = createAgentPiDiagnosticEvent({
      context: { requestId: "diagnostic-request", step: 1 },
      source: AgentPiDiagnosticSources.Session,
      name: "before_provider_payload",
      details: {
        text: "x".repeat(8_000),
        entries: Array.from({ length: 40 }, (_, index) => index),
        nested: {
          one: {
            two: {
              three: {
                four: {
                  five: {
                    six: "hidden",
                  },
                },
              },
            },
          },
        },
      },
    });
    const details = diagnostic.details as {
      text: string;
      entries: unknown[];
      nested: { one: { two: { three: { four: unknown } } } };
    };

    expect(details.text.length).toBeLessThan(1_050);
    expect(details.text).toContain("[truncated]");
    expect(details.entries.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(details).length).toBeLessThan(20_000);
  });

  test("does not read every property from a wide trace payload", () => {
    let reads = 0;
    const widePayload: Record<string, unknown> = {};
    for (let index = 0; index < 512; index += 1) {
      Object.defineProperty(widePayload, `field_${index}`, {
        enumerable: true,
        get: () => {
          reads += 1;
          return index;
        },
      });
    }

    const diagnostic = createAgentPiDiagnosticEvent({
      context: { requestId: "wide-diagnostic-request", step: 1 },
      source: AgentPiDiagnosticSources.Session,
      name: "before_provider_payload",
      details: widePayload,
    });

    expect(reads).toBeLessThan(40);
    expect(Object.keys(diagnostic.details as Record<string, unknown>)).toHaveLength(25);
  });
});

function messageUpdate(text: string): AgentPiRunEvent {
  return {
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text,
        },
      ],
    },
    assistantMessageEvent: {},
  } as unknown as AgentPiRunEvent;
}

function thinkingUpdate(
  type: "thinking_start" | "thinking_delta" | "thinking_end",
  contentIndex: number,
  delta?: string,
  content?: string,
): AgentPiRunEvent {
  return {
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: {
      type,
      contentIndex,
      ...(delta === undefined ? {} : { delta }),
      ...(content === undefined ? {} : { content }),
      partial: { role: "assistant", content: [] },
    },
  } as unknown as AgentPiRunEvent;
}

function assistantMessageEvent(
  type: "message_start" | "message_end",
  text: string,
  stopReason: string = "stop",
): AgentPiRunEvent {
  return {
    type,
    message: {
      role: "assistant",
      ...(type === "message_end" ? { stopReason } : {}),
      content: [{ type: "text", text }],
    },
  } as AgentPiRunEvent;
}

function createModel(): AgentPiModelProjection {
  return {
    id: "test-model",
    name: "test-model",
    api: "senera-planning",
    provider: "senera",
    baseUrl: "senera://planning",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

class BackpressurePiSession {
  private listener: ((event: AgentSessionEvent) => void | Promise<void>) | undefined;
  constructor(private readonly streamThinking = false) {}
  private resolvePromptStarted!: () => void;
  readonly promptStarted = new Promise<void>((resolve) => {
    this.resolvePromptStarted = resolve;
  });
  promptCompleted = false;

  subscribe(listener: (event: AgentSessionEvent) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  async markTurnBoundary(): Promise<string> {
    return "backpressure-boundary";
  }

  async prompt(): Promise<void> {
    this.resolvePromptStarted();
    if (this.streamThinking) {
      await this.listener?.(assistantMessageEvent("message_start", "") as unknown as AgentSessionEvent);
      await this.listener?.(thinkingUpdate("thinking_start", 1) as unknown as AgentSessionEvent);
      await this.listener?.(
        thinkingUpdate("thinking_delta", 1, "checking live wiring") as unknown as AgentSessionEvent,
      );
      await this.listener?.(
        thinkingUpdate("thinking_end", 1, undefined, "checking live wiring") as unknown as AgentSessionEvent,
      );
      await this.listener?.(assistantMessageEvent("message_end", "") as unknown as AgentSessionEvent);
    }
    if (!this.streamThinking) await this.listener?.(messageUpdate("partial"));
    this.promptCompleted = true;
  }

  async steer(): Promise<void> {}

  async followUp(): Promise<void> {}

  async nextTurn(): Promise<void> {}

  async setResources(): Promise<void> {}

  async abort(): Promise<void> {}

  dispose(): void {}

  getLastAssistantText(): string {
    return "partial";
  }

  getActiveToolNames(): string[] {
    return [];
  }
}

function createTurnRuntime(session: BackpressurePiSession): AgentPiTurnRuntimePort {
  return {
    services: {
      pi: {
        model: () => createModel(),
        leaseTurn: async (options) => {
          options.turnState?.beginModelRequest();
          return {
            session: session as unknown as AgentPiSession,
            piSessionId: "backpressure-session",
          };
        },
      },
      piSessions: new AgentPiActiveSessionRegistry(),
      retrieval: {
        afterToolResults: () => ({ loadedTools: [], observation: undefined }) as never,
        createToolExposure: (grant) => new AgentToolExposureState(grant),
      },
    },
    modelProviderConfig: {
      Id: "backpressure-model",
      TimeoutMs: 1_000,
    } as AgentPiTurnRuntimePort["modelProviderConfig"],
    agentLoopConfig: {
      PiTurnLeaseTimeoutMs: 1_000,
      PiSessions: { Compaction: { Enabled: true } },
    },
    tokenEstimator: {
      estimate: (text: string) => ({ tokenCount: text.length }),
    },
    promptConfig: () => ({
      UserMessageEnvelope: true,
      TimeZone: "Asia/Shanghai",
      BamlToolAttribution: true,
    }),
  };
}

function createTurnState(requestId: string, step: number): AgentPiTurnState {
  const toolAccessGrant = emptyAgentToolAccessGrant();
  return new AgentPiTurnState({
    systemPrompt: "Test agent system context.",
    userMessage: "Test streaming request.",
    approvalMode: "agent",
    requestId,
    step,
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 128_000,
      outputReserveTokens: 8_192,
    }),
  });
}

function createRunPiTurnCommand(): AgentPiTurnRequest {
  return {
    approvalMode: "agent",
    sessionId: "backpressure-session",
    requestId: "backpressure-request",
    step: 1,
    input: "stream this response",
    prompt: "stream this response",
    rootCommand: toolRootCommand(),
    loadedToolNames: [],
    nativeToolNames: [],
    toolAccessGrant: emptyAgentToolAccessGrant(),
    activeSkills: [],
  };
}
