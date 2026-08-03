import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readArtifactMemories,
  type AgentArtifactMemoryReadOptions,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import {
  ArtifactMemoryReadArgumentsSchema,
  type ArtifactManifestRecord,
  ReadableArtifactRefDefinitions,
  ReadableArtifactRefs,
  type ReadableArtifactRef,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import {
  ArtifactJsonIndexPageProtocol,
  ArtifactJsonViewPageProtocol,
} from "../../../Source/AgentSystem/Memory/AgentArtifactJsonQuery.js";
import { AgentArtifactFileWriter } from "../../../Source/AgentSystem/Artifacts/AgentArtifactFileWriter.js";
import {
  artifactJsonStructurePath,
  createArtifactJsonStructureTransform,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactJsonStructure.js";

const temporaryDirectories: string[] = [];
const ArtifactId = "art_0123456789abcdef01234567";
const ArtifactUri = `senera://artifact/${ArtifactId}`;
const DefaultReadLimits = {
  maxArtifacts: 16,
  maxRefs: 8,
  maxConcurrency: 4,
  jsonTokenProjector: new AgentTokenProjector("gpt-4o"),
  jsonTokenLimit: 4_000,
} as const;

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("artifact memory paging", () => {
  test("returns an explicit terminal range instead of repeating a truncated prefix", async () => {
    const fixture = await createFixture("abcdef");
    const readFile = vi.spyOn(fs, "readFile");

    const first = await readPage(fixture, 0, 3);
    expect(first).toEqual({
      ref: "projection",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      range: {
        startByte: 0,
        endByte: 3,
        totalBytes: 6,
        returnedBytes: 3,
        complete: false,
        nextStartByte: 3,
      },
      content: "abc",
    });

    const final = await readPage(fixture, first.range.nextStartByte!, 3);
    expect(final).toEqual({
      ref: "projection",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      range: {
        startByte: 3,
        endByte: 6,
        totalBytes: 6,
        returnedBytes: 3,
        complete: true,
      },
      content: "def",
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  test("keeps continuation offsets on UTF-8 code-point boundaries", async () => {
    const fixture = await createFixture("你好吗");

    const first = await readPage(fixture, 0, 4);
    expect(first.content).toBe("你");
    expect(first.range).toMatchObject({ startByte: 0, endByte: 3, totalBytes: 9, nextStartByte: 3 });

    const second = await readPage(fixture, first.range.nextStartByte!, 4);
    expect(second.content).toBe("好");
    expect(second.range).toMatchObject({ startByte: 3, endByte: 6, nextStartByte: 6 });

    const final = await readPage(fixture, second.range.nextStartByte!, 4);
    expect(final.content).toBe("吗");
    expect(final.range).toMatchObject({ startByte: 6, endByte: 9, complete: true });
  });

  test("normalizes model-provided numeric paging arguments", () => {
    expect(
      ArtifactMemoryReadArgumentsSchema.parse({
        artifactUris: { item: [ArtifactUri] },
        maxBytesPerRef: "4096",
        startBytePerRef: "8192",
      }),
    ).toEqual({ artifactUris: [ArtifactUri], maxBytesPerRef: 4096, startBytePerRef: 8192 });
    expect(
      ArtifactMemoryReadArgumentsSchema.parse({
        artifactUris: { item: [ArtifactUri] },
        refs: { item: ["projection"] },
        refRanges: {
          item: [{ ref: "projection", maxBytes: "128", startByte: "32" }],
        },
      }).refRanges,
    ).toEqual([{ ref: "projection", maxBytes: 128, startByte: 32 }]);
  });

  test("reports unavailable refs as terminal instead of claiming an empty successful load", async () => {
    const fixture = await createFixture("projection only");

    const result = await readArtifactMemories({ artifactUris: [ArtifactUri], refs: ["raw"] }, fixture.manifests, {
      workspaceRoot: fixture.workspaceRoot,
      artifactRoot: fixture.artifactRoot,
      maxBytes: 1024,
      startByte: 0,
      ...DefaultReadLimits,
    });

    expect(result.artifacts.item[0]).toMatchObject({
      status: "found",
      message: "Artifact found; one or more requested refs are unavailable.",
      memoryCount: 0,
      unavailableRefCount: 1,
      failedRefCount: 0,
      refResults: {
        item: [{ ref: "raw", status: "unavailable" }],
      },
    });
    expect(result.guidance).toContain("unavailable and failed refs are terminal");
  });

  test("rejects a text ref whose bytes no longer match its published identity", async () => {
    const fixture = await createFixture("published projection");
    const projectionPath = path.join(fixture.artifactRoot, ArtifactId, "projection.md");
    await fs.writeFile(projectionPath, "tampered projection", "utf8");

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["projection"] },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      memoryCount: 0,
      failedRefCount: 1,
      refResults: {
        item: [
          {
            ref: "projection",
            status: "failed",
            message: expect.stringContaining("Artifact content integrity verification failed"),
          },
        ],
      },
    });
  });

  test("verifies workspace patches through the same published text receipt path", async () => {
    const fixture = await createFixture("projection");
    const workspacePatchPath = path.join(fixture.artifactRoot, ArtifactId, "workspace.patch");
    await fs.writeFile(workspacePatchPath, "--- before\n+++ after\n", "utf8");
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { workspacePatch: workspacePatchPath });
    await fs.appendFile(workspacePatchPath, "tampered\n", "utf8");

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["workspacePatch"] },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(result.artifacts.item[0]).toMatchObject({
      memoryCount: 0,
      failedRefCount: 1,
      refResults: {
        item: [
          {
            ref: "workspacePatch",
            status: "failed",
            message: expect.stringContaining("Artifact content integrity verification failed"),
          },
        ],
      },
    });
  });

  test("rejects tampered JSON source and structural sidecar bytes", async () => {
    const sourceFixture = await createFixture("projection");
    const rawPath = path.join(sourceFixture.artifactRoot, ArtifactId, "raw.json");
    await fs.writeFile(rawPath, JSON.stringify({ items: [{ id: 1 }] }), "utf8");
    sourceFixture.manifests = await createManifestMap(sourceFixture.artifactRoot, { raw: rawPath });
    await fs.writeFile(rawPath, JSON.stringify({ items: [{ id: 2 }] }), "utf8");

    const sourceResult = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw"] },
      sourceFixture.manifests,
      readOptions(sourceFixture),
    );
    expect(sourceResult.artifacts.item[0]).toMatchObject({ memoryCount: 0, failedRefCount: 1 });

    const sidecarFixture = await createFixture("projection");
    const sidecarRawPath = path.join(sidecarFixture.artifactRoot, ArtifactId, "raw.json");
    await fs.writeFile(sidecarRawPath, JSON.stringify({ items: [{ id: 1 }] }), "utf8");
    sidecarFixture.manifests = await createManifestMap(sidecarFixture.artifactRoot, { raw: sidecarRawPath });
    await fs.appendFile(artifactJsonStructurePath(sidecarRawPath), "{}\n", "utf8");

    const sidecarResult = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw"] },
      sidecarFixture.manifests,
      readOptions(sidecarFixture),
    );
    expect(sidecarResult.artifacts.item[0]).toMatchObject({ memoryCount: 0, failedRefCount: 1 });
  });

  test("supports independent byte ranges for multiple refs", async () => {
    const fixture = await createFixture("projection only");
    const projectionPath = path.join(fixture.artifactRoot, ArtifactId, "projection.md");
    const stdoutPath = path.join(fixture.artifactRoot, ArtifactId, "stdout.txt");
    await fs.writeFile(stdoutPath, "stdout content", "utf8");
    const projectionStat = await fs.stat(projectionPath);
    const stdoutStat = await fs.stat(stdoutPath);
    fixture.manifests = new Map([
      [
        ArtifactId,
        {
          schemaVersion: 3,
          artifactId: ArtifactId,
          artifactUri: ArtifactUri,
          files: { projection: projectionPath, stdout: stdoutPath },
          contents: [
            {
              ref: "projection",
              mediaType: "text/markdown",
              byteLength: projectionStat.size,
              sha256: await hashFile(projectionPath),
            },
            {
              ref: "stdout",
              mediaType: "text/plain",
              byteLength: stdoutStat.size,
              sha256: await hashFile(stdoutPath),
            },
          ],
        },
      ],
    ]);

    const result = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["projection", "stdout"],
        refRanges: [
          { ref: "projection", maxBytes: 4, startByte: 0 },
          { ref: "stdout", maxBytes: 8, startByte: 2 },
        ],
      },
      fixture.manifests,
      {
        workspaceRoot: fixture.workspaceRoot,
        artifactRoot: fixture.artifactRoot,
        maxBytes: 1024,
        startByte: 0,
        ...DefaultReadLimits,
      },
    );

    expect(result.artifacts.item[0]?.memories.item).toEqual([
      expect.objectContaining({ ref: "projection", content: "proj", range: expect.objectContaining({ endByte: 4 }) }),
      expect.objectContaining({
        ref: "stdout",
        content: "dout con",
        range: expect.objectContaining({ startByte: 2, nextStartByte: 10 }),
      }),
    ]);
  });

  test("streams a structural index for JSON without loading source values into memory", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    await fs.writeFile(
      rawPath,
      JSON.stringify({ items: Array.from({ length: 4_096 }, (_, id) => ({ id })), active: true }),
      "utf8",
    );
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { raw: rawPath });
    const readFile = vi.spyOn(fs, "readFile");

    const indexed = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw"] },
      fixture.manifests,
      readOptions(fixture),
    );

    expect(indexed.artifacts.item[0]).toMatchObject({
      status: "found",
      memoryCount: 1,
      failedRefCount: 0,
      refResults: { item: [{ ref: "raw", status: "loaded" }] },
    });
    const memory = indexed.artifacts.item[0]!.memories.item[0]!;
    expect(memory.view).toEqual({
      kind: "json_index",
      rootType: "object",
      fieldCount: 2,
      startFieldIndex: 0,
      returnedFieldCount: 2,
      remainingFieldCount: 0,
      complete: true,
    });
    expect(memory.structuredContent).toMatchObject({
      type: ArtifactJsonIndexPageProtocol.type,
      root: { type: "object" },
      source: { index: expect.stringMatching(/^sidecar:[a-f0-9]{64}$/) },
      page: {
        startFieldIndex: 0,
        returnedFieldCount: 2,
        totalFieldCount: 2,
        remainingFieldCount: 0,
        complete: true,
      },
      fields: [
        { name: "items", type: "array", itemCount: 4_096 },
        { name: "active", type: "boolean" },
      ],
    });
    expect(memory.content).not.toContain('"id"');
    expect(readFile).not.toHaveBeenCalled();

    readFile.mockRestore();
    const ranged = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["rawBlob"] },
      fixture.manifests,
      readOptions(fixture, { maxBytes: 32 }),
    );
    expect(ranged.artifacts.item[0]?.memories.item[0]).toMatchObject({
      ref: "rawBlob",
      range: { complete: false, nextStartByte: expect.any(Number), returnedBytes: 32 },
    });
  });

  test("keeps the JSON index within the active token budget by omitting complete field records", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    const fields = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`descriptive_field_${index.toString().padStart(3, "0")}`, index]),
    );
    await fs.writeFile(rawPath, JSON.stringify(fields), "utf8");
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { raw: rawPath });
    const projector = new AgentTokenProjector("gpt-4o");
    const tokenLimit = 500;

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw"] },
      fixture.manifests,
      readOptions(fixture, { jsonTokenProjector: projector, jsonTokenLimit: tokenLimit }),
    );
    const memory = result.artifacts.item[0]!.memories.item[0]!;
    const index = JSON.parse(memory.content) as {
      page: {
        returnedFieldCount: number;
        totalFieldCount: number;
        remainingFieldCount: number;
        complete: boolean;
        nextCursor?: string;
      };
      fields: Array<{ name: string; type: string }>;
    };

    expect(index.fields.length).toBeGreaterThan(0);
    expect(index.fields.length).toBeLessThan(80);
    expect(index.page).toMatchObject({
      returnedFieldCount: index.fields.length,
      totalFieldCount: 80,
      remainingFieldCount: 80 - index.fields.length,
      complete: false,
      nextCursor: expect.any(String),
    });
    expect(projector.countJson(index)).toBeLessThanOrEqual(tokenLimit);
    expect(index.fields.every((field) => field.name.length > 0 && field.type === "number")).toBe(true);

    const mismatched = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["raw"],
        jsonView: { kind: "query", sourcePath: [], cursor: index.page.nextCursor },
      },
      fixture.manifests,
      readOptions(fixture, { jsonTokenProjector: projector, jsonTokenLimit: tokenLimit }),
    );
    expect(mismatched.artifacts.item[0]).toMatchObject({
      memoryCount: 0,
      failedRefCount: 1,
      refResults: { item: [{ status: "failed", message: "Artifact JSON query cursor is invalid." }] },
    });

    const names = new Set(index.fields.map((field) => field.name));
    const cursors = new Set<string>();
    let cursor = index.page.nextCursor;
    while (cursor) {
      expect(cursors.has(cursor)).toBe(false);
      cursors.add(cursor);
      const continued = await readArtifactMemories(
        {
          artifactUris: [ArtifactUri],
          refs: ["raw"],
          jsonView: { kind: "index", cursor },
        },
        fixture.manifests,
        readOptions(fixture, { jsonTokenProjector: projector, jsonTokenLimit: tokenLimit }),
      );
      const page = JSON.parse(continued.artifacts.item[0]!.memories.item[0]!.content) as typeof index;
      page.fields.forEach((field) => names.add(field.name));
      cursor = page.page.nextCursor;
      if (!cursor) expect(page.page).toMatchObject({ complete: true, remainingFieldCount: 0 });
    }
    expect(names).toEqual(new Set(Object.keys(fields)));
  });

  test("streams and pages a nested JSON structure index without materializing the source document", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    const fields = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [`nested_field_${index.toString().padStart(3, "0")}`, index]),
    );
    await fs.writeFile(rawPath, JSON.stringify({ envelope: { metadata: fields } }), "utf8");
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { raw: rawPath });
    const projector = new AgentTokenProjector("gpt-4o");
    const tokenLimit = 1_000;

    const first = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["raw"],
        jsonView: { kind: "index", sourcePath: ["envelope", "metadata"] },
      },
      fixture.manifests,
      readOptions(fixture, { jsonTokenProjector: projector, jsonTokenLimit: tokenLimit }),
    );
    const firstMemory = first.artifacts.item[0]!.memories.item[0]!;
    const firstPage = JSON.parse(firstMemory.content) as {
      source: { sourcePath?: string[]; index: string };
      fields: Array<{ name: string }>;
      page: { nextCursor?: string; complete: boolean };
    };

    expect(firstMemory.view).toMatchObject({
      kind: "json_index",
      sourcePath: ["envelope", "metadata"],
      complete: false,
      nextCursor: expect.any(String),
    });
    expect(firstPage.source.sourcePath).toEqual(["envelope", "metadata"]);
    expect(firstPage.source.index).toMatch(/^path:[a-f0-9]{64}$/);
    expect(firstPage.fields.length).toBeGreaterThan(0);
    expect(firstPage.page.complete).toBe(false);

    const names = new Set(firstPage.fields.map((field) => field.name));
    let cursor = firstPage.page.nextCursor;
    while (cursor) {
      const continued = await readArtifactMemories(
        {
          artifactUris: [ArtifactUri],
          refs: ["raw"],
          jsonView: { kind: "index", sourcePath: ["envelope", "metadata"], cursor },
        },
        fixture.manifests,
        readOptions(fixture, { jsonTokenProjector: projector, jsonTokenLimit: tokenLimit }),
      );
      const page = JSON.parse(continued.artifacts.item[0]!.memories.item[0]!.content) as typeof firstPage;
      page.fields.forEach((field) => names.add(field.name));
      cursor = page.page.nextCursor;
    }

    expect(names).toEqual(new Set(Object.keys(fields)));
  });

  test("counts root array items and excludes internal routing fields from JSON indexes", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    const evidencePath = path.join(fixture.artifactRoot, ArtifactId, "evidence.json");
    await fs.writeFile(rawPath, JSON.stringify(Array.from({ length: 257 }, (_, index) => index)), "utf8");
    await fs.writeFile(evidencePath, JSON.stringify({ absolutePath: "private", value: "public" }), "utf8");
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { raw: rawPath, evidence: evidencePath });

    const result = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw", "evidence"] },
      fixture.manifests,
      readOptions(fixture),
    );
    const [raw, evidence] = result.artifacts.item[0]!.memories.item;

    expect(raw?.view).toEqual({
      kind: "json_index",
      rootType: "array",
      rootItemCount: 257,
      fieldCount: 0,
      startFieldIndex: 0,
      returnedFieldCount: 0,
      remainingFieldCount: 0,
      complete: true,
    });
    expect(evidence?.structuredContent).toMatchObject({
      fields: [{ name: "value", type: "string" }],
      page: { totalFieldCount: 1, remainingFieldCount: 0, complete: true },
    });
  });

  test("enforces configured artifact and ref counts before scheduling reads", async () => {
    const fixture = await createFixture("projection");
    await expect(
      readArtifactMemories(
        { artifactUris: [ArtifactUri, ArtifactUri] },
        fixture.manifests,
        readOptions(fixture, { maxArtifacts: 1 }),
      ),
    ).rejects.toMatchObject({
      kind: "ArtifactMemoryReadRequestLimitError",
      argumentPath: "artifactUris",
      actual: 2,
      limit: 1,
    });

    await expect(
      readArtifactMemories(
        { artifactUris: [ArtifactUri], refs: ["summary", "projection"] },
        fixture.manifests,
        readOptions(fixture, { maxRefs: 1 }),
      ),
    ).rejects.toMatchObject({
      kind: "ArtifactMemoryReadRequestLimitError",
      argumentPath: "refs",
      actual: 2,
      limit: 1,
    });
  });

  test("shares one filesystem concurrency budget across artifacts and refs", async () => {
    const fixture = await createFixture("projection");
    const originalStat = fs.stat.bind(fs);
    let active = 0;
    let peak = 0;
    vi.spyOn(fs, "stat").mockImplementation(async (filePath, options) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      try {
        return await originalStat(filePath, options);
      } finally {
        active -= 1;
      }
    });

    await readArtifactMemories(
      { artifactUris: [ArtifactUri, ArtifactUri], refs: ["projection", "summary"] },
      fixture.manifests,
      readOptions(fixture, { maxConcurrency: 2 }),
    );

    expect(peak).toBe(2);
  });

  test("streams and projects large JSON with complete-item cursor pages", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    const items = Array.from({ length: 2_000 }, (_, index) => ({
      id: index,
      status: index % 2 === 0 ? "active" : "inactive",
      payload: "x".repeat(128),
    }));
    await fs.writeFile(rawPath, JSON.stringify({ items }), "utf8");
    fixture.manifests = await createManifestMap(fixture.artifactRoot, { raw: rawPath });

    const result = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["raw"],
        jsonView: {
          kind: "query",
          sourcePath: ["items"],
          select: ["id", "status"],
          where: [{ field: "status", operator: "eq", value: "active" }],
        },
      },
      fixture.manifests,
      readOptions(fixture, {
        jsonTokenProjector: new AgentTokenProjector("gpt-4o"),
        jsonTokenLimit: 700,
      }),
    );

    const artifact = result.artifacts.item[0]!;
    const memory = artifact.memories.item[0]!;
    const page = JSON.parse(memory.content) as {
      items: Array<Record<string, unknown>>;
      page: { complete: boolean; nextCursor?: string };
    };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.status === "active" && !Object.hasOwn(item, "payload"))).toBe(true);
    expect(memory.view).toMatchObject({ kind: "json_query", complete: false, nextCursor: expect.any(String) });
    expect(memory.structuredContent).toMatchObject({
      type: ArtifactJsonViewPageProtocol.type,
      page: { complete: false, nextCursor: expect.any(String) },
      items: page.items,
    });

    const continued = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["raw"],
        jsonView: {
          kind: "query",
          sourcePath: ["items"],
          select: ["id", "status"],
          where: [{ field: "status", operator: "eq", value: "active" }],
          cursor: page.page.nextCursor,
        },
      },
      fixture.manifests,
      readOptions(fixture, {
        jsonTokenProjector: new AgentTokenProjector("gpt-4o"),
        jsonTokenLimit: 700,
      }),
    );
    const nextPage = JSON.parse(continued.artifacts.item[0]!.memories.item[0]!.content) as {
      items: Array<{ id: number }>;
    };
    expect(nextPage.items[0]!.id).toBeGreaterThan(page.items.at(-1)!.id as number);
  });
});

