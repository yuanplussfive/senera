import { describe, expect, test } from "vitest";
import type { AgentEvent, AgentHarness } from "@earendil-works/pi-agent-core";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentLoopCommand } from "../../../Source/AgentSystem/Loop/AgentLoopStateTypes.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiHarnessSession } from "../../../Source/AgentSystem/Pi/AgentPiHarnessSession.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
import {
  AgentPiSessionBootstrapService,
  type AgentPiSessionBootstrapRuntime,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionBootstrapService.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import {
  AgentPiTurnExecutor,
  type AgentPiTurnRuntimePort,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import { createPiTraceEvent } from "../../../Source/AgentSystem/Pi/AgentPiTraceProjector.js";
import type { AgentPiModelProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";

describe("Pi streaming stability", () => {
  test("awaits asynchronous core-event subscribers through the harness adapter", async () => {
    const harness = new AwaitingHarness();
    const session = new AgentPiHarnessSession(harness as unknown as AgentHarness, {
      model: createModel(),
      tools: [],
    });
    let releaseListener!: () => void;
    const listenerGate = new Promise<void>((resolve) => {
      releaseListener = resolve;
    });
    let listenerSettled = false;

    session.subscribe(async () => {
      await listenerGate;
      listenerSettled = true;
    });

    const delivery = harness.dispatch(messageUpdate("partial"));
    await Promise.resolve();
    expect(listenerSettled).toBe(false);

    releaseListener();
    await delivery;
    expect(listenerSettled).toBe(true);
  });

  test("projects ordered model deltas without retaining redundant Pi traces", async () => {
    const emitted: Array<{ kind: string; data: unknown }> = [];
    const collector = new AgentPiRunCollector({
      requestId: "streaming-request",
      step: 1,
      onEvent: async (event) => {
        emitted.push(event);
      },
    });

    await collector.collect(messageUpdate("first"));
    await collector.collect(messageUpdate("first second"));
    await collector.drain();

    expect(emitted.filter((event) => event.kind === AgentEventKinds.ModelDelta)).toEqual([
      expect.objectContaining({ data: { text: "first" } }),
      expect.objectContaining({ data: { text: " second" } }),
    ]);
    expect(emitted.some((event) => event.kind === AgentEventKinds.PiTrace)).toBe(false);
    expect(collector.snapshot()).not.toHaveProperty("events");
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

  test("releases the runtime lease after Pi session bootstrap", async () => {
    let releases = 0;
    let disposed = false;
    const runtime = {
      agentLoopConfig: {
        PiSessionCreateTimeoutMs: 1_000,
      },
      services: {
        pi: {
          createSession: async () => ({
            session: {
              dispose: () => {
                disposed = true;
              },
              getActiveToolNames: () => [],
            },
            piSessionId: "bootstrap-session",
            historyMigrationRequired: false,
          }),
        },
      },
    } as unknown as AgentPiSessionBootstrapRuntime;
    const bootstrap = new AgentPiSessionBootstrapService({
      acquireRuntime: () => ({
        runtime,
        release: () => {
          releases += 1;
        },
      }),
    });

    await bootstrap.bootstrap({
      sessionId: "bootstrap-session",
      modelProviderId: "deepseek-pro",
    });

    expect(disposed).toBe(true);
    expect(releases).toBe(1);
  });

  test("retains a bootstrap lease until a timed-out session creation settles", async () => {
    let releases = 0;
    let disposed = false;
    let resolveSession!: (value: unknown) => void;
    const lateSession = new Promise<unknown>((resolve) => {
      resolveSession = resolve;
    });
    const runtime = {
      agentLoopConfig: {
        PiSessionCreateTimeoutMs: 1,
      },
      services: {
        pi: {
          createSession: async () => lateSession,
        },
      },
    } as unknown as AgentPiSessionBootstrapRuntime;
    const bootstrap = new AgentPiSessionBootstrapService({
      acquireRuntime: () => ({
        runtime,
        release: () => {
          releases += 1;
        },
      }),
    });

    await bootstrap.bootstrap({ sessionId: "late-bootstrap-session" });
    expect(releases).toBe(0);

    resolveSession({
      session: {
        dispose: () => {
          disposed = true;
        },
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(disposed).toBe(true);
    expect(releases).toBe(1);
  });

  test("bounds diagnostic Pi trace payloads before event serialization", () => {
    const trace = createPiTraceEvent({
      requestId: "trace-request",
      step: 1,
      source: "session",
      eventType: "before_provider_payload",
      payload: {
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
    if (trace.kind !== AgentEventKinds.PiTrace) {
      throw new Error("Expected a Pi trace event.");
    }
    const payload = trace.data.payload as {
      text: string;
      entries: unknown[];
      nested: { one: { two: { three: { four: unknown } } } };
    };

    expect(payload.text.length).toBeLessThan(4_120);
    expect(payload.text).toContain("[truncated]");
    expect(payload.entries).toHaveLength(33);
    expect(payload.nested.one.two.three.four).toBe("[truncated]");
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

    const trace = createPiTraceEvent({
      requestId: "wide-trace-request",
      step: 1,
      source: "session",
      eventType: "before_provider_payload",
      payload: widePayload,
    });
    if (trace.kind !== AgentEventKinds.PiTrace) {
      throw new Error("Expected a Pi trace event.");
    }

    expect(reads).toBeLessThan(40);
    expect(Object.keys(trace.data.payload as Record<string, unknown>)).toHaveLength(33);
  });
});

class AwaitingHarness {
  private listener: ((event: AgentEvent) => void | Promise<void>) | undefined;

  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  async dispatch(event: AgentEvent): Promise<void> {
    await this.listener?.(event);
  }
}

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
        createSession: async () => ({
          session: session as unknown as AgentPiSession,
          piSessionId: "backpressure-session",
          historyMigrationRequired: false,
        }),
      } as AgentPiTurnRuntimePort["services"]["pi"],
      piSessions: new AgentPiActiveSessionRegistry(),
    },
    modelProviderConfig: {
      Id: "backpressure-model",
      TimeoutMs: 1_000,
    } as AgentPiTurnRuntimePort["modelProviderConfig"],
    agentLoopConfig: {
      PiSessionCreateTimeoutMs: 1_000,
    },
    tokenEstimator: {
      estimate: (text: string) => ({ tokenCount: text.length }),
    },
    conversationProjector: new AgentConversationProjector(),
  };
}

function createRunPiTurnCommand(): Extract<AgentLoopCommand, { kind: "run_pi_turn" }> {
  return {
    kind: "run_pi_turn",
    sessionId: "backpressure-session",
    requestId: "backpressure-request",
    step: 1,
    input: "stream this response",
    prompt: "stream this response",
    messages: [],
    conversationEntries: [],
    loadedToolNames: [],
    activeSkills: [],
  };
}
