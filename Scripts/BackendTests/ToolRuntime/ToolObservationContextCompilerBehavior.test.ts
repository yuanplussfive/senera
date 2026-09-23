import { describe, expect, test } from "vitest";
import { AgentToolObservationContextCompiler } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";

describe("Tool observation context compiler", () => {
  test("preserves a small structured result and its artifact retrieval contract", () => {
    const observation = compile({ result: { answer: "42" } });

    expect(observation).toMatchObject({
      status: "success",
      detail: {
        summary: "Test summary",
        retrieval: { artifactUri: "senera://artifact/test", refs: ["raw"] },
        result: { answer: "42" },
      },
    });
    // v5 omits the completeness declaration for fully projected observations.
    expect(observation.observation_view).toBeUndefined();
  });

  test("bounds pathological scalar output before exact token projection", () => {
    const source = String.fromCodePoint(0x8bca, 0x65ad, 0x8f93, 0x51fa).repeat(300_000);
    const observation = compile({ result: { text: source } });
    const serialized = JSON.stringify(observation);

    expect(serialized).not.toContain(source);
    expect(observation).toMatchObject({
      observation_view: {
        complete: false,
        artifact_uri: "senera://artifact/test",
      },
    });
    expect(new AgentTokenProjector("gpt-4o").countJson(observation)).toBeLessThanOrEqual(
      StandardAgentToolObservationProjection.maxTokens,
    );
  });

  test("allocates the standard result source from the live observation budget", () => {
    const source = String.fromCodePoint(0x6587, 0x672c).repeat(100_000);
    const observation = compile({ result: { text: source } });
    const resultSource = StandardAgentToolObservationProjection.sources.find((entry) => entry.source === "result");
    if (!resultSource?.budgetShare) throw new Error("Standard result source must declare a budget share.");

    const serialized = JSON.stringify(observation);
    expect(new AgentTokenProjector("gpt-4o").countJson(observation)).toBeLessThanOrEqual(
      Math.floor(StandardAgentToolObservationProjection.maxTokens * resultSource.budgetShare) + 1_024,
    );
    expect(serialized).not.toContain(source);
    expect(observation.observation_view?.complete).toBe(false);
  });

  test("retains the canonical failure envelope independently of optional detail", () => {
    const observation = compile({
      status: "failure",
      error: {
        code: "ToolExecutionError",
        kind: "host",
        source: "host",
        retryable: false,
        message: "Validation failed.",
        diagnostics: Array.from({ length: 100 }, (_, index) => ({
          index,
          message: `detail-${index}`,
          text: "detail".repeat(100),
        })),
      },
      result: { error: "Validation failed." },
    });

    expect(observation).toMatchObject({
      status: "failure",
      error: {
        code: "ToolExecutionError",
        kind: "host",
        source: "host",
        retryable: false,
        message: "Validation failed.",
        diagnostics: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("detail") })]),
      },
    });
    expect(observation.error?.diagnostics).toHaveLength(8);
    expect(JSON.stringify(observation.error)).not.toContain('"index"');
  });

  test("transmits a bounded failure message verbatim and retains an over-budget prefix", () => {
    const boundedMessage = "Validation failed: lang is not a supported value.";
    const bounded = compile({
      status: "failure",
      executionStatus: "completed",
      error: {
        code: "ToolExecutionError",
        kind: "execution",
        source: "mcp",
        retryable: false,
        message: boundedMessage,
      },
      result: undefined,
    });
    expect(bounded.error?.message).toBe(boundedMessage);

    const longMessage = "failure detail: ".repeat(2_000) + "lang=zh invalid";
    const observation = compile({
      status: "failure",
      executionStatus: "completed",
      error: {
        code: "ToolExecutionError",
        kind: "execution",
        source: "mcp",
        retryable: false,
        message: longMessage,
      },
      result: undefined,
    });

    // An over-budget message must never blank the whole error: a real, readable
    // prefix is retained, the envelope fields survive, and the omission points
    // at /message so the model knows only the tail was folded.
    const projectedMessage = observation.error?.message ?? "";
    expect(projectedMessage.length).toBeGreaterThan(0);
    expect(projectedMessage.startsWith("failure detail: ")).toBe(true);
    expect(observation.error).toMatchObject({ code: "ToolExecutionError", kind: "execution", retryable: false });
    const total = new AgentTokenProjector("gpt-4o").countJson(observation);
    expect(total).toBeLessThanOrEqual(StandardAgentToolObservationProjection.maxTokens);
    expect(observation.observation_view?.omissions).toContainEqual(
      expect.objectContaining({ path: "/error/message", reason: "token_limit" }),
    );
  });

  test("uses an explicit runtime summary without requiring artifact metadata", () => {
    const observation = compile({
      summary: "User input is required.",
      result: { question: "Which directory?" },
      artifact: undefined,
    });

    expect(observation).toMatchObject({
      detail: {
        summary: "User input is required.",
        result: { question: "Which directory?" },
      },
    });
    expect(observation.observation_view).toBeUndefined();
  });

  test("uses RFC 6901 selection and an explicit artifact-only policy without field-name inference", () => {
    const manifest: AgentToolObservationProjectionManifest = {
      ...StandardAgentToolObservationProjection,
      sources: [
        {
          ...StandardAgentToolObservationProjection.sources.find((source) => source.source === "result")!,
          pointer: "/records",
          mode: "orderedArray",
        },
        {
          ...StandardAgentToolObservationProjection.sources.find((source) => source.source === "result")!,
          source: "arguments",
          mode: "artifactOnly",
        },
      ],
    };
    const observation = compile(
      { result: { records: [{ id: 1 }, { id: 2 }], ignored: "not projected" }, arguments: { secret: "value" } },
      manifest,
    );

    expect(observation.detail).toMatchObject({ result: [{ id: 1 }, { id: 2 }] });
    expect(JSON.stringify(observation.detail)).not.toContain("ignored");
    expect(JSON.stringify(observation.detail)).not.toContain("secret");
    expect(observation).toMatchObject({ observation_view: { complete: false } });
  });

  test("does not mark the observation incomplete when an advisory source is token-truncated", () => {
    const summaryFacts = StandardAgentToolObservationProjection.sources.find((source) => source.source === "retrieval");
    if (!summaryFacts) throw new Error("Standard observation projection must declare retrieval.");
    const manifest: AgentToolObservationProjectionManifest = {
      ...StandardAgentToolObservationProjection,
      sources: [
        {
          ...summaryFacts,
          source: "summaryFacts",
          mode: "orderedArray",
          requiredForCompletion: false,
          maxTokens: 16,
        },
        ...StandardAgentToolObservationProjection.sources,
      ],
    };
    const observation = compile(
      {
        artifact: {
          artifactUri: "senera://artifact/test",
          structuredSummary: {
            summary: "Test summary",
            retrieval: { artifactUri: "senera://artifact/test", refs: ["raw"] },
            facts: Array.from({ length: 40 }, (_, index) => ({ name: `fact-${index}`, value: "x".repeat(80) })),
            limitations: [],
          },
          evidence: [],
          delta: [],
        },
      },
      manifest,
    );

    expect(observation.observation_view).toMatchObject({ complete: true });
    expect(observation.observation_view).toMatchObject({ omission_count: expect.any(Number) });
  });

  test("projects a declared perception line into observation detail", () => {
    const observation = compile({
      result: { status: "completed", summary: "The header is 'Welcome'." },
      perception: "I read what's on that part of the page, it says: The header is 'Welcome'.",
    });

    expect(observation.detail).toMatchObject({
      perception: "I read what's on that part of the page, it says: The header is 'Welcome'.",
    });
    expect(observation.observation_view).toBeUndefined();
  });

  test("omits perception detail entirely when no perception line was provided", () => {
    const observation = compile({ result: { status: "completed" } });

    expect(observation.detail.perception).toBeUndefined();
  });

  test("folds an inlined result down to the verbatim result and no completeness view", () => {
    const observation = compile({
      inline: true,
      result: { answer: "42" },
      artifact: {
        artifactUri: "senera://artifact/test",
        structuredSummary: {
          summary: "Test summary",
          retrieval: { artifactUri: "senera://artifact/test", refs: ["raw"] },
          facts: [],
          limitations: [],
        },
        evidence: [{ evidenceUri: "senera://evidence/test" }],
        delta: [{ kind: "evidence", status: "added", summary: "changed" }],
      },
    });

    expect(observation).toMatchObject({
      status: "success",
      detail: { result: { answer: "42" } },
    });
    expect(observation.detail.summary).toBeUndefined();
    expect(observation.detail.retrieval).toBeUndefined();
    expect(observation.detail.evidence).toEqual([]);
    expect(observation.detail.delta).toBeUndefined();
    expect(observation.detail.perception).toBeUndefined();
    expect(observation.observation_view).toBeUndefined();
  });

  test("keeps the completeness view when the result is token-truncated", () => {
    const source = "x".repeat(40_000);
    const observation = compile({ result: { text: source } });

    expect(observation.observation_view).toMatchObject({
      complete: false,
      artifact_uri: "senera://artifact/test",
    });
    expect(observation.observation_view?.omission_count).toBeGreaterThan(0);
    expect(JSON.stringify(observation)).not.toContain(source);
  });

  test("uses declarative host compression for oversized text and keeps protected atoms", () => {
    const source = [
      "The deployment failed while running the verification suite.",
      "The deployment failed while running the verification suite.",
      "error: contract mismatch at Source/AgentSystem/Pi/AgentPiToolExecutionBridge.ts:354.",
      "artifact=senera://artifact/rev-42 contains the complete output.",
      "rollback required before 2026-10-01T00:00:00Z.",
      ...Array.from({ length: 80 }, (_, index) => `unrelated diagnostic line ${index} with no new evidence.`),
    ].join("\n");
    const artifact = {
      artifactUri: "senera://artifact/test",
      structuredSummary: { summary: "Test summary", retrieval: { artifactUri: "senera://artifact/test" } },
      evidence: [],
      delta: [],
    };
    const result = { text: source, count: 3, enabled: true, empty: null };
    const observation = compile({
      result,
      contentPolicy: {
        ownership: "host",
        kind: "web-readable",
        representation: "markdown",
        compression: "bounded",
        deduplication: "prose-only",
        targets: ["/text"],
        preserve: ["urls", "identifiers", "logs"],
      },
      artifact,
      compressionQuery: "find deployment error, artifact URI, rollback date, and source file",
    });

    const text = String((observation.detail.result as Record<string, unknown>).text);
    const rawTokens = new AgentTokenProjector("gpt-4o").countJson({
      text: source,
      count: 3,
      enabled: true,
      empty: null,
    });
    const projectedTokens = new AgentTokenProjector("gpt-4o").countJson(observation.detail.result);
    expect(projectedTokens).toBeLessThan(rawTokens);
    expect(text).toContain("senera://artifact/rev-42");
    expect(text).toContain("Source/AgentSystem/Pi/AgentPiToolExecutionBridge.ts:354");
    expect(text).toContain("2026-10-01T00:00:00Z");
    expect(text.match(/The deployment failed while running the verification suite\./gu)).toHaveLength(1);
    expect(observation.detail.result).toMatchObject({ count: 3, enabled: true, empty: null });
    expect(result.text).toBe(source);
    expect(observation.observation_view).toMatchObject({ complete: false, artifact_uri: "senera://artifact/test" });
  });

  test("does not adapt tool-owned content even when it is large", () => {
    const source = Array.from({ length: 120 }, (_, index) => `line ${index}: keep this tool-owned output`).join("\n");
    const observation = compile({
      result: { text: source },
      contentPolicy: {
        ownership: "tool",
        kind: "web-readable",
        representation: "markdown",
        compression: "none",
        deduplication: "none",
      },
    });

    expect((observation.detail.result as Record<string, unknown>).text).toBe(source);
  });
});

function compile(
  overrides: Partial<Parameters<AgentToolObservationContextCompiler["compile"]>[0]>,
  manifest: AgentToolObservationProjectionManifest = StandardAgentToolObservationProjection,
) {
  return new AgentToolObservationContextCompiler({ model: "gpt-4o" }).compile(
    {
      toolName: "TestTool",
      callId: "call-1",
      batchId: "batch-1",
      status: "success",
      executionStatus: "completed",
      outputAvailability: "complete",
      outcome: {},
      process: { exitCode: 0, stdout: "", stderr: "" },
      error: undefined,
      result: { ok: true },
      arguments: {},
      artifact: {
        artifactUri: "senera://artifact/test",
        structuredSummary: {
          summary: "Test summary",
          retrieval: { artifactUri: "senera://artifact/test", refs: ["raw"] },
          facts: [],
          limitations: [],
        },
        evidence: [],
        delta: [],
      },
      ...overrides,
    },
    manifest,
  );
}
