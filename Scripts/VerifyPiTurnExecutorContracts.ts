import assert from "node:assert/strict";
import type { AgentEvent as AgentSessionEvent } from "@earendil-works/pi-agent-core";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiTurnExecutor, type AgentPiTurnRuntimePort } from "../Source/AgentSystem/Pi/AgentPiTurnExecutor.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type {
  AgentPiSessionOptions,
  AgentPiSessionResult,
  AgentPiSessionEventListener,
} from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import {
  AgentPiTurnContextRegistry,
  type AgentPiTurnContextStore,
} from "../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { AgentPiTurnRequest, AgentPiTurnResult } from "../Source/AgentSystem/Pi/AgentPiTurnTypes.js";
import type { AgentRootCommand } from "../Source/AgentSystem/AgentRootCommand.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentPiDiagnosticEvent } from "../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import { createAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolSuccessOutcome } from "../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentToolObservationContextCompiler } from "../Source/AgentSystem/ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";

const modelProviderConfig: ResolvedAgentModelProviderConfig = {
  Id: "verification-model",
  ProviderId: "main",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "verification-model",
  ContextWindowTokens: 128_000,
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
  const diagnostics: AgentPiDiagnosticEvent[] = [];
  const runtime = createRuntime(pi, diagnostics);
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

  assert.equal(runtime.services.piSessions.get(command.sessionId!), undefined);
  const output = readPiOutput(result);
  assert.equal(output.responseText, "工具检查完成。");
  assert.deepEqual(pi.lastSessionOptions?.visibleToolNames, ["SeneraEchoTool"]);
  assert.equal(pi.lastSessionOptions?.sessionId, command.sessionId);
  assert.deepEqual(
    pi.lastSessionOptions?.activeSkills?.map((skill) => skill.name),
    ["VerifyWorkspaceSkill"],
  );
  assert.equal(typeof pi.lastSessionOptions?.piTurnContextId, "string");
  assert.equal(readTurnContext(runtime.piTurnContexts, pi.lastSessionOptions?.piTurnContextId), undefined);

  const assignedHistory = pi.session.assignedHistoryTexts();
  assert.equal(assignedHistory.length, 2);
  assert.ok(assignedHistory[0]?.includes("<historical_user_turn>"));
  assert.ok(assignedHistory[0]?.includes("<request_id>previous-request</request_id>"));
  assert.ok(assignedHistory[0]?.includes("<content>之前的上下文</content>"));
  assert.equal(assignedHistory[1], "之前的回答");
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
  assertDiagnostic(diagnostics, "turn.started");
  assertDiagnostic(diagnostics, "session.lease.started");
  assertDiagnostic(diagnostics, "session.lease.completed");
  assertDiagnostic(diagnostics, "session.prompt.started");
  assertDiagnostic(diagnostics, "session.prompt.completed");
  assertDiagnostic(diagnostics, "turn.completed");

  assert.equal(output.stepTraces.length, 2);
  assert.equal(output.stepTraces[0]?.kind, "tool");
  assert.equal(output.stepTraces[0]?.toolName, "SeneraEchoTool");
  assert.equal(output.stepTraces[0]?.toolPresentation?.headline, "workspace summary");
  assert.deepEqual(output.stepTraces[0]?.toolArgs, {
    text: "检查当前工作区",
  });
  assert.equal(output.stepTraces[1]?.kind, "answer");

  assert.deepEqual(output.conversationEntries, []);
  assert.equal(output.executedTools.length, 1);
  assert.equal(output.executedTools[0]?.name, "SeneraEchoTool");
  assert.equal(output.executedTools[0]?.artifact?.evidence[0]?.evidenceUri, "senera://evidence/echo");
  assert.deepEqual(output.executedTools[0]?.artifact?.evidence[0]?.plannerMemory.facts, [
    {
      name: "summary",
      value: "workspace inspected",
    },
  ]);

  await verifyAbortCleansContext(command);
  await verifyAbortDuringSessionCreate(command);
  await verifyExistingPiSessionSkipsHistoryMigration(command);
  await verifyProviderFailureDoesNotSucceed(command);

  console.log("Pi turn executor contracts verified.");
}

