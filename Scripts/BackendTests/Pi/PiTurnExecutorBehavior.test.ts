import { describe, expect, test, vi } from "vitest";
import type { AgentState } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type {
  AgentPiSession,
  AgentPiSessionEventListener,
  AgentPiSessionOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import {
  AgentPiTurnExecutor,
  type AgentPiTurnRuntimePort,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import type { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import type { AgentPiTurnRequest } from "../../../Source/AgentSystem/Pi/AgentPiTurnTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentPiDiagnosticEvent } from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import { resolveAgentPiTokenBudgetHeadroom } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSettings.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";

describe("Pi turn executor behavior", () => {
  test("uses the native Pi session and clears the active session after a completed turn", async () => {
    const fixture = new PiTurnRuntimeFixture();
    const command = createPiTurnCommand();
    const events: AgentDomainEvent[] = [];

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(command, (event) => {
      events.push(event);
    });

    expect(result).toMatchObject({
      responseText: "The workspace inspection is complete.",
    });
    expect(fixture.session.prompts).toEqual(["Inspect the workspace"]);
    expect(fixture.lastSessionOptions?.tokenBudget?.windowHeadroomTokens).toBe(
      resolveAgentPiTokenBudgetHeadroom({ Enabled: true }, piModel()),
    );
    expect(fixture.activeSessions.get(command.sessionId!)).toBeUndefined();
    expect(fixture.session.disposed).toBe(true);
    expect(fixture.session.unsubscribeCount).toBe(1);
    expect(fixture.afterToolResults).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: command.requestId,
        sessionId: command.sessionId,
        activeSkills: command.activeSkills,
      }),
    );
    expect(events.some((event) => event.kind === AgentEventKinds.ModelDelta)).toBe(true);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.RunActivityChanged)
        .map((event) => ({ activity: event.data.activity, state: event.data.state })),
    ).toEqual([
      { activity: AgentRunActivities.PreparingContext, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.PreparingContext, state: AgentRunActivityStates.Completed },
      { activity: AgentRunActivities.InitializingRuntime, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.InitializingRuntime, state: AgentRunActivityStates.Completed },
      { activity: AgentRunActivities.RunningAgentTurn, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.GeneratingResponse, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.GeneratingResponse, state: AgentRunActivityStates.Completed },
      { activity: AgentRunActivities.RunningAgentTurn, state: AgentRunActivityStates.Completed },
      { activity: AgentRunActivities.FinalizingResponse, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.FinalizingResponse, state: AgentRunActivityStates.Completed },
    ]);
    expect(diagnosticNames(fixture.diagnostics)).toEqual(
      expect.arrayContaining(["turn.started", "session.lease.completed", "turn.completed"]),
    );
  });

  test("keeps the completed response when routing observation fails", async () => {
    const fixture = new PiTurnRuntimeFixture();
    fixture.afterToolResults.mockImplementation(() => {
      throw new Error("routing memory unavailable");
    });

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(createPiTurnCommand());
    expect(result.responseText).toBe("The workspace inspection is complete.");
    expect(result.routingObservation).toBeUndefined();
  });

  test("continues the existing Pi transcript without prompting with a synthetic word", async () => {
    const fixture = new PiTurnRuntimeFixture();
    const command = {
      ...createPiTurnCommand(),
      continueFromTranscript: true,
      continuationSourceRequestId: "source-request",
    };

    await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(command);

    expect(fixture.session.prompts).toEqual([]);
    expect(fixture.session.continuations).toHaveLength(1);
    expect(fixture.session.continuationSourceRequestIds).toEqual(["source-request"]);
  });

  test("publishes the stable answer before post-turn compaction settles", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferCompaction: true });
    const events: AgentDomainEvent[] = [];
    const availableAnswers: string[] = [];
    const command: AgentPiTurnRequest = {
      ...createPiTurnCommand(),
      onFinalResponseAvailable: (content) => {
        availableAnswers.push(content);
      },
    };
    let settled = false;
    const pending = new AgentPiTurnExecutor({ runtime: fixture.runtime })
      .run(command, (event) => {
        events.push(event);
      })
      .finally(() => {
        settled = true;
      });

    await fixture.session.compactionStarted;

    expect(availableAnswers).toEqual(["The workspace inspection is complete."]);
    expect(settled).toBe(false);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.RunActivityChanged)
        .map((event) => ({ activity: event.data.activity, state: event.data.state })),
    ).toContainEqual({
      activity: AgentRunActivities.CompactingContext,
      state: AgentRunActivityStates.Started,
    });

    fixture.session.completeCompaction();
    await expect(pending).resolves.toMatchObject({ responseText: "The workspace inspection is complete." });
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.RunActivityChanged)
        .map((event) => ({ activity: event.data.activity, state: event.data.state })),
    ).toContainEqual({
      activity: AgentRunActivities.CompactingContext,
      state: AgentRunActivityStates.Completed,
    });
  });

  test("aborts an in-flight prompt and releases session resources", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferPrompt: true });
    const command = createPiTurnCommand();
    const controller = new AbortController();
    const executor = new AgentPiTurnExecutor({ runtime: fixture.runtime });

    const pending = executor.run(command, undefined, controller.signal);
    await fixture.session.promptStarted;
    expect(fixture.activeSessions.get(command.sessionId!)?.requestId).toBe(command.requestId);
    controller.abort("operator cancelled the turn");
    fixture.session.completePrompt();

    await expect(pending).rejects.toMatchObject({ name: "AgentCancellationError" });
    expect(fixture.session.abortCount).toBe(1);
    expect(fixture.session.disposed).toBe(true);
    expect(fixture.activeSessions.get(command.sessionId!)).toBeUndefined();
  });

  test("does not apply the per-network timeout to human or tool wait time inside a turn", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferPrompt: true, modelTimeoutMs: 10, maxRequestMs: -1 });
    const command = createPiTurnCommand();
    const pending = new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(command);

    await fixture.session.promptStarted;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fixture.session.disposed).toBe(false);
    expect(fixture.activeSessions.get(command.sessionId!)).toBeDefined();

    fixture.session.completePrompt();
    await expect(pending).resolves.toMatchObject({ responseText: "The workspace inspection is complete." });
  });

  test("does not report lease cancellation before a non-cooperative lease has settled", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferSessionCreate: true });
    const controller = new AbortController();
    const executor = new AgentPiTurnExecutor({ runtime: fixture.runtime });
    const pending = executor.run(createPiTurnCommand(), undefined, controller.signal);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await fixture.sessionCreateStarted;
    controller.abort("cancel during session creation");
    await Promise.resolve();
    expect(settled).toBe(false);

    fixture.completeSessionCreate();
    await expect(pending).rejects.toMatchObject({ name: "AgentCancellationError" });
    await fixture.session.disposedPromise;

    expect(fixture.session.disposed).toBe(true);
  });

  test("cancels the lease operation when its phase deadline expires", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferSessionCreate: true, leaseTimeoutMs: 25 });
    const executor = new AgentPiTurnExecutor({ runtime: fixture.runtime });
    const pending = executor.run(createPiTurnCommand());

    await fixture.sessionCreateStarted;
    await expect(pending).rejects.toMatchObject({
      name: "AgentPiTurnPhaseTimeoutError",
      phase: "session.lease",
      timeoutMs: 25,
    });
    expect(fixture.lastSessionOptions?.signal?.aborted).toBe(true);

    fixture.completeSessionCreate();
    await fixture.session.disposedPromise;
    expect(fixture.session.disposed).toBe(true);
  });

  test("reports a failure diagnostic and disposes a provider-failed session", async () => {
    const fixture = new PiTurnRuntimeFixture({ promptFailure: new Error("provider rejected request") });
    const events: AgentDomainEvent[] = [];

    await expect(
      new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(createPiTurnCommand(), (event) => {
        events.push(event);
      }),
    ).rejects.toThrow("provider rejected request");

    expect(fixture.session.disposed).toBe(true);
    expect(fixture.session.unsubscribeCount).toBe(1);
    expect(diagnosticNames(fixture.diagnostics)).toContain("turn.failed");
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.RunActivityChanged)
        .slice(-2)
        .map((event) => ({ activity: event.data.activity, state: event.data.state })),
    ).toEqual([
      { activity: AgentRunActivities.RunningAgentTurn, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.RunningAgentTurn, state: AgentRunActivityStates.Failed },
    ]);
  });
});

