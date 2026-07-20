import fs from "node:fs/promises";
import path from "node:path";
import {
  createArtifactStreamRedactionTransform,
  redactArtifactSecrets,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactRedaction.js";
import { afterEach, describe, expect, test } from "vitest";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { createSeneraOutputSpool } from "../../../Source/AgentSystem/Execution/SeneraOutputSpool.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { readArtifactMemories } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import type { ArtifactManifestRecord } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

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
          process: { exitCode: 0, signal: null, stderr: "complete stderr\n" },
          outputCapture: spool.descriptor,
          result: { stdout: "preview", stderr: "preview" },
          artifactPolicy: {},
        },
      ],
    });

    expect(result?.artifact?.files.stdout).toBeDefined();
    expect(await fs.readFile(result!.artifact!.files.stdout, "utf8")).toBe("complete stdout\n");
    expect(await fs.readFile(result!.artifact!.files.stderr, "utf8")).toBe("complete stderr\n");
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.manifest, "utf8"))).toMatchObject({
      schemaVersion: 2,
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
    await expect(fs.stat(spool.descriptor.directory)).rejects.toMatchObject({ code: "ENOENT" });
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
          process: { exitCode: 0, signal: null, stderr: "" },
          outputCapture: spool.descriptor,
          result: { stdout: "preview sk-raw-secret", stderr: "preview" },
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
          process: { exitCode: 0, signal: null, stderr: "" },
          outputCapture: spool.descriptor,
          result: { ok: true },
          artifactPolicy: { Redact: { Keys: ["token"], Streams: ["stdout"] } },
        },
      ],
    });

    expect(await fs.readFile(result!.artifact!.files.stdout, "utf8")).toBe("[REDACTED]\n");
    expect(await fs.readFile(result!.artifact!.files.stderr, "utf8")).toBe("visible stderr\n");
    expect(JSON.parse(await fs.readFile(result!.artifact!.files.input, "utf8"))).toEqual({ token: "[REDACTED]" });
  });

  test("preserves the spool when artifact recording fails", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-artifact-redaction-failure");
    temporaryDirectories.push(workspaceRoot);
    const spool = await createSeneraOutputSpool(path.join(workspaceRoot, "spool"), "call");
    spool.write("stdout", Buffer.from("output that must remain recoverable\n"));
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

    await expect(
      recorder.record({
        requestId: "request-redaction-failure",
        step: 1,
        results: [
          {
            callId: "call-redaction-failure",
            name: "ShellCommandTool",
            arguments: { command: "echo secret" },
            process: { exitCode: 0, signal: null, stderr: "" },
            outputCapture: spool.descriptor,
            result: { ok: true },
            artifactPolicy: {
              Redact: { Transforms: [{ Pattern: "[", Streams: ["stdout"] }] },
            },
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(spool.descriptor.directory, ".output-spool.json"), "utf8")).toContain(
      '"state":"failed"',
    );
    expect(await fs.readFile(spool.descriptor.files.stdout, "utf8")).toBe("output that must remain recoverable\n");
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
          process: { exitCode: 0, signal: null, stderr: "" },
          result: raw,
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
        expect.objectContaining({ ref: "raw" }),
        expect.objectContaining({ ref: "rawBlob" }),
        expect.objectContaining({ ref: "rawPreview" }),
      ]),
    });
    const rawBlob = await readArtifactMemories(
      { artifactUris: [manifest.artifactUri], refs: ["rawBlob"], maxBytesPerRef: 128 },
      new Map([[manifest.artifactId, manifest]]),
      {
        workspaceRoot,
        artifactRoot: path.resolve(workspaceRoot, config.RootDir),
        maxBytes: 128,
        startByte: 0,
        structuredJsonMaxBytes: 8 * 1024 * 1024,
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
