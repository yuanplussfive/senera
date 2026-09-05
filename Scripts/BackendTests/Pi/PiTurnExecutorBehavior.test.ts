import { describe, expect, test, vi } from "vitest";
import type { AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
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
import type { AgentPiTurnRequest } from "../../../Source/AgentSystem/Pi/AgentPiTurnTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentPiDiagnosticEvent } from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";

describe("Pi turn executor behavior", () => {
  test("migrates product conversation history and clears the active session after a completed turn", async () => {
    const fixture = new PiTurnRuntimeFixture();
    const command = createPiTurnCommand();
    const events: AgentDomainEvent[] = [];

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(command, (event) => {
      events.push(event);
    });

    expect(result).toMatchObject({
      responseText: "The workspace inspection is complete.",
    });
    const historyTexts = fixture.session.historyTexts();
    expect(historyTexts).toHaveLength(2);
    expect(historyTexts[0]).toContain("<historical_user_turn>");
    expect(historyTexts[0]).toContain("<request_id>previous-request</request_id>");
    expect(historyTexts[0]).toContain("<content>Earlier request</content>");
    expect(historyTexts[1]).toBe("Earlier response");
    expect(fixture.session.prompts).toEqual(["Inspect the workspace"]);
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
    expect(result.conversationEntries).toEqual([]);
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
      { activity: AgentRunActivities.SynchronizingContext, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.SynchronizingContext, state: AgentRunActivityStates.Completed },
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

  test("does not replay history into an existing Pi session", async () => {
    const fixture = new PiTurnRuntimeFixture({ historyMigrationRequired: false });

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(createPiTurnCommand());

    expect(result.responseText).toBe("The workspace inspection is complete.");
    expect(fixture.session.historyTexts()).toEqual([]);
    expect(fixture.session.prompts).toEqual(["Inspect the workspace"]);
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
  readonly afterToolResults = vi.fn(() => []);
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
      historyMigrationRequired?: boolean;
      deferPrompt?: boolean;
      deferCompaction?: boolean;
      deferSessionCreate?: boolean;
      promptFailure?: Error;
      modelTimeoutMs?: number;
      maxRequestMs?: number;
    } = {},
  ) {
    this.session = new ScriptedPiSession(behavior);
    this.runtime = {
      services: {
        pi: {
          model: () => piModel(),
          leaseTurn: async (options) => {
            this.lastSessionOptions = options;
            this.resolveSessionCreateStarted();
            if (this.behavior.deferSessionCreate) {
              await this.sessionCreateGate;
            }
            try {
              return {
                session: this.session,
                piSessionId: options?.sessionId,
                historyMigrationRequired: this.behavior.historyMigrationRequired ?? true,
              };
            } finally {
              this.resolveSessionCreateSettled();
            }
          },
        },
        piSessions: this.activeSessions,
        retrieval: { afterToolResults: this.afterToolResults },
      },
      modelProviderConfig: {
        ...modelProviderConfig,
        TimeoutMs: behavior.modelTimeoutMs ?? modelProviderConfig.TimeoutMs,
        MaxRequestMs: behavior.maxRequestMs ?? modelProviderConfig.MaxRequestMs,
      },
      agentLoopConfig: { PiTurnLeaseTimeoutMs: 5_000 },
      tokenEstimator: { estimate: (text) => ({ tokenCount: text.length }) },
      promptConfig: () =>
        ({
          UserMessageEnvelope: false,
          TimeZone: "Asia/Shanghai",
          RoleCheck: true,
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
  readonly history: AgentMessage[] = [];
  private readonly listeners = new Set<AgentPiSessionEventListener>();
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

  setHistory(messages: readonly AgentMessage[]): void {
    this.history.splice(0, this.history.length, ...messages);
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

  historyTexts(): string[] {
    return this.history.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return [];
      }
      const content = message.content;
      if (!Array.isArray(content)) {
        return [];
      }
      return content.flatMap((entry) => (entry.type === "text" ? [entry.text] : []));
    });
  }

  private async emitTurnEvents(): Promise<void> {
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
  const projector = new AgentConversationProjector();
  return {
    approvalMode: "agent",
    sessionId: "pi-test-session",
    requestId: "pi-test-request",
    step: 1,
    input: "Inspect the workspace",
    prompt: "<agent_system>test</agent_system>",
    conversationEntries: [
      projector.projectUserInput("previous-request", "Earlier request", "2026-01-01T00:00:00.000Z"),
      projector.projectAssistantDecision("previous-request", "Earlier response", "2026-01-01T00:00:01.000Z"),
      projector.projectUserInput("pi-test-request", "Inspect the workspace", "2026-01-01T00:01:00.000Z"),
    ],
    rootCommand: toolRootCommand(),
    loadedToolNames: [],
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
