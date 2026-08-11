import type { AgentContext, PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentRunActivityReporter } from "../../../Source/AgentSystem/Events/AgentRunActivityReporter.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import {
  AgentPiCompactionController,
  type AgentPiCompactionIndexes,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionController.js";
import { resolveAgentPiCompactionSettings } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSettings.js";
import { readAgentPiCompactionToolCallIndex } from "../../../Source/AgentSystem/Pi/AgentPiCompactionToolIndex.js";
import {
  AgentPiMidRunCompactionCoordinator,
  resolveAgentPiMidRunCompactionPressure,
} from "../../../Source/AgentSystem/Pi/AgentPiMidRunCompactionCoordinator.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi mid-run context compaction", () => {
  test("derives pressure headroom from the declared model and compaction budgets", () => {
    expect(
      resolveAgentPiMidRunCompactionPressure(
        { inputCapacityTokens: 90_000, outputReserveTokens: 10_000 },
        { keepRecentTokens: 20_000 },
      ),
    ).toEqual({
      inputCapacityTokens: 90_000,
      proactiveHeadroomTokens: 10_000,
      triggerTokens: 80_000,
    });
    expect(
      resolveAgentPiCompactionSettings({ Enabled: true }, { contextWindow: 4_096, maxTokens: 512 } as never),
    ).toEqual({ enabled: true, reserveTokens: 512, keepRecentTokens: 3_072 });
  });

  test("persists a compaction and replaces the active loop context before the next provider request", async () => {
    const manager = SessionManager.inMemory("C:\\workspace");
    const oldUser = user("Investigate the old context. ".repeat(20), 1);
    const oldAssistant = assistant([{ type: "text", text: "Old findings. ".repeat(20) }], 2);
    const currentUser = user("Continue with a tool.", 3);
    const toolAssistant = assistant(
      [{ type: "toolCall", id: "call-live", name: "Search", arguments: { query: "context" } }],
      4,
    );
    const toolResult = result("call-live", "Search", "Current evidence. ".repeat(40), 5);
    [oldUser, oldAssistant, currentUser, toolAssistant, toolResult].forEach((message) =>
      manager.appendMessage(message),
    );

    const events: AgentDomainEvent[] = [];
    const tokenBudget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 1_000,
      outputReserveTokens: 200,
    });
    tokenBudget.recordProviderInputTokens(690);
    const grant = createAgentToolAccessGrant({ authorizedToolNames: ["Search"], exposedToolNames: ["Search"] });
    const reporter = new AgentRunActivityReporter({
      requestId: "request-mid-run",
      onEvent: (event) => {
        events.push(event);
      },
    });
    const turnState = new AgentPiTurnState({
      requestId: "request-mid-run",
      step: 1,
      approvalMode: "agent",
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      activeSkills: [],
      usageLedger: new AgentModelUsageLedger(),
      toolPlan: new AgentPiToolPlanCoordinator(),
      tokenBudget,
      activityReporter: reporter,
    });
    const diagnostics: string[] = [];
    const frame = new AgentPiMutableSessionFrame({
      requestId: "request-mid-run",
      step: 1,
      turnState,
      diagnostics: (event) => {
        diagnostics.push(event.name);
      },
      skillCatalogFingerprint: "test",
      toolAccessGrant: grant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget,
      preflight: async () => undefined,
    });
    const summarize = vi.fn(async () => "Compacted findings with a continuation checkpoint.");
    const controller = new AgentPiCompactionController({
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) },
    });
    const projectProviderMessages = vi.fn(async (messages: AgentContext["messages"]) => [...messages]);
    const coordinator = new AgentPiMidRunCompactionCoordinator({
      frame,
      sessionManager: manager,
      compactionController: controller,
      projectProviderMessages,
    });
    const state = { messages: manager.buildSessionContext().messages };
    const session = { agent: { state } } as unknown as AgentSession;
    const context: AgentContext = { messages: [...state.messages], tools: [], systemPrompt: "system" };
    const turn: PrepareNextTurnContext = {
      message: toolAssistant,
      toolResults: [toolResult],
      context,
      newMessages: [currentUser, toolAssistant, toolResult],
    };

    const compacted = await coordinator.prepareNextTurn(
      turn,
      session,
      { enabled: true, reserveTokens: 200, keepRecentTokens: 80 },
      new AbortController().signal,
    );

    expect(compacted).toBeDefined();
    expect(summarize).toHaveBeenCalledOnce();
    expect(projectProviderMessages).toHaveBeenCalledTimes(2);
    expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(true);
    expect(state.messages).toEqual(compacted?.messages);
    expect(state.messages.some((message) => message.role === "compactionSummary")).toBe(true);
    expect(state.messages.slice(-2)).toEqual([toolAssistant, toolResult]);
    expect(tokenBudget.snapshot().occupiedTokens).toBeLessThan(690);
    expect(diagnostics).toEqual(["compaction.mid_turn.started", "compaction.mid_turn.completed"]);
    expect(
      events.filter((event) => event.kind === AgentEventKinds.RunActivityChanged).map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        activity: AgentRunActivities.CompactingContext,
        state: AgentRunActivityStates.Started,
      }),
      expect.objectContaining({
        activity: AgentRunActivities.CompactingContext,
        state: AgentRunActivityStates.Completed,
      }),
    ]);
  });

  test("does not persist a compaction when the completed tool batch is itself over capacity", async () => {
    const manager = SessionManager.inMemory("C:\\workspace");
    const oldUser = user("Earlier context that can be summarized.", 1);
    const currentUser = user("Inspect the large result.", 2);
    const toolAssistant = assistant(
      [{ type: "toolCall", id: "call-oversized", name: "Search", arguments: { query: "large" } }],
      3,
    );
    const toolResult = result("call-oversized", "Search", "oversized evidence ".repeat(2_000), 4);
    [oldUser, currentUser, toolAssistant, toolResult].forEach((message) => manager.appendMessage(message));

    const tokenBudget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 600,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(400);
    const grant = createAgentToolAccessGrant({ authorizedToolNames: ["Search"], exposedToolNames: ["Search"] });
    const diagnostics: string[] = [];
    const frame = new AgentPiMutableSessionFrame({
      requestId: "request-oversized-batch",
      step: 1,
      diagnostics: (event) => {
        diagnostics.push(event.name);
      },
      skillCatalogFingerprint: "test",
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      selectedPromptTemplates: [],
      tokenBudget,
      preflight: async () => undefined,
    });
    const summarize = vi.fn(async () => "Short durable summary.");
    const coordinator = new AgentPiMidRunCompactionCoordinator({
      frame,
      sessionManager: manager,
      compactionController: new AgentPiCompactionController({
        planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) },
      }),
      projectProviderMessages: async (messages) => [...messages],
    });
    const state = { messages: manager.buildSessionContext().messages };
    const context: AgentContext = { messages: [...state.messages], tools: [], systemPrompt: "system" };

    await expect(
      coordinator.prepareNextTurn(
        {
          message: toolAssistant,
          toolResults: [toolResult],
          context,
          newMessages: [currentUser, toolAssistant, toolResult],
        },
        { agent: { state } } as unknown as AgentSession,
        { enabled: true, reserveTokens: 100, keepRecentTokens: 80 },
      ),
    ).rejects.toThrow("irreducible projected context");

    expect(summarize).toHaveBeenCalledOnce();
    expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
    expect(state.messages).toEqual(context.messages);
    expect(diagnostics).toEqual([
      "compaction.mid_turn.started",
      "compaction.mid_turn.insufficient_capacity",
      "compaction.mid_turn.failed",
    ]);
  });

  test("validates pending retrieval indexes before mutating append-only history", async () => {
    const manager = SessionManager.inMemory("C:\\workspace");
    const archivedAssistant = assistant(
      [{ type: "toolCall", id: "call-archived", name: "Search", arguments: { query: "archived" } }],
      2,
    );
    const archivedResult = {
      ...piToolResultMessage(
        compilePiToolObservation({
          toolName: "Search",
          callId: "call-archived",
          result: { summary: "Archived evidence" },
        }),
        { toolCallId: "call-archived", toolName: "Search" },
      ),
      timestamp: 3,
    } as ToolResultMessage;
    const currentUser = user("Continue with current evidence.", 4);
    const currentAssistant = assistant(
      [{ type: "toolCall", id: "call-current", name: "Search", arguments: { query: "current" } }],
      5,
    );
    const currentResult = result("call-current", "Search", "Current evidence.", 6);
    [
      user("Inspect archived evidence.", 1),
      archivedAssistant,
      archivedResult,
      currentUser,
      currentAssistant,
      currentResult,
    ].forEach((message) => manager.appendMessage(message));

    const tokenBudget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 1_000,
      outputReserveTokens: 200,
    });
    tokenBudget.recordProviderInputTokens(690);
    const grant = createAgentToolAccessGrant({ authorizedToolNames: ["Search"], exposedToolNames: ["Search"] });
    const diagnostics: string[] = [];
    const frame = new AgentPiMutableSessionFrame({
      requestId: "request-pending-index",
      step: 1,
      diagnostics: (event) => {
        diagnostics.push(event.name);
      },
      skillCatalogFingerprint: "test",
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      selectedPromptTemplates: [],
      tokenBudget,
      preflight: async () => undefined,
    });
    const projectedIndexMessage = {
      role: "custom",
      customType: "test.pending_compaction_index",
      content: "projected retrieval index ".repeat(2_000),
      display: false,
      timestamp: 7,
    } satisfies AgentContext["messages"][number];
    const projectProviderMessages = vi.fn(
      async (messages: AgentContext["messages"], pendingIndexes?: AgentPiCompactionIndexes) => {
        const toolCallIndex =
          pendingIndexes?.toolCallIndex ?? readAgentPiCompactionToolCallIndex(manager.buildContextEntries()).index;
        return toolCallIndex && toolCallIndex.calls.length > 0 ? [...messages, projectedIndexMessage] : [...messages];
      },
    );
    const coordinator = new AgentPiMidRunCompactionCoordinator({
      frame,
      sessionManager: manager,
      compactionController: new AgentPiCompactionController({
        planningCompilerFactory: {
          create: () => ({ compile: vi.fn(), summarize: vi.fn(async () => "Short durable summary.") }),
        },
      }),
      projectProviderMessages,
    });
    const state = { messages: manager.buildSessionContext().messages };
    const context: AgentContext = { messages: [...state.messages], tools: [], systemPrompt: "system" };

    await expect(
      coordinator.prepareNextTurn(
        {
          message: currentAssistant,
          toolResults: [currentResult],
          context,
          newMessages: [currentUser, currentAssistant, currentResult],
        },
        { agent: { state } } as unknown as AgentSession,
        { enabled: true, reserveTokens: 200, keepRecentTokens: 80 },
      ),
    ).rejects.toThrow("irreducible projected context");

    expect(projectProviderMessages).toHaveBeenCalledOnce();
    expect(projectProviderMessages.mock.calls[0]?.[1]?.toolCallIndex.calls).toEqual([
      expect.objectContaining({ callId: "call-archived", toolName: "Search" }),
    ]);
    expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
    expect(readAgentPiCompactionToolCallIndex(manager.buildContextEntries()).index).toBeUndefined();
    expect(state.messages).toEqual(context.messages);
    expect(diagnostics).toEqual([
      "compaction.mid_turn.started",
      "compaction.mid_turn.insufficient_capacity",
      "compaction.mid_turn.failed",
    ]);
  });

  test("does not summarize a completed tool batch below the adaptive trigger", async () => {
    const manager = SessionManager.inMemory("C:\\workspace");
    const toolAssistant = assistant([{ type: "toolCall", id: "call-small", name: "Search", arguments: {} }], 1);
    const toolResult = result("call-small", "Search", "small", 2);
    manager.appendMessage(toolAssistant);
    manager.appendMessage(toolResult);
    const tokenBudget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 1_000,
      outputReserveTokens: 200,
    });
    tokenBudget.recordProviderInputTokens(100);
    const grant = createAgentToolAccessGrant({ authorizedToolNames: ["Search"], exposedToolNames: ["Search"] });
    const frame = new AgentPiMutableSessionFrame({
      skillCatalogFingerprint: "test",
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      selectedPromptTemplates: [],
      tokenBudget,
      preflight: async () => undefined,
    });
    const summarize = vi.fn();
    const coordinator = new AgentPiMidRunCompactionCoordinator({
      frame,
      sessionManager: manager,
      compactionController: new AgentPiCompactionController({
        planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) },
      }),
      projectProviderMessages: async (messages) => [...messages],
    });
    const context: AgentContext = { messages: manager.buildSessionContext().messages, systemPrompt: "system" };

    const compacted = await coordinator.prepareNextTurn(
      { message: toolAssistant, toolResults: [toolResult], context, newMessages: [toolAssistant, toolResult] },
      { agent: { state: { messages: context.messages } } } as unknown as AgentSession,
      { enabled: true, reserveTokens: 200, keepRecentTokens: 80 },
    );

    expect(compacted).toBeUndefined();
    expect(summarize).not.toHaveBeenCalled();
    expect(manager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
  });
});

function user(content: string, timestamp: number): UserMessage {
  return { role: "user", content, timestamp };
}

function assistant(content: AssistantMessage["content"], timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "test",
    model: "gpt-4o",
    content,
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp,
  };
}

function result(callId: string, toolName: string, content: string, timestamp: number): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName,
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp,
  };
}