function createRuntime(pi: FakePiRuntime, diagnostics: AgentPiDiagnosticEvent[] = []): AgentPiTurnRuntimePort {
  const piSessions = new AgentPiActiveSessionRegistry();
  const piTurnContexts = new AgentPiTurnContextRegistry();
  pi.sessionRegistry = piSessions;
  pi.turnContexts = piTurnContexts;
  pi.session.turnContexts = piTurnContexts;
  return {
    services: {
      pi,
      piSessions,
      retrieval: { afterToolResults: () => [] },
    },
    modelProviderConfig,
    agentLoopConfig: {
      PiTurnLeaseTimeoutMs: 20_000,
    },
    tokenEstimator: {
      estimate: (text: string) => ({ tokenCount: text.length }),
    },
    piDiagnostics: (event) => {
      diagnostics.push(event);
    },
    piTurnContexts,
  };
}

async function verifyAbortCleansContext(command: AgentPiTurnRequest): Promise<void> {
  const abortingPi = new FakePiRuntime();
  abortingPi.session.deferPrompt = true;
  const abortingRuntime = createRuntime(abortingPi);
  const abortingExecutor = new AgentPiTurnExecutor({ runtime: abortingRuntime });
  const controller = new AbortController();
  const runPromise = abortingExecutor.run(command, undefined, controller.signal);

  await abortingPi.session.promptStarted;
  const contextId = abortingPi.lastSessionOptions?.piTurnContextId;
  assert.equal(typeof contextId, "string");
  assert.equal(readTurnContext(abortingRuntime.piTurnContexts, contextId)?.rootCommand, command.rootCommand);
  controller.abort("verification abort");
  abortingPi.session.finishPrompt();
  await assert.rejects(runPromise, /verification abort/);
  assert.equal(abortingPi.session.abortCount, 1);
  assert.equal(abortingPi.session.disposed, true);
  assert.equal(readTurnContext(abortingRuntime.piTurnContexts, contextId), undefined);
}

async function verifyAbortDuringSessionCreate(command: AgentPiTurnRequest): Promise<void> {
  const abortingPi = new FakePiRuntime();
  abortingPi.deferCreate = true;
  const abortingRuntime = createRuntime(abortingPi);
  const abortingExecutor = new AgentPiTurnExecutor({ runtime: abortingRuntime });
  const controller = new AbortController();
  const runPromise = abortingExecutor.run(command, undefined, controller.signal);

  await abortingPi.createStarted;
  const contextId = abortingPi.lastSessionOptions?.piTurnContextId;
  assert.equal(typeof contextId, "string");
  assert.equal(readTurnContext(abortingRuntime.piTurnContexts, contextId)?.rootCommand, command.rootCommand);
  controller.abort("verification create abort");
  await assert.rejects(runPromise, /verification create abort/);
  assert.equal(readTurnContext(abortingRuntime.piTurnContexts, contextId), undefined);

  await abortingPi.finishCreate();
  assert.equal(abortingPi.session.disposed, true);
}

async function verifyExistingPiSessionSkipsHistoryMigration(command: AgentPiTurnRequest): Promise<void> {
  const existingPi = new FakePiRuntime();
  existingPi.historyMigrationRequired = false;
  const runtime = createRuntime(existingPi);
  const executor = new AgentPiTurnExecutor({ runtime });

  const result = await executor.run(command);

  assert.equal(result.responseText, "工具检查完成。");
  assert.deepEqual(existingPi.session.assignedHistoryTexts(), []);
  assert.deepEqual(existingPi.session.prompts, ["检查当前工作区"]);
}

async function verifyProviderFailureDoesNotSucceed(command: AgentPiTurnRequest): Promise<void> {
  const failingPi = new FakePiRuntime();
  failingPi.session.promptFailure = new Error("500 Invalid option: expected one of system|user|assistant|tool");
  const diagnostics: AgentPiDiagnosticEvent[] = [];
  const runtime = createRuntime(failingPi, diagnostics);
  const executor = new AgentPiTurnExecutor({ runtime });

  await assert.rejects(executor.run(command), /Invalid option/);

  assert.equal(failingPi.session.disposed, true);
  assert.equal(failingPi.session.unsubscribeCount, 1);
  assertDiagnostic(diagnostics, "turn.failed");
}

function readPiOutput(result: AgentPiTurnResult): AgentPiTurnResult {
  return result;
}

