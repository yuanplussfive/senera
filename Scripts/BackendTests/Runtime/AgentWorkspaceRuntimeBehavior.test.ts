import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMcpToolClientPool } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import { AgentSystemRuntimeCache } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentWorkspaceRuntime } from "../../../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentSystemRuntimeCacheRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import type { ResolvedAgentUploadsConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  let directory: string | undefined;
  while ((directory = temporaryDirectories.pop()) !== undefined) removeDirectory(directory);
});

describe("workspace runtime behavior", () => {
  test("shares workspace-scoped dependencies across model runtime generations", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-workspace-runtime");
    temporaryDirectories.push(workspaceRoot);
    const pool = new AgentMcpToolClientPool();
    const uploadStore = new AgentUploadStore({ workspaceRoot, config: uploadConfig() });
    const workspaceRuntime = new AgentWorkspaceRuntime({
      workspaceRoot,
      uploads: uploadConfig(),
      mcpClientPool: pool,
      uploadStore,
    });
    const dependencies: unknown[] = [];
    const cache = new AgentSystemRuntimeCache<AgentSystemRuntimeCacheRuntime>({
      workspaceRoot,
      configPath: "senera.config.json",
      workspaceRuntime,
      snapshot: () => ({ version: 1, config: {} as AgentSystemConfig }),
      runtimeFactory: (input) => {
        dependencies.push(input.workspaceRuntime);
        return { close: () => undefined };
      },
    });

    cache.acquire("model-a").release();
    cache.acquire("model-b").release();

    expect(dependencies).toEqual([workspaceRuntime, workspaceRuntime]);
    expect(workspaceRuntime.mcpClientPool).toBe(pool);
    expect(workspaceRuntime.uploadStore).toBe(uploadStore);
    await cache.clear();
    await workspaceRuntime.close();
  });

  test("closes its owned pool only once", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-workspace-runtime-close");
    temporaryDirectories.push(workspaceRoot);
    const pool = new AgentMcpToolClientPool();
    const close = vi.spyOn(pool, "close");
    const workspaceRuntime = new AgentWorkspaceRuntime({
      workspaceRoot,
      uploads: uploadConfig(),
      mcpClientPool: pool,
    });

    const first = workspaceRuntime.close();
    const second = workspaceRuntime.close();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    await workspaceRuntime.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function uploadConfig(): ResolvedAgentUploadsConfig {
  return {
    RootDir: ".senera/uploads",
    MaxFileBytes: 1_024,
    MaxRequestBytes: 4_096,
    MaxFilesPerRequest: 4,
    MaxConcurrentUploads: 2,
    MaxStoredBytes: 16_384,
    RetentionHours: 24,
    MaintenanceIntervalMinutes: 15,
  };
}
