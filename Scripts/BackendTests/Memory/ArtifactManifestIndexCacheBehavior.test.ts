import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentArtifactManifestIndexCache } from "../../../Source/AgentSystem/Memory/AgentArtifactManifestIndexCache.js";
import { AgentArtifactMemoryContentCache } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryContentCache.js";
import { AgentArtifactMemoryContentCacheRegistry } from "../../../Source/AgentSystem/Memory/AgentArtifactMemoryContentCacheRegistry.js";
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

  test("coalesces concurrent immutable artifact content reads", async () => {
    const cache = new AgentArtifactMemoryContentCache({ maxBytes: 1024, maxEntries: 8 });
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { content: "hydrated", byteLength: 8 };
    };

    const [first, second] = await Promise.all([cache.load("artifact-ref", loader), cache.load("artifact-ref", loader)]);
    const third = await cache.load("artifact-ref", loader);

    expect(first).toEqual({ content: "hydrated", byteLength: 8 });
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(loads).toBe(1);
  });

  test("evicts least-recently-used content by retained byte budget", async () => {
    const cache = new AgentArtifactMemoryContentCache({ maxBytes: 10, maxEntries: 8 });
    const loads = new Map<string, number>();
    const load = (key: string, content: string) =>
      cache.load(key, async () => {
        loads.set(key, (loads.get(key) ?? 0) + 1);
        return { content, byteLength: Buffer.byteLength(content) };
      });

    await load("first", "123456");
    await load("second", "abcdef");
    await load("second", "abcdef");
    await load("first", "123456");

    expect(loads).toEqual(
      new Map([
        ["first", 2],
        ["second", 1],
      ]),
    );
  });

  test("does not retain one item larger than the entire byte budget", async () => {
    const cache = new AgentArtifactMemoryContentCache({ maxBytes: 4, maxEntries: 8 });
    let loads = 0;
    const load = () =>
      cache.load("oversized", async () => {
        loads += 1;
        return { content: "oversized", byteLength: 9 };
      });

    await load();
    await load();

    expect(loads).toBe(2);
  });

  test("isolates caches by workspace and replaces them when configured limits change", () => {
    const registry = new AgentArtifactMemoryContentCacheRegistry(2);
    const limits = { maxBytes: 1024, maxEntries: 8 };
    const first = registry.get("workspace-a", limits);

    expect(registry.get("workspace-a", limits)).toBe(first);
    expect(registry.get("workspace-b", limits)).not.toBe(first);
    expect(registry.get("workspace-a", { ...limits, maxBytes: 2048 })).not.toBe(first);
  });

  test("resolves artifact memory cache limits through the shared defaults catalog", () => {
    const defaults = resolveArtifactsConfig({} as AgentSystemConfig);
    expect(defaults).toMatchObject({
      MemoryReadStructuredJsonMaxBytes: 8388608,
      MemoryReadMaxArtifacts: 16,
      MemoryReadMaxRefs: 8,
      MemoryReadMaxConcurrency: 4,
      MemoryReadCacheMaxBytes: 134217728,
      MemoryReadCacheMaxEntries: 64,
    });

    expect(
      resolveArtifactsConfig({
        Artifacts: { MemoryReadCacheMaxBytes: 4096, MemoryReadCacheMaxEntries: 3 },
      } as AgentSystemConfig),
    ).toMatchObject({ MemoryReadCacheMaxBytes: 4096, MemoryReadCacheMaxEntries: 3 });
  });
});

async function writeManifest(root: string, directory: string, artifactId: string): Promise<void> {
  const target = path.join(root, directory);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "manifest.json"),
    JSON.stringify({
      artifactId,
      artifactUri: `senera://artifact/${artifactId}`,
      files: {},
    }),
  );
}