const modelProviderConfig: ResolvedAgentModelProviderConfig = {
  Id: "test-model",
  ProviderId: "test-endpoint",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://model.example/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "test-model",
  ToolPlanningMode: "baml",
  ContextWindowTokens: 128_000,
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 5_000,
  FirstTokenTimeoutMs: 5_000,
  MaxRequestMs: 5_000,
  MaxNetworkRetries: 0,
  RetryBaseDelayMs: 250,
  RetryMaxDelayMs: 10_000,
  RetryAfterMaxDelayMs: 60_000,
  Headers: {},
};

class PiTurnRuntimeFixture {
  readonly activeSessions = new AgentPiActiveSessionRegistry();
  readonly diagnostics: AgentPiDiagnosticEvent[] = [];
  readonly session: ScriptedPiSession;
  readonly runtime: AgentPiTurnRuntimePort;
  readonly afterToolResults = vi.fn(() => ({ loadedTools: [], observation: undefined }) as never);
  lastSessionOptions?: AgentPiSessionOptions;
  private resolveSessionCreateStarted!: () => void;
  private resolveSessionCreate!: () => void;
  private resolveSessionCreateSettled!: () => void;
  readonly sessionCreateStarted = new Promise<void>((resolve) => {
    this.resolveSessionCreateStarted = resolve;
  });
  private readonly sessionCreateGate = new Promise<void>((resolve) => {
    this.resolveSessionCreate = resolve;
  });
  readonly sessionCreateSettled = new Promise<void>((resolve) => {
    this.resolveSessionCreateSettled = resolve;
  });

