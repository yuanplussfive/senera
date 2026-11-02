import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readArtifactMemories,
  type AgentArtifactMemoryReadOptions,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import type { ArtifactManifestRecord } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import { AgentArtifactCompactViewStore } from "../../../Source/AgentSystem/Artifacts/AgentArtifactCompactViewStore.js";
import { AgentArtifactMemoryHttpApi } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryHttpApi.js";
import { findAgentResourceRecord } from "../../../Source/AgentSystem/Resources/AgentResourceRegistry.js";
import { createAgentResourceUri } from "../../../Source/AgentSystem/Resources/AgentResourceUri.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const ArtifactId = "art_0123456789abcdef01234567";
const ArtifactUri = `senera://artifact/${ArtifactId}`;

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("ArtifactReadTool views", () => {
  test("returns the published deterministic summary as a mechanically compact view", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Mechanical summary." });

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], view: "compact" },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      requestedUri: ArtifactUri,
      artifactId: ArtifactId,
      status: "found",
      view: "compact",
      compressionMethod: "mechanical",
      content: "Mechanical summary.",
    });
  });

  test("prefers the persisted LLM observation summary without changing the source Artifact", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Mechanical summary." });
    await new AgentArtifactCompactViewStore(fixture.workspaceRoot).write({
      artifactUri: ArtifactUri,
      artifactPath: fixture.artifactPath,
      summary: "LLM summary for the original request.",
    });

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], view: "compact" },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      status: "found",
      compressionMethod: "llm",
      content: "LLM summary for the original request.",
    });
    expect(await fs.readFile(fixture.rawPath, "utf8")).toBe('{"answer":"source truth"}\n');
  });

  test("returns the original JSON result for a full view", async () => {
    const original = { items: [{ id: 1 }, { id: 2 }], exact: true };
    const fixture = await createFixture({ result: original, summary: "Compact." });

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], view: "full" },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      status: "found",
      view: "full",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      content: { result: original },
    });
    expect(result.artifacts.item[0]).not.toHaveProperty("compressionMethod");
  });

  test("legacy references resolve to a short identity and field selection preserves null and exact keys", async () => {
    const fixture = await createFixture({
      result: { count: 2, "a/b": { "~key": [null, "exact URL"] } },
      summary: "Compact.",
    });
    const first = await readArtifactMemories(
      { requests: [{ uri: ArtifactUri, paths: ["/a~1b/~0key/0", "/missing", "/a~1b/~0key/1"] }] },
      fixture.manifests,
      readOptions(fixture),
    );
    const item = first.artifacts.item[0]!;
    expect(item.artifactUri).toMatch(/^senera:\/\/resource\/[0-9a-hjkmnp-tv-z]{6}$/u);
    expect(item.requestedUri).toBe(ArtifactUri);
    expect(item.content).toMatchObject({
      selections: [
        { path: "/a~1b/~0key/0", status: "found", value: null, complete: true },
        { path: "/missing", status: "not_found" },
        { path: "/a~1b/~0key/1", status: "found", value: "exact URL" },
      ],
    });
    const record = findAgentResourceRecord(fixture.workspaceRoot, ArtifactUri)!;
    expect(item.artifactUri).toBe(createAgentResourceUri(record.resource_id));
    const api = new AgentArtifactMemoryHttpApi({
      workspaceRoot: fixture.workspaceRoot,
      configSnapshot: () => ({ ModelProviders: [], Artifacts: { RootDir: "artifacts" } }) as AgentSystemConfig,
      maxRequestBytes: 4096,
    });
    const response = artifactReadResponse();
    await api.handle(
      artifactReadRequest({ requests: [{ uri: item.artifactUri, paths: [""] }] }),
      response as unknown as ServerResponse,
    );
    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      artifacts: {
        item: [
          {
            requestedUri: item.artifactUri,
            status: "found",
            content: { selections: [{ value: { count: 2 }, representation: "original" }] },
          },
        ],
      },
    });
  });

  test("HTTP ArtifactRead reuses the same full-result reader", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Compact." });
    const request = artifactReadRequest({ artifactUris: [ArtifactUri], view: "full" });
    const response = artifactReadResponse();
    const config = {
      ModelProviders: [],
      Artifacts: { RootDir: "artifacts" },
    } as AgentSystemConfig;
    const api = new AgentArtifactMemoryHttpApi({
      workspaceRoot: fixture.workspaceRoot,
      configSnapshot: () => config,
      maxRequestBytes: 4096,
    });

    await api.handle(request, response as unknown as ServerResponse);

    expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Cache-Control": "no-store" }));
    expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      artifacts: {
        item: [
          {
            status: "found",
            view: "full",
            content: { result: { answer: "source truth" } },
          },
        ],
      },
    });
  });

  test("can inspect a nested subtree's structure before reading its exact fields", async () => {
    const fixture = await createFixture({
      result: { rows: [{ id: 42, body: "source detail ".repeat(2_000) }] },
      summary: "Compact.",
    });
    const result = await readArtifactMemories(
      { requests: [{ uri: ArtifactUri, paths: ["/rows/0"], view: "structure" }] },
      fixture.manifests,
      readOptions(fixture, { model: "gpt-4o", tokenLimit: 400 }),
    );
    expect(result.artifacts.item[0]).toMatchObject({
      status: "found",
      view: "structure",
      content: {
        selections: [
          {
            path: "/rows/0",
            representation: "structure",
            complete: false,
            value: { fields: { id: 42, body: { path: "/rows/0/body", type: "string" } } },
          },
        ],
      },
    });
    const exact = await readArtifactMemories(
      {
        requests: [
          { uri: ArtifactUri, paths: ["/rows/0/id"] },
          { uri: ArtifactUri, part: "source" },
        ],
      },
      fixture.manifests,
      readOptions(fixture),
    );
    expect(exact.artifacts.item[0]?.content).toMatchObject({ selections: [{ value: 42, complete: true }] });
    expect(exact.artifacts.item[1]).toMatchObject({
      status: "failed",
      part: "source",
      availableParts: ["result", "summary"],
    });
    const root = await readArtifactMemories(
      { requests: [{ uri: ArtifactUri, view: "content" }] },
      fixture.manifests,
      readOptions(fixture),
    );
    expect(root.artifacts.item[0]).toMatchObject({
      view: "selected",
      content: { selections: [{ path: "", representation: "original", complete: true }] },
    });
  });

  test("process selection reads the same verified streams as a legacy full view", async () => {
    const fixture = await createFixture({ result: { ok: true }, summary: "Compact." });
    const manifest = fixture.manifests.get(ArtifactId)!;
    const stdout = "exact captured output\n";
    const stdoutPath = path.join(fixture.artifactPath, "stdout.txt");
    await fs.writeFile(stdoutPath, stdout, "utf8");
    const identity = {
      ref: "stdout" as const,
      mediaType: "text/plain",
      byteLength: Buffer.byteLength(stdout),
      sha256: await hashFile(stdoutPath),
    };
    manifest.files.stdout = stdoutPath;
    manifest.contents!.push(identity);
    manifest.process = {
      exitCode: 0,
      signal: null,
      streams: [{ stream: "stdout", ref: "stdout", byteLength: identity.byteLength, sha256: identity.sha256 }],
    };
    const result = await readArtifactMemories(
      { requests: [{ uri: ArtifactUri, part: "process", paths: ["/exitCode", "/stdout", "/stderr"] }] },
      fixture.manifests,
      readOptions(fixture),
    );
    expect(result.artifacts.item[0]).toMatchObject({
      status: "found",
      part: "process",
      content: { selections: [{ value: 0 }, { value: stdout }, { value: "" }] },
    });
    await fs.writeFile(stdoutPath, "tampered", "utf8");
    const tampered = await readArtifactMemories(
      { requests: [{ uri: ArtifactUri, part: "process", paths: ["/stdout"] }] },
      fixture.manifests,
      readOptions(fixture),
    );
    expect(tampered.artifacts.item[0]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("integrity"),
    });
  });

  test("HTTP ArtifactRead rejects malformed transport input without exposing a second tool contract", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Compact." });
    const config = {
      ModelProviders: [],
      Artifacts: { RootDir: "artifacts" },
    } as AgentSystemConfig;
    const api = new AgentArtifactMemoryHttpApi({
      workspaceRoot: fixture.workspaceRoot,
      configSnapshot: () => config,
      maxRequestBytes: 4096,
    });

    for (const body of [
      { artifactUris: [ArtifactUri] },
      { artifactUris: [ArtifactUri], view: "index" },
      { artifactUris: ["invalid"], view: "full" },
      { artifactUris: [ArtifactUri], view: "full", refs: ["raw"] },
    ]) {
      const response = artifactReadResponse();
      await api.handle(artifactReadRequest(body), response as unknown as ServerResponse);

      expect(response.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(JSON.parse(String(response.end.mock.calls[0]?.[0]))).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
  });

  test("reports invalid, missing, and integrity-failed artifacts distinctly", async () => {
    const fixture = await createFixture({ result: { value: 1 }, summary: "Compact." });
    await fs.writeFile(fixture.rawPath, "tampered", "utf8");

    const result = await readArtifactMemories(
      { artifactUris: ["invalid", `senera://artifact/art_aaaaaaaaaaaaaaaaaaaaaaaa`, ArtifactUri], view: "full" },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item.map(({ status }) => status)).toEqual(["invalid", "not_found", "failed"]);
    expect(result.artifacts.item[2]?.message).toContain("integrity");
  });

  test("enforces the configured artifact count before reading", async () => {
    const fixture = await createFixture({ result: { value: 1 }, summary: "Compact." });
    await expect(
      readArtifactMemories(
        { artifactUris: [ArtifactUri, ArtifactUri], view: "full" },
        fixture.manifests,
        readOptions(fixture, { maxArtifacts: 1 }),
      ),
    ).rejects.toMatchObject({
      kind: "ArtifactMemoryReadRequestLimitError",
      actual: 2,
      limit: 1,
    });
  });
});

