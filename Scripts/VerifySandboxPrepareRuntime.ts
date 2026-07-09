import assert from "node:assert/strict";
import {
  discoverSandboxImages,
  prepareSandboxRuntime,
  readOptions,
} from "../Build/PrepareSandboxRuntime.js";

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
assert.deepEqual(images, ["node:22-bookworm-slim"]);
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

const installed = new FakeMicrosandboxModule(true);
await prepareSandboxRuntime({
  strict: true,
  skipImagePull: false,
  importBundles: false,
}, installed);
assert.equal(installed.installCount, 0);
assert.deepEqual(installed.createdImages, ["alpine", ...images]);

const missing = new FakeMicrosandboxModule(false);
await prepareSandboxRuntime({
  strict: true,
  skipImagePull: true,
  importBundles: false,
}, missing);
assert.equal(missing.installCount, 1);
assert.deepEqual(missing.createdImages, []);

console.log("Sandbox prepare runtime verification passed.");