  constructor(
    private readonly behavior: {
      deferPrompt?: boolean;
      deferCompaction?: boolean;
      deferSessionCreate?: boolean;
      promptFailure?: Error;
      modelTimeoutMs?: number;
      maxRequestMs?: number;
      leaseTimeoutMs?: number;
    } = {},
  ) {
    this.session = new ScriptedPiSession(behavior);
    this.runtime = {
      services: {
        pi: {
          model: () => piModel(),
          leaseTurn: async (options) => {
            this.lastSessionOptions = options;
            if (!options?.turnState) throw new Error("The scripted Pi session requires an active turn state.");
            this.session.setTurnState(options.turnState);
            this.resolveSessionCreateStarted();
            if (this.behavior.deferSessionCreate) {
              await this.sessionCreateGate;
            }
            try {
              return {
                session: this.session,
                piSessionId: options?.sessionId,
              };
            } finally {
              this.resolveSessionCreateSettled();
            }
          },
        },
        piSessions: this.activeSessions,
        retrieval: {
          afterToolResults: this.afterToolResults,
          createToolExposure: (grant) => new AgentToolExposureState(grant),
        },
      },
      modelProviderConfig: {
        ...modelProviderConfig,
        TimeoutMs: behavior.modelTimeoutMs ?? modelProviderConfig.TimeoutMs,
        MaxRequestMs: behavior.maxRequestMs ?? modelProviderConfig.MaxRequestMs,
      },
      agentLoopConfig: {
        PiTurnLeaseTimeoutMs: behavior.leaseTimeoutMs ?? 5_000,
        PiSessions: { Compaction: { Enabled: true } },
      },
      tokenEstimator: { estimate: (text) => ({ tokenCount: text.length }) },
      promptConfig: () =>
        ({
          UserMessageEnvelope: false,
          TimeZone: "Asia/Shanghai",
          BamlToolAttribution: true,
        }) as const,
      piDiagnostics: (event) => {
        this.diagnostics.push(event);
      },
    };
  }

  completeSessionCreate(): void {
    this.resolveSessionCreate();
  }
}

class ScriptedPiSession implements AgentPiSession {
  readonly state = {
    systemPrompt: "",
    model: piModel() as unknown as AgentState["model"],
    thinkingLevel: "off",
    tools: [],
    messages: [],
    isStreaming: false,
    pendingToolCalls: new Set(),
  } as AgentState;
  readonly model = this.state.model;
  readonly prompts: string[] = [];
  readonly continuations: number[] = [];
  readonly continuationSourceRequestIds: Array<string | undefined> = [];
  private readonly listeners = new Set<AgentPiSessionEventListener>();
  private turnState?: AgentPiTurnState;
  private resolvePromptStarted!: () => void;
  private resolvePrompt!: () => void;
  readonly promptStarted = new Promise<void>((resolve) => {
    this.resolvePromptStarted = resolve;
  });
  private readonly promptGate = new Promise<void>((resolve) => {
    this.resolvePrompt = resolve;
  });
  private resolveCompactionStarted!: () => void;
  readonly compactionStarted = new Promise<void>((resolve) => {
    this.resolveCompactionStarted = resolve;
  });
  private resolveCompaction!: () => void;
  private readonly compactionGate = new Promise<void>((resolve) => {
    this.resolveCompaction = resolve;
  });
  disposed = false;
  abortCount = 0;
  unsubscribeCount = 0;
  private resolveDisposed!: () => void;
  readonly disposedPromise = new Promise<void>((resolve) => {
    this.resolveDisposed = resolve;
  });

