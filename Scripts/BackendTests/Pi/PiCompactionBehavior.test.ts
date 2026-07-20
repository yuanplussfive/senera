import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentMessage, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import {
  AgentPiCompactionDispositions,
  AgentPiCompactionPolicy,
  AgentPiCompactionSkipReasons,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionPolicy.js";
import { AgentPiCompactionSummarizer } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSummarizer.js";
import { AgentPiHarnessSession } from "../../../Source/AgentSystem/Pi/AgentPiHarnessSession.js";
import type { AgentPiCompactionPromptInput } from "../../../Source/AgentSystem/Pi/AgentPiCompactionPrompt.js";
import { AgentPiHarnessSessionPool } from "../../../Source/AgentSystem/Pi/AgentPiHarnessSessionPool.js";
import { AgentPiSessionStore } from "../../../Source/AgentSystem/Pi/AgentPiSessionStore.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type {
  AgentSystemConfig,
  ResolvedAgentPiCompactionConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { resolveAgentLoopConfig } from "../../../Source/AgentSystem/AgentDefaults.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Pi compaction behavior", () => {
  test("compacts migrated history through BAML hook and restores summary plus recent suffix", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const provider = {
      ...createModelProvider(),
      ContextWindowTokens: 16_384,
      MaxOutputTokens: 2_048,
      MaxModelOutputTokens: 4_096,
    };
    const store = new AgentPiSessionStore({ workspaceRoot, sessionsRoot: ".senera/pi-sessions", env });
    const persistent = await store.openOrCreate({ sessionId: "session-compact" });
    const compactPiSession = vi.fn(async (_input: AgentPiCompactionPromptInput) => ({
      goals: ["Preserve the active implementation task"],
      constraints: ["Do not repeat completed work"],
      completed: ["Inspected the existing runtime"],
      inProgress: ["Implement automatic compaction"],
      blocked: [],
      decisions: [{ decision: "Use the Pi hook", rationale: "Pi retains session-tree ownership" }],
      nextSteps: ["Continue with the retained suffix"],
      criticalContext: ["sessionId=session-compact"],
    }));
    const compactionConfig = createCompactionConfig();
    const traceEvents: unknown[] = [];
    const pool = new AgentPiHarnessSessionPool({
      env,
      provider: projectSeneraModelProviderToPi(provider, config),
      modelProvider: provider,
      compactionPolicy: new AgentPiCompactionPolicy(compactionConfig, provider),
      compactionSummarizer: new AgentPiCompactionSummarizer({ compactPiSession }),
    });
    const lease = await pool.lease({
      sessionId: persistent.sessionId,
      session: persistent.session,
      toolSet: {
        fingerprint: "empty-tools",
        activeToolNames: [],
        materialize: () => [],
      },
      resources: { skills: [], promptTemplates: [] },
      resourceFingerprint: "empty-resources",
      frame: {
        sessionId: persistent.sessionId,
        selectedPromptTemplates: [],
        onEvent: (event) => {
          traceEvents.push(event);
        },
      },
      preflight: async () => undefined,
    });
    const history = createHistory(32, 900);
    await lease.session.setHistory(history);

    const result = await lease.session.compactIfNeeded?.();

    expect(result?.status).toBe("compacted");
    expect(compactPiSession).toHaveBeenCalledOnce();
    expect(compactPiSession.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        compactedConversation: expect.stringContaining("historical-message-0"),
      }),
    );
    const entries = await persistent.session.getEntries();
    expect(entries.at(-1)).toMatchObject({ type: "compaction", fromHook: true });
    const context = await persistent.session.buildContext();
    expect(context.messages[0]).toMatchObject({
      role: "compactionSummary",
      summary: expect.stringContaining("## Goal"),
    });
    expect(context.messages.length).toBeLessThan(history.length);
    expect(readPiTracePayload(traceEvents, "compaction.check.timing")).toEqual({
      durationMs: expect.any(Number),
      branchEntryCount: history.length,
    });

    lease.session.dispose();
    await pool.close();
  });

  test("uses token and message watermarks without compacting twice at the same leaf", () => {
    const provider = {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    };
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), provider);
    const messages = createHistory(40, 20);
    const branch = messages.map((message, index) => ({
      type: "message" as const,
      id: `entry-${index}`,
      parentId: index === 0 ? null : `entry-${index - 1}`,
      timestamp: new Date(index).toISOString(),
      message,
    }));

    const plan = policy.plan(messages, branch);
    expect(plan.kind).toBe(AgentPiCompactionDispositions.Compact);
    expect(plan.inspection.shouldCompact).toBe(true);
    expect(plan.inspection.pressureReasons).toContain("message_threshold");
    expect(plan.inspection.settings.keepRecentTokens).toBeLessThanOrEqual(plan.inspection.targetTokens);

    const repeated = policy.plan(messages, [
      ...branch,
      {
        type: "compaction",
        id: "compaction-1",
        parentId: branch.at(-1)!.id,
        timestamp: new Date().toISOString(),
        summary: "summary",
        firstKeptEntryId: branch[20]!.id,
        tokensBefore: 100,
      },
    ]);
    expect(repeated).toMatchObject({
      kind: AgentPiCompactionDispositions.Skip,
      reason: AgentPiCompactionSkipReasons.AlreadyCompacted,
      inspection: { shouldCompact: false },
    });
  });

  test("falls back to full local estimation when migrated assistant usage is zero", () => {
    const provider = {
      ...createModelProvider(),
      ContextWindowTokens: 10_000,
      MaxOutputTokens: 1_000,
    };
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), provider);
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "x".repeat(30_000) }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Migrated response" }],
        api: "openai-completions",
        provider: "senera-pi-proxy",
        model: "test-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      },
    ];
    const branch = messages.map((message, index) => ({
      type: "message" as const,
      id: `zero-usage-${index}`,
      parentId: index === 0 ? null : `zero-usage-${index - 1}`,
      timestamp: new Date(index).toISOString(),
      message,
    }));

    const plan = policy.plan(messages, branch);

    expect(plan.inspection.branchHistoryTokens).toBeGreaterThan(plan.inspection.triggerTokens);
    expect(plan.inspection.reportedContextTokens).toBe(plan.inspection.branchHistoryTokens);
    expect(plan.inspection.pressureReasons).toContain("history_token_threshold");
  });

  test("classifies provider-reported fixed overhead without attempting history compaction", () => {
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    });
    const messages: AgentMessage[] = [
      userMessage("Run the terminal workflow", 1),
      assistantMessage("Starting tools", 34_475, 2),
    ];

    const plan = policy.plan(messages, branchFromMessages(messages));

    expect(plan).toMatchObject({
      kind: AgentPiCompactionDispositions.ReduceContextOverhead,
      reason: AgentPiCompactionSkipReasons.FixedOverheadDominant,
      inspection: {
        shouldCompact: false,
        requestHardLimitExceeded: false,
        hardLimitExceeded: false,
      },
    });
    expect(plan.inspection.reportedContextTokens).toBeGreaterThan(plan.inspection.triggerTokens);
    expect(plan.inspection.branchHistoryTokens).toBeLessThan(plan.inspection.triggerTokens);
    expect(plan.inspection.fixedOverheadTokens).toBeGreaterThan(30_000);
    expect(plan.inspection.pressureReasons).toEqual(["reported_token_threshold"]);
  });

  test("does not promote provider-reported overhead to the history hard limit", () => {
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    });
    const messages: AgentMessage[] = [
      userMessage("Continue the terminal workflow", 1),
      assistantMessage("Waiting for output", 44_092, 2),
    ];

    const plan = policy.plan(messages, branchFromMessages(messages));

    expect(plan.kind).toBe(AgentPiCompactionDispositions.ReduceContextOverhead);
    expect(plan.inspection.requestHardLimitExceeded).toBe(true);
    expect(plan.inspection.hardLimitExceeded).toBe(false);
  });

  test("skips harness compaction when request pressure comes from fixed context overhead", async () => {
    const provider = {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    };
    const messages: AgentMessage[] = [
      userMessage("Continue the terminal workflow", 1),
      assistantMessage("Waiting for output", 44_092, 2),
    ];
    const branch = branchFromMessages(messages);
    const compact = vi.fn(async () => {
      throw new Error("compact must not run for fixed overhead");
    });
    const events: string[] = [];
    const session = new AgentPiHarnessSession(
      {
        waitForIdle: vi.fn(async () => undefined),
        appendMessage: vi.fn(async () => undefined),
        compact,
      } as never,
      {
        model: projectSeneraModelProviderToPi(provider, config).model,
        tools: [],
        persistentSession: {
          getBranch: async () => branch,
          buildContext: async () => ({ messages }),
        } as never,
        compactionPolicy: new AgentPiCompactionPolicy(createCompactionConfig(), provider),
        onCompactionEvent: async (event) => {
          events.push(event);
        },
      },
    );

    await expect(session.compactIfNeeded()).resolves.toMatchObject({
      status: "skipped",
      reason: AgentPiCompactionSkipReasons.FixedOverheadDominant,
      inspection: {
        disposition: AgentPiCompactionDispositions.ReduceContextOverhead,
        requestHardLimitExceeded: true,
        hardLimitExceeded: false,
      },
    });
    expect(events).toEqual(["checked", "skipped"]);
    expect(compact).not.toHaveBeenCalled();
  });

  test("builds compaction context from one branch snapshot and reports check cost", async () => {
    const provider = {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    };
    const branch = branchFromMessages([userMessage("short history", 1)]);
    const getBranch = vi.fn(async () => branch);
    const events: Array<{ event: string; payload: unknown }> = [];
    const session = new AgentPiHarnessSession(
      {
        waitForIdle: vi.fn(async () => undefined),
        appendMessage: vi.fn(async () => undefined),
        compact: vi.fn(async () => {
          throw new Error("compact must not run below threshold");
        }),
      } as never,
      {
        model: projectSeneraModelProviderToPi(provider, config).model,
        tools: [],
        persistentSession: { getBranch } as never,
        compactionPolicy: new AgentPiCompactionPolicy(createCompactionConfig(), provider),
        onCompactionEvent: async (event, _inspection, payload) => {
          events.push({ event, payload });
        },
      },
    );

    await expect(session.compactIfNeeded()).resolves.toMatchObject({
      status: "skipped",
      reason: AgentPiCompactionSkipReasons.BelowThreshold,
    });
    expect(getBranch).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { event: "checked", payload: { durationMs: expect.any(Number), branchEntryCount: 1 } },
      {
        event: "skipped",
        payload: {
          durationMs: expect.any(Number),
          branchEntryCount: 1,
          reason: AgentPiCompactionSkipReasons.BelowThreshold,
          recommendedAction: AgentPiCompactionDispositions.Skip,
        },
      },
    ]);
  });

  test("skips tool-result-heavy branches when Pi has no valid compaction cut point", () => {
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    });
    const messages: AgentMessage[] = [
      userMessage("Run parallel tools", 1),
      assistantMessage("Starting tools", 0, 2),
      ...Array.from({ length: 40 }, (_, index) => toolResultMessage("ok", index + 3)),
    ];

    const plan = policy.plan(messages, branchFromMessages(messages));

    expect(plan).toMatchObject({
      kind: AgentPiCompactionDispositions.Skip,
      reason: AgentPiCompactionSkipReasons.NoCompactableHistory,
      inspection: {
        shouldCompact: false,
        compactableMessageCount: 0,
        turnPrefixMessageCount: 0,
      },
    });
    expect(plan.inspection.pressureReasons).toContain("message_threshold");
  });

  test("accepts a valid split-turn-only compaction plan", async () => {
    const policy = new AgentPiCompactionPolicy(createCompactionConfig(), {
      ...createModelProvider(),
      ContextWindowTokens: 128_000,
      MaxOutputTokens: 8_192,
    });
    const messages: AgentMessage[] = [
      userMessage(`Inspect deeply ${"u".repeat(10_000)}`, 1),
      assistantMessage("a".repeat(36_000), 0, 2),
      toolResultMessage("b".repeat(40_000), 3),
    ];
    const plan = policy.plan(messages, branchFromMessages(messages));
    expect(plan.kind).toBe(AgentPiCompactionDispositions.Compact);
    if (plan.kind !== AgentPiCompactionDispositions.Compact) throw new Error("Expected a compaction plan.");
    expect(plan.preparation.messagesToSummarize).toHaveLength(0);
    expect(plan.preparation.turnPrefixMessages.length).toBeGreaterThan(0);

    const compactPiSession = vi.fn(async (_input: AgentPiCompactionPromptInput) => ({
      goals: ["Continue the active turn"],
      constraints: [],
      completed: [],
      inProgress: ["Large tool operation"],
      blocked: [],
      decisions: [],
      nextSteps: ["Continue with the retained suffix"],
      criticalContext: [],
    }));
    await new AgentPiCompactionSummarizer({ compactPiSession }).summarize({
      preparation: plan.preparation,
      inspection: plan.inspection,
    });

    expect(compactPiSession).toHaveBeenCalledWith(
      expect.objectContaining({
        compactedConversation: "",
        splitTurnPrefix: expect.stringContaining("Inspect deeply"),
      }),
      { signal: undefined },
    );
  });

  test("rejects invalid ratios after defaults and local overrides are merged", () => {
    expect(() =>
      resolveAgentLoopConfig({
        ...config,
        AgentLoop: { PiSessions: { Compaction: { TargetRatio: 0.9 } } },
      }),
    ).toThrow("TargetRatio < TriggerRatio < HardLimitRatio");
  });
});

