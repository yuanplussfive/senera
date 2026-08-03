import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import { AgentPiToolObservationBatchProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolObservationBatchProjector.js";
import {
  AgentPiToolObservationContextViewProtocol,
  AgentPiToolObservationProtocolError,
  agentPiToolObservationIdentity,
  projectAgentPiToolObservationDetail,
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import { AgentBudgetedJsonProjector } from "../../../Source/AgentSystem/Text/AgentBudgetedJsonProjection.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi tool observation batch projection", () => {
  test("projects a concurrent batch independently of tool completion order", () => {
    const messages = [
      piToolResultMessage(toolObservation("call-b", "SearchB", "b".repeat(12_000))),
      piToolResultMessage(toolObservation("call-a", "SearchA", "a".repeat(12_000))),
    ];
    const reversed = [...messages].reverse();

    expect(projectByCallId(messages)).toEqual(projectByCallId(reversed));
  });

  test("keeps a complete observation until later context creates budget pressure", () => {
    const projector = createProjector();
    const toolMessage = piToolResultMessage(toolObservation("call-stable", "StableTool", "result".repeat(40)));
    const first = projector.project([toolMessage]);
    const second = projector.project([userMessage("later context".repeat(10_000)), toolMessage]);

    expect(parseToolObservation(first[0])).toMatchObject({
      context_view: { complete: true },
      detail: { result: { text: "result".repeat(40) } },
    });
    expect(first[0]).toMatchObject({ content: [expect.objectContaining({ type: "text" })] });
    expect(parseToolObservation(second[1])).toMatchObject({
      context_view: { complete: false, mode: "deterministic_summary" },
    });
    expect(readAgentPiMessageTextContent(second[1])).not.toBe(readAgentPiMessageTextContent(first[0]));
  });

  test("replaces a closed batch with one grounded hot digest while retaining recovery envelopes", () => {
    const projector = createProjector();
    const rawMessages = [
      piToolResultMessage(toolObservation("call-a", "SearchA", "a".repeat(12_000))),
      piToolResultMessage(toolObservation("call-b", "SearchB", "b".repeat(12_000))),
    ];
    projector.project(rawMessages);
    const enriched = rawMessages.map((message, index) => {
      if (index !== 0) return message;
      const observation = parseToolObservation(message);
      return piToolResultMessage(withDigest(observation, "- Both searches returned relevant facts. [call-a, call-b]"));
    });

    expect(
      projector.commitCondensedBatch(enriched, enriched.map(parseToolObservation).map(agentPiToolObservationIdentity)),
    ).toBe(true);
    const hotViews = projector.project(rawMessages).map(parseToolObservation);

    expect(hotViews[0]).toMatchObject({
      artifact_uri: "senera://artifact/call-a",
      context_view: { mode: "grounded_digest" },
      detail: { semantic_digest: expect.stringContaining("call-a, call-b") },
    });
    expect(hotViews[1]).toMatchObject({
      artifact_uri: "senera://artifact/call-b",
      context_view: { mode: "grounded_digest" },
    });
    expect(JSON.stringify(hotViews)).not.toContain("a".repeat(1_000));
    expect(JSON.stringify(hotViews)).not.toContain("b".repeat(1_000));
  });

  test("commits a digest only for the selected batch observations", () => {
    const projector = createProjector();
    const historical = piToolResultMessage(toolObservation("call-history", "HistoryTool", "history".repeat(2_000)));
    const current = piToolResultMessage(toolObservation("call-current", "CurrentTool", "current".repeat(2_000)));
    projector.project([historical, current]);
    const currentObservation = parseToolObservation(current);
    const enriched = [
      historical,
      piToolResultMessage(withDigest(currentObservation, "- Current batch fact. [call-current]")),
    ];

    expect(projector.commitCondensedBatch(enriched, [agentPiToolObservationIdentity(currentObservation)])).toBe(true);
    const [historicalView, currentView] = projector.project([historical, current]).map(parseToolObservation);

    expect(historicalView.context_view).not.toMatchObject({ mode: "grounded_digest" });
    expect(currentView.context_view).toMatchObject({ mode: "grounded_digest" });
    expect(JSON.stringify(currentView)).toContain("[call-current]");
  });

  test("releases committed views once their observations leave the active context", () => {
    const projector = createProjector();
    const historical = piToolResultMessage(toolObservation("call-history", "HistoryTool", "history".repeat(2_000)));
    const current = piToolResultMessage(toolObservation("call-current", "CurrentTool", "current".repeat(2_000)));
    const currentObservation = parseToolObservation(current);
    const enriched = piToolResultMessage(withDigest(currentObservation, "- Current batch fact. [call-current]"));

    expect(
      projector.commitCondensedBatch([historical, enriched], [agentPiToolObservationIdentity(currentObservation)]),
    ).toBe(true);
    expect(parseToolObservation(projector.project([current])[0]).context_view).toMatchObject({
      mode: "grounded_digest",
    });

    projector.project([historical]);
    expect(parseToolObservation(projector.project([current])[0]).context_view).not.toMatchObject({
      mode: "grounded_digest",
    });
  });

  test("retains the deterministic failure envelope after source projection bounds oversized detail", () => {
    const source = compilePiToolObservation(
      {
        toolName: "SearchTool",
        callId: "call-failure",
        status: "failure",
        summary: "Search validation failed before producing an answer.",
        error: {
          code: "PluginExecutionError",
          message: "answer must be a string",
          diagnostics: Array.from({ length: 100 }, (_, index) => ({ index, message: "diagnostic".repeat(50) })),
        },
        process: {
          exitCode: 2,
          stdout: "partial output",
          stderr: "answer must be a string",
        },
        result: { text: "x".repeat(40_000) },
        artifact: {
          artifactUri: "senera://artifact/art_failure",
          evidence: [
            {
              evidenceUri: "senera://evidence/failure",
              kind: "diagnostic",
              source: "answer must be a string",
            },
          ],
          delta: [],
        },
      },
      diagnosticObservationProjection(),
    );
    const projected = createProjector().project([piToolResultMessage(source)]);
    const observation = parseToolObservation(projected[0]);

    expect(observation).toMatchObject({
      tool_name: "SearchTool",
      call_id: "call-failure",
      status: "failure",
      artifact_uri: "senera://artifact/art_failure",
      error: {
        code: "PluginExecutionError",
        message: "answer must be a string",
      },
      context_view: {
        type: AgentPiToolObservationContextViewProtocol.type,
        complete: true,
      },
      observation_view: { complete: false },
    });
    expect(observation.detail).toMatchObject({
      summary: "Search validation failed before producing an answer.",
      process: {
        exitCode: 2,
        stdout: "partial output",
        stderr: "answer must be a string",
      },
      evidence: [expect.objectContaining({ evidence_uri: "senera://evidence/failure" })],
    });
    expect(readAgentPiMessageTextContent(projected[0])).not.toBe("null");
    expect(observation.detail).not.toBeNull();
    expect(JSON.stringify(observation.detail)).not.toContain("diagnostic".repeat(50));
  });

  test("rejects an unbounded Senera observation before token measurement", () => {
    const message = rawToolResultMessage({
      type: "senera.tool_observation.v1",
      tool_name: "LegacyTool",
      call_id: "call-unbounded",
      result: { diagnostics: "x".repeat(100_000) },
    });

    expect(() => createProjector().project([message])).toThrow(AgentPiToolObservationProtocolError);
  });

  test("keeps staging budgets stable while concurrent tools finish", () => {
    const budget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 8_192,
      outputReserveTokens: 2_048,
    });
    budget.observeModelInput({ messages: [{ role: "user", content: "run both" }] });
    const before = budget.availableTokens();

    expect(budget.availableTokens()).toBe(before);
  });

  test("never collapses an oversized JSON projection to a null sentinel", () => {
    const projection = new AgentBudgetedJsonProjector("test-model").project({ payload: "x".repeat(10_000) }, 1);

    expect(projection.value).not.toBeNull();
    expect(projection.text).not.toBe("null");
    expect(projection.complete).toBe(false);
  });
});

