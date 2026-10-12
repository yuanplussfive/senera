import { describe, expect, test } from "vitest";
import { projectAgentToolResultPresentation } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultPresentation.js";
import {
  AgentWorkspaceChangeSetProtocol,
  type AgentToolProcessError,
  type ExecutedToolCallResult,
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
        workspaceStatus: "modified",
        workspaceBeforeKind: "file",
        workspaceAfterKind: "file",
        addedLines: 2,
        removedLines: 1,
      },
    ]);
    expect(presentation.headline).not.toContain("opaque");
  });

  test("projects workspace changes before Artifact recording publishes the delta", () => {
    const workspaceChanges = compareWorkspaceSnapshots(
      {
        capturedAt: "2026-08-13T00:00:00.000Z",
        files: [],
      },
      {
        capturedAt: "2026-08-13T00:00:01.000Z",
        files: [workspaceFile("src/created.ts", "export const ready = true;\n")],
      },
    );
    const result = fixture({
      result: { ok: true },
      workspaceCapture: {
        before: { files: [], capturedAt: "2026-08-13T00:00:00.000Z" },
        after: { files: [], capturedAt: "2026-08-13T00:00:01.000Z" },
        changes: workspaceChanges,
      },
    });

    expect(projectAgentToolResultPresentation(result).changes).toEqual([
      expect.objectContaining({
        kind: "workspace",
        status: "changed",
        key: "src/created.ts",
        workspaceStatus: "added",
        workspaceBeforeKind: "missing",
        workspaceAfterKind: "file",
        addedLines: 1,
        removedLines: 0,
      }),
    ]);
  });

  test("keeps directory changes in provenance without counting them as files", () => {
    const before = { capturedAt: "2026-08-13T00:00:00.000Z", files: [] };
    const after = {
      capturedAt: "2026-08-13T00:00:01.000Z",
      files: [workspaceDirectory("images"), workspaceFile("pelican-bicycle.svg", "<svg />\n")],
    };
    const changes = compareWorkspaceSnapshots(before, after);
    const presentation = projectAgentToolResultPresentation(
      fixture({
        result: { ok: true },
        workspace: { before, after, changes },
      }),
    );

    expect(changes).toHaveLength(2);
    expect(presentation.workspaceObservation).toMatchObject({ changedFileCount: 1, changedDirectoryCount: 1 });
    expect(presentation.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pelican-bicycle.svg",
          workspaceBeforeKind: "missing",
          workspaceAfterKind: "file",
        }),
        expect.objectContaining({
          key: "images",
          workspaceBeforeKind: "missing",
          workspaceAfterKind: "directory",
        }),
      ]),
    );
  });

  test("preserves observed batch scope without mislabeling it as an incomplete capture", () => {
    const before = { capturedAt: "2026-09-28T00:00:00.000Z", files: [] };
    const after = {
      capturedAt: "2026-09-28T00:00:01.000Z",
      files: [workspaceFile("generated.txt", "observed output\n")],
    };
    const result = fixture({
      result: { ok: true },
      workspaceCapture: {
        type: AgentWorkspaceChangeSetProtocol.type,
        version: AgentWorkspaceChangeSetProtocol.version,
        source: "filesystem-observer",
        coverage: "observed",
        scope: { kind: "tool_batch", id: "batch-1" },
        before,
        after,
        changes: compareWorkspaceSnapshots(before, after),
      },
    });

    expect(projectAgentToolResultPresentation(result).workspaceObservation).toMatchObject({
      status: "complete",
      coverage: "observed",
      source: "filesystem-observer",
      scope: { kind: "tool_batch", id: "batch-1" },
      changedFileCount: 1,
    });
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

  test("does not substitute the tool name when a result has no semantic headline", () => {
    const presentation = projectAgentToolResultPresentation(fixture({ result: { code: 0 } }));

    expect(presentation.headline).toBe("");
    expect(presentation.summary).toBeUndefined();
  });

  test("keeps suspicious inline media out of the model-facing headline", () => {
    const encoded = "A".repeat(20_000);
    const result = fixture({ result: `![image](data:image/png;base64,${encoded})` });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.headline).not.toContain(encoded);
    expect(presentation.headline).toContain("inline media omitted");
    expect(result.result).toContain(encoded);
  });

  test("exposes published MCP resources without exposing provider-local identities", () => {
    const result = fixture({
      result: {
        text: "Generated image",
        content: [
          {
            type: "resource",
            uri: "senera://resource/upl_0123456789abcdef0123456789abcdef",
            mimeType: "image/png",
            name: "upl_abcdef0123456789abcdef0123456789.png",
          },
        ],
      },
    });

    const presentation = projectAgentToolResultPresentation(result);

    expect(presentation.resources).toEqual([
      {
        uri: "senera://resource/upl_0123456789abcdef0123456789abcdef",
        name: "upl_abcdef0123456789abcdef0123456789.png",
        mime: "image/png",
        origin: "tool",
      },
    ]);
  });

  test("projects resource links and top-level declared resources through the same canonical contract", () => {
    const result = fixture({
      result: {
        content: [
          {
            type: "resource_link",
            uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
            name: "linked.png",
            mimeType: "image/png",
          },
          {
            type: "resource",
            resource: {
              uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
              name: "duplicate.png",
              mimeType: "image/png",
            },
          },
        ],
        resources: [
          {
            resourceUri: "senera://resource/res_abcdef0123456789abcdef0123456789",
            name: "report.pdf",
            mediaType: "application/pdf",
          },
          { uri: "https://provider.example/report.pdf", name: "provider.pdf", mimeType: "application/pdf" },
        ],
      },
    });

    expect(projectAgentToolResultPresentation(result).resources).toEqual([
      {
        uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
        name: "linked.png",
        mime: "image/png",
        origin: "tool",
      },
      {
        uri: "senera://resource/res_abcdef0123456789abcdef0123456789",
        name: "report.pdf",
        mime: "application/pdf",
        origin: "tool",
      },
    ]);
  });

  test("merges later resource metadata for one canonical URI", () => {
    const result = fixture({
      result: {
        content: [
          {
            type: "resource",
            resource: {
              uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
              mimeType: "application/octet-stream",
            },
          },
        ],
        resources: [
          {
            resourceUri: "senera://resource/res_0123456789abcdef0123456789abcdef",
            name: "report.pdf",
            mediaType: "application/pdf",
            size: 42,
            sha256: "sha256:report",
          },
        ],
      },
    });

    expect(projectAgentToolResultPresentation(result).resources).toEqual([
      {
        uri: "senera://resource/res_0123456789abcdef0123456789abcdef",
        name: "report.pdf",
        mime: "application/pdf",
        size: 42,
        sha256: "sha256:report",
        origin: "tool",
      },
    ]);
  });

  test("keeps only canonical artifact assets and preserves their durable metadata", () => {
    const result = fixture({
      result: { text: "created" },
      assets: [
        asset("senera://resource/res_abcdef0123456789abcdef0123456789", "image.png", "image/png"),
        asset("https://provider.example/image.png", "provider.png", "image/png"),
      ],
    });

    expect(projectAgentToolResultPresentation(result).resources).toEqual([
      expect.objectContaining({
        uri: "senera://resource/res_abcdef0123456789abcdef0123456789",
        name: "image.png",
        mime: "image/png",
        size: 3,
        sha256: "sha256",
        origin: "artifact",
      }),
    ]);
  });

  test("projects published resources recorded as evidence even when they are nested in structured content", () => {
    const uri = "senera://resource/upl_0123456789abcdef0123456789abcdef";
    const presentation = projectAgentToolResultPresentation(
      fixture({
        result: { output: { image: uri } },
        evidence: [
          {
            key: `resource:${uri}`,
            evidenceUri: "senera://evidence/resource",
            kind: "resource",
            locator: uri,
            display: "generated.png",
            label: "MCP resource",
            source: "MCP content",
            confidence: 1,
            modelSlots: [{ name: "uri", value: uri }],
            plannerMemory: { facts: [], artifactRefs: [] },
            metadata: {
              contentType: "resource",
              resourceUri: uri,
              name: "generated.png",
              mimeType: "image/png",
              size: 128,
              sha256: "sha256:generated",
            },
          },
        ],
      }),
    );

    expect(presentation.resources).toEqual([
      {
        uri,
        name: "generated.png",
        mime: "image/png",
        size: 128,
        sha256: "sha256:generated",
        origin: "tool",
      },
    ]);
  });
});

