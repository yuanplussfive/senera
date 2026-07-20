import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readArtifactMemories,
  type AgentArtifactMemoryReadOptions,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryReader.js";
import {
  ArtifactMemoryReadArgumentsSchema,
  type ArtifactManifestRecord,
} from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const ArtifactId = "art_0123456789abcdef01234567";
const ArtifactUri = `senera://artifact/${ArtifactId}`;
const DefaultReadLimits = {
  structuredJsonMaxBytes: 8 * 1024 * 1024,
  maxArtifacts: 16,
  maxRefs: 8,
  maxConcurrency: 4,
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
    expect(result.guidance).toContain("unavailable, too_large, and failed are terminal");
  });

  test("supports independent byte ranges for multiple refs", async () => {
    const fixture = await createFixture("projection only");
    const evidencePath = path.join(fixture.artifactRoot, ArtifactId, "evidence.json");
    await fs.writeFile(evidencePath, '{"value":"evidence"}', "utf8");
    fixture.manifests = new Map([
      [
        ArtifactId,
        {
          artifactId: ArtifactId,
          artifactUri: ArtifactUri,
          files: { projection: path.join(fixture.artifactRoot, ArtifactId, "projection.md"), evidence: evidencePath },
        },
      ],
    ]);

    const result = await readArtifactMemories(
      {
        artifactUris: [ArtifactUri],
        refs: ["projection", "evidence"],
        refRanges: [
          { ref: "projection", maxBytes: 4, startByte: 0 },
          { ref: "evidence", maxBytes: 8, startByte: 2 },
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
        ref: "evidence",
        content: '  "value',
        range: expect.objectContaining({ startByte: 2, nextStartByte: 10 }),
      }),
    ]);
  });

  test("rejects oversized structured JSON before opening the source and directs raw reads to rawBlob", async () => {
    const fixture = await createFixture("projection");
    const rawPath = path.join(fixture.artifactRoot, ArtifactId, "raw.json");
    await fs.writeFile(rawPath, JSON.stringify({ value: "x".repeat(4096) }), "utf8");
    fixture.manifests = createManifestMap(fixture.artifactRoot, { raw: rawPath });
    const open = vi.spyOn(fs, "open");

    const oversized = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["raw"] },
      fixture.manifests,
      readOptions(fixture, { structuredJsonMaxBytes: 1024 }),
    );

    expect(oversized.artifacts.item[0]).toMatchObject({
      status: "found",
      memoryCount: 0,
      oversizedRefCount: 1,
      failedRefCount: 0,
      refResults: {
        item: [
          {
            ref: "raw",
            status: "too_large",
            sourceByteLength: expect.any(Number),
            structuredJsonMaxBytes: 1024,
            alternativeRef: "rawBlob",
          },
        ],
      },
    });
    expect(open).not.toHaveBeenCalled();

    open.mockRestore();
    const ranged = await readArtifactMemories(
      { artifactUris: [ArtifactUri], refs: ["rawBlob"] },
      fixture.manifests,
      readOptions(fixture, { maxBytes: 32, structuredJsonMaxBytes: 1024 }),
    );
    expect(ranged.artifacts.item[0]?.memories.item[0]).toMatchObject({
      ref: "rawBlob",
      range: { complete: false, nextStartByte: expect.any(Number), returnedBytes: 32 },
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
  return {
    workspaceRoot,
    artifactRoot,
    manifests: new Map([
      [
        ArtifactId,
        {
          artifactId: ArtifactId,
          artifactUri: ArtifactUri,
          files: { projection: projectionPath },
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

function createManifestMap(
  artifactRoot: string,
  files: Record<string, string>,
): ReadonlyMap<string, ArtifactManifestRecord> {
  return new Map([
    [
      ArtifactId,
      {
        artifactId: ArtifactId,
        artifactUri: ArtifactUri,
        files,
      },
    ],
  ]);
}