function createProjector(): AgentPiToolObservationBatchProjector {
  return new AgentPiToolObservationBatchProjector({
    model: "test-model",
    contextWindowTokens: 1_024,
    outputReserveTokens: 256,
  });
}

function projectByCallId(messages: readonly AgentMessage[]): Record<string, string> {
  return Object.fromEntries(
    createProjector()
      .project(messages)
      .map((message) => {
        const observation = parseToolObservation(message);
        return [String(observation.call_id), readAgentPiMessageTextContent(message)];
      }),
  );
}

function toolObservation(callId: string, toolName: string, result: string): AgentPiToolObservation {
  return compilePiToolObservation({
    callId,
    toolName,
    result: { text: result },
    artifact: {
      artifactUri: `senera://artifact/${callId}`,
      structuredSummary: { retrieval: { refs: ["raw"] } },
      evidence: [],
      delta: [],
    },
  });
}

function rawToolResultMessage(observation: Record<string, unknown>): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: String(observation.call_id),
    toolName: String(observation.tool_name),
    content: [{ type: "text", text: JSON.stringify(observation) }],
    isError: observation.status === "failure",
    timestamp: Date.now(),
  } as AgentMessage;
}

function withDigest(observation: AgentPiToolObservation, semanticDigest: string): AgentPiToolObservation {
  return {
    ...observation,
    detail: { ...projectAgentPiToolObservationDetail(observation), semantic_digest: semanticDigest },
  };
}

function diagnosticObservationProjection(): AgentToolObservationProjectionManifest {
  const result = StandardAgentToolObservationProjection.sources.find((source) => source.source === "result");
  if (!result) throw new Error("Standard observation projection must declare the result source.");
  return {
    ...StandardAgentToolObservationProjection,
    sources: [
      ...StandardAgentToolObservationProjection.sources,
      { ...result, source: "process", priority: "high", maxTokens: 512 },
    ],
  };
}

function userMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() } as AgentMessage;
}

function parseToolObservation(message: AgentMessage): AgentPiToolObservation {
  const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
  if (!observation) throw new Error("Expected a structured Pi tool observation.");
  return observation;
}
