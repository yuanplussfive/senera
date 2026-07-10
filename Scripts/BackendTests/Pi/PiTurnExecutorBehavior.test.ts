import { describe, expect, test } from "vitest";
import type {
  AgentEvent as AgentSessionEvent,
  AgentMessage,
  AgentState,
} from "@earendil-works/pi-agent-core";
import { AgentConversationEntryKinds } from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type {
  AgentPiSession,
  AgentPiSessionEventListener,
  AgentPiSessionOptions,
  AgentPiSessionResult,
} from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentPiTurnExecutor, type AgentPiTurnRuntimePort } from "../../../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import type { AgentLoopCommand } from "../../../Source/AgentSystem/Loop/AgentLoopStateTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("Pi turn executor behavior", () => {
  test("migrates history, records the transcript, and clears the active session after a completed turn", async () => {
    const fixture = new PiTurnRuntimeFixture();
    const command = createPiTurnCommand();
    const events: AgentDomainEvent[] = [];

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(command, (event) => {
      events.push(event);
    });

    expect(result).toMatchObject({
      kind: "succeeded",
      output: {
        kind: "pi_turn_completed",
        responseText: "The workspace inspection is complete.",
      },
    });
    if (result.kind !== "succeeded" || result.output.kind !== "pi_turn_completed") {
      throw new Error("Expected a completed Pi turn.");
    }
    expect(fixture.session.historyTexts()).toEqual(["Earlier request", "Earlier response"]);
    expect(fixture.session.prompts).toEqual(["Inspect the workspace"]);
    expect(fixture.activeSessions.get(command.sessionId!)).toBeUndefined();
    expect(fixture.session.disposed).toBe(true);
    expect(fixture.session.unsubscribeCount).toBe(1);
    expect(result.output.conversationEntries).toEqual([
      expect.objectContaining({ kind: AgentConversationEntryKinds.OpenAiTranscript }),
    ]);
    expect(events.some((event) => event.kind === AgentEventKinds.ModelDelta)).toBe(true);
    expect(traceTypes(events)).toEqual(expect.arrayContaining([
      "turn.started",
      "session.create.completed",
      "turn.completed",
    ]));
  });

  test("does not replay history into an existing Pi session", async () => {
    const fixture = new PiTurnRuntimeFixture({ historyMigrationRequired: false });

    const result = await new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(createPiTurnCommand());

    expect(result).toMatchObject({ kind: "succeeded" });
    expect(fixture.session.historyTexts()).toEqual([]);
    expect(fixture.session.prompts).toEqual(["Inspect the workspace"]);
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

  test("disposes a session that finishes creating after cancellation", async () => {
    const fixture = new PiTurnRuntimeFixture({ deferSessionCreate: true });
    const controller = new AbortController();
    const executor = new AgentPiTurnExecutor({ runtime: fixture.runtime });
    const pending = executor.run(createPiTurnCommand(), undefined, controller.signal);

    await fixture.sessionCreateStarted;
    controller.abort("cancel during session creation");
    await expect(pending).rejects.toMatchObject({ name: "AgentCancellationError" });
    fixture.completeSessionCreate();
    await fixture.session.disposedPromise;

    expect(fixture.session.disposed).toBe(true);
  });

  test("emits a failure trace and disposes a provider-failed session", async () => {
    const fixture = new PiTurnRuntimeFixture({ promptFailure: new Error("provider rejected request") });
    const events: AgentDomainEvent[] = [];

    await expect(new AgentPiTurnExecutor({ runtime: fixture.runtime }).run(createPiTurnCommand(), (event) => {
      events.push(event);
    })).rejects.toThrow("provider rejected request");

    expect(fixture.session.disposed).toBe(true);
    expect(fixture.session.unsubscribeCount).toBe(1);
    expect(traceTypes(events)).toContain("turn.failed");
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
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 5_000,
  FirstTokenTimeoutMs: 5_000,
  MaxRequestMs: 5_000,
  MaxNetworkRetries: 0,
  Headers: {},
};

class PiTurnRuntimeFixture {
  readonly activeSessions = new AgentPiActiveSessionRegistry();
  readonly session: ScriptedPiSession;
  readonly runtime: AgentPiTurnRuntimePort;
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

  constructor(private readonly behavior: {
    historyMigrationRequired?: boolean;
    deferPrompt?: boolean;
    deferSessionCreate?: boolean;
    promptFailure?: Error;
  } = {}) {
    this.session = new ScriptedPiSession(behavior);
    this.runtime = {
      services: {
        pi: {
          model: () => piModel(),
          toolDefinitions: () => [],
          activeToolNames: () => [],
          createSession: async (options) => {
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
      },
      modelProviderConfig,
      agentLoopConfig: { PiSessionCreateTimeoutMs: 5_000 },
      tokenEstimator: { estimate: (text) => ({ tokenCount: text.length }) },
      conversationProjector: new AgentConversationProjector(),
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
  disposed = false;
  abortCount = 0;
  unsubscribeCount = 0;
  private resolveDisposed!: () => void;
  readonly disposedPromise = new Promise<void>((resolve) => {
    this.resolveDisposed = resolve;
  });

  constructor(private readonly behavior: {
    deferPrompt?: boolean;
    promptFailure?: Error;
  }) {}

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
    this.emitTurnEvents();
  }

  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async nextTurn(): Promise<void> {}
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

  historyTexts(): string[] {
    return this.history.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return [];
      }
      const content = message.content;
      if (!Array.isArray(content)) {
        return [];
      }
      return content.flatMap((entry) => entry.type === "text" ? [entry.text] : []);
    });
  }

  private emitTurnEvents(): void {
    this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace" }],
      },
      assistantMessageEvent: {},
    } as unknown as AgentSessionEvent);
    this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace inspection is complete." }],
      },
      assistantMessageEvent: {},
    } as unknown as AgentSessionEvent);
    this.emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The workspace inspection is complete." }],
      },
      toolResults: [],
    } as unknown as AgentSessionEvent);
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      void listener(event);
    }
  }
}

function createPiTurnCommand(): Extract<AgentLoopCommand, { kind: "run_pi_turn" }> {
  const projector = new AgentConversationProjector();
  return {
    kind: "run_pi_turn",
    sessionId: "pi-test-session",
    requestId: "pi-test-request",
    step: 1,
    input: "Inspect the workspace",
    prompt: "<agent_system>test</agent_system>",
    messages: [{ role: "user", content: "Inspect the workspace" }],
    conversationEntries: [
      projector.projectOpenAiTranscript("previous-request", [{
        role: "user",
        content: "Earlier request",
      }, {
        role: "assistant",
        content: "Earlier response",
      }], "2026-01-01T00:00:00.000Z"),
      projector.projectUserInput("pi-test-request", "Inspect the workspace", "2026-01-01T00:01:00.000Z"),
    ],
    rootCommand: {
      authority: "senera_runtime_root",
      objective: "Inspect the workspace",
    } as Extract<AgentLoopCommand, { kind: "run_pi_turn" }> ["rootCommand"],
    loadedToolNames: [],
    activeSkills: [],
  };
}

function piModel() {
  return {
    id: "test-model",
    name: "test-model",
    api: "openai-completions" as const,
    provider: "test-provider",
    baseUrl: "https://model.example/v1",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function traceTypes(events: readonly AgentDomainEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.kind !== AgentEventKinds.PiTrace || !event.data || typeof event.data !== "object") {
      return [];
    }
    const eventType = "eventType" in event.data ? event.data.eventType : undefined;
    return typeof eventType === "string" ? [eventType] : [];
  });
}
