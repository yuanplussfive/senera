import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { RecordToolArtifactsInput } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import type { ExecutedToolCallArtifact } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  let directory: string | undefined;
  while ((directory = temporaryDirectories.pop()) !== undefined) removeDirectory(directory);
});

describe("artifact publication", () => {
  test("serializes concurrent retries and reuses one immutable publication", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-retry");

    const [left, right] = await Promise.all([recorder.record(input), recorder.record(input)]);
    const leftArtifact = requireArtifact(left.at(0)?.artifact);
    const rightArtifact = requireArtifact(right.at(0)?.artifact);

    expect(rightArtifact.artifactId).toBe(leftArtifact.artifactId);
    expect(await fs.readFile(rightArtifact.files.manifest)).toEqual(await fs.readFile(leftArtifact.files.manifest));
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

  test("rejects retry restoration when published content no longer matches its manifest", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-content-integrity");
    const artifact = requireArtifact((await recorder.record(input)).at(0)?.artifact);
    await fs.writeFile(artifact.files.summary, "tampered summary", "utf8");

    await expect(recorder.record(input)).rejects.toMatchObject({ code: "ArtifactIntegrityMismatch" });
  });

  test("rejects retry restoration when the published identity was changed", async () => {
    const { recorder } = createRecorder();
    const input = recordInput("call-identity-integrity");
    const artifact = requireArtifact((await recorder.record(input)).at(0)?.artifact);
    const manifest = JSON.parse(await fs.readFile(artifact.files.manifest, "utf8")) as Record<string, unknown>;
    await fs.writeFile(artifact.files.manifest, `${JSON.stringify({ ...manifest, toolName: "OtherTool" })}\n`, "utf8");

    await expect(recorder.record(input)).rejects.toMatchObject({ code: "ArtifactPublicationConflict" });
  });
});

function createRecorder(): { recorder: AgentToolExecutionArtifactRecorder } {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-publication");
  temporaryDirectories.push(workspaceRoot);
  const config = resolveArtifactsConfig({
    ModelProviders: [],
    Artifacts: { RootDir: ".senera/artifacts" },
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
