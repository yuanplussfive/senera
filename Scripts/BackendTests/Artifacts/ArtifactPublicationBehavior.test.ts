import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { RecordToolArtifactsInput } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import type { AgentArtifactsConfig } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import type { ExecutedToolCallArtifact } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import { hashWorkspaceText } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotUtils.js";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  let directory: string | undefined;
  while ((directory = temporaryDirectories.pop()) !== undefined) removeDirectory(directory);
});

describe("artifact publication", () => {
  test("publishes declared inline tool images as one durable resource without retaining their Base64 payload", async () => {
    const { recorder } = createRecorder();
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const imageData = imageBytes.toString("base64");
    const image = { type: "image", data: imageData, mimeType: "image/png" };
    const input: RecordToolArtifactsInput = {
      requestId: "request-inline-image",
      step: 1,
      results: [
        {
          callId: "call-inline-image",
          name: "InlineImageTool",
          arguments: { prompt: "diagram" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { content: [{ type: "text", text: "diagram" }, image] },
          artifactPayload: { rawResponse: { content: [image] } },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    };
    const [recorded] = await recorder.record(input);

    const artifact = requireArtifact(recorded?.artifact);
    expect(artifact.assets).toHaveLength(1);
    const asset = artifact.assets![0]!;
    expect(asset).toMatchObject({
      fileName: expect.stringMatching(/^inline-image-[a-f0-9]{32}\.png$/),
      mediaType: "image/png",
      byteLength: imageBytes.byteLength,
      resourceUri: expect.stringMatching(/^senera:\/\/resource\/[0-9a-hjkmnp-tv-z]{6}$/),
      workspacePath: expect.stringContaining(".senera/artifacts/"),
    });
    await expect(fs.readFile(path.join(artifact.artifactPath, asset.relativePath))).resolves.toEqual(imageBytes);

    expect(recorded?.result).toMatchObject({
      content: [
        { type: "text", text: "diagram" },
        {
          type: "resource",
          resource: {
            uri: asset.resourceUri,
            name: asset.fileName,
            mimeType: "image/png",
            size: imageBytes.byteLength,
            sha256: asset.sha256,
            workspacePath: asset.workspacePath,
          },
        },
      ],
    });

    const [raw, rawResponse] = await Promise.all([
      fs.readFile(artifact.files.raw, "utf8"),
      fs.readFile(artifact.files.rawResponse, "utf8"),
    ]);
    expect(raw).not.toContain(imageData);
    expect(rawResponse).not.toContain(imageData);
    expect(raw).toContain(asset.resourceUri);
    expect(rawResponse).toContain(asset.resourceUri);

    const [recovered] = await recorder.record(input);
    expect(recovered?.artifact?.artifactId).toBe(artifact.artifactId);
    expect(recovered?.result).toMatchObject({
      content: [
        { type: "text", text: "diagram" },
        { type: "resource", resource: { uri: asset.resourceUri, workspacePath: asset.workspacePath } },
      ],
    });
    expect(JSON.stringify(recovered?.result)).not.toContain(imageData);
  });

  test("replaces an invalid declared inline image with an explicit unavailable-media result", async () => {
    const { recorder } = createRecorder();
    const invalidPayload = "not valid base64";
    const [recorded] = await recorder.record({
      requestId: "request-invalid-inline-image",
      step: 1,
      results: [
        {
          callId: "call-invalid-inline-image",
          name: "InlineImageTool",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { content: [{ type: "image", data: invalidPayload, mimeType: "image/png" }] },
          artifactPayload: {
            rawResponse: { content: [{ type: "image", data: invalidPayload, mimeType: "image/png" }] },
          },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    const artifact = requireArtifact(recorded?.artifact);
    expect(artifact.assets).toBeUndefined();
    expect(recorded?.result).toEqual({
      content: [
        {
          type: "media_unavailable",
          reason: "invalid_inline_image",
          message: "The tool returned an inline image that could not be published as a durable resource.",
          mediaType: "image/png",
        },
      ],
    });
    const [raw, rawResponse] = await Promise.all([
      fs.readFile(artifact.files.raw, "utf8"),
      fs.readFile(artifact.files.rawResponse, "utf8"),
    ]);
    expect(raw).not.toContain(invalidPayload);
    expect(rawResponse).not.toContain(invalidPayload);
    expect(raw).toContain("invalid_inline_image");
    expect(rawResponse).toContain("invalid_inline_image");
  });

  test("does not infer an image resource from a provider-specific image-shaped value", async () => {
    const { recorder } = createRecorder();
    const providerValue = { type: "image", url: "https://example.test/provider-image" };
    const [recorded] = await recorder.record({
      requestId: "request-provider-image-shape",
      step: 1,
      results: [
        {
          callId: "call-provider-image-shape",
          name: "ProviderShapedTool",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { content: [providerValue] },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.artifact?.assets).toBeUndefined();
    expect(recorded?.result).toEqual({ content: [providerValue] });
  });

  test("does not expose a pending inline-image resource when Artifact publication fails", async () => {
    const { recorder } = createRecorder();
    const imageData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    const [recorded] = await recorder.record({
      requestId: "request-inline-image-publication-failure",
      step: 1,
      results: [
        {
          callId: "call-inline-image-publication-failure",
          name: "InlineImageTool",
          arguments: {},
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { content: [{ type: "image", data: imageData, mimeType: "image/png" }] },
          artifactPayload: {
            // A malformed declared asset makes the Artifact transaction fail
            // after inline-image normalization but before publication commits.
            assets: [
              {
                id: "invalid-existing-asset",
                fileName: "invalid.bin",
                mediaType: "application/octet-stream",
                dataBase64: "not valid base64",
              },
            ],
          },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded).toMatchObject({
      artifactAvailability: { status: "unavailable", reason: "recording_failed" },
      result: {
        content: [
          {
            type: "media_unavailable",
            reason: "artifact_recording_failed",
          },
        ],
      },
    });
    expect(JSON.stringify(recorded?.result)).not.toContain(imageData);
    expect(JSON.stringify(recorded?.result)).not.toContain("inline-image-");
  });

  test("does not add placeholder evidence for structured tool output", async () => {
    const { recorder } = createRecorder();
    const [recorded] = await recorder.record({
      requestId: "request-structured-evidence",
      step: 1,
      results: [
        {
          callId: "call-structured-evidence",
          name: "CustomMcpTool",
          arguments: { input: "value" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: {
            providerSpecificField: { arbitrary: true },
            imageData: "provider-defined-value",
          },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.artifact?.evidence).toEqual([]);
  });

  test("keeps small plain output available for the shared observation budget decision", async () => {
    const { recorder } = createRecorder();
    const [recorded] = await recorder.record({
      requestId: "request-inline",
      step: 1,
      results: [
        {
          callId: "call-inline",
          name: "CustomMcpTool",
          arguments: { input: "value" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: "short-lived status: ok",
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.result).toEqual("short-lived status: ok");
    expect(recorded?.artifact?.evidence).toContainEqual(expect.objectContaining({ kind: "tool-output" }));
  });

  test("keeps declared source views out of the artifact publication path", async () => {
    const { recorder, workspaceRoot } = createRecorder();
    const sourceUri = "senera://artifact/art_0123456789abcdef01234567";
    const [recorded] = await recorder.record({
      requestId: "request-source-view",
      step: 1,
      results: [
        {
          callId: "call-source-view",
          name: "ArtifactReadTool",
          resultStorage: "SourceView",
          sourceArtifacts: [{ artifactUri: sourceUri, refs: ["raw"] }],
          arguments: { artifactUris: [sourceUri], refs: ["raw"] },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: {
            artifacts: {
              item: [
                {
                  artifactUri: sourceUri,
                  status: "found",
                  memories: { item: [{ ref: "raw", content: "bounded source page" }] },
                },
              ],
            },
          },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: artifactMemoryEvidencePolicy(),
        },
      ],
    });

    expect(recorded?.artifact).toBeUndefined();
    expect(recorded?.sourceArtifacts).toEqual([{ artifactUri: sourceUri, refs: ["raw"] }]);
    await expect(fs.access(path.join(workspaceRoot, ".senera", "artifacts"))).rejects.toThrow();
  });

  test("rejects a successful source view that has no recoverable source coordinate", async () => {
    const { recorder } = createRecorder();
    await expect(
      recorder.record({
        requestId: "request-unrecoverable-source-view",
        step: 1,
        results: [
          {
            callId: "call-unrecoverable-source-view",
            name: "ArtifactReadTool",
            resultStorage: "SourceView",
            sourceArtifacts: [],
            arguments: { artifactUris: ["senera://artifact/art_0123456789abcdef01234567"] },
            process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
            result: { artifacts: { item: [] } },
            outcome: AgentToolSuccessOutcome,
            artifactPolicy: artifactMemoryEvidencePolicy(),
          },
        ],
      }),
    ).rejects.toThrow("completed without a canonical source Artifact reference");
  });

  test("rejects a source view that tries to introduce a new durable payload", async () => {
    const { recorder } = createRecorder();
    await expect(
      recorder.record({
        requestId: "request-source-view-payload",
        step: 1,
        results: [
          {
            callId: "call-source-view-payload",
            name: "ArtifactReadTool",
            resultStorage: "SourceView",
            sourceArtifacts: [{ artifactUri: "senera://artifact/art_0123456789abcdef01234567", refs: ["raw"] }],
            artifactPayload: { rawResponse: { duplicated: "payload" } },
            arguments: { artifactUris: ["senera://artifact/art_0123456789abcdef01234567"] },
            process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
            result: { artifacts: { item: [] } },
            outcome: AgentToolSuccessOutcome,
            artifactPolicy: artifactMemoryEvidencePolicy(),
          },
        ],
      }),
    ).rejects.toThrow("declared a new durable output");
  });

  test("preserves a failed source-view read without requiring a source coordinate", async () => {
    const { recorder } = createRecorder();
    const failure = { code: AgentExecutionErrorCodes.ToolExecutionError, message: "Artifact manifest is unavailable." };
    const [recorded] = await recorder.record({
      requestId: "request-source-view-failure",
      step: 1,
      results: [
        {
          callId: "call-source-view-failure",
          name: "ArtifactReadTool",
          resultStorage: "SourceView",
          arguments: { artifactUris: ["senera://artifact/art_0123456789abcdef01234567"] },
          process: { exitCode: 1, signal: null, stdout: "", stderr: "manifest unavailable" },
          result: { error: failure },
          outcome: createAgentToolFailureOutcome(failure, AgentToolFailureSources.Host, "partial"),
          artifactPolicy: artifactMemoryEvidencePolicy(),
        },
      ],
    });

    expect(recorded?.artifact).toBeUndefined();
    expect(recorded).toMatchObject({ result: { error: failure }, outcome: { assessment: { status: "failure" } } });
  });

  test.each([
    ["null", null],
    ["number", 7],
    ["boolean", false],
  ] as const)("preserves a small %s result for the shared observation budget decision", async (_kind, result) => {
    const { recorder } = createRecorder();
    const [recorded] = await recorder.record({
      requestId: `request-inline-scalar-${_kind}`,
      step: 1,
      results: [
        {
          callId: `call-inline-scalar-${_kind}`,
          name: "CustomMcpTool",
          arguments: { input: "value" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.result).toEqual(result);
  });

  test("adds bounded generic evidence only for oversized plain string tool output", async () => {
    const { recorder } = createRecorder();
    // ~96k mixed-case chars with digits, punctuation and newlines tokenize to far
    // More than the former inline budget; unlike a repeated-common-word string,
    // this reliably exercises durable evidence capture for a large text source.
    const oversizedOutput = "INFO  request=7f3c path=/v1/chat row=2048 elapsed=312ms tokens=8127\n".repeat(3_500);
    expect(new AgentTokenProjector("default").countJson(oversizedOutput)).toBeGreaterThan(8_192);
    const [recorded] = await recorder.record({
      requestId: "request-string-evidence",
      step: 1,
      results: [
        {
          callId: "call-string-evidence",
          name: "CustomMcpTool",
          arguments: { input: "value" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: oversizedOutput,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.artifact?.evidence).toEqual([
      expect.objectContaining({
        kind: "tool-output",
        key: "result:$",
        locator: "$",
        plannerMemory: expect.objectContaining({ artifactRefs: ["raw"] }),
      }),
    ]);
    expect(recorded?.artifact?.evidence[0]?.modelSlots).toEqual([]);
  });

  test("serializes concurrent retries and reuses one immutable publication", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-retry");

    const [left, right] = await Promise.all([recorder.record(input), recorder.record(input)]);
    const leftArtifact = requireArtifact(left.at(0)?.artifact);
    const rightArtifact = requireArtifact(right.at(0)?.artifact);

    expect(rightArtifact.artifactId).toBe(leftArtifact.artifactId);
    expect(await fs.readFile(rightArtifact.files.manifest)).toEqual(await fs.readFile(leftArtifact.files.manifest));
  });

  test("does not reuse an Artifact when an equal public result has different process output", async () => {
    const { recorder } = createRecorder();
    const record = (stdout: string): RecordToolArtifactsInput => ({
      requestId: "request-process-identity",
      step: 1,
      results: [
        {
          callId: "call-process-identity",
          name: "PublicationTool",
          arguments: { query: "same" },
          process: { exitCode: 0, signal: null, stdout, stderr: "" },
          result: { value: "same" },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    const first = requireArtifact((await recorder.record(record("first process output\n"))).at(0)?.artifact);
    const second = requireArtifact((await recorder.record(record("second process output\n"))).at(0)?.artifact);

    expect(second.artifactId).not.toBe(first.artifactId);
    await expect(fs.readFile(first.files.stdout, "utf8")).resolves.toBe("first process output\n");
    await expect(fs.readFile(second.files.stdout, "utf8")).resolves.toBe("second process output\n");
  });

  test("gives distinct calls distinct artifact identities even when arguments and results match", async () => {
    const { recorder } = createRecorder();

    const first = requireArtifact((await recorder.record(recordInput("call-first"))).at(0)?.artifact);
    const second = requireArtifact((await recorder.record(recordInput("call-second"))).at(0)?.artifact);

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.artifactPath).not.toBe(first.artifactPath);
  });

  test("isolates artifact identities across sessions when the tool publication is otherwise identical", async () => {
    const { recorder } = createRecorder();

    const first = requireArtifact(
      (await recorder.record({ ...recordInput("call-shared"), sessionId: "session-first" })).at(0)?.artifact,
    );
    const second = requireArtifact(
      (await recorder.record({ ...recordInput("call-shared"), sessionId: "session-second" })).at(0)?.artifact,
    );

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.artifactPath).not.toBe(first.artifactPath);
  });

  test("restores the owner metadata of a legacy published manifest", async () => {
    const { recorder } = createRecorder();
    const input = { ...recordInput("call-legacy-owner"), sessionId: "session-owner" };
    const artifact = requireArtifact((await recorder.record(input)).at(0)?.artifact);
    const manifest = JSON.parse(await fs.readFile(artifact.files.manifest, "utf8")) as Record<string, unknown>;
    delete manifest.sessionId;
    delete manifest.sessionIds;
    await fs.writeFile(artifact.files.manifest, `${JSON.stringify(manifest)}\n`, "utf8");

    await recorder.record(input);

    await expect(
      fs.readFile(artifact.files.manifest, "utf8").then((value) => JSON.parse(value)),
    ).resolves.toMatchObject({
      sessionId: "session-owner",
      sessionIds: ["session-owner"],
    });
  });

  test("keeps the result and marks Artifact unavailable when published content no longer matches its manifest", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-content-integrity");
    const artifact = requireArtifact((await recorder.record(input)).at(0)?.artifact);
    await fs.writeFile(artifact.files.summary, "tampered summary", "utf8");

    await expect(recorder.record(input)).resolves.toEqual([
      expect.objectContaining({
        result: { value: "same" },
        outcome: AgentToolSuccessOutcome,
        artifactAvailability: { status: "unavailable", reason: "recording_failed" },
      }),
    ]);
  });

  test("keeps the result and marks Artifact unavailable when the published identity was changed", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-identity-integrity");
    const artifact = requireArtifact((await recorder.record(input)).at(0)?.artifact);
    const manifest = JSON.parse(await fs.readFile(artifact.files.manifest, "utf8")) as Record<string, unknown>;
    await fs.writeFile(artifact.files.manifest, `${JSON.stringify({ ...manifest, toolName: "OtherTool" })}\n`, "utf8");

    await expect(recorder.record(input)).resolves.toEqual([
      expect.objectContaining({
        result: { value: "same" },
        outcome: AgentToolSuccessOutcome,
        artifactAvailability: { status: "unavailable", reason: "recording_failed" },
      }),
    ]);
  });

  test("publishes a generated workspace patch as a canonical preview resource", async () => {
    const { recorder, workspaceRoot, systemConfig } = createRecorder();
    const beforeText = 'export const state = "before";\n';
    const afterText = 'export const state = "after";\n';
    const [recorded] = await recorder.record({
      requestId: "request-workspace-patch-resource",
      step: 1,
      results: [
        {
          callId: "call-workspace-patch-resource",
          name: "ShellCommandTool",
          arguments: { cwd: "." },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { ok: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {
            Workspace: {
              Capture: "mutation-receipt",
              MaxFileBytes: 262_144,
              CaptureContent: "text",
              PatchContextLines: 3,
            },
          },
          workspaceCapture: {
            before: { files: [workspaceFile("src/state.ts", beforeText)], capturedAt: "2026-08-13T00:00:00.000Z" },
            after: { files: [workspaceFile("src/state.ts", afterText)], capturedAt: "2026-08-13T00:00:01.000Z" },
            changes: [
              {
                path: "src/state.ts",
                absolutePath: "C:/workspace/src/state.ts",
                status: "modified",
                beforeKind: "file",
                afterKind: "file",
                beforeHash: hashWorkspaceText(beforeText),
                afterHash: hashWorkspaceText(afterText),
                beforeSize: Buffer.byteLength(beforeText),
                afterSize: Buffer.byteLength(afterText),
                addedLines: 1,
                removedLines: 1,
              },
            ],
          },
        },
      ],
    });

    const patchAsset = recorded?.artifact?.assets?.find((asset) => asset.id === "workspace.patch");
    expect(patchAsset).toMatchObject({
      fileName: "workspace.patch",
      mediaType: "text/x-diff",
      resourceUri: expect.stringMatching(/^senera:\/\/resource\/[0-9a-hjkmnp-tv-z]{6}$/),
    });
    expect(recorded?.presentation?.resources).toContainEqual(
      expect.objectContaining({
        uri: patchAsset?.resourceUri,
        name: "workspace.patch",
        mime: "text/x-diff",
        origin: "artifact",
      }),
    );
    await expect(
      fs.readFile(path.join(recorded!.artifact!.artifactPath, "workspace.patch"), "utf8"),
    ).resolves.toContain('export const state = "before";');
    const patchText = await fs.readFile(path.join(recorded!.artifact!.artifactPath, "workspace.patch"), "utf8");
    expect(patchText).not.toContain("===================================================================");
    expect(patchText).not.toContain("sha256");

    const resolver = new AgentResourceResolver({
      workspaceRoot,
      config: systemConfig,
      uploadStore: { resolve: async () => undefined },
    });
    const resolved = await resolver.resolve(patchAsset!.resourceUri);
    expect(resolved).toMatchObject({
      resourceUri: patchAsset!.resourceUri,
      name: "workspace.patch",
      mime: "text/x-diff",
      origin: "artifact",
    });
    await expect(fs.readFile(resolved!.filePath, "utf8")).resolves.toContain('export const state = "after";');
  });

  test("does not persist a no-op workspace snapshot bundle", async () => {
    const { recorder } = createRecorder();
    const [recorded] = await recorder.record({
      requestId: "request-workspace-noop",
      step: 1,
      results: [
        {
          callId: "call-workspace-noop",
          name: "ShellCommandTool",
          arguments: { cwd: "." },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { ok: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {
            Workspace: {
              Capture: "mutation-receipt",
              MaxFileBytes: 262_144,
              CaptureContent: "text",
              PatchContextLines: 3,
            },
          },
          workspaceCapture: {
            before: { files: [], capturedAt: "2026-08-13T00:00:00.000Z" },
            after: { files: [], capturedAt: "2026-08-13T00:00:01.000Z" },
            changes: [],
          },
        },
      ],
    });

    expect(recorded?.artifact?.workspace).toBeUndefined();
    expect(recorded?.presentation?.workspaceObservation).toBeUndefined();
    const manifest = JSON.parse(await fs.readFile(recorded!.artifact!.manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.workspace).toBeUndefined();
  });
});

function createRecorder(artifacts?: AgentArtifactsConfig): {
  recorder: AgentToolExecutionArtifactRecorder;
  workspaceRoot: string;
  systemConfig: AgentSystemConfig;
} {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-publication");
  temporaryDirectories.push(workspaceRoot);
  const systemConfig = {
    ModelProviders: [],
    Artifacts: { RootDir: ".senera/artifacts", ...artifacts },
  } satisfies AgentSystemConfig;
  const config = resolveArtifactsConfig(systemConfig);
  return {
    recorder: new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" }),
    workspaceRoot,
    systemConfig,
  };
}

function recordInput(callId: string): RecordToolArtifactsInput {
  return {
    requestId: "request-publication",
    step: 1,
    results: [
      {
        callId,
        name: "PublicationTool",
        arguments: { query: "same" },
        process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
        result: { value: "same" },
        outcome: AgentToolSuccessOutcome,
        artifactPolicy: {},
      },
    ],
  };
}

function artifactMemoryEvidencePolicy() {
  return {
    Evidence: [
      {
        Kind: "artifact_memory",
        Records: "$.artifacts.item[*]",
        Slots: {
          artifactUri: "$.artifactUri",
          status: "$.status",
          loadedRefs: "$.memories.item[*].ref",
        },
        Identity: { Parts: ["artifactUri", "status"] },
        Presentation: {
          Locator: "{{ artifactUri }}",
          Display: "{{ status }} {{ artifactUri }}",
          Label: "{{ artifactUri }}",
          Source: "artifact memory",
        },
        ModelProjection: { Slots: ["artifactUri", "status", "loadedRefs"] },
        PlannerMemory: {
          Facts: ["status", "loadedRefs"],
          ArtifactUri: "artifactUri",
          ArtifactRefsSlot: "loadedRefs",
        },
        Projection: { SummaryTemplate: "{{ evidence[0].slots.status }}", ArtifactTemplate: "{{ artifactUri }}" },
        Confidence: 1,
      },
    ],
  };
}

function requireArtifact(artifact: ExecutedToolCallArtifact | undefined): ExecutedToolCallArtifact {
  if (!artifact) throw new Error("Expected a recorded artifact.");
  return artifact;
}

function workspaceFile(filePath: string, text: string) {
  return {
    path: filePath,
    absolutePath: "C:/workspace/" + filePath,
    exists: true,
    kind: "file" as const,
    size: Buffer.byteLength(text),
    mtimeMs: 0,
    hash: hashWorkspaceText(text),
    content: {
      state: "captured" as const,
      encoding: "utf8" as const,
      byteLength: Buffer.byteLength(text),
      lineCount: text.split("\n").length,
      text,
    },
  };
}
