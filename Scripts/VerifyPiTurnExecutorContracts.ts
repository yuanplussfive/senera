import assert from "node:assert/strict";
import type { AgentEvent as AgentSessionEvent, AgentHarness } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentConversationEntryKinds } from "../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiHarnessSession } from "../Source/AgentSystem/Pi/AgentPiHarnessSession.js";
import { AgentPiTurnExecutor, type AgentPiTurnRuntimePort } from "../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type {
  AgentPiSessionOptions,
  AgentPiSessionResult,
  AgentPiSessionEventListener,
} from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { readPiProxyRuntimeContext } from "../Source/AgentSystem/PiProxy/AgentPiProxyRuntimeContext.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { AgentLoopCommand, AgentLoopCommandResult } from "../Source/AgentSystem/Loop/AgentLoopStateTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const modelProviderConfig: ResolvedAgentModelProviderConfig = {
  Id: "verification-model",
  ProviderId: "main",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "verification-model",
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  RetryBaseDelayMs: 250,
  RetryMaxDelayMs: 10_000,
  RetryAfterMaxDelayMs: 60_000,
  Headers: {},
};

async function main(): Promise<void> {
  const pi = new FakePiRuntime();
  const runtime = createRuntime(pi);
  const executor = new AgentPiTurnExecutor({ runtime });
  const events: AgentDomainEvent[] = [];
  const command = createRunPiTurnCommand();
  pi.session.onPromptStarted = () => {
    const handle = runtime.services.piSessions.get(command.sessionId!);
    assert.equal(handle?.requestId, command.requestId);
    assert.equal(handle?.step, command.step);
  };
  const result = await executor.run(command, (event) => {
    events.push(event);
  });

  assert.equal(result.kind, "succeeded");
  assert.equal(runtime.services.piSessions.get(command.sessionId!), undefined);
  const output = readPiOutput(result);
  assert.equal(output.responseText, "工具检查完成。");
  assert.deepEqual(pi.lastSessionOptions?.visibleToolNames, ["SeneraEchoTool"]);
  assert.equal(pi.lastSessionOptions?.sessionId, command.sessionId);
  assert.deepEqual(
    pi.lastSessionOptions?.activeSkills?.map((skill) => skill.name),
    ["VerifyWorkspaceSkill"],
  );
  assert.equal(typeof pi.lastSessionOptions?.piProxyRuntimeContextId, "string");
  assert.equal(readPiProxyRuntimeContext(pi.lastSessionOptions?.piProxyRuntimeContextId), undefined);

  assert.deepEqual(pi.session.assignedHistoryTexts(), ["之前的上下文", "之前的回答"]);
  assert.deepEqual(pi.session.prompts, ["检查当前工作区"]);
  assert.deepEqual(pi.session.promptOptions, [
    {
      expandPromptTemplates: false,
      source: "extension",
    },
  ]);
  assert.equal(pi.session.disposed, true);
  assert.equal(pi.session.unsubscribeCount, 1);

  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.ModelDelta),
    true,
  );
  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.ToolCallStarted),
    true,
  );
  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.ToolCallCompleted),
    true,
  );
  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.ToolCallResultDetail),
    true,
  );
  assertPiTrace(events, "turn.started");
  assertPiTrace(events, "session.create.started");
  assertPiTrace(events, "session.create.completed");
  assertPiTrace(events, "session.prompt.started");
  assertPiTrace(events, "session.prompt.completed");
  assertPiTrace(events, "turn.completed");

  assert.equal(output.stepTraces.length, 2);
  assert.equal(output.stepTraces[0]?.kind, "tool");
  assert.equal(output.stepTraces[0]?.toolName, "SeneraEchoTool");
  assert.equal(output.stepTraces[0]?.toolPresentation?.headline, "workspace summary");
  assert.deepEqual(output.stepTraces[0]?.toolArgs, {
    text: "检查当前工作区",
  });
  assert.equal(output.stepTraces[1]?.kind, "answer");

  assert.equal(output.conversationEntries.length, 2);
  assert.equal(output.conversationEntries[0]?.kind, AgentConversationEntryKinds.OpenAiTranscript);
  assert.equal(
    output.conversationEntries.some((entry) => entry.kind === AgentConversationEntryKinds.ContextToolResults),
    false,
  );
  assert.equal(output.conversationEntries[1]?.kind, AgentConversationEntryKinds.ToolEvidenceMemory);
  const transcriptEntry = output.conversationEntries[0];
  assert.equal(transcriptEntry?.kind, AgentConversationEntryKinds.OpenAiTranscript);
  if (transcriptEntry?.kind === AgentConversationEntryKinds.OpenAiTranscript) {
    assert.deepEqual(
      transcriptEntry.messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(transcriptEntry.messages[1]?.role, "assistant");
    assert.equal(
      transcriptEntry.messages[1]?.role === "assistant"
        ? transcriptEntry.messages[1].tool_calls?.[0]?.function.name
        : undefined,
      "SeneraEchoTool",
    );
  }
  const evidenceEntry = output.conversationEntries[1];
  assert.equal(evidenceEntry?.kind, AgentConversationEntryKinds.ToolEvidenceMemory);
  if (evidenceEntry?.kind === AgentConversationEntryKinds.ToolEvidenceMemory) {
    assert.equal(evidenceEntry.record.toolName, "SeneraEchoTool");
    assert.equal(evidenceEntry.record.evidence[0]?.evidenceUri, "senera://evidence/echo");
    assert.deepEqual(evidenceEntry.record.evidence[0]?.facts, [
      {
        name: "summary",
        value: "workspace inspected",
      },
    ]);
  }

  await verifyAbortCleansContext(command);
  await verifyAbortDuringSessionCreate(command);
  await verifyExistingPiSessionSkipsHistoryMigration(command);
  await verifyProviderFailureDoesNotSucceed(command);
  await verifyHarnessSessionRejectsFailedAssistant();

  console.log("Pi turn executor contracts verified.");
}