function fixture(input: {
  result: unknown;
  error?: AgentToolProcessError;
  exitCode?: number | null;
  evidence?: NonNullable<ExecutedToolCallResult["artifact"]>["evidence"];
  delta?: NonNullable<ExecutedToolCallResult["artifact"]>["delta"];
  workspace?: NonNullable<ExecutedToolCallResult["artifact"]>["workspace"];
  workspaceCapture?: NonNullable<ExecutedToolCallResult["workspaceCapture"]>;
  assets?: NonNullable<ExecutedToolCallResult["artifact"]>["assets"];
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
      assets: input.assets,
      workspace: input.workspace,
    },
    ...(input.workspaceCapture ? { workspaceCapture: input.workspaceCapture } : {}),
  };
}

function asset(resourceUri: string, fileName: string, mediaType: string) {
  return {
    id: "asset_test",
    resourceUri,
    fileName,
    mediaType,
    relativePath: fileName,
    workspacePath: `.senera/uploads/${fileName}`,
    byteLength: 3,
    sha256: "sha256",
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

function workspaceDirectory(path: string) {
  return {
    path,
    absolutePath: `C:/workspace/${path}`,
    exists: true,
    kind: "directory" as const,
    size: 0,
    mtimeMs: 0,
    hash: "sha256:directory",
    content: { state: "omitted" as const, reason: "directory" as const, byteLength: 0 },
  };
}
