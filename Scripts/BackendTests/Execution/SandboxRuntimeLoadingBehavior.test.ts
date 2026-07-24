import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  prepareAgentSandboxRuntime,
  resolveAgentSandboxRuntimePaths,
  type MicrosandboxModule,
} from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("sandbox runtime loading", () => {
  test("loads the official SDK with only the application-managed state directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-runtime-"));
    const previousMsbHome = process.env.MSB_HOME;
    const previousMsbPath = process.env.MSB_PATH;
    const previousLibraryPath = process.env.MSB_LIBKRUNFW_PATH;
    try {
      process.env.MSB_PATH = "provider-owned-msb";
      process.env.MSB_LIBKRUNFW_PATH = "provider-owned-libkrunfw";
      const config = sandboxConfig(".senera/runtime");
      const paths = resolveAgentSandboxRuntimePaths(workspaceRoot, config);
      const stages: string[] = [];

      const prepared = await prepareAgentSandboxRuntime({
        workspaceRoot,
        config,
        microsandbox: createMicrosandbox(),
        strict: true,
        skipImagePull: true,
        onProgress: ({ stage }) => stages.push(stage),
      });

      expect(prepared).toMatchObject({ paths: { baseDir: paths.baseDir }, preparedImages: [] });
      expect(Object.keys(prepared.paths)).toEqual(["baseDir"]);
      expect(process.env.MSB_HOME).toBe(paths.baseDir);
      expect(process.env.MSB_PATH).toBe("provider-owned-msb");
      expect(process.env.MSB_LIBKRUNFW_PATH).toBe("provider-owned-libkrunfw");
      expect(stages).toEqual(["checking_host_runtime", "loading_runtime"]);
    } finally {
      restoreEnvironment("MSB_HOME", previousMsbHome);
      restoreEnvironment("MSB_PATH", previousMsbPath);
      restoreEnvironment("MSB_LIBKRUNFW_PATH", previousLibraryPath);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("uses successful sandbox creation instead of the SDK installation flag as readiness evidence", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-runtime-"));
    try {
      const isInstalled = vi.fn(() => false);
      const createdImages: string[] = [];
      const microsandbox = createMicrosandbox(createdImages) as MicrosandboxModule & {
        isInstalled(): boolean;
      };
      microsandbox.isInstalled = isInstalled;

      const prepared = await prepareAgentSandboxRuntime({
        workspaceRoot,
        config: sandboxConfig(".senera/runtime", ["alpine"]),
        microsandbox,
        strict: true,
      });

      expect(prepared.preparedImages).toEqual(["alpine"]);
      expect(createdImages).toEqual(["alpine"]);
      expect(isInstalled).not.toHaveBeenCalled();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function sandboxConfig(baseDir: string, images: string[] = []): ResolvedAgentSandboxRuntimeConfig {
  return {
    Enabled: true,
    BaseDir: baseDir,
    Images: images,
  };
}

function createMicrosandbox(createdImages: string[] = []): MicrosandboxModule {
  return {
    Snapshot: {
      import: async () => undefined,
      export: async () => undefined,
    },
    Sandbox: {
      builder: () => new FakeSandboxBuilder(createdImages),
      get: async () => {
        throw new Error("snapshot export was not expected");
      },
    },
  };
}

class FakeSandboxBuilder {
  private selectedImage = "";

  constructor(private readonly createdImages: string[]) {}

  image(value: string): this {
    this.selectedImage = value;
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
        yield { kind: "complete" as const, reference: "alpine" };
      },
    };
  }

  private sandbox() {
    this.createdImages.push(this.selectedImage);
    return {
      name: "runtime-probe",
      stopWithTimeout: async () => undefined,
      kill: async () => undefined,
    };
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
