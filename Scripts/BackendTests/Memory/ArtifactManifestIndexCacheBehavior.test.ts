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