function createHistory(count: number, contentLength: number): AgentMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text: `historical-message-${index} ${"x".repeat(contentLength)}` }],
    timestamp: Date.parse("2026-01-01T00:00:00.000Z") + index,
  }));
}

function branchFromMessages(messages: readonly AgentMessage[]): SessionTreeEntry[] {
  return messages.map((message, index) => ({
    type: "message",
    id: `entry-${index}`,
    parentId: index === 0 ? null : `entry-${index - 1}`,
    timestamp: new Date(index).toISOString(),
    message,
  }));
}

function userMessage(text: string, timestamp: number): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp,
  };
}

function assistantMessage(text: string, reportedTokens: number, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "senera-pi-proxy",
    model: "test-model",
    usage: {
      input: reportedTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: reportedTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function toolResultMessage(text: string, timestamp: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${timestamp}`,
    toolName: "TestTool",
    content: [{ type: "text", text }],
    isError: false,
    timestamp,
  };
}

function createCompactionConfig(): ResolvedAgentPiCompactionConfig {
  return {
    Enabled: true,
    TriggerRatio: 0.5,
    HardLimitRatio: 0.95,
    TargetRatio: 0.25,
    SummaryMaxTokens: 512,
    TimeoutSeconds: 30,
    TimeoutMs: 30_000,
    UnknownContextWindowTokens: 128_000,
    UnknownModelOutputTokens: 8_192,
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-pi-compaction");
  temporaryDirectories.push(workspace);
  return workspace;
}

const config: AgentSystemConfig = {
  AgentLoop: {
    PiSessions: {
      Compaction: createCompactionConfig(),
    },
  },
  Server: { Host: "127.0.0.1", Port: 8787 },
  ModelProviderEndpoints: [{ Id: "test-endpoint", BaseUrl: "https://model.example/v1", ApiKey: "test-key" }],
  ModelProviders: [
    {
      Id: "test-provider",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
};

function readPiTracePayload(events: readonly unknown[], eventType: string): unknown {
  for (const event of events) {
    if (!event || typeof event !== "object" || !("kind" in event) || event.kind !== "pi.trace") continue;
    const data = "data" in event ? event.data : undefined;
    if (data && typeof data === "object" && "eventType" in data && data.eventType === eventType) {
      return "payload" in data ? data.payload : undefined;
    }
  }
  return undefined;
}