function createRuntime(pi: FakePiRuntime): AgentPiTurnRuntimePort {
  const piSessions = new AgentPiActiveSessionRegistry();
  pi.sessionRegistry = piSessions;
  return {
    services: {
      pi,
      piSessions,
    },
    modelProviderConfig,
    agentLoopConfig: {
      PiSessionCreateTimeoutMs: 20_000,
    },
    tokenEstimator: {
      estimate: (text: string) => ({ tokenCount: text.length }),
    },
    conversationProjector: new AgentConversationProjector(),
  };
}

async function verifyAbortCleansContext(command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>): Promise<void> {
  const abortingPi = new FakePiRuntime();
  abortingPi.session.deferPrompt = true;
  const abortingRuntime = createRuntime(abortingPi);
  const abortingExecutor = new AgentPiTurnExecutor({ runtime: abortingRuntime });
  const controller = new AbortController();
  const runPromise = abortingExecutor.run(command, undefined, controller.signal);

  await abortingPi.session.promptStarted;
  const contextId = abortingPi.lastSessionOptions?.piProxyRuntimeContextId;
  assert.equal(typeof contextId, "string");
  assert.equal(readPiProxyRuntimeContext(contextId)?.rootCommand, command.rootCommand);
  controller.abort("verification abort");
  abortingPi.session.finishPrompt();
  await assert.rejects(runPromise, /verification abort/);
  assert.equal(abortingPi.session.abortCount, 1);
  assert.equal(abortingPi.session.disposed, true);
  assert.equal(readPiProxyRuntimeContext(contextId), undefined);
}