async function createFixture(content: string): Promise<{
  workspaceRoot: string;
  artifactRoot: string;
  manifests: ReadonlyMap<string, ArtifactManifestRecord>;
}> {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-memory-paging");
  temporaryDirectories.push(workspaceRoot);
  const artifactRoot = path.join(workspaceRoot, "artifacts");
  const artifactDir = path.join(artifactRoot, ArtifactId);
  const projectionPath = path.join(artifactDir, "projection.md");
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(projectionPath, content, "utf8");
  const projectionStat = await fs.stat(projectionPath);
  return {
    workspaceRoot,
    artifactRoot,
    manifests: new Map([
      [
        ArtifactId,
        {
          schemaVersion: 3,
          artifactId: ArtifactId,
          artifactUri: ArtifactUri,
          files: { projection: projectionPath },
          contents: [
            {
              ref: "projection",
              mediaType: "text/markdown",
              byteLength: projectionStat.size,
              sha256: await hashFile(projectionPath),
            },
          ],
        },
      ],
    ]),
  };
}

async function readPage(fixture: Awaited<ReturnType<typeof createFixture>>, startByte: number, maxBytes: number) {
  const result = await readArtifactMemories(
    { artifactUris: [ArtifactUri], refs: ["projection"], startBytePerRef: startByte },
    fixture.manifests,
    {
      workspaceRoot: fixture.workspaceRoot,
      artifactRoot: fixture.artifactRoot,
      maxBytes,
      startByte,
      ...DefaultReadLimits,
    },
  );
  return result.artifacts.item[0]!.memories.item[0]!;
}

