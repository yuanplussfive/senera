import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";
import { buildSandboxImageArchive } from "../../../Build/BuildSandboxImageArchive.js";
import type { MicrosandboxDistributionRuntime } from "../../../Build/MicrosandboxDistributionRuntime.js";
import { installAgentSandboxBundle } from "../../../Source/AgentSystem/Sandbox/AgentSandboxArchiveInstaller.js";
import {
  resolveAgentSandboxBundleLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "../../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import type { AgentMicrosandboxImageArchiveLoader } from "../../../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

const ArchiveContents = Buffer.from("verified-oci-image-archive");

describe("sandbox OCI image Bundle distribution", () => {
  test("verifies and imports one local Bundle without any network source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-install-"));
    const bundleRoot = path.join(root, "bundle");
    const runtimeRoot = path.join(root, "runtime");
    const contract = distributionContract();
    const manifest = archiveManifest(contract);
    await writeBundle(bundleRoot, contract, manifest);
    const loadArchive = vi.fn(async () => undefined);
    const imageArchive = createImageArchiveApi(loadArchive);
    const stages: string[] = [];

    try {
      const first = await installAgentSandboxBundle({
        baseDir: runtimeRoot,
        bundleRoot,
        architecture: "x64",
        contract,
        imageArchive,
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(first.imported).toBe(true);
      expect(first.archivePath).toBe(path.join(bundleRoot, manifest.asset.fileName));
      expect(loadArchive).toHaveBeenCalledWith({
        baseDir: runtimeRoot,
        archivePath: first.archivePath,
        reference: contract.targets.x64?.runtimeImage,
        compression: "gzip",
        expectedUncompressedBytes: ArchiveContents.byteLength,
        maxUncompressedBytes: contract.limits.archiveMaxBytes,
      });
      expect(stages[0]).toBe("resolving_archive");
      expect(stages).toContain("verifying_archive");
      expect(stages.at(-1)).toBe("importing_image");

      stages.length = 0;
      loadArchive.mockClear();
      const second = await installAgentSandboxBundle({
        baseDir: runtimeRoot,
        bundleRoot,
        architecture: "x64",
        contract,
        imageArchive,
        onProgress: ({ stage }) => stages.push(stage),
      });
      expect(second.imported).toBe(false);
      expect(loadArchive).not.toHaveBeenCalled();
      expect(stages[0]).toBe("resolving_archive");
      expect(stages).toContain("verifying_archive");
      expect(stages).not.toContain("downloading_archive");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a corrupt local Bundle before image import", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-corrupt-"));
    const contract = distributionContract();
    const manifest = archiveManifest(contract);
    await writeBundle(root, contract, manifest);
    await writeFile(path.join(root, manifest.asset.fileName), Buffer.alloc(manifest.asset.sizeBytes));
    const loadArchive = vi.fn(async () => undefined);
    try {
      await expect(
        installAgentSandboxBundle({
          baseDir: path.join(root, "runtime"),
          bundleRoot: root,
          architecture: "x64",
          contract,
          imageArchive: createImageArchiveApi(loadArchive),
        }),
      ).rejects.toThrow("failed SHA-256 verification");
      expect(loadArchive).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a manifest that exceeds its declared read limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-manifest-limit-"));
    const baseline = distributionContract();
    const contract: AgentSandboxDistributionContract = {
      ...baseline,
      limits: { ...baseline.limits, manifestMaxBytes: 32 },
    };
    const manifest = archiveManifest(contract);
    await writeBundle(root, contract, manifest);
    const loadArchive = vi.fn(async () => undefined);
    try {
      await expect(
        installAgentSandboxBundle({
          baseDir: path.join(root, "runtime"),
          bundleRoot: root,
          architecture: "x64",
          contract,
          imageArchive: createImageArchiveApi(loadArchive),
        }),
      ).rejects.toThrow("Sandbox Bundle manifest size is invalid");
      expect(loadArchive).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("publishes a compressed Bundle that starts after its source cache and raw archive are removed", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-build-"));
    const contract = distributionContract();
    const savedImages: string[] = [];
    const loadedImages: string[] = [];
    const preparedImages: Array<{ reference: string; pullPolicy: string }> = [];
    const runtime = createBuildRuntime({ savedImages, loadedImages, preparedImages, requireCleanImport: true });
    try {
      const result = await buildSandboxImageArchive({
        workspaceRoot: process.cwd(),
        outputRoot,
        architecture: "x64",
        contract,
        runtime,
      });
      expect(gunzipSync(await readFile(result.archivePath))).toEqual(ArchiveContents);
      expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toEqual(result.manifest);
      expect(result.manifest).toMatchObject({
        formatVersion: 4,
        distributionId: contract.id,
        sourceImage: contract.targets.x64?.sourceImage,
        runtimeImage: contract.targets.x64?.runtimeImage,
        asset: {
          format: "oci",
          mediaType: "application/vnd.oci.image.layout.v1.tar",
          compression: "gzip",
          compressedMediaType: "application/gzip",
          uncompressedSizeBytes: ArchiveContents.byteLength,
          sha256: await sha256File(result.archivePath),
        },
      });
      expect("productVersion" in result.manifest).toBe(false);
      expect("url" in result.manifest.asset).toBe(false);
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
          architecture: "x64",
          contract,
          runtime,
        }),
      ).rejects.toThrow("Sandbox Bundle output already exists");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("does not publish a Bundle that fails clean-runtime load verification", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-rejected-"));
    const contract = distributionContract();
    const location = resolveAgentSandboxBundleLocation(contract, "x64");
    try {
      await expect(
        buildSandboxImageArchive({
          workspaceRoot: process.cwd(),
          outputRoot,
          architecture: "x64",
          contract,
          runtime: createBuildRuntime({ loadError: new Error("OCI archive import failed") }),
        }),
      ).rejects.toThrow("OCI archive import failed");
      await expect(readFile(path.join(outputRoot, location.archiveFileName))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(outputRoot, location.manifestFileName))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

function distributionContract(): AgentSandboxDistributionContract {
  return {
    formatVersion: 4,
    id: "senera-test-runtime",
    archiveVersion: "1.0.2",
    microsandboxVersion: "0.6.4",
    hostRequirements: {
      microsandbox: {
        linux: {
          devices: [{ path: "/dev/kvm", access: ["read", "write"] }],
        },
      },
    },
    targets: {
      x64: {
        sourceImage: "docker.io/library/node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27",
        runtimeImage: "senera.local/senera-test-runtime:1.0.2-x64",
        probe: { command: "node", arguments: ["--version"] },
        archive: {
          format: "oci",
          mediaType: "application/vnd.oci.image.layout.v1.tar",
          compression: "gzip",
          compressedMediaType: "application/gzip",
          assetName: "SeneraSandboxImage-1.0.2-x64.oci.tar.gz",
        },
      },
    },
    bundle: { manifestFileName: "SeneraSandboxImageManifest.json" },
    limits: {
      manifestMaxBytes: 65_536,
      bundleMaxBytes: 1_048_576,
      archiveMaxBytes: 1_048_576,
    },
  };
}

function archiveManifest(contract: AgentSandboxDistributionContract): AgentSandboxArchiveManifest {
  const location = resolveAgentSandboxBundleLocation(contract, "x64");
  const bundle = gzipSync(ArchiveContents, { level: 9 });
  return {
    formatVersion: 4,
    distributionId: contract.id,
    archiveVersion: contract.archiveVersion,
    microsandboxVersion: contract.microsandboxVersion,
    target: location.targetId,
    sourceImage: location.target.sourceImage,
    runtimeImage: location.target.runtimeImage,
    asset: {
      format: location.target.archive.format,
      mediaType: location.target.archive.mediaType,
      compression: location.target.archive.compression,
      compressedMediaType: location.target.archive.compressedMediaType,
      fileName: location.archiveFileName,
      sizeBytes: bundle.byteLength,
      uncompressedSizeBytes: ArchiveContents.byteLength,
      sha256: createHash("sha256").update(bundle).digest("hex"),
    },
  };
}

async function writeBundle(
  bundleRoot: string,
  contract: AgentSandboxDistributionContract,
  manifest: AgentSandboxArchiveManifest,
): Promise<void> {
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path.join(bundleRoot, contract.bundle.manifestFileName), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(bundleRoot, manifest.asset.fileName), gzipSync(ArchiveContents, { level: 9 }));
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
  let rawArchivePath: string | undefined;
  return {
    prepareImage: async ({ baseDir, reference, pullPolicy }) => {
      sourceRuntimeRoot ??= baseDir;
      options.preparedImages?.push({ reference, pullPolicy });
    },
    saveOciImage: async ({ baseDir, reference, outputPath }) => {
      sourceRuntimeRoot = baseDir;
      rawArchivePath = outputPath;
      options.savedImages?.push(reference);
      await writeFile(outputPath, ArchiveContents);
    },
    loadOciImage: async ({ archivePath, reference, expectedUncompressedBytes }) => {
      if (
        options.requireCleanImport &&
        ((sourceRuntimeRoot && (await pathExists(sourceRuntimeRoot))) ||
          (rawArchivePath && (await pathExists(rawArchivePath))))
      ) {
        throw new Error("source runtime or raw archive still exists during clean Bundle verification");
      }
      expect(expectedUncompressedBytes).toBe(ArchiveContents.byteLength);
      expect(gunzipSync(await readFile(archivePath))).toEqual(ArchiveContents);
      options.loadedImages?.push(reference);
      if (options.loadError) throw options.loadError;
    },
  };
}

function createImageArchiveApi(load: AgentMicrosandboxImageArchiveLoader["load"]): AgentMicrosandboxImageArchiveLoader {
  return { load };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
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
