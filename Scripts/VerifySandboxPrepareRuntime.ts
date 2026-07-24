import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareSandboxRuntime, readOptions, type PrepareOptions } from "../Build/PrepareSandboxRuntime.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";

class FakeMicrosandboxModule {
  readonly createdImages: string[] = [];
  readonly Snapshot = {
    import: async (_archive: string): Promise<void> => {},
    export: async (_nameOrPath: string, _out: string): Promise<void> => {},
  };
  readonly Sandbox = {
    builder: (name: string) => new FakeSandboxBuilder(name, this.createdImages, this.runtimeAvailable),
    get: async (_name: string) => ({
      snapshotTo: async (_path: string): Promise<void> => {},
    }),
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
  exportBundlePath: undefined,
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
  await prepareSandboxRuntime(availableOptions, available, prepareTerminalRuntime);
  assert.deepEqual(available.createdImages, [SeneraMicrosandboxDefaults.image]);

  const missing = new FakeMicrosandboxModule(false);
  const missingOptions = prepareOptionsFixture(tempRoot, "missing");
  await assert.rejects(() => prepareSandboxRuntime(missingOptions, missing, prepareTerminalRuntime), {
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
    exportBundlePath: undefined,
  };
}
