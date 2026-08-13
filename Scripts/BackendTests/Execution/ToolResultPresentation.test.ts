import { describe, expect, test } from "vitest";
import { projectAgentToolResultPresentation } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultPresentation.js";
import type {
  AgentToolProcessError,
  ExecutedToolCallResult,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { compareWorkspaceSnapshots } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotDiff.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

describe("Tool result presentation", () => {
  test("uses tool-owned evidence display while preserving raw result separately", () => {
    const result = fixture({
      result: { weather: { city: "Beijing", temperature: 26 } },
      evidence: [
        {
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
        },
      ],
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
    expect(presentation.facts).toEqual([
      expect.objectContaining({
        name: "temperature",
        value: "26",
      }),
    ]);
    expect(result.result).toEqual({ weather: { city: "Beijing", temperature: 26 } });
  });

  test("projects workspace changes and does not stringify opaque raw objects for the default view", () => {
    const workspaceChanges = compareWorkspaceSnapshots(
      {
        capturedAt: "2026-08-13T00:00:00.000Z",
        files: [workspaceFile("Source/example.ts", "export const before = true;\n")],
      },
      {
        capturedAt: "2026-08-13T00:00:01.000Z",
        files: [workspaceFile("Source/example.ts", "export const after = true;\nexport const ready = true;\n")],
      },
    );
    const result = fixture({
      result: { opaque: { deeply: ["structured", "payload"] } },
      delta: [
        {
          kind: "workspace",
          key: "Source/example.ts",
          status: "changed",
          summary: "modified: Source/example.ts",
        },
      ],
      workspace: {
        before: { files: [], capturedAt: "2026-08-13T00:00:00.000Z" },
        after: { files: [], capturedAt: "2026-08-13T00:00:01.000Z" },
        changes: workspaceChanges,
      },
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.headline).toBe("modified: Source/example.ts");
    expect(presentation.summary).toBeUndefined();
    expect(presentation.changes).toEqual([
      {
        kind: "workspace",
        status: "changed",
        key: "Source/example.ts",
        summary: "modified: Source/example.ts",
        addedLines: 2,
        removedLines: 1,
      },
    ]);
    expect(presentation.headline).not.toContain("opaque");
  });

  test("marks structured failures without replacing their raw error data", () => {
    const error = {
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: "command failed",
    };
    const result = fixture({
      result: { error },
      error,
      exitCode: 1,
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.status).toBe("failure");
    expect(result.result).toEqual({ error });
  });

  test("uses a semantic result field when a tool does not declare evidence", () => {
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
  error?: AgentToolProcessError;
  exitCode?: number | null;
  evidence?: NonNullable<ExecutedToolCallResult["artifact"]>["evidence"];
  delta?: NonNullable<ExecutedToolCallResult["artifact"]>["delta"];
  workspace?: NonNullable<ExecutedToolCallResult["artifact"]>["workspace"];
}): ExecutedToolCallResult {
  return {
    callId: "call_test",
    name: "TestTool",
    arguments: {},
    process: {
      exitCode: input.exitCode ?? 0,
      signal: null,
      stdout: "",
      stderr: "",
    },
    result: input.result,
    outcome: input.error
      ? createAgentToolFailureOutcome(input.error, AgentToolFailureSources.Host, "none")
      : AgentToolSuccessOutcome,
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
      workspace: input.workspace,
    },
  };
}

function workspaceFile(path: string, text: string) {
  return {
    path,
    absolutePath: `C:/workspace/${path}`,
    exists: true,
    kind: "file" as const,
    size: Buffer.byteLength(text),
    mtimeMs: 0,
    hash: text,
    content: {
      state: "captured" as const,
      encoding: "utf8" as const,
      byteLength: Buffer.byteLength(text),
      lineCount: text.split("\n").length,
      text,
    },
  };
}
