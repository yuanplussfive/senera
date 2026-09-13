import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentArtifactManifestIndexCache } from "../../../Source/AgentSystem/Memory/AgentArtifactManifestIndexCache.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Artifact manifest index cache", () => {
  test("requires a positive bounded root capacity", () => {
    expect(() => new AgentArtifactManifestIndexCache(0)).toThrow("maxRoots must be a positive safe integer");
    expect(() => new AgentArtifactManifestIndexCache(Number.POSITIVE_INFINITY)).toThrow(
      "maxRoots must be a positive safe integer",
    );
  });

  test("reuses a complete index and refreshes when a requested artifact is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-"));
    temporaryRoots.push(root);
    const cache = new AgentArtifactManifestIndexCache();
    const firstId = "art_0123456789abcdef01234567";
    const secondId = "art_89abcdef0123456701234567";
    await writeManifest(root, "first", firstId);

    const first = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [firstId] });
    const reused = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [firstId] });
    expect(reused).toBe(first);

    await writeManifest(root, "second", secondId);
    const refreshed = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [secondId] });
    expect(refreshed).not.toBe(first);
    expect([...refreshed.keys()]).toEqual(expect.arrayContaining([firstId, secondId]));
  });

  test("invalidates a complete index when a cached manifest is edited or removed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-invalidation-"));
    temporaryRoots.push(root);
    const cache = new AgentArtifactManifestIndexCache();
    const artifactId = "art_0123456789abcdef01234567";
    const manifestPath = path.join(root, "artifact", "manifest.json");
    await writeManifest(root, "artifact", artifactId, { schemaVersion: 3, marker: "before" });

    const before = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [artifactId] });
    expect(before.get(artifactId)).toMatchObject({ marker: "before" });

    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 3,
        marker: "after",
        artifactId,
        artifactUri: `senera://artifact/${artifactId}`,
        files: {},
      }),
    );
    const after = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [artifactId] });
    expect(after).not.toBe(before);
    expect(after.get(artifactId)).toMatchObject({ marker: "after" });

    await fs.rm(manifestPath);
    const removed = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [artifactId] });
    expect(removed.has(artifactId)).toBe(false);
  });

  test("does not share an index across different workspace boundaries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-boundary-"));
    temporaryRoots.push(root);
    const cache = new AgentArtifactManifestIndexCache();
    const artifactRoot = path.join(root, "workspace", "artifacts");
    const workspaceRoot = path.join(root, "workspace");
    const artifactId = "art_0123456789abcdef01234567";
    await writeManifest(artifactRoot, "artifact", artifactId);

    const first = await cache.load({ artifactRoot, workspaceRoot, requiredArtifactIds: [artifactId] });
    const second = await cache.load({ artifactRoot, workspaceRoot: root, requiredArtifactIds: [artifactId] });

    expect(second).not.toBe(first);
    expect(second.get(artifactId)?.artifactId).toBe(artifactId);
  });

  test("skips malformed manifests and discovers them after repair", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-malformed-"));
    temporaryRoots.push(root);
    const cache = new AgentArtifactManifestIndexCache();
    const artifactId = "art_0123456789abcdef01234567";
    const directory = path.join(root, "artifact");
    const manifestPath = path.join(directory, "manifest.json");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(manifestPath, "{ malformed", "utf8");

    const skipped = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [] });
    expect(skipped.has(artifactId)).toBe(false);

    await writeManifest(root, "artifact", artifactId);
    const repaired = await cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [] });
    expect(repaired.get(artifactId)?.artifactId).toBe(artifactId);
  });

  test("rejects duplicate Artifact IDs instead of selecting by directory order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-duplicate-"));
    temporaryRoots.push(root);
    const cache = new AgentArtifactManifestIndexCache();
    const artifactId = "art_0123456789abcdef01234567";
    await writeManifest(root, "first", artifactId);
    await writeManifest(root, "second", artifactId);

    await expect(cache.load({ artifactRoot: root, workspaceRoot: root, requiredArtifactIds: [] })).rejects.toThrow(
      `Duplicate Artifact manifest for ${artifactId}`,
    );
  });

  test("resolves artifact read request and concurrency limits through the shared defaults catalog", () => {
    const defaults = resolveArtifactsConfig({} as AgentSystemConfig);
    expect(defaults).toMatchObject({
      MemoryReadMaxArtifacts: 16,
      MemoryReadMaxRefs: 8,
      MemoryReadMaxConcurrency: 4,
    });
  });

  test.each([
    { label: "without version metadata", metadata: {} },
    {
      label: "with newer version metadata and an unknown capability",
      metadata: {
        schemaVersion: 99,
        futureMetadata: { writer: "future-runtime" },
        contents: [
          {
            ref: "futureProjection",
            mediaType: "application/json",
            byteLength: 1,
            sha256: "0".repeat(64),
          },
          {
            ref: "raw",
            mediaType: "application/json",
            byteLength: 2,
            sha256: "1".repeat(64),
            futureContentMetadata: true,
          },
        ],
      },
    },
  ])("indexes a capability-compatible manifest $label", async ({ metadata }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-artifact-index-compatible-"));
    temporaryRoots.push(root);
    const artifactId = "art_0123456789abcdef01234567";
    await writeManifest(root, "compatible", artifactId, metadata);

    const index = await new AgentArtifactManifestIndexCache().load({
      artifactRoot: root,
      workspaceRoot: root,
      requiredArtifactIds: [artifactId],
    });

    expect(index.get(artifactId)).toMatchObject({
      artifactId,
      artifactUri: `senera://artifact/${artifactId}`,
    });
    if ("contents" in metadata) {
      expect(index.get(artifactId)?.contents).toEqual([
        expect.objectContaining({ ref: "raw", futureContentMetadata: true }),
      ]);
    }
  });
});

async function writeManifest(
  root: string,
  directory: string,
  artifactId: string,
  metadata: Readonly<Record<string, unknown>> = { schemaVersion: 3 },
): Promise<void> {
  const target = path.join(root, directory);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "manifest.json"),
    JSON.stringify({
      ...metadata,
      artifactId,
      artifactUri: `senera://artifact/${artifactId}`,
      files: {},
    }),
  );
}
