import { describe, expect, test, vi } from "vitest";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import { AgentToolResultSummaryProtocol } from "../../../Source/AgentSystem/Types/AgentToolResultSummaryTypes.js";
import {
  AgentToolResultObservationCompressor,
  type AgentToolResultObservationInput,
  type AgentToolResultObservationCompressorOptions,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultObservationCompressor.js";
import type { ExecutedToolCallArtifact } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const model = "gpt-4o";

describe("AgentToolResultObservationCompressor", () => {
  test("passes the complete serialized observation when both budgets admit it", async () => {
    const summarize = vi.fn(async () => "should not run");
    const compressor = createCompressor({ summarize });
    const input = observationInput({
      result: { found: true, count: 3, selected: ["src/app.ts"] },
      process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    });

    const observation = await compressor.compress(input);

    expect(observation.compression_method).toBe("verbatim");
    expect(observation.detail.result).toEqual(input.result);
    expect(observation.detail.arguments).toBeUndefined();
    expect(observation.detail.process).toEqual({ exitCode: 0 });
    expect(observation.detail.outcome).toBeUndefined();
    expect(observation.status).toBe("success");
    expect(observation.execution_status).toBe("completed");
    expect(observation.output_availability).toBe("complete");
    expect(tokenCount(observation)).toBeLessThanOrEqual(2_048);
    expect(summarize).not.toHaveBeenCalled();
  });

  test("mechanically removes repeated text and keeps one source coordinate without repeating evidence", async () => {
    const summarize = vi.fn(async () => "should not run");
    const artifact = artifactFixture();
    const compressor = createCompressor({ summarize });
    const input = observationInput({
      artifact,
      result: { log: Array.from({ length: 300 }, () => "same status line; no new fact").join("\n") },
    });

    const observation = await compressor.compress(input);

    expect(observation.compression_method).toBe("mechanical");
    expect(observation.artifact_uri).toBe(artifact.artifactUri);
    expect(observation.observation_view?.artifact_uri).toBeUndefined();
    expect(observation.evidence_uris).toBeUndefined();
    expect(observation.detail.evidence).toEqual([]);
    expect(artifact.evidence[0]?.evidenceUri).toBe("senera://evidence/evi_0123456789abcdef01234567");
    expect(tokenCount(observation)).toBeLessThanOrEqual(2_048);
    expect(summarize).not.toHaveBeenCalled();
  });

  test("outlines oversized Artifact results without using task-specific saved summaries", async () => {
    const summarize = vi.fn(async () => "should not run");
    const artifact = {
      ...artifactFixture(),
      structuredSummary: {
        type: AgentToolResultSummaryProtocol.type,
        version: AgentToolResultSummaryProtocol.version,
        toolName: "WorkspaceRead",
        callId: "call-summary",
        status: "success" as const,
        artifactUri: "senera://artifact/art_0123456789abcdef01234567",
        headline: "Deployment completed",
        summary: "Revision rev-42 is active.",
        facts: [],
        changes: [
          {
            kind: "workspace",
            status: "changed",
            key: "src/app.ts",
            summary: "updated",
          },
        ],
        limitations: [],
        retrieval: {
          artifactUri: "senera://artifact/art_0123456789abcdef01234567",
          refs: ["summary"],
        },
        stats: {
          summaryTokens: 8,
          summaryTokenLimit: 700,
          summaryTruncated: false,
          factCount: 0,
          omittedFacts: 0,
          changeCount: 1,
          omittedChanges: 0,
        },
      },
    };
    const compressor = createCompressor({ summarize });

    const observation = await compressor.compress(
      observationInput({
        artifact,
        result: { output: "raw output ".repeat(10_000) },
      }),
    );

    expect(observation.compression_method).toBe("mechanical");
    expect(observation.detail.headline).toBeUndefined();
    expect(observation.detail.summary).toBeUndefined();
    expect(observation.detail.result).toMatchObject({
      part: "result",
      representation: "structure",
      outline: { fields: { output: { path: "/output", type: "string", tokens: expect.any(Number) } } },
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(tokenCount(observation)).toBeLessThanOrEqual(2_048);
  });

  test("omits an empty process envelope instead of carrying null and empty fields", async () => {
    const compressor = createCompressor();
    const observation = await compressor.compress(
      observationInput({
        process: { exitCode: null, signal: null, stdout: "", stderr: "" },
      }),
    );

    expect(observation.detail.process).toBeUndefined();
    expect(observation.detail.result).toEqual({ found: true });
  });

  test("omitted process output cannot be reported as a complete observation", async () => {
    const summarize = vi.fn(async () => "should not run");
    const observation = await createCompressor({ summarize }).compress(
      observationInput({
        artifact: artifactFixture(),
        result: { count: 3 },
        process: { exitCode: 0, signal: null, stdout: "unique diagnostic output ".repeat(3_000), stderr: "" },
      }),
    );
    expect(observation.observation_view?.complete).toBe(false);
    expect(observation.observation_view?.omissions).toEqual([{ path: "/detail/process", reason: "deferred_content" }]);
    expect(observation.detail.process).toMatchObject({
      part: "process",
      complete: false,
      outline: { fields: { exitCode: 0, stdout: { path: "/stdout", type: "string" } } },
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  test("uses Pi summary compression for a large result without a durable source", async () => {
    const summarize = vi.fn(async (request) => {
      expect(request.currentUserMessage).toBe("Find the deployment outcome.");
      expect(JSON.stringify(request.feedback)).toContain("record-39");
      return "Deployment completed; revision rev-42 is active.";
    });
    const compressor = createCompressor({ summarize });
    const records = Array.from(
      { length: 120 },
      (_, index) =>
        `record-${index}: deployment worker processed shard ${index} with checksum ${index * 7919} and ` +
        Array.from({ length: 14 }, (_, word) => `unique-${index}-${word}`).join(" "),
    );
    const input = observationInput({
      currentUserMessage: "Find the deployment outcome.",
      result: {
        first: records.join("\n"),
        second: records.map((record) => `verification-${record}`).join("\n"),
        third: records.map((record) => `replica-${record}`).join("\n"),
      },
    });

    const observation = await compressor.compress(input);

    expect(observation.compression_method).toBe("llm");
    expect(observation.detail.summary).toBe("Deployment completed; revision rev-42 is active.");
    expect(tokenCount(observation)).toBeLessThanOrEqual(2_048);
    expect(summarize).toHaveBeenCalledOnce();
  }, 30_000);

  test("returns a pressure observation when the dynamic budget cannot fit the envelope", async () => {
    const compressor = createCompressor();
    const observation = await compressor.compress(observationInput({ observationBudgetTokens: 1 }));

    expect(observation.compression_method).toBe("mechanical");
    expect(observation.observation_view?.complete).toBe(false);
    expect(observation.observation_view?.omissions[0]?.reason).toBe("context_pressure_envelope");
    expect(observation.detail.notice).toContain("Pi will compact");
  });
});

function createCompressor(
  options: {
    readonly summarize?: AgentToolResultObservationCompressorOptions["summarize"];
  } = {},
): AgentToolResultObservationCompressor {
  return new AgentToolResultObservationCompressor({
    model,
    summarize: options.summarize ?? (async () => "summary"),
  });
}

function observationInput(patch: Partial<AgentToolResultObservationInput> = {}): AgentToolResultObservationInput {
  return {
    toolName: "WorkspaceRead",
    status: "success",
    executionStatus: "completed",
    outputAvailability: "complete",
    arguments: { path: "src/app.ts" },
    process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    outcome: {
      execution: { status: "completed" },
      assessment: { status: "success" },
      output: { availability: "complete" },
    },
    result: { found: true },
    systemPrompt: "Answer accurately using the supplied tool result.",
    currentUserMessage: "Inspect the requested file.",
    observationBudgetTokens: 2_048,
    ...patch,
  };
}

function artifactFixture(): ExecutedToolCallArtifact {
  return {
    artifactId: "art_0123456789abcdef01234567",
    artifactUri: "senera://artifact/art_0123456789abcdef01234567",
    artifactPath: "artifacts/art_0123456789abcdef01234567",
    relativePath: "artifacts/art_0123456789abcdef01234567",
    manifestPath: "artifacts/art_0123456789abcdef01234567/manifest.json",
    files: {},
    summary: "Deployment run output.",
    evidence: [
      {
        origin: "result",
        key: "deployment",
        evidenceUri: "senera://evidence/evi_0123456789abcdef01234567",
        kind: "deployment",
        locator: "deployment://rev-42",
        display: "Deployment rev-42",
        label: "Deployment",
        source: "Deployment completed.",
        confidence: 1,
        modelSlots: [{ name: "revision", value: "rev-42" }],
        plannerMemory: {
          facts: [{ name: "revision", value: "rev-42" }],
          artifactRefs: ["raw", "evidence"],
          artifactUri: "senera://artifact/art_0123456789abcdef01234567",
        },
      },
    ],
    delta: [],
  };
}

function tokenCount(value: unknown): number {
  return new AgentTokenProjector(model).countJson(value);
}
