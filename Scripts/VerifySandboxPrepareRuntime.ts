import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareSandboxRuntime, readOptions, type PrepareOptions } from "../Build/PrepareSandboxRuntime.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

class FakeMicrosandboxModule {
  readonly createdImages: string[] = [];
  readonly Sandbox = {
    builder: (name: string) => new FakeSandboxBuilder(name, this.createdImages, this.runtimeAvailable),
  };

  constructor(private readonly runtimeAvailable: boolean) {}
}

class FakeSandboxBuilder {
  private selectedImage = "";

  constructor(
    readonly name: string,
    private readonly createdImages: string[],
    private readonly runtimeAvailable: boolean,
  ) {}

  image(image: string): this {
    this.selectedImage = image;
    return this;
  }

  pullPolicy(_policy: string): this {
    return this;
  }

  registry(): this {
    return this;
  }

  cpus(_value: number): this {
    return this;
  }

  memory(_value: number): this {
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

  maxDuration(_seconds: number): this {
    return this;
  }

  async create(): Promise<FakeSandbox> {
    if (!this.runtimeAvailable) throw new Error("official microsandbox runtime unavailable");
    assert.match(this.name, /^senera-sandbox-prepare-/);
    assert.ok(this.selectedImage);
    this.createdImages.push(this.selectedImage);
    return new FakeSandbox(this.name);
  }

  async createWithPullProgress() {
    const sandbox = await this.create();
    return {
      awaitSandbox: async () => sandbox,
      async *[Symbol.asyncIterator]() {
        yield { kind: "complete" as const, reference: "test-image" };
      },
    };
  }
}

class FakeSandbox {
  constructor(readonly name: string) {}
  async stopWithTimeout(_timeoutMs: number): Promise<void> {}
  async kill(): Promise<void> {}
}

assert.deepEqual(readOptions([]), {
  baseDir: undefined,
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-prepare-"));
try {
  const preparedTerminalRuntimeRoots: string[] = [];
  const prepareTerminalRuntime = async (options: { sandboxRuntimeBaseDir: string }) => {
    preparedTerminalRuntimeRoots.push(options.sandboxRuntimeBaseDir);
    return { runtimeRoot: options.sandboxRuntimeBaseDir, prepared: true, fingerprint: "verify" };
  };
  const available = new FakeMicrosandboxModule(true);
  const availableOptions = prepareOptionsFixture(tempRoot, "available");
  const sandboxTarget = resolveAgentSandboxDistributionTarget(readAgentSandboxDistributionContract());
  const archiveInstaller = async () => ({
    archivePath: path.join(tempRoot, "SandboxImage", sandboxTarget.archive.assetName),
    imported: true,
    manifest: {
      formatVersion: 4 as const,
      distributionId: "senera-node-runtime",
      archiveVersion: "1.0.2",
      microsandboxVersion: "0.6.4",
      target: process.arch,
      sourceImage: sandboxTarget.sourceImage,
      runtimeImage: sandboxTarget.runtimeImage,
      asset: {
        format: sandboxTarget.archive.format,
        mediaType: sandboxTarget.archive.mediaType,
        compression: sandboxTarget.archive.compression,
        compressedMediaType: sandboxTarget.archive.compressedMediaType,
        fileName: sandboxTarget.archive.assetName,
        sizeBytes: 1,
        uncompressedSizeBytes: 1,
        sha256: "0".repeat(64),
      },
    },
  });
  await prepareSandboxRuntime(availableOptions, available, prepareTerminalRuntime, archiveInstaller);
  assert.deepEqual(available.createdImages, [sandboxTarget.runtimeImage]);

  const missing = new FakeMicrosandboxModule(false);
  const missingOptions = prepareOptionsFixture(tempRoot, "missing");
  await assert.rejects(() => prepareSandboxRuntime(missingOptions, missing, prepareTerminalRuntime, archiveInstaller), {
    message: /official microsandbox runtime unavailable/u,
  });
  assert.deepEqual(missing.createdImages, []);
  assert.deepEqual(preparedTerminalRuntimeRoots, [availableOptions.baseDir]);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Sandbox prepare runtime verification passed.");

function prepareOptionsFixture(root: string, name: string): PrepareOptions {
  const baseDir = path.join(root, name, "runtime");
  return {
    baseDir,
  };
}
