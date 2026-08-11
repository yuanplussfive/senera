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
      observation_view: { complete: true, omission_count: 0, artifact_uri: "senera://artifact/test" },
      detail: {
        summary: "Test summary",
        retrieval: { artifactUri: "senera://artifact/test", refs: ["raw"] },
        result: { answer: "42" },
      },
    });
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

  test("retains the canonical failure envelope independently of optional detail", () => {
    const observation = compile({
      status: "failure",
      error: {
        code: "ToolExecutionError",
        kind: "host",
        source: "host",
        retryable: false,
        message: "Validation failed.",
        diagnostics: Array.from({ length: 100 }, (_, index) => ({ index, text: "detail".repeat(100) })),
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
      },
    });
    expect(JSON.stringify(observation.error)).not.toContain("diagnostics");
  });

  test("uses an explicit runtime summary without requiring artifact metadata", () => {
    const observation = compile({
      summary: "User input is required.",
      result: { question: "Which directory?" },
      artifact: undefined,
    });

    expect(observation).toMatchObject({
      observation_view: { complete: true },
      detail: {
        summary: "User input is required.",
        result: { question: "Which directory?" },
      },
    });
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
