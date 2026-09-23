import fs from "node:fs/promises";
import path from "node:path";
import {
  createArtifactStreamRedactionTransform,
  redactArtifactSecrets,
  redactArtifactToolOutcome,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactRedaction.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { createSeneraOutputSpool } from "../../../Source/AgentSystem/Execution/SeneraOutputSpool.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { RecordToolArtifactsInput } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { readArtifactMemories } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import type { ArtifactManifestRecord } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import { projectAgentToolResultEventValue } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultEventProjection.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import {
  AgentToolExecutionStatuses,
  AgentToolOutputAvailabilities,
  AgentToolSuccessOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("artifact output capture", () => {
  test("uses structural sharing and copies only branches changed by redaction", () => {
    const untouched = { nested: { value: "visible" }, items: [{ value: 1 }] };
    expect(redactArtifactSecrets(untouched, {})).toBe(untouched);

    const sensitive = { stable: untouched.nested, changed: { token: "secret", value: "visible" } };
    const redacted = redactArtifactSecrets(sensitive, { Redact: { Keys: ["token"] } }) as typeof sensitive;
    expect(redacted).not.toBe(sensitive);
    expect(redacted.stable).toBe(sensitive.stable);
    expect(redacted.changed).not.toBe(sensitive.changed);
    expect(redacted.changed).toEqual({ token: "[REDACTED]", value: "visible" });
  });

  test("preserves outcome control fields when the policy redacts the complete error", () => {
    expect(
      redactArtifactToolOutcome(
        {
          execution: { status: AgentToolExecutionStatuses.Completed },
          assessment: {
            status: "failure",
            error: {
              code: AgentExecutionErrorCodes.ToolExecutionError,
              kind: "execution",
              source: "host",
              retryable: false,
              message: "sensitive failure",
              details: { token: "secret-value" },
            },
          },
          output: { availability: AgentToolOutputAvailabilities.Partial },
        },
        { Redact: { Paths: ["$.error"] } },
      ),
    ).toEqual({
      execution: { status: AgentToolExecutionStatuses.Completed },
      assessment: {
        status: "failure",
        error: {
          code: AgentExecutionErrorCodes.ToolExecutionError,
          kind: "execution",
          source: "host",
          retryable: false,
          message: "[REDACTED]",
        },
      },
      output: { availability: AgentToolOutputAvailabilities.Partial },
    });
  });

  test("copies the shared stdout/stderr spool into readable artifact refs", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-output");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("complete stdout\n"));
    spool.write("stderr", Buffer.from("complete stderr\n"));
    await spool.close();

    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config,
      model: "test-model",
    });
    const [result] = await recorder.record({
      requestId: "request-output",
      step: 1,
      results: [
        {
          callId: "call-output",
          name: "ShellCommandTool",
          arguments: { command: "echo test" },
          process: { exitCode: 0, signal: null, stdout: "complete stdout\n", stderr: "complete stderr\n" },
          outputCapture: spool.descriptor,
          result: { stdout: "preview", stderr: "preview" },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(result?.artifact?.files.stdout).toBeDefined();
    expect(await fs.readFile(result!.artifact!.files.stdout, "utf8")).toBe("complete stdout\n");
    expect(await fs.readFile(result!.artifact!.files.stderr, "utf8")).toBe("complete stderr\n");
    expect(result?.process).toEqual({ exitCode: 0, signal: null, stdout: "", stderr: "" });
    expect(result).not.toHaveProperty("outputCapture");
    const manifestSource = await fs.readFile(result!.artifact!.files.manifest, "utf8");
    expect(manifestSource).not.toContain("complete stdout");
    expect(manifestSource).not.toContain("complete stderr");
    const manifest = JSON.parse(manifestSource) as ArtifactManifestRecord;
    expect(manifest).toMatchObject({
      schemaVersion: 4,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      process: {
        exitCode: 0,
        signal: null,
        streams: expect.arrayContaining([
          expect.objectContaining({
            stream: "stdout",
            ref: "stdout",
            byteLength: Buffer.byteLength("complete stdout\n"),
          }),
          expect.objectContaining({
            stream: "stderr",
            ref: "stderr",
            byteLength: Buffer.byteLength("complete stderr\n"),
          }),
        ]),
      },
      outputCapture: { refs: ["stdout", "stderr"] },
      contents: expect.arrayContaining([
        expect.objectContaining({
          ref: "stdout",
          mediaType: "text/plain",
          byteLength: Buffer.byteLength("complete stdout\n"),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    });
    const recalled = await readArtifactMemories(
      { artifactUris: [manifest.artifactUri], refs: ["stdout", "stderr"] },
      new Map([[manifest.artifactId, manifest]]),
      {
        workspaceRoot,
        artifactRoot: path.resolve(workspaceRoot, config.RootDir),
        maxBytes: 1_024,
        startByte: 0,
        maxArtifacts: 16,
        maxRefs: 8,
        maxConcurrency: 4,
      },
    );
    expect(recalled.artifacts.item[0]?.memories.item).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "stdout", content: "complete stdout\n" }),
        expect.objectContaining({ ref: "stderr", content: "complete stderr\n" }),
      ]),
    );
    await expect(fs.stat(spool.descriptor.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reclaims a matching retry spool after restoring a published Artifact", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-output-retry");
    temporaryDirectories.push(workspaceRoot);
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" });
    const stdout = "completed output\n";
    const createCapture = async (id: string) => {
      const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), id);
      spool.write("stdout", Buffer.from(stdout));
      await spool.close();
      return spool.descriptor;
    };
    const record = (outputCapture: Awaited<ReturnType<typeof createCapture>>) =>
      recorder.record({
        requestId: "request-output-retry",
        step: 1,
        results: [
          {
            callId: "call-output-retry",
            name: "ShellCommandTool",
            arguments: { command: "echo complete" },
            process: { exitCode: 0, signal: null, stdout, stderr: "" },
            outputCapture,
            result: { state: "completed" },
            outcome: AgentToolSuccessOutcome,
            artifactPolicy: {},
          },
        ],
      });

    const firstCapture = await createCapture("first");
    const [first] = await record(firstCapture);
    const retryCapture = await createCapture("retry");
    const [retried] = await record(retryCapture);

    expect(retried?.artifact?.artifactId).toBe(first?.artifact?.artifactId);
    await expect(fs.stat(retryCapture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    { label: "10 KiB streams", bytesPerStream: 10 * 1024 },
    { label: "100 KiB streams", bytesPerStream: 100 * 1024 },
  ])("projects $label into a compact Artifact-backed event result", async ({ bytesPerStream }) => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-token-projection");
    temporaryDirectories.push(workspaceRoot);
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: {
        RootDir: ".senera/artifacts",
        InlineResultMaxTokens: 512,
        InlineResultMaxBytes: 1024,
      },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "gpt-4o" });
    const stdout = createExecutionLog("stdout", bytesPerStream);
    const stderr = createExecutionLog("stderr", bytesPerStream);
    const result = {
      resourceId: "res_token_projection",
      kind: "terminal",
      state: "completed",
      fromCursor: 0,
      cursor: 2,
      oldestCursor: 0,
      updates: [
        {
          kind: "output",
          cursor: 1,
          stream: "stdout",
          text: stdout,
          byteLength: bytesPerStream,
          totalBytes: bytesPerStream,
        },
        {
          kind: "output",
          cursor: 2,
          stream: "stderr",
          text: stderr,
          byteLength: bytesPerStream,
          totalBytes: bytesPerStream,
        },
      ],
      exitCode: 0,
    };
    const [recorded] = await recorder.record({
      requestId: `request-token-${bytesPerStream}`,
      step: 1,
      results: [
        {
          callId: `call-token-${bytesPerStream}`,
          name: "ShellCommandTool",
          arguments: { command: "npm test", cwd: workspaceRoot },
          process: { exitCode: 0, signal: null, stdout, stderr },
          result,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(recorded?.artifact).toBeDefined();
    expect(recorded?.inlinePayload).toBeUndefined();
    expect(recorded?.process).toEqual({ exitCode: 0, signal: null, stdout: "", stderr: "" });
    const artifactEventResult = projectAgentToolResultEventValue(recorded!);
    expect(artifactEventResult).toMatchObject({
      type: "senera.artifact_backed_tool_result.v1",
      artifactUri: recorded!.artifact!.artifactUri,
    });
    expect(JSON.stringify(artifactEventResult)).not.toContain(stdout);
    expect(JSON.parse(await fs.readFile(recorded!.artifact!.files.raw, "utf8"))).toEqual(result);

    const projector = new AgentTokenProjector("gpt-4o");
    const legacyPayload = {
      arguments: { command: "npm test", cwd: workspaceRoot },
      result,
      process: { exitCode: 0, signal: null, stdout, stderr },
    };
    const artifactBackedPayload = {
      arguments: recorded!.arguments,
      result: artifactEventResult,
      process: recorded!.process,
      artifactUri: recorded!.artifact!.artifactUri,
    };
    const legacyTokens = projector.countJson(legacyPayload);
    const artifactBackedTokens = projector.countJson(artifactBackedPayload);

    expect(artifactBackedTokens).toBeLessThan(legacyTokens);
    expect(1 - artifactBackedTokens / legacyTokens).toBeGreaterThan(0.98);
  });

  test("redacts stream content across spool chunks using the declared transform", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-redaction");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("before sk-abc"));
    spool.write("stdout", Buffer.from("123456 after\n"));
    spool.write("stderr", Buffer.from("stderr stays visible\n"));
    await spool.close();

    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config,
      model: "test-model",
    });
    const [result] = await recorder.record({
      requestId: "request-redaction",
      step: 1,
      results: [
        {
          callId: "call-redaction",
          name: "ShellCommandTool",
          arguments: { command: "echo secret" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          outputCapture: spool.descriptor,
          result: { stdout: "preview sk-raw-secret", stderr: "preview" },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {
            Redact: {
              Transforms: [
                {
                  Pattern: "sk-[A-Za-z0-9_-]+",
                  Replacement: "[REDACTED]",
                  Streams: ["stdout"],
                  WindowChars: 64,
                },
              ],
            },
          },
        },
      ],
    });

    expect(await fs.readFile(result!.artifact!.files.stdout, "utf8")).toBe("before [REDACTED] after\n");
    expect(await fs.readFile(result!.artifact!.files.stderr, "utf8")).toBe("stderr stays visible\n");
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.raw, "utf8"))).toMatchObject({
      stdout: "preview [REDACTED]",
    });
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.manifest, "utf8"))).toMatchObject({
      outputCapture: { redacted: { stdout: true, stderr: false } },
    });
  });

  test("does not leak a token prefix when the match starts in one read chunk", async () => {
    const transform = createArtifactStreamRedactionTransform(
      {
        Redact: {
          Transforms: [{ Pattern: "sk-[A-Za-z0-9_-]+", Replacement: "[REDACTED]", WindowChars: 64 }],
        },
      },
      "stdout",
    );
    expect(transform).toBeDefined();
    const chunks: Buffer[] = [];
    const consume = (async () => {
      for await (const chunk of transform!) chunks.push(Buffer.from(chunk));
    })();

    transform!.write(Buffer.from(`${"x".repeat(120)}sk-`));
    transform!.end(Buffer.from("abc123 after"));
    await consume;

    expect(Buffer.concat(chunks).toString("utf8")).toBe(`${"x".repeat(120)}[REDACTED] after`);
  });

  test("supports full stream redaction independently from structured key redaction", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-stream-redaction");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("sensitive stdout\n"));
    spool.write("stderr", Buffer.from("visible stderr\n"));
    await spool.close();

    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config,
      model: "test-model",
    });
    const [result] = await recorder.record({
      requestId: "request-full-redaction",
      step: 1,
      results: [
        {
          callId: "call-full-redaction",
          name: "ShellCommandTool",
          arguments: { token: "secret" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          outputCapture: spool.descriptor,
          result: { ok: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: { Redact: { Keys: ["token"], Streams: ["stdout"] } },
        },
      ],
    });

    expect(await fs.readFile(result!.artifact!.files.stdout, "utf8")).toBe("[REDACTED]\n");
    expect(await fs.readFile(result!.artifact!.files.stderr, "utf8")).toBe("visible stderr\n");
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.input, "utf8"))).toEqual({ token: "[REDACTED]" });
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.manifest, "utf8"))).toMatchObject({
      argsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      redactionPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("redacts structured failures consistently across artifact files", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-outcome-redaction");
    temporaryDirectories.push(workspaceRoot);
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" });
    const secret = "secret-value";
    const [recorded] = await recorder.record({
      requestId: "request-outcome-redaction",
      step: 1,
      results: [
        {
          callId: "call-outcome-redaction",
          name: "FailureTool",
          arguments: { token: secret },
          process: { exitCode: 1, signal: null, stdout: "", stderr: "" },
          result: { error: { message: secret, token: secret } },
          outcome: {
            execution: { status: AgentToolExecutionStatuses.Completed },
            assessment: {
              status: "failure",
              error: {
                code: AgentExecutionErrorCodes.ToolExecutionError,
                kind: "execution",
                source: "host",
                retryable: false,
                message: secret,
                details: { token: secret },
              },
            },
            output: { availability: AgentToolOutputAvailabilities.Partial },
          },
          artifactPolicy: { Redact: { Keys: ["token"], Paths: ["$.error.message"] } },
        },
      ],
    });
    const files = recorded!.artifact!.files;
    const manifestSource = await fs.readFile(files.manifest, "utf8");
    const published = await Promise.all(
      [files.input, files.raw, files.summary, files.summaryJson, files.projection].map((filePath) =>
        fs.readFile(filePath, "utf8"),
      ),
    );

    expect([...published, manifestSource].every((content) => !content.includes(secret))).toBe(true);
    expect(JSON.parse(manifestSource)).toMatchObject({
      outcome: {
        execution: { status: AgentToolExecutionStatuses.Completed },
        assessment: {
          status: "failure",
          error: {
            code: AgentExecutionErrorCodes.ToolExecutionError,
            kind: "execution",
            source: "host",
            retryable: false,
            message: "[REDACTED]",
            details: { token: "[REDACTED]" },
          },
        },
        output: { availability: AgentToolOutputAvailabilities.Partial },
      },
    });
  });

  test("reuses an identical published artifact without replacing it", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-immutable");
    temporaryDirectories.push(workspaceRoot);
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" });
    const input: RecordToolArtifactsInput = {
      requestId: "request-immutable",
      step: 1,
      results: [
        {
          callId: "call-immutable",
          name: "ImmutableTool",
          arguments: { token: "secret" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: { ok: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: { Redact: { Keys: ["token"] } },
        },
      ],
    };

    const [first] = await recorder.record(input);
    const manifestBefore = await fs.readFile(first!.artifact!.files.manifest);

    const [retried] = await recorder.record(input);

    expect(retried?.artifact?.artifactId).toBe(first?.artifact?.artifactId);
    expect(retried?.artifact?.artifactUri).toBe(first?.artifact?.artifactUri);
    expect(await fs.readFile(first!.artifact!.files.manifest)).toEqual(manifestBefore);
  });

  test("preserves the successful result and spool when Artifact recording fails", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-redaction-failure");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("output that must remain recoverable\n"));
    await spool.close();

    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const warn = vi.fn();
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config,
      model: "test-model",
      logger: { warn } as never,
    });

    const [recorded] = await recorder.record({
      requestId: "request-redaction-failure",
      step: 1,
      results: [
        {
          callId: "call-redaction-failure",
          name: "ShellCommandTool",
          arguments: { command: "echo secret" },
          process: {
            exitCode: 0,
            signal: null,
            stdout: "output that must remain recoverable\n",
            stderr: "",
          },
          outputCapture: spool.descriptor,
          result: { ok: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {
            Redact: { Transforms: [{ Pattern: "[", Streams: ["stdout"] }] },
          },
        },
      ],
    });

    expect(recorded).toMatchObject({
      result: { ok: true },
      outcome: { assessment: { status: "success" } },
      artifactAvailability: { status: "unavailable", reason: "recording_failed" },
    });
    expect(recorded).not.toHaveProperty("artifact");
    expect(recorded?.process.stdout).toBe("output that must remain recoverable\n");
    expect(recorded?.outputCapture).toEqual(spool.descriptor);
    expect(warn).toHaveBeenCalledWith(
      "tool.artifact.recording_failed",
      expect.objectContaining({
        toolName: "ShellCommandTool",
        toolCallId: "call-redaction-failure",
        requestId: "request-redaction-failure",
      }),
    );

    expect(await fs.readFile(path.join(spool.descriptor.directory, ".output-spool.json"), "utf8")).toContain(
      '"state":"failed"',
    );
    expect(await fs.readFile(spool.descriptor.files.stdout, "utf8")).toBe("output that must remain recoverable\n");
  });

  test("marks the Artifact unavailable while preserving the spool after workspace materialization fails", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-workspace-failure");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("output that must remain recoverable\n"));
    await spool.close();
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts" },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({ workspaceRoot, config, model: "test-model" });

    const [recorded] = await recorder.record({
      requestId: "request-workspace-failure",
      step: 1,
      results: [
        {
          callId: "call-workspace-failure",
          name: "WorkspaceApplyPatch",
          arguments: { patch: "*** Begin Patch" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          outputCapture: spool.descriptor,
          result: { applied: true },
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
          workspaceCapture: {
            before: { files: [], capturedAt: new Date().toISOString() },
            after: { files: [], capturedAt: new Date().toISOString() },
            changes: [],
          },
        },
      ],
    });

    expect(recorded).toMatchObject({
      result: { applied: true },
      outcome: { assessment: { status: "success" } },
      artifactAvailability: { status: "unavailable", reason: "recording_failed" },
    });

    expect(await fs.readFile(path.join(spool.descriptor.directory, ".output-spool.json"), "utf8")).toContain(
      '"state":"failed"',
    );
    expect(await fs.readFile(spool.descriptor.files.stdout, "utf8")).toBe("output that must remain recoverable\n");
    const artifactRoot = path.resolve(workspaceRoot, config.RootDir);
    const entries = await fs.readdir(artifactRoot, { recursive: true });
    const markerEntry = entries.find((entry) => entry.endsWith(".artifact-writing"));
    expect(markerEntry).toBeDefined();
    const markerPath = path.join(artifactRoot, markerEntry!);
    expect(JSON.parse(await fs.readFile(markerPath, "utf8"))).toMatchObject({ state: "failed" });
    await expect(fs.access(path.join(path.dirname(markerPath), "manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("keeps the complete structured result while writing a bounded preview", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-raw");
    temporaryDirectories.push(workspaceRoot);
    const config = resolveArtifactsConfig({
      ModelProviders: [],
      Artifacts: { RootDir: ".senera/artifacts", RawJsonMaxBytes: 1_024 },
    } satisfies AgentSystemConfig);
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config,
      model: "test-model",
    });
    const raw = { items: Array.from({ length: 200 }, (_, index) => ({ index, value: `value-${index}` })) };

    const [result] = await recorder.record({
      requestId: "request-raw",
      step: 1,
      results: [
        {
          callId: "call-raw",
          name: "TavilySearchTool",
          arguments: { query: "large result" },
          process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
          result: raw,
          outcome: AgentToolSuccessOutcome,
          artifactPolicy: {},
        },
      ],
    });

    expect(JSON.parse(await fs.readFile(result!.artifact!.files.raw, "utf8"))).toEqual(raw);
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.rawPreview, "utf8"))).toEqual(
      expect.objectContaining({ truncated: true }),
    );
    const manifest = JSON.parse(await fs.readFile(result!.artifact!.files.manifest, "utf8")) as ArtifactManifestRecord;
    expect(manifest).toMatchObject({
      contents: expect.arrayContaining([
        expect.objectContaining({
          ref: "raw",
          structure: expect.objectContaining({
            mediaType: "application/x-ndjson",
            byteLength: expect.any(Number),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
        expect.objectContaining({ ref: "rawBlob" }),
        expect.objectContaining({ ref: "rawPreview" }),
      ]),
    });
    const indexed = await readArtifactMemories(
      { artifactUris: [manifest.artifactUri], refs: ["raw"] },
      new Map([[manifest.artifactId, manifest]]),
      {
        workspaceRoot,
        artifactRoot: path.resolve(workspaceRoot, config.RootDir),
        maxBytes: 128,
        startByte: 0,
        maxArtifacts: 16,
        maxRefs: 8,
        maxConcurrency: 4,
        jsonTokenProjector: new AgentTokenProjector("gpt-4o"),
        jsonTokenLimit: 1_000,
      },
    );
    expect(indexed.artifacts.item[0]?.memories.item[0]).toMatchObject({
      view: {
        kind: "json_index",
        fieldCount: 1,
        returnedFieldCount: 1,
        remainingFieldCount: 0,
        complete: true,
      },
      structuredContent: {
        fields: [{ name: "items", type: "array", itemCount: 200 }],
      },
    });
    const rawBlob = await readArtifactMemories(
      { artifactUris: [manifest.artifactUri], refs: ["rawBlob"], maxBytesPerRef: 128 },
      new Map([[manifest.artifactId, manifest]]),
      {
        workspaceRoot,
        artifactRoot: path.resolve(workspaceRoot, config.RootDir),
        maxBytes: 128,
        startByte: 0,
        maxArtifacts: 16,
        maxRefs: 8,
        maxConcurrency: 4,
      },
    );
    expect(rawBlob.artifacts.item[0]?.memories.item[0]).toMatchObject({
      ref: "rawBlob",
      range: { complete: false, nextStartByte: expect.any(Number) },
      content: expect.stringContaining("items"),
    });
  });
});

function createExecutionLog(stream: "stdout" | "stderr", bytes: number): string {
  const lines: string[] = [];
  let byteLength = 0;
  for (let index = 0; byteLength < bytes; index += 1) {
    const line = `${stream.toUpperCase()} request=${index.toString(36)} file=packages/app/src/module-${(
      index % 97
    ).toString(36)}.ts elapsed=${10 + (index % 997)}ms status=${index % 31 === 0 ? "warning" : "ok"}\n`;
    lines.push(line);
    byteLength += Buffer.byteLength(line, "utf8");
  }
  return Buffer.from(lines.join(""), "utf8").subarray(0, bytes).toString("utf8");
}
