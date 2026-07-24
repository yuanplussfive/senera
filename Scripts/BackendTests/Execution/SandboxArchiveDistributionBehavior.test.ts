import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { buildSandboxImageArchive } from "../../../Build/BuildSandboxImageArchive.js";
import type { MicrosandboxDistributionRuntime } from "../../../Build/MicrosandboxDistributionRuntime.js";
import { installAgentSandboxReleaseArchive } from "../../../Source/AgentSystem/Sandbox/AgentSandboxArchiveInstaller.js";
import {
  resolveAgentSandboxReleaseLocation,
  type AgentSandboxDistributionContract,
} from "../../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import type { AgentMicrosandboxImageArchiveLoader } from "../../../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

const ArchiveContents = Buffer.from("verified-oci-image-archive");

describe("sandbox OCI image archive distribution", () => {
  test("downloads, verifies, imports, and then reuses one release archive without registry fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-archive-install-"));
    const contract = distributionContract();
    const location = resolveAgentSandboxReleaseLocation(contract, "1.2.3", "x64");
    const manifest = archiveManifest(contract, "1.2.3");
    const requestedUrls: string[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === location.manifestUrl) {
        const content = JSON.stringify(manifest);
        return new Response(content, {
          status: 200,
          headers: { "content-length": String(Buffer.byteLength(content)) },
        });
      }
      if (url === location.archiveUrl) {
        return new Response(ArchiveContents, {
          status: 200,
          headers: { "content-length": String(ArchiveContents.byteLength) },
        });
      }
      throw new Error(`Unexpected distribution URL: ${url}`);
    }) as typeof fetch;
    const loadArchive = vi.fn(async () => undefined);
    const imageArchive = createImageArchiveApi(loadArchive);
    const stages: string[] = [];

    try {
      const first = await installAgentSandboxReleaseArchive({
        baseDir: root,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        fetch: fetchImplementation,
        imageArchive,
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(first.imported).toBe(true);
      expect(requestedUrls).toEqual([location.manifestUrl, location.archiveUrl]);
      expect(loadArchive).toHaveBeenCalledWith({
        baseDir: root,
        archivePath: first.archivePath,
        reference: location.target.runtimeImage,
      });
      expect(stages).toEqual(["resolving_archive", "downloading_archive", "verifying_archive", "importing_image"]);

      requestedUrls.length = 0;
      stages.length = 0;
      loadArchive.mockClear();
      const second = await installAgentSandboxReleaseArchive({
        baseDir: root,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        fetch: fetchImplementation,
        imageArchive,
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(second.imported).toBe(false);
      expect(requestedUrls).toEqual([]);
      expect(loadArchive).not.toHaveBeenCalled();
      expect(stages).toEqual(["resolving_archive", "verifying_archive"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("publishes only an OCI archive that starts after its source cache has been removed", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-archive-build-"));
    const contract = distributionContract();
    const savedImages: string[] = [];
    const loadedImages: string[] = [];
    const preparedImages: Array<{ reference: string; pullPolicy: string }> = [];
    const runtime = createBuildRuntime({ savedImages, loadedImages, preparedImages, requireCleanImport: true });
    try {
      const result = await buildSandboxImageArchive({
        workspaceRoot: process.cwd(),
        outputRoot,
        productVersion: "1.2.3",
        architecture: "x64",
        contract,
        runtime,
      });
      expect(await readFile(result.archivePath)).toEqual(ArchiveContents);
      expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toEqual(result.manifest);
      expect(result.manifest).toMatchObject({
        formatVersion: 3,
        distributionId: contract.id,
        productVersion: "1.2.3",
        sourceImage: contract.targets.x64?.sourceImage,
        runtimeImage: contract.targets.x64?.runtimeImage,
        asset: {
          format: "oci",
          mediaType: "application/vnd.oci.image.layout.v1.tar",
          sizeBytes: ArchiveContents.byteLength,
          sha256: createHash("sha256").update(ArchiveContents).digest("hex"),
        },
      });
      expect(savedImages).toEqual([contract.targets.x64?.sourceImage]);
      expect(loadedImages).toEqual([contract.targets.x64?.runtimeImage]);
      expect(preparedImages).toEqual([
        { reference: contract.targets.x64?.sourceImage, pullPolicy: "if-missing" },
        { reference: contract.targets.x64?.runtimeImage, pullPolicy: "never" },
      ]);
      await expect(
        buildSandboxImageArchive({
          workspaceRoot: process.cwd(),
          outputRoot,
          productVersion: "1.2.3",
          architecture: "x64",
          contract,
          runtime,
        }),
      ).rejects.toThrow("Sandbox release output already exists");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("does not publish an archive that fails clean-runtime load verification", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-archive-rejected-"));
    const contract = distributionContract();
    const location = resolveAgentSandboxReleaseLocation(contract, "1.2.3", "x64");
    try {
      await expect(
        buildSandboxImageArchive({
          workspaceRoot: process.cwd(),
          outputRoot,
          productVersion: "1.2.3",
          architecture: "x64",
          contract,
          runtime: createBuildRuntime({ loadError: new Error("OCI archive import failed") }),
        }),
      ).rejects.toThrow("OCI archive import failed");
      await expect(readFile(path.join(outputRoot, location.target.archive.assetName))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(path.join(outputRoot, contract.release.manifestAssetName))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

function distributionContract(): AgentSandboxDistributionContract {
  return {
    formatVersion: 3,
    id: "senera-test-runtime",
    archiveVersion: "1.0.2",
    microsandboxVersion: "0.6.4",
    targets: {
      x64: {
        sourceImage: "docker.io/library/node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27",
        runtimeImage: "senera.local/senera-test-runtime:1.0.2-x64",
        probe: { command: "node", arguments: ["--version"] },
        archive: {
          format: "oci",
          mediaType: "application/vnd.oci.image.layout.v1.tar",
          assetName: "SeneraSandboxImage-1.0.2-x64.oci.tar",
        },
      },
    },
    release: {
      repositoryUrl: "https://example.test/senera",
      tagTemplate: "v{productVersion}",
      manifestAssetName: "SeneraSandboxImageManifest.json",
    },
    downloadPolicy: {
      requestTimeoutMs: 30_000,
      manifestMaxBytes: 65_536,
      archiveMaxBytes: 1_048_576,
    },
  };
}

function archiveManifest(contract: AgentSandboxDistributionContract, productVersion: string) {
  const location = resolveAgentSandboxReleaseLocation(contract, productVersion, "x64");
  return {
    formatVersion: 3 as const,
    distributionId: contract.id,
    archiveVersion: contract.archiveVersion,
    productVersion,
    microsandboxVersion: contract.microsandboxVersion,
    target: location.targetId,
    sourceImage: location.target.sourceImage,
    runtimeImage: location.target.runtimeImage,
    asset: {
      format: location.target.archive.format,
      mediaType: location.target.archive.mediaType,
      fileName: location.target.archive.assetName,
      url: location.archiveUrl,
      sizeBytes: ArchiveContents.byteLength,
      sha256: createHash("sha256").update(ArchiveContents).digest("hex"),
    },
  };
}

function createBuildRuntime(
  options: {
    loadError?: Error;
    savedImages?: string[];
    loadedImages?: string[];
    preparedImages?: Array<{ reference: string; pullPolicy: string }>;
    requireCleanImport?: boolean;
  } = {},
): MicrosandboxDistributionRuntime {
  let sourceRuntimeRoot: string | undefined;
  return {
    prepareImage: async ({ baseDir, reference, pullPolicy }) => {
      sourceRuntimeRoot ??= baseDir;
      options.preparedImages?.push({ reference, pullPolicy });
    },
    saveOciImage: async ({ baseDir, reference, outputPath }) => {
      sourceRuntimeRoot = baseDir;
      options.savedImages?.push(reference);
      await writeFile(outputPath, ArchiveContents);
    },
    loadOciImage: async ({ reference }) => {
      if (options.requireCleanImport && sourceRuntimeRoot && (await pathExists(sourceRuntimeRoot))) {
        throw new Error("source runtime still exists during clean archive verification");
      }
      options.loadedImages?.push(reference);
      if (options.loadError) throw options.loadError;
    },
  };
}

function createImageArchiveApi(load: AgentMicrosandboxImageArchiveLoader["load"]): AgentMicrosandboxImageArchiveLoader {
  return { load };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
