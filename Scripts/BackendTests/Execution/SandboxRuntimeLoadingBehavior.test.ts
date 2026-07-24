import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { AgentSandboxArchiveInstallation } from "../../../Source/AgentSystem/Sandbox/AgentSandboxArchiveInstaller.js";
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
        onProgress: ({ stage }) => stages.push(stage),
      });

      expect(prepared).toMatchObject({ paths: { baseDir: paths.baseDir }, preparedImages: ["alpine"] });
      expect(Object.keys(prepared.paths)).toEqual(["baseDir"]);
      expect(process.env.MSB_HOME).toBe(paths.baseDir);
      expect(process.env.MSB_PATH).toBe("provider-owned-msb");
      expect(process.env.MSB_LIBKRUNFW_PATH).toBe("provider-owned-libkrunfw");
      expect(stages).toEqual([
        "checking_host_runtime",
        "loading_runtime",
        "warming_image",
        "warming_image",
        "warming_image",
      ]);
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
      });

      expect(prepared.preparedImages).toEqual(["alpine"]);
      expect(createdImages).toEqual(["alpine"]);
      expect(isInstalled).not.toHaveBeenCalled();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("imports a release bundle and probes only its declared image with network pulling disabled", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-runtime-"));
    const createdImages: string[] = [];
    const pullPolicies: string[] = [];
    const sourceImage = "registry.example/runtime@sha256:bundle";
    const runtimeImage = "senera.local/test-runtime:1.0.1-x64";
    const archiveInstallation = {
      archivePath: path.join(workspaceRoot, "image.oci.tar"),
      imported: true,
      manifest: {
        formatVersion: 3,
        distributionId: "test",
        archiveVersion: "1.0.2",
        productVersion: "1.2.3",
        microsandboxVersion: "0.6.4",
        target: "x64",
        sourceImage,
        runtimeImage,
        asset: {
          format: "oci",
          mediaType: "application/vnd.oci.image.layout.v1.tar",
          fileName: "image.oci.tar",
          url: "https://example.test/image.oci.tar",
          sizeBytes: 1,
          sha256: "0".repeat(64),
        },
      },
    } satisfies AgentSandboxArchiveInstallation;
    const archiveInstaller = vi.fn(async () => archiveInstallation);
    try {
      const prepared = await prepareAgentSandboxRuntime({
        workspaceRoot,
        config: {
          Enabled: true,
          BaseDir: ".senera/runtime",
          Provisioning: { Kind: "ReleaseBundle" },
        },
        productVersion: "1.2.3",
        microsandbox: createMicrosandbox(createdImages, pullPolicies),
        archiveInstaller,
      });

      expect(archiveInstaller).toHaveBeenCalledOnce();
      expect(prepared.preparedImages).toEqual([runtimeImage]);
      expect(createdImages).toEqual([runtimeImage]);
      expect(pullPolicies).toEqual(["never"]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("rejects missing declared registry credentials before contacting the OCI registry", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-runtime-"));
    const usernameVariable = "SENERA_TEST_SANDBOX_REGISTRY_USERNAME_MISSING";
    const passwordVariable = "SENERA_TEST_SANDBOX_REGISTRY_PASSWORD_MISSING";
    const previousUsername = process.env[usernameVariable];
    const previousPassword = process.env[passwordVariable];
    delete process.env[usernameVariable];
    delete process.env[passwordVariable];
    const createdImages: string[] = [];
    try {
      await expect(
        prepareAgentSandboxRuntime({
          workspaceRoot,
          config: {
            Enabled: true,
            BaseDir: ".senera/runtime",
            Provisioning: {
              Kind: "Oci",
              Images: ["registry.example/runtime@sha256:digest"],
              Registry: {
                Authentication: {
                  Kind: "Basic",
                  UsernameEnvironmentVariable: usernameVariable,
                  PasswordEnvironmentVariable: passwordVariable,
                },
              },
            },
          },
          microsandbox: createMicrosandbox(createdImages),
        }),
      ).rejects.toThrow(`Sandbox registry environment variable is not set: ${usernameVariable}`);
      expect(createdImages).toEqual([]);
    } finally {
      restoreEnvironment(usernameVariable, previousUsername);
      restoreEnvironment(passwordVariable, previousPassword);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function sandboxConfig(baseDir: string, images: string[] = ["alpine"]): ResolvedAgentSandboxRuntimeConfig {
  return {
    Enabled: true,
    BaseDir: baseDir,
    Provisioning: {
      Kind: "Oci",
      Images: images,
    },
  };
}

function createMicrosandbox(createdImages: string[] = [], pullPolicies: string[] = []): MicrosandboxModule {
  return {
    Sandbox: {
      builder: () => new FakeSandboxBuilder(createdImages, pullPolicies),
    },
  };
}

class FakeSandboxBuilder {
  private selectedImage = "";

  constructor(
    private readonly createdImages: string[],
    private readonly pullPolicies: string[],
  ) {}

  image(value: string): this {
    this.selectedImage = value;
    return this;
  }

  pullPolicy(policy: string): this {
    this.pullPolicies.push(policy);
    return this;
  }

  registry(): this {
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
      exec: async () => ({
        code: 0,
        success: true,
        stdout: () => "",
        stderr: () => "",
      }),
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