  constructor(
    private readonly behavior: {
      deferPrompt?: boolean;
      deferCompaction?: boolean;
      promptFailure?: Error;
    },
  ) {}

  setTurnState(turnState: AgentPiTurnState): void {
    this.turnState = turnState;
  }

  async prompt(text: string): Promise<void> {
    this.prompts.push(text);
    this.resolvePromptStarted();
    if (this.behavior.deferPrompt) {
      await this.promptGate;
      return;
    }
    if (this.behavior.promptFailure) {
      throw this.behavior.promptFailure;
    }
    await this.emitTurnEvents();
  }

  prepareContinuation(sourceRequestId?: string): void {
    this.continuationSourceRequestIds.push(sourceRequestId);
  }

  async continue(): Promise<void> {
    this.continuations.push(this.continuations.length + 1);
    await this.emitTurnEvents();
  }

  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async requestFinalAnswer(): Promise<boolean> {
    return true;
  }
  async nextTurn(): Promise<void> {}
  async markTurnBoundary(requestId: string): Promise<string> {
    return `boundary:${requestId}`;
  }
  async setResources(): Promise<void> {}

  subscribe(listener: AgentPiSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.unsubscribeCount += 1;
      this.listeners.delete(listener);
    };
  }

  async abort(): Promise<void> {
    this.abortCount += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.resolveDisposed();
  }

  getLastAssistantText(): string {
    return "The workspace inspection is complete.";
  }

  getActiveToolNames(): string[] {
    return [];
  }

  completePrompt(): void {
    this.resolvePrompt();
  }

  completeCompaction(): void {
    this.resolveCompaction();
  }

  private async emitTurnEvents(): Promise<void> {
    if (!this.turnState) throw new Error("The scripted Pi session has no active turn state.");
    this.turnState.beginModelRequest();
    const assistantMessage = {
      role: "assistant" as const,
      api: "senera-planning" as const,
      provider: "test-provider",
      model: "test-model",
      content: [{ type: "text" as const, text: "The workspace inspection is complete." }],
      usage: {
        input: 10,
        output: 6,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 16,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
    await this.emit({ type: "message_start", message: assistantMessage });
    await this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace" }],
      },
      assistantMessageEvent: {},
    } as unknown as AgentSessionEvent);
    await this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace inspection is complete." }],
      },
      assistantMessageEvent: {},
    } as unknown as AgentSessionEvent);
    await this.emit({ type: "message_end", message: assistantMessage });
    if (this.behavior.deferCompaction) {
      await this.emit({ type: "compaction_start", reason: "threshold" });
      this.resolveCompactionStarted();
      await this.compactionGate;
      await this.emit({
        type: "compaction_end",
        reason: "threshold",
        result: {
          summary: "Compacted conversation",
          firstKeptEntryId: "entry-recent",
          tokensBefore: 10_000,
        },
        aborted: false,
        willRetry: false,
      });
    }
    await this.emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace inspection is complete." }],
      },
      toolResults: [],
    } as unknown as AgentSessionEvent);
  }

  private async emit(event: AgentSessionEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}

function createPiTurnCommand(): AgentPiTurnRequest {
  return {
    approvalMode: "agent",
    sessionId: "pi-test-session",
    requestId: "pi-test-request",
    step: 1,
    input: "Inspect the workspace",
    prompt: "<agent_system>test</agent_system>",
    rootCommand: toolRootCommand(),
    loadedToolNames: [],
    nativeToolNames: [],
    toolAccessGrant: emptyAgentToolAccessGrant(),
    activeSkills: [],
  };
}

function piModel() {
  return {
    id: "test-model",
    name: "test-model",
    api: "senera-planning" as const,
    provider: "test-provider",
    baseUrl: "https://model.example/v1",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function diagnosticNames(events: readonly AgentPiDiagnosticEvent[]): string[] {
  return events.map((event) => event.name);
}