function readOptions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<AgentArtifactMemoryReadOptions> = {},
): AgentArtifactMemoryReadOptions {
  return {
    workspaceRoot: fixture.workspaceRoot,
    artifactRoot: fixture.artifactRoot,
    maxBytes: 1024,
    startByte: 0,
    ...DefaultReadLimits,
    ...overrides,
  };
}

async function createManifestMap(
  artifactRoot: string,
  files: Record<string, string>,
): Promise<ReadonlyMap<string, ArtifactManifestRecord>> {
  const workspaceRoot = path.dirname(artifactRoot);
  const writer = new AgentArtifactFileWriter(workspaceRoot);
  const contents = await Promise.all(
    ReadableArtifactRefs.flatMap((ref) => {
      const definition = ReadableArtifactRefDefinitions[ref];
      const filePath = files[definition.file];
      return filePath ? [createManifestContent(writer, ref, filePath, definition)] : [];
    }),
  );
  return new Map([
    [
      ArtifactId,
      {
        schemaVersion: 3,
        artifactId: ArtifactId,
        artifactUri: ArtifactUri,
        files,
        contents,
      },
    ],
  ]);
}

async function createManifestContent(
  writer: AgentArtifactFileWriter,
  ref: ReadableArtifactRef,
  filePath: string,
  definition: (typeof ReadableArtifactRefDefinitions)[ReadableArtifactRef],
) {
  const stat = await fs.stat(filePath);
  const structure =
    definition.format === "json"
      ? await (async () => {
          const structurePath = artifactJsonStructurePath(filePath);
          await writer.copyFileWithTransform(filePath, structurePath, createArtifactJsonStructureTransform());
          const structureStat = await fs.stat(structurePath);
          return {
            file: structurePath,
            mediaType: "application/x-ndjson" as const,
            byteLength: structureStat.size,
            sha256: await hashFile(structurePath),
          };
        })()
      : undefined;
  return {
    ref,
    mediaType: definition.mediaType,
    byteLength: stat.size,
    sha256: await hashFile(filePath),
    ...(structure ? { structure } : {}),
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