function createRunPiTurnCommand(): AgentPiTurnRequest {
  const toolAccessGrant = createAgentToolAccessGrant({
    authorizedToolNames: ["SeneraEchoTool"],
    exposedToolNames: ["SeneraEchoTool"],
    preferredToolNames: ["SeneraEchoTool"],
  });
  const rootCommand: AgentRootCommand = {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "检查当前工作区",
    instruction: "检查当前工作区",
    toolAccessGrant,
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "缺少工具能力时说明阻塞。",
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "pi_tool_turn",
      format: "openai_tool_calls_or_final_text",
      rules: [],
      repair: { instruction: "按 Pi 工具调用协议重试。", rules: [] },
    },
  };
  return {
    sessionId: "verify-pi-session",
    requestId: "verify-pi-turn-executor",
    step: 1,
    input: "检查当前工作区",
    prompt: "<agent_system>verification</agent_system>",
    conversationEntries: [
      new AgentConversationProjector().projectUserInput("previous-request", "之前的上下文", "2026-01-01T00:00:00.000Z"),
      new AgentConversationProjector().projectAssistantDecision(
        "previous-request",
        "之前的回答",
        "2026-01-01T00:00:01.000Z",
      ),
      new AgentConversationProjector().projectUserInput(
        "verify-pi-turn-executor",
        "检查当前工作区",
        "2026-01-01T00:00:02.000Z",
      ),
    ],
    rootCommand,
    loadedToolNames: ["SeneraEchoTool"],
    toolAccessGrant,
    activeSkills: [
      {
        name: "VerifyWorkspaceSkill",
        revision: "test-revision",
        title: "验证工作区技能",
        summary: "用于验证 Pi Harness 能接收 Senera 激活技能。",
        useCases: ["工作区验证"],
        avoid: [],
        recommendedTools: ["SeneraEchoTool"],
        evidenceRequirements: [],
        descriptionFile: "System/Skills/workspace-investigation/SKILL.md",
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

function readTurnContext(registry: Pick<AgentPiTurnContextStore, "acquire">, contextId: string | undefined) {
  const lease = registry.acquire(contextId);
  try {
    return lease?.context;
  } finally {
    lease?.release();
  }
}

class FakePiRuntime {
  readonly session = new FakePiSession();
  sessionRegistry?: AgentPiActiveSessionRegistry;
  turnContexts?: AgentPiTurnContextRegistry;
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

  async leaseTurn(options: AgentPiSessionOptions): Promise<AgentPiSessionResult> {
    this.lastSessionOptions = options;
    this.session.piTurnContextId = options.piTurnContextId;
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

  async resetSession(): Promise<boolean> {
    return false;
  }

  async rewindSession(): Promise<boolean> {
    return false;
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
  piTurnContextId?: string;
  turnContexts?: AgentPiTurnContextRegistry;
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

  async markTurnBoundary(requestId: string): Promise<string> {
    return `boundary:${requestId}`;
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
    this.turnContexts?.registerExecutedToolResult(this.piTurnContextId, "call_echo", executedToolResult());
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
              text: JSON.stringify(verificationToolObservation()),
            },
          ],
          details: {
            senera: {
              toolName: "SeneraEchoTool",
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
      },
    },
  };
}

function verificationToolObservation(): unknown {
  return new AgentToolObservationContextCompiler({ model: "verification-model" }).compile(
    {
      toolName: "SeneraEchoTool",
      callId: "call_echo",
      batchId: "verification-batch",
      status: "success",
      executionStatus: "completed",
      outputAvailability: "complete",
      summary: "workspace inspected",
      outcome: AgentToolSuccessOutcome,
      process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
      error: undefined,
      result: { summary: "workspace inspected" },
      arguments: { text: "检查当前工作区" },
      artifact: undefined,
    },
    StandardAgentToolObservationProjection,
  );
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
      stdout: "",
      stderr: "",
    },
    result: {
      summary: "workspace inspected",
    },
    outcome: AgentToolSuccessOutcome,
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

function assertDiagnostic(events: readonly AgentPiDiagnosticEvent[], name: string): void {
  assert.equal(
    events.some((event) => event.name === name),
    true,
    `Expected Pi diagnostic ${name}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
