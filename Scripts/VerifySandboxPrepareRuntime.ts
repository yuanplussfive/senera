import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverSandboxImages,
  prepareSandboxRuntime,
  readOptions,
  type PrepareOptions,
} from "../Build/PrepareSandboxRuntime.js";
import { resolveAgentSandboxRuntimePaths } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";

interface FakeSetupBuilder {
  baseDir(path: string): FakeSetupBuilder;
  install(): Promise<void>;
}

class FakeMicrosandboxModule {
  installCount = 0;
  readonly createdImages: string[] = [];
  readonly importedBundles: string[] = [];
  runtimeBaseDir = "";
  libkrunfwPath = "";
  readonly Snapshot = {
    import: async (archive: string): Promise<void> => {
      this.importedBundles.push(archive);
    },
    export: async (_nameOrPath: string, _out: string): Promise<void> => {},
  };
  readonly Sandbox = {
    builder: (name: string) => new FakeSandboxBuilder(name, this.createdImages),
    get: async (_name: string) => ({
      snapshotTo: async (_path: string): Promise<void> => {},
    }),
  };

  constructor(private installed: boolean) {}

  isInstalled(): boolean {
    return this.installed;
  }

  async install(): Promise<void> {
    this.installCount += 1;
    this.installed = true;
  }

  setup(): FakeSetupBuilder {
    const builder: FakeSetupBuilder = {
      baseDir: (baseDir: string) => {
        this.runtimeBaseDir = baseDir;
        return builder;
      },
      install: () => this.install(),
    };
    return builder;
  }

  setRuntimeLibkrunfwPath(path: string): void {
    this.libkrunfwPath = path;
  }
}

class FakeSandboxBuilder {
  private selectedImage = "";

  constructor(
    readonly name: string,
    private readonly createdImages: string[],
  ) {}

  image(image: string): this {
    this.selectedImage = image;
    return this;
  }

  pullPolicy(_policy: string): this {
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
    assert.match(this.name, /^senera-sandbox-prepare-/);
    assert.ok(this.selectedImage);
    this.createdImages.push(this.selectedImage);
    return new FakeSandbox(this.name);
  }
}

class FakeSandbox {
  constructor(readonly name: string) {}
  async stopWithTimeout(_timeoutMs: number): Promise<void> {}
  async kill(): Promise<void> {}
}

const images = discoverSandboxImages();
assert.deepEqual(images, []);
assert.deepEqual(readOptions(["--strict"]), {
  strict: true,
  skipImagePull: false,
  importBundles: false,
  baseDir: undefined,
  bundleDir: undefined,
  exportBundlePath: undefined,
});
assert.deepEqual(readOptions(["--skip-image-pull"]), {
  strict: false,
  skipImagePull: true,
  importBundles: false,
  baseDir: undefined,
  bundleDir: undefined,
  exportBundlePath: undefined,
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-prepare-"));
try {
  const preparedTerminalRuntimeRoots: string[] = [];
  const prepareTerminalRuntime = async (options: { sandboxRuntimeBaseDir: string }) => {
    preparedTerminalRuntimeRoots.push(options.sandboxRuntimeBaseDir);
    return { runtimeRoot: options.sandboxRuntimeBaseDir, prepared: true, fingerprint: "verify" };
  };
  const installed = new FakeMicrosandboxModule(true);
  const installedOptions = await prepareOptionsFixture(tempRoot, "installed", false);
  await writeRuntimeInstallMarkers(installedOptions);
  await prepareSandboxRuntime(installedOptions, installed, prepareTerminalRuntime);
  assert.equal(installed.installCount, 0);
  assert.deepEqual(installed.createdImages, [SeneraMicrosandboxDefaults.image, ...images]);

  const missing = new FakeMicrosandboxModule(false);
  const missingOptions = await prepareOptionsFixture(tempRoot, "missing", true);
  await prepareSandboxRuntime(missingOptions, missing, prepareTerminalRuntime);
  assert.equal(missing.installCount, 1);
  assert.deepEqual(missing.createdImages, []);
  assert.deepEqual(preparedTerminalRuntimeRoots, [installedOptions.baseDir, missingOptions.baseDir]);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Sandbox prepare runtime verification passed.");

async function prepareOptionsFixture(root: string, name: string, skipImagePull: boolean): Promise<PrepareOptions> {
  const baseDir = path.join(root, name, "runtime");
  const bundleDir = path.join(root, name, "bundles");
  await mkdir(bundleDir, { recursive: true });
  return {
    strict: true,
    skipImagePull,
    importBundles: false,
    baseDir,
    bundleDir,
    exportBundlePath: undefined,
  };
}

async function writeRuntimeInstallMarkers(options: PrepareOptions): Promise<void> {
  const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
  const paths = resolveAgentSandboxRuntimePaths(process.cwd(), {
    BaseDir: options.baseDir ?? defaults.BaseDir,
    BundleDir: options.bundleDir ?? defaults.BundleDir,
  });
  await mkdir(path.dirname(paths.msbPath), { recursive: true });
  await mkdir(path.dirname(paths.libkrunfwPath), { recursive: true });
  await writeFile(paths.msbPath, "");
  await writeFile(paths.libkrunfwPath, "");
}
