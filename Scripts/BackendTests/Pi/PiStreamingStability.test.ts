import { describe, expect, test } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import type { AgentPiTurnRequest } from "../../../Source/AgentSystem/Pi/AgentPiTurnTypes.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
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
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";

describe("Pi streaming stability", () => {
  test("projects ordered model deltas without emitting internal diagnostics as domain events", async () => {
    const emitted: Array<{ kind: string; data: unknown }> = [];
    const collector = new AgentPiRunCollector({
      requestId: "streaming-request",
      step: 1,
      onEvent: async (event) => {
        emitted.push(event);
      },
      turnContexts: new AgentPiTurnContextRegistry(),
    });

    await collector.collect(messageUpdate("first"));
    await collector.collect(messageUpdate("first second"));
    await collector.drain();

    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelDelta)).toEqual([
      expect.objectContaining({ data: { text: "first" } }),
      expect.objectContaining({ data: { text: " second" } }),
    ]);
    expect(emitted.every((event) => event.kind === AgentEventKinds.ModelDelta)).toBe(true);
    expect(collector.snapshot()).not.toHaveProperty("events");
  });

  test("projects assistant message lifecycles and resets cumulative text between Pi turns", async () => {
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const collector = new AgentPiRunCollector({
      requestId: "lifecycle-request",
      step: 2,
      onEvent: async (event) => {
        emitted.push(event as { kind: string; data: Record<string, unknown> });
      },
      turnContexts: new AgentPiTurnContextRegistry(),
    });

    await collector.collect(assistantMessageEvent("message_start", ""));
    await collector.collect(messageUpdate("first response"));
    await collector.collect(assistantMessageEvent("message_end", "first response"));
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

function messageUpdate(text: string): AgentEvent {
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
  } as unknown as AgentEvent;
}

function assistantMessageEvent(type: "message_start" | "message_end", text: string): AgentEvent {
  return {
    type,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  } as AgentEvent;
}

function createModel(): AgentPiModelProjection {
  return {
    id: "test-model",
    name: "test-model",
    api: "openai-completions",
    provider: "senera-pi-proxy",
    baseUrl: "http://127.0.0.1:8787/v1",
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
  private listener: ((event: AgentEvent) => void | Promise<void>) | undefined;
  private resolvePromptStarted!: () => void;
  readonly promptStarted = new Promise<void>((resolve) => {
    this.resolvePromptStarted = resolve;
  });
  promptCompleted = false;

  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  async setHistory(): Promise<void> {}

  async markTurnBoundary(): Promise<string> {
    return "backpressure-boundary";
  }

  async prompt(): Promise<void> {
    this.resolvePromptStarted();
    await this.listener?.(messageUpdate("partial"));
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
        leaseTurn: async () => ({
          session: session as unknown as AgentPiSession,
          piSessionId: "backpressure-session",
          historyMigrationRequired: false,
        }),
      },
      piSessions: new AgentPiActiveSessionRegistry(),
      retrieval: { afterToolResults: () => [] },
    },
    modelProviderConfig: {
      Id: "backpressure-model",
      TimeoutMs: 1_000,
    } as AgentPiTurnRuntimePort["modelProviderConfig"],
    agentLoopConfig: {
      PiTurnLeaseTimeoutMs: 1_000,
    },
    tokenEstimator: {
      estimate: (text: string) => ({ tokenCount: text.length }),
    },
    piTurnContexts: new AgentPiTurnContextRegistry(),
  };
}

function createRunPiTurnCommand(): AgentPiTurnRequest {
  return {
    sessionId: "backpressure-session",
    requestId: "backpressure-request",
    step: 1,
    input: "stream this response",
    prompt: "stream this response",
    conversationEntries: [],
    rootCommand: toolRootCommand(),
    loadedToolNames: [],
    toolAccessGrant: emptyAgentToolAccessGrant(),
    activeSkills: [],
  };
}
