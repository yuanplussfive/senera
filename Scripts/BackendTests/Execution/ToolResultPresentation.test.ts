import { describe, expect, test } from "vitest";
import { projectAgentToolResultPresentation } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultPresentation.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

describe("Tool result presentation", () => {
  test("uses plugin-owned evidence display while preserving raw result separately", () => {
    const result = fixture({
      result: { weather: { city: "Beijing", temperature: 26 } },
      evidence: [{
        key: "weather:beijing",
        evidenceUri: "senera://evidence/weather-beijing",
        kind: "weather",
        locator: "weather://beijing",
        display: "Beijing: sunny, 26 C",
        label: "Beijing weather",
        source: "Weather API",
        confidence: 0.96,
        modelSlots: [{ name: "temperature", value: "26" }],
        plannerMemory: { facts: [], artifactRefs: ["summary"] },
      }],
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation).toMatchObject({
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "Beijing: sunny, 26 C",
      artifactUri: "senera://artifact/test",
    });
    expect(presentation.evidence).toHaveLength(1);
    expect(presentation.facts).toEqual([expect.objectContaining({
      name: "temperature",
      value: "26",
    })]);
    expect(result.result).toEqual({ weather: { city: "Beijing", temperature: 26 } });
  });

  test("projects workspace changes and does not stringify opaque raw objects for the default view", () => {
    const result = fixture({
      result: { opaque: { deeply: ["structured", "payload"] } },
      delta: [{
        kind: "workspace",
        key: "Source/example.ts",
        status: "changed",
        summary: "modified: Source/example.ts",
      }],
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.headline).toBe("modified: Source/example.ts");
    expect(presentation.summary).toBeUndefined();
    expect(presentation.changes).toEqual([{
      kind: "workspace",
      status: "changed",
      key: "Source/example.ts",
      summary: "modified: Source/example.ts",
    }]);
    expect(presentation.headline).not.toContain("opaque");
  });

  test("marks structured failures without replacing their raw error data", () => {
    const result = fixture({
      result: { error: { code: "ToolFailed", message: "command failed" } },
      exitCode: 1,
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.status).toBe("failure");
    expect(result.result).toEqual({ error: { code: "ToolFailed", message: "command failed" } });
  });

  test("uses a semantic result field when a plugin does not declare evidence", () => {
    const result = fixture({
      result: {
        message: "Created report.md",
        metadata: { generatedAt: "2026-07-10T00:00:00.000Z" },
      },
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.headline).toBe("Created report.md");
    expect(presentation.headline).not.toContain("metadata");
  });
});

function fixture(input: {
  result: unknown;
  exitCode?: number | null;
  evidence?: NonNullable<ExecutedToolCallResult["artifact"]>["evidence"];
  delta?: NonNullable<ExecutedToolCallResult["artifact"]>["delta"];
}): ExecutedToolCallResult {
  return {
    callId: "call_test",
    name: "TestTool",
    arguments: {},
    process: {
      exitCode: input.exitCode ?? 0,
      signal: null,
      stderr: "",
    },
    result: input.result,
    artifact: {
      artifactId: "art_test",
      artifactUri: "senera://artifact/test",
      artifactPath: "artifacts/test",
      relativePath: "artifacts/test",
      manifestPath: "artifacts/test/manifest.json",
      files: {},
      summary: "",
      evidence: input.evidence ?? [],
      delta: input.delta ?? [],
    },
  };
}