async function createFixture(input: { result: unknown; summary: string }): Promise<{
  workspaceRoot: string;
  artifactRoot: string;
  artifactPath: string;
  rawPath: string;
  manifests: ReadonlyMap<string, ArtifactManifestRecord>;
}> {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-memory-read");
  temporaryDirectories.push(workspaceRoot);
  const artifactRoot = path.join(workspaceRoot, "artifacts");
  const artifactPath = path.join(artifactRoot, ArtifactId);
  const rawPath = path.join(artifactPath, "raw.json");
  const summaryPath = path.join(artifactPath, "summary.md");
  const manifestPath = path.join(artifactPath, "manifest.json");
  await fs.mkdir(artifactPath, { recursive: true });
  await fs.writeFile(rawPath, `${JSON.stringify(input.result)}\n`, "utf8");
  await fs.writeFile(summaryPath, input.summary, "utf8");
  const manifest: ArtifactManifestRecord = {
    schemaVersion: 4,
    artifactId: ArtifactId,
    artifactUri: ArtifactUri,
    files: { manifest: manifestPath, raw: rawPath, summary: summaryPath },
    contents: [
      {
        ref: "raw",
        mediaType: "application/json",
        byteLength: (await fs.stat(rawPath)).size,
        sha256: await hashFile(rawPath),
      },
      {
        ref: "summary",
        mediaType: "text/markdown",
        byteLength: (await fs.stat(summaryPath)).size,
        sha256: await hashFile(summaryPath),
      },
    ],
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return {
    workspaceRoot,
    artifactRoot,
    artifactPath,
    rawPath,
    manifests: new Map([[ArtifactId, manifest]]),
  };
}

function readOptions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<AgentArtifactMemoryReadOptions> = {},
): AgentArtifactMemoryReadOptions {
  return {
    workspaceRoot: fixture.workspaceRoot,
    artifactRoot: fixture.artifactRoot,
    maxArtifacts: 16,
    maxConcurrency: 4,
    ...overrides,
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function artifactReadRequest(body: unknown): IncomingMessage {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    method: "POST",
    url: "/api/artifacts/read",
    headers: { "content-type": "application/json" },
  }) as unknown as IncomingMessage;
}

function artifactReadResponse() {
  return Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    end: vi.fn(),
  });
}