async function verifyAbortDuringSessionCreate(
  command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
): Promise<void> {
  const abortingPi = new FakePiRuntime();
  abortingPi.deferCreate = true;
  const abortingRuntime = createRuntime(abortingPi);
  const abortingExecutor = new AgentPiTurnExecutor({ runtime: abortingRuntime });
  const controller = new AbortController();
  const runPromise = abortingExecutor.run(command, undefined, controller.signal);

  await abortingPi.createStarted;
  const contextId = abortingPi.lastSessionOptions?.piProxyRuntimeContextId;
  assert.equal(typeof contextId, "string");
  assert.equal(readPiProxyRuntimeContext(contextId)?.rootCommand, command.rootCommand);
  controller.abort("verification create abort");
  await assert.rejects(runPromise, /verification create abort/);
  assert.equal(readPiProxyRuntimeContext(contextId), undefined);

  await abortingPi.finishCreate();
  assert.equal(abortingPi.session.disposed, true);
}

async function verifyExistingPiSessionSkipsHistoryMigration(
  command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
): Promise<void> {
  const existingPi = new FakePiRuntime();
  existingPi.historyMigrationRequired = false;
  const runtime = createRuntime(existingPi);
  const executor = new AgentPiTurnExecutor({ runtime });

  const result = await executor.run(command);

  assert.equal(result.kind, "succeeded");
  assert.deepEqual(existingPi.session.assignedHistoryTexts(), []);
  assert.deepEqual(existingPi.session.prompts, ["检查当前工作区"]);
}

async function verifyProviderFailureDoesNotSucceed(
  command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
): Promise<void> {
  const failingPi = new FakePiRuntime();
  failingPi.session.promptFailure = new Error("500 Invalid option: expected one of system|user|assistant|tool");
  const runtime = createRuntime(failingPi);
  const executor = new AgentPiTurnExecutor({ runtime });
  const events: AgentDomainEvent[] = [];

  await assert.rejects(
    executor.run(command, (event) => {
      events.push(event);
    }),
    /Invalid option/,
  );

  assert.equal(failingPi.session.disposed, true);
  assert.equal(failingPi.session.unsubscribeCount, 1);
  assertPiTrace(events, "turn.failed");
}

async function verifyHarnessSessionRejectsFailedAssistant(): Promise<void> {
  const session = new AgentPiHarnessSession(
    new FakeHarness(
      createAssistantMessage({
        stopReason: "error",
        errorMessage: "500 Invalid option: expected one of system|user|assistant|tool",
      }),
    ) as unknown as AgentHarness,
    {
      model: new FakePiRuntime().model(),
      tools: [],
    },
  );

  await assert.rejects(session.prompt("hello"), /Invalid option/);
  assert.equal(session.getLastAssistantText(), undefined);
}

function readPiOutput(result: AgentLoopCommandResult): Extract<
  AgentLoopCommandResult,
  {
    kind: "succeeded";
  }
>["output"] & { kind: "pi_turn_completed" } {
  assert.equal(result.kind, "succeeded");
  assert.equal(result.output.kind, "pi_turn_completed");
  return result.output;
}

function createRunPiTurnCommand(): Extract<AgentLoopCommand, { kind: "run_pi_turn" }> {
  const rootCommand = {
    authority: "senera_runtime_root",
    objective: "检查当前工作区",
  };
  return {
    kind: "run_pi_turn",
    sessionId: "verify-pi-session",
    requestId: "verify-pi-turn-executor",
    step: 1,
    input: "检查当前工作区",
    prompt: "<agent_system>verification</agent_system>",
    messages: [
      {
        role: "user",
        content: "之前的上下文",
      },
      {
        role: "user",
        content: "检查当前工作区",
      },
    ],
    conversationEntries: [
      new AgentConversationProjector().projectOpenAiTranscript(
        "previous-request",
        [
          {
            role: "user",
            content: "之前的上下文",
          },
          {
            role: "assistant",
            content: "之前的回答",
          },
        ],
        "2026-01-01T00:00:01.000Z",
      ),
      new AgentConversationProjector().projectUserInput(
        "verify-pi-turn-executor",
        "检查当前工作区",
        "2026-01-01T00:00:02.000Z",
      ),
    ],
    rootCommand: rootCommand as Extract<AgentLoopCommand, { kind: "run_pi_turn" }>["rootCommand"],
    loadedToolNames: ["SeneraEchoTool"],
    activeSkills: [
      {
        name: "VerifyWorkspaceSkill",
        title: "验证工作区技能",
        summary: "用于验证 Pi Harness 能接收 Senera 激活技能。",
        useCases: ["工作区验证"],
        avoid: [],
        recommendedTools: ["SeneraEchoTool"],
        evidenceRequirements: [],
        descriptionFile: "System/Plugins/AgentCapabilitySkillsPlugin/docs/WorkspaceInvestigation.md",
        matchedTerms: ["workspace"],
        matchedFields: [
          {
            term: "workspace",
            fields: ["summary"],
          },
        ],
        score: 1,
      },
    ],
  };
}

