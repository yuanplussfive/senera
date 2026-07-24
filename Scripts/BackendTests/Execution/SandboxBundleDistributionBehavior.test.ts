import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { buildSandboxBundle } from "../../../Build/BuildSandboxBundle.js";
import { installAgentSandboxReleaseBundle } from "../../../Source/AgentSystem/Sandbox/AgentSandboxBundleInstaller.js";
import {
  resolveAgentSandboxReleaseLocation,
  type AgentSandboxDistributionContract,
} from "../../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import type {
  MicrosandboxModule,
  MicrosandboxRegistryConfigBuilder,
} from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";

const BundleContents = Buffer.from("verified-sandbox-bundle");

describe("sandbox bundle distribution", () => {
  test("downloads, verifies, imports, and then reuses one release bundle without network fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-install-"));
    const contract = distributionContract();
    const location = resolveAgentSandboxReleaseLocation(contract, "1.2.3", "x64");
    const manifest = bundleManifest(contract, "1.2.3");
    const requestedUrls: string[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === location.manifestUrl) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "content-length": String(Buffer.byteLength(JSON.stringify(manifest))) },
        });
      }
      if (url === location.bundleUrl) {
        return new Response(BundleContents, {
          status: 200,
          headers: { "content-length": String(BundleContents.byteLength) },
        });
      }
      throw new Error(`Unexpected distribution URL: ${url}`);
    }) as typeof fetch;
    const importSnapshot = vi.fn(async () => undefined);
    const stages: string[] = [];

    try {
      const first = await installAgentSandboxReleaseBundle({
        baseDir: root,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        fetch: fetchImplementation,
        snapshot: { import: importSnapshot },
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(first.imported).toBe(true);
      expect(requestedUrls).toEqual([location.manifestUrl, location.bundleUrl]);
      expect(importSnapshot).toHaveBeenCalledTimes(1);
      expect(stages).toEqual(["resolving_bundle", "downloading_bundle", "verifying_bundle", "importing_bundle"]);

      requestedUrls.length = 0;
      stages.length = 0;
      importSnapshot.mockClear();
      const second = await installAgentSandboxReleaseBundle({
        baseDir: root,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        fetch: fetchImplementation,
        snapshot: { import: importSnapshot },
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(second.imported).toBe(false);
      expect(requestedUrls).toEqual([]);
      expect(importSnapshot).not.toHaveBeenCalled();
      expect(stages).toEqual(["resolving_bundle", "verifying_bundle"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("builds a strict manifest and content-addressed bundle from the declared OCI image", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-build-"));
    const contract = distributionContract();
    const microsandbox = createBuildMicrosandbox();
    try {
      const result = await buildSandboxBundle({
        workspaceRoot: process.cwd(),
        outputRoot,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        microsandbox,
      });
      expect(await readFile(result.bundlePath)).toEqual(BundleContents);
      expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toEqual(result.manifest);
      expect(result.manifest).toMatchObject({
        distributionId: contract.id,
        productVersion: "1.2.3",
        sourceImage: contract.targets.x64?.sourceImage,
        asset: {
          sizeBytes: BundleContents.byteLength,
          sha256: createHash("sha256").update(BundleContents).digest("hex"),
        },
      });
      await expect(
        buildSandboxBundle({
          workspaceRoot: process.cwd(),
          outputRoot,
          productVersion: "1.2.3",
          architecture: "x64",
          contract,
          microsandbox,
        }),
      ).rejects.toThrow("Sandbox release output already exists");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

function distributionContract(): AgentSandboxDistributionContract {
  return {
    formatVersion: 1,
    id: "senera-test-runtime",
    bundleVersion: "1.0.0",
    microsandboxVersion: "0.6.4",
    targets: {
      x64: {
        sourceImage: "docker.io/library/node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27",
        bundleAssetName: "SeneraSandboxBundle-1.0.0-x64.tar.zst",
      },
    },
    release: {
      repositoryUrl: "https://example.test/senera",
      tagTemplate: "v{productVersion}",
      manifestAssetName: "SeneraSandboxBundleManifest.json",
    },
    downloadPolicy: {
      requestTimeoutMs: 30_000,
      manifestMaxBytes: 65_536,
      bundleMaxBytes: 1_048_576,
    },
  };
}

function bundleManifest(contract: AgentSandboxDistributionContract, productVersion: string) {
  const location = resolveAgentSandboxReleaseLocation(contract, productVersion, "x64");
  return {
    formatVersion: 1 as const,
    distributionId: contract.id,
    bundleVersion: contract.bundleVersion,
    productVersion,
    microsandboxVersion: contract.microsandboxVersion,
    target: location.targetId,
    sourceImage: location.target.sourceImage,
    asset: {
      fileName: location.target.bundleAssetName,
      url: location.bundleUrl,
      sizeBytes: BundleContents.byteLength,
      sha256: createHash("sha256").update(BundleContents).digest("hex"),
    },
  };
}

function createBuildMicrosandbox(): MicrosandboxModule {
  return {
    Snapshot: {
      import: async () => undefined,
      export: async (_snapshotPath, outputPath) => writeFile(outputPath, BundleContents),
    },
    Sandbox: {
      builder: (name) => new BuildSandboxBuilder(name),
      get: async () => ({ snapshotTo: async () => undefined }),
    },
  };
}

class BuildSandboxBuilder {
  constructor(readonly name: string) {}

  image(): this {
    return this;
  }

  registry(configure: (registry: MicrosandboxRegistryConfigBuilder) => MicrosandboxRegistryConfigBuilder): this {
    configure(new NoopRegistryBuilder());
    return this;
  }

  pullPolicy(): this {
    return this;
  }

  cpus(): this {
    return this;
  }

  memory(): this {
    return this;
  }

  replace(): this {
    return this;
  }

  quietLogs(): this {
    return this;
  }

  disableMetricsSample(): this {
    return this;
  }

  disableNetwork(): this {
    return this;
  }

  maxDuration(): this {
    return this;
  }

  async create() {
    return this.sandbox();
  }

  async createWithPullProgress() {
    const sandbox = this.sandbox();
    return {
      awaitSandbox: async () => sandbox,
      async *[Symbol.asyncIterator]() {
        yield { kind: "complete" as const, reference: "test" };
      },
    };
  }

  private sandbox() {
    return {
      name: this.name,
      stopWithTimeout: async () => undefined,
      kill: async () => undefined,
    };
  }
}

class NoopRegistryBuilder implements MicrosandboxRegistryConfigBuilder {
  auth(): this {
    return this;
  }

  insecure(): this {
    return this;
  }

  caCerts(): this {
    return this;
  }
}
