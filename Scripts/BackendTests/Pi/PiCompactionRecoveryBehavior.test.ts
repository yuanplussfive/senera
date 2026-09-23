import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager, type ExtensionAPI, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { createAgentPiDeterministicCompactionSummary } from "../../../Source/AgentSystem/Pi/AgentPiCompactionRecovery.js";
import { AgentPiCompactionToolIndexProtocol } from "../../../Source/AgentSystem/Pi/AgentPiCompactionToolIndex.js";
import { AgentPiRuntimeExtensionFactory } from "../../../Source/AgentSystem/Pi/AgentPiRuntimeExtensionFactory.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("Pi deterministic compaction recovery", () => {
  test("preserves bounded visible context and durable index coordinates without another model call", () => {
    const hugeObservation = "private payload ".repeat(20_000);
    const messages = [
      { role: "user", content: "Continue the migration from the previous checkpoint.", timestamp: 1 },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "workspace.read",
        content: [{ type: "text", text: hugeObservation }],
        isError: false,
        timestamp: 2,
      },
    ] as unknown as AgentMessage[];
    const summary = createAgentPiDeterministicCompactionSummary(
      {
        mode: "compact",
        messages,
        previousSummary: "The migration is halfway complete.",
        artifactIndex: { artifacts: [{ artifactUri: "senera://artifact/1" }] },
        toolCallIndex: {
          type: AgentPiCompactionToolIndexProtocol.type,
          calls: [],
          totalCalls: 1,
          successCount: 1,
          failureCount: 0,
          emptyCount: 0,
          evidenceUris: ["senera://evidence/1"],
          artifactUris: ["senera://artifact/1"],
        },
        continuityLedger: {
          references: [{ id: "ref-1" }],
          checkpoints: [{ id: "checkpoint-1" }],
        },
      },
      { model: "gpt-5.6-luna", reason: "threshold" },
    );

    expect(summary).toContain("Deterministic compaction checkpoint");
    expect(summary).toContain("Continue the migration from the previous checkpoint.");
    expect(summary).toContain("Previous checkpoint:");
    expect(summary).toContain("Durable indexes: artifacts=1 toolCalls=0 continuityReferences=1 checkpoints=1");
    expect(summary).not.toContain("<summary>");
    expect(summary).not.toContain("private payload");
    expect(summary.length).toBeLessThan(20_000);
  });

  test("recovers automatic compaction when the provider summary request times out", async () => {
    const manager = SessionManager.inMemory("C:\\workspace");
    const message = { role: "user", content: "Keep the current migration goal.", timestamp: 1 } as AgentMessage;
    manager.appendMessage(message as never);
    const grant = createAgentToolAccessGrant({ authorizedToolNames: [], exposedToolNames: [] });
    const tokenBudget = new AgentTurnTokenBudget({
      model: "gpt-5.6-luna",
      contextWindowTokens: 10_000,
      outputReserveTokens: 1_000,
    });
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "session-recovery",
      skillCatalogFingerprint: "test",
      nativeProviderToolNames: [],
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      selectedPromptTemplates: [],
      tokenBudget,
      preflight: async () => undefined,
    });
    const summarize = async () => {
      throw new Error("first token timeout");
    };
    const registration = new AgentPiRuntimeExtensionFactory({
      provider: { model: { id: "gpt-5.6-luna" } } as never,
      modelProvider: createModelProvider({ Model: "gpt-5.6-luna" }),
      planningCompilerFactory: {
        create: () => ({ compile: async () => ({}), summarize }) as never,
      },
    }).create(frame, manager);
    type BeforeCompactHandler = (event: SessionBeforeCompactEvent) => Promise<unknown>;
    const handlers = new Map<string, BeforeCompactHandler>();
    const extensionApi = {
      on: (name: string, handler: unknown) => {
        if (name === "session_before_compact") handlers.set(name, handler as BeforeCompactHandler);
      },
    } as unknown as ExtensionAPI;
    await registration.factory(extensionApi);

    const compact = handlers.get("session_before_compact");
    expect(compact).toBeDefined();
    const entryId = manager.getBranch()[0]?.id;
    const result = await compact?.({
      type: "session_before_compact",
      preparation: {
        messagesToSummarize: [message],
        turnPrefixMessages: [],
        previousSummary: undefined,
        isSplitTurn: false,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
        settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 8_000 },
        firstKeptEntryId: entryId,
        tokensBefore: 100,
      },
      branchEntries: manager.getBranch(),
      customInstructions: undefined,
      reason: "threshold",
      willRetry: false,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      compaction: {
        firstKeptEntryId: entryId,
        details: { summarySource: "deterministic-recovery" },
      },
    });
    expect((result as { compaction: { summary: string } }).compaction.summary).toContain(
      "Deterministic compaction checkpoint",
    );
  });
});
