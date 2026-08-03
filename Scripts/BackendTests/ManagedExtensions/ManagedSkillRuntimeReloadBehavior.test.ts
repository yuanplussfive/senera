import { describe, expect, test } from "vitest";
import { AgentManagedExtensionService } from "../../../Source/AgentSystem/ManagedExtensions/AgentManagedExtensionService.js";
import {
  AgentSystemRuntimeCache,
  type AgentSystemRuntimeCacheRuntime,
} from "../../../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("managed Skill runtime reload", () => {
  test("reloads a validated Skill on the next runtime acquisition", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-skill-runtime-reload");
    const config = testConfig();
    const runtimes: TestRuntime[] = [];
    const cache = new AgentSystemRuntimeCache<TestRuntime>({
      workspaceRoot,
      configPath: "senera.config.json",
      snapshot: () => ({
        version: 1,
        revision: 1,
        sourceRevisions: {
          skills: AgentSkillScanner.sourceRevision(resolveAgentWorkspaceLayout(workspaceRoot).skillRoot),
        },
        config,
      }),
      runtimeFactory: () => {
        const runtime = new TestRuntime(runtimes.length + 1);
        runtimes.push(runtime);
        return runtime;
      },
    });

    try {
      const current = cache.acquire();
      current.release();

      const service = new AgentManagedExtensionService(workspaceRoot, { getTool: () => undefined });
      service.manageSkill({
        action: "create",
        name: "json-field-selector",
        description: "Select named fields from JSON objects when deterministic projection is required.",
        instructions: "# JSON Field Selector\n\nProject only the requested fields.",
      });

      const reloaded = cache.acquire();
      expect(reloaded.runtime).not.toBe(current.runtime);
      expect(runtimes.map((runtime) => runtime.generation)).toEqual([1, 2]);
      reloaded.release();
    } finally {
      await cache.clear();
      removeDirectory(workspaceRoot);
    }
  });
});

class TestRuntime implements AgentSystemRuntimeCacheRuntime {
  constructor(readonly generation: number) {}

  close(): void {}
}

function testConfig(): AgentSystemConfig {
  return {
    ModelProviders: [],
  };
}