class FakePiRuntime {
  readonly session = new FakePiSession();
  sessionRegistry?: AgentPiActiveSessionRegistry;
  lastSessionOptions?: AgentPiSessionOptions;
  historyMigrationRequired = true;
  deferCreate = false;
  private createStartedResolve!: () => void;
  private createFinishResolve!: () => void;
  private createReturnedResolve!: () => void;
  readonly createStarted = new Promise<void>((resolve) => {
    this.createStartedResolve = resolve;
  });
  private readonly createFinished = new Promise<void>((resolve) => {
    this.createFinishResolve = resolve;
  });
  private readonly createReturned = new Promise<void>((resolve) => {
    this.createReturnedResolve = resolve;
  });

  model() {
    return {
      id: "verification-model",
      name: "verification-model",
      api: "openai-completions" as const,
      provider: "senera-pi-proxy",
      baseUrl: "http://127.0.0.1:8787/v1",
      reasoning: false,
      input: ["text" as const],
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

  toolDefinitions() {
    return [];
  }

  activeToolNames() {
    return ["SeneraEchoTool"];
  }

  async createSession(options: AgentPiSessionOptions): Promise<AgentPiSessionResult> {
    this.lastSessionOptions = options;
    this.createStartedResolve();
    if (this.deferCreate) {
      await this.createFinished;
    }
    try {
      return {
        session: this.session as unknown as AgentPiSessionResult["session"],
        piSessionId: options.sessionId,
        historyMigrationRequired: this.historyMigrationRequired,
      };
    } finally {
      this.createReturnedResolve();
    }
  }

  async finishCreate(): Promise<void> {
    this.createFinishResolve();
    await this.createReturned;
  }
}

class FakePiSession {
  readonly listeners = new Set<AgentPiSessionEventListener>();
  readonly prompts: string[] = [];
  readonly promptOptions: unknown[] = [];
  readonly assignedHistory: unknown[] = [];
  deferPrompt = false;
  disposed = false;
  abortCount = 0;
  unsubscribeCount = 0;
  promptFailure?: Error;
  onPromptStarted?: () => void;
  private promptStartedResolve!: () => void;
  private promptFinishResolve!: () => void;
  promptStarted = new Promise<void>((resolve) => {
    this.promptStartedResolve = resolve;
  });
  private promptFinished = new Promise<void>((resolve) => {
    this.promptFinishResolve = resolve;
  });

  subscribe(listener: AgentPiSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.unsubscribeCount += 1;
      this.listeners.delete(listener);
    };
  }

  setHistory(messages: readonly unknown[]): void {
    this.assignedHistory.splice(0, this.assignedHistory.length, ...messages);
  }

  async prompt(text: string, options: unknown): Promise<void> {
    this.prompts.push(text);
    this.promptOptions.push(options);
    this.promptStartedResolve();
    this.onPromptStarted?.();
    if (this.deferPrompt) {
      await this.promptFinished;
      return;
    }
    if (this.promptFailure) {
      throw this.promptFailure;
    }
    await this.emitScriptedEvents();
  }

  finishPrompt(): void {
    this.promptFinishResolve();
  }

  async abort(): Promise<void> {
    this.abortCount += 1;
  }

  dispose(): void {
    this.disposed = true;
  }

  getLastAssistantText(): string {
    return "工具检查完成。";
  }

  assignedHistoryTexts(): string[] {
    return this.assignedHistory.flatMap((message) => {
      const record = message as { content?: Array<{ type?: string; text?: string }> };
      return (
        record.content?.flatMap((entry) =>
          entry.type === "text" && typeof entry.text === "string" ? [entry.text] : [],
        ) ?? []
      );
    });
  }

  private async emitScriptedEvents(): Promise<void> {
    await this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "工具",
          },
        ],
      },
      assistantMessageEvent: {},
    } as unknown as AgentSessionEvent);
    await this.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "工具检查完成。",
          },
        ],
      },
      assistantMessageEvent: {},
    } as AgentSessionEvent);
    await this.emit({
      type: "tool_execution_start",
      toolCallId: "call_echo",
      toolName: "SeneraEchoTool",
      args: {
        text: "检查当前工作区",
      },
    });
    await this.emit({
      type: "tool_execution_end",
      toolCallId: "call_echo",
      toolName: "SeneraEchoTool",
      result: projectPiToolResult(),
      isError: false,
    });
    await this.emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "我先调用工具检查工作区。",
          },
          {
            type: "toolCall",
            id: "call_echo",
            name: "SeneraEchoTool",
            arguments: {
              text: "检查当前工作区",
            },
          },
        ],
      },
      toolResults: [
        {
          role: "toolResult",
          toolCallId: "call_echo",
          toolName: "SeneraEchoTool",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "senera.tool_observation.v1",
                status: "success",
                summary: "workspace inspected",
              }),
            },
          ],
          details: {
            senera: {
              toolName: "SeneraEchoTool",
              executed: executedToolResult(),
            },
          },
          isError: false,
          timestamp: Date.now(),
        },
      ],
    } as AgentSessionEvent);
    await this.emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "工具检查完成。",
          },
        ],
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

