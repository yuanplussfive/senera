import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { RecordToolArtifactsInput } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import type { AgentArtifactsConfig } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import type { ExecutedToolCallArtifact } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  let directory: string | undefined;
  while ((directory = temporaryDirectories.pop()) !== undefined) removeDirectory(directory);
});

describe("artifact publication", () => {
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

  test("inlines small plain output verbatim without automatic evidence", async () => {
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

    expect(recorded?.inlinePayload).toEqual("short-lived status: ok");
    expect(recorded?.artifact?.evidence).toEqual([]);
  });

  test.each([
    ["null", null],
    ["number", 7],
    ["boolean", false],
  ] as const)("inlines a small %s result without an Artifact-only detour", async (_kind, result) => {
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

    expect(recorded?.inlinePayload).toEqual(result);
    expect(recorded?.artifact?.evidence).toEqual([]);
  });

  test("adds bounded generic evidence only for oversized plain string tool output", async () => {
    const { recorder } = createRecorder();
    // ~96k mixed-case chars with digits, punctuation and newlines tokenize to far
    // more than the inline budget; unlike a repeated-common-word string, this is
    // robust to tokenizer compression so it reliably crosses the inline threshold.
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

  test("skips inline for high-compression text that exceeds the byte ceiling", async () => {
    // A repetitive string tokenizes under the token budget but its raw size
    // still exceeds the byte gate; it must route to the evidence chain.
    const repeated = "provider output ".repeat(4_000); // ~64KB UTF-8, ~8k tokens
    const projector = new AgentTokenProjector("default");
    expect(projector.countJson(repeated)).toBeLessThanOrEqual(8_192);
    expect(Buffer.byteLength(repeated, "utf8")).toBeGreaterThan(16 * 1024);
    // Raise the token ceiling only for this test so it exercises the
    // independent byte gate rather than the smaller production token gate.
    const { recorder } = createRecorder({ InlineResultMaxTokens: 8_192, InlineResultMaxBytes: 16 * 1024 });
    const [recorded] = await recorder.record({
      requestId: "request-byte-gate",
      step: 1,
      results: [
        {
          callId: "call-byte-gate",
          name: "CustomMcpTool",
          arguments: { input: "value" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: repeated,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.artifact?.evidence).toContainEqual(expect.objectContaining({ kind: "tool-output" }));
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
});

function createRecorder(artifacts?: AgentArtifactsConfig): { recorder: AgentToolExecutionArtifactRecorder } {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-publication");
  temporaryDirectories.push(workspaceRoot);
  const config = resolveArtifactsConfig({
    ModelProviders: [],
    Artifacts: { RootDir: ".senera/artifacts", ...artifacts },
  } satisfies AgentSystemConfig);
  return {
    recorder: new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" }),
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

function requireArtifact(artifact: ExecutedToolCallArtifact | undefined): ExecutedToolCallArtifact {
  if (!artifact) throw new Error("Expected a recorded artifact.");
  return artifact;
}
