import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readArtifactMemories,
  type AgentArtifactMemoryReadOptions,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import {
  ArtifactMemoryReadArgumentsSchema,
  type ArtifactManifestRecord,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import { AgentArtifactCompactViewStore } from "../../../Source/AgentSystem/Artifacts/AgentArtifactCompactViewStore.js";
import { AgentArtifactMemoryHttpApi } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryHttpApi.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const ArtifactId = "art_0123456789abcdef01234567";
const ArtifactUri = `senera://artifact/${ArtifactId}`;

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("ArtifactReadTool views", () => {
  test("accepts only artifactUris and an explicit compact or full view", () => {
    expect(ArtifactMemoryReadArgumentsSchema.parse({ artifactUris: [ArtifactUri], view: "compact" })).toEqual({
      artifactUris: [ArtifactUri],
      view: "compact",
    });
    expect(ArtifactMemoryReadArgumentsSchema.safeParse({ artifactUris: [ArtifactUri], view: "full" }).success).toBe(
      true,
    );
    expect(ArtifactMemoryReadArgumentsSchema.safeParse({ artifactUris: [ArtifactUri] }).success).toBe(false);
    expect(ArtifactMemoryReadArgumentsSchema.safeParse({ artifactUris: [ArtifactUri], view: "index" }).success).toBe(
      false,
    );
    expect(ArtifactMemoryReadArgumentsSchema.safeParse({ artifactUris: ["invalid"], view: "full" }).success).toBe(
      false,
    );
    expect(ArtifactMemoryReadArgumentsSchema.safeParse({ artifactUris: [ArtifactUri], refs: ["raw"] }).success).toBe(
      false,
    );
    expect(
      ArtifactMemoryReadArgumentsSchema.safeParse({
        artifactUris: [ArtifactUri],
        view: "compact",
        jsonView: { kind: "index" },
      }).success,
    ).toBe(false);
  });

  test("returns the published deterministic summary as a mechanically compact view", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Mechanical summary." });

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], view: "compact" },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      artifactUri: ArtifactUri,
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

  test("HTTP ArtifactRead reuses the same full-result reader", async () => {
    const fixture = await createFixture({ result: { answer: "source truth" }, summary: "Compact." });
    const request = Object.assign(Readable.from([JSON.stringify({ artifactUris: [ArtifactUri], view: "full" })]), {
      method: "POST",
      url: "/api/artifacts/read",
      headers: { "content-type": "application/json" },
    }) as unknown as IncomingMessage;
    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
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