class FakeHarness {
  constructor(private readonly assistant: AssistantMessage) {}

  async prompt(): Promise<AssistantMessage> {
    return this.assistant;
  }
}

function createAssistantMessage(input: {
  stopReason: AssistantMessage["stopReason"];
  errorMessage?: string;
}): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "",
      },
    ],
    api: "openai-completions",
    provider: "senera-pi-proxy",
    model: "verification-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: input.stopReason,
    errorMessage: input.errorMessage,
    timestamp: Date.now(),
  };
}

function projectPiToolResult(): unknown {
  return {
    content: [
      {
        type: "text",
        text: "workspace inspected",
      },
    ],
    details: {
      senera: {
        toolName: "SeneraEchoTool",
        executed: executedToolResult(),
      },
    },
  };
}

function executedToolResult(): ExecutedToolCallResult {
  return {
    callId: "call_echo",
    name: "SeneraEchoTool",
    arguments: {
      text: "检查当前工作区",
    },
    process: {
      exitCode: 0,
      signal: null,
      stderr: "",
    },
    result: {
      summary: "workspace inspected",
    },
    artifact: {
      artifactId: "art_0123456789abcdef01234567",
      artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      artifactPath: "E:/senera/.senera/artifacts/verification",
      relativePath: ".senera/artifacts/verification",
      manifestPath: "E:/senera/.senera/artifacts/verification/manifest.json",
      files: {
        manifest: "E:/senera/.senera/artifacts/verification/manifest.json",
      },
      summary: "workspace inspected",
      evidence: [
        {
          key: "echo",
          evidenceUri: "senera://evidence/echo",
          kind: "workspace_summary",
          locator: "workspace://.",
          display: "workspace summary",
          label: "workspace",
          source: "workspace inspected",
          confidence: 1,
          modelSlots: [
            {
              name: "summary",
              value: "workspace inspected",
            },
          ],
          plannerMemory: {
            facts: [
              {
                name: "summary",
                value: "workspace inspected",
              },
            ],
            artifactRefs: ["projection"],
          },
        },
      ],
      delta: [],
    },
  };
}

function assertPiTrace(events: readonly AgentDomainEvent[], eventType: string): void {
  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.PiTrace && readRecord(event.data)?.eventType === eventType),
    true,
    `Expected Pi trace event ${eventType}`,
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
