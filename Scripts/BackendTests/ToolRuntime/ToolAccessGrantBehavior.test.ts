import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { buildAgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPromptAssetCatalog } from "../../../Source/AgentSystem/Prompt/AgentPromptAssetCatalog.js";
import {
  createAgentToolAccessGrant,
  orderToolNamesByPreference,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolCallExecutor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import type { AgentToolRunnerLike } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { createXmlProtocolSpec } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("authoritative tool access grant behavior", () => {
  test("enforces subset invariants, deep immutability, and stable preference ordering", () => {
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: ["ToolA", "ToolB", "ToolC"],
      exposedToolNames: ["ToolA", "ToolB", "ToolC"],
      preferredToolNames: ["ToolA", "ToolC"],
    });

    expect(orderToolNamesByPreference(["ToolB", "ToolC", "ToolA"], grant.preferredToolNames)).toEqual([
      "ToolA",
      "ToolC",
      "ToolB",
    ]);
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.authorizedToolNames)).toBe(true);
    expect(() =>
      createAgentToolAccessGrant({
        authorizedToolNames: ["ToolA"],
        exposedToolNames: ["ToolA"],
        preferredToolNames: ["ToolB"],
      }),
    ).toThrow("ToolB");
  });

  test("use_tools grants every loaded tool while preserving multiple preferences", () => {
    const registry = new AgentExtensionRegistry();
    new AgentPromptAssetCatalog().registerRoot(registry, path.resolve("System", "Prompts"));
    const policy = registry.getRootCommandPolicy("use_tools");
    if (!policy) throw new Error("Missing use_tools RootCommand policy.");
    const loadedTools = ["ToolA", "ToolB", "ToolC"].map((name) => ({
      name,
      handler: { kind: "HostCapability" as const, capability: `test.${name}` },
    }));

    const command = buildAgentRootCommand({
      decision: {
        action: "use_tools",
        useTools: {
          preferredTools: ["ToolA", "ToolC"],
          instruction: "Complete the task.",
          needs: [],
        },
      },
      loadedTools,
      registeredTools: loadedTools,
      policy,
    });

    expect(command.toolAccessGrant).toEqual({
      authorizedToolNames: ["ToolA", "ToolB", "ToolC"],
      exposedToolNames: ["ToolA", "ToolB", "ToolC"],
      preferredToolNames: ["ToolA", "ToolC"],
    });
  });

  test("evolves exposure within the authorization boundary and versions only observable changes", () => {
    const state = new AgentToolExposureState(
      createAgentToolAccessGrant({
        authorizedToolNames: ["ToolSearchTool", "ToolA", "ToolB"],
        exposedToolNames: ["ToolSearchTool", "ToolA"],
        preferredToolNames: ["ToolSearchTool"],
      }),
    );

    const promoted = state.expose(["ToolA", "ToolB", "UntrustedTool"]);
    const unchanged = state.expose(["ToolA", "ToolB"]);

    expect(promoted).toMatchObject({
      addedToolNames: ["ToolB"],
      rejectedToolNames: ["UntrustedTool"],
      snapshot: {
        generation: 1,
        exposedToolNames: ["ToolSearchTool", "ToolA", "ToolB"],
        preferredToolNames: ["ToolA", "ToolB", "ToolSearchTool"],
      },
    });
    expect(unchanged.snapshot.generation).toBe(1);
    expect(Object.isFrozen(promoted.snapshot.exposedToolNames)).toBe(true);
  });

  test("executor rejects a registered tool outside the authoritative grant before dispatch", async () => {
    const run = vi.fn();
    const registeredTool = { name: "ToolB" } as RegisteredTool;
    const registry = {
      getTool: (name: string) => (name === registeredTool.name ? registeredTool : undefined),
    } as unknown as AgentExtensionRegistry;
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: { run } as unknown as AgentToolRunnerLike,
      emitLifecycleEvents: false,
    });

    await expect(
      executor.execute(
        { name: "ToolB" },
        {
          requestId: "request-denied",
          toolAccessGrant: createAgentToolAccessGrant({
            authorizedToolNames: ["ToolA"],
            exposedToolNames: ["ToolA"],
          }),
        },
      ),
    ).rejects.toThrow("ToolB");
    expect(run).not.toHaveBeenCalled();
  });

  test("executor rejects a tool whose contract changed after the turn snapshot", async () => {
    const run = vi.fn();
    const registeredTool = {
      name: "ToolA",
      contract: { digest: "new-digest" },
    } as RegisteredTool;
    const registry = {
      getTool: (name: string) => (name === registeredTool.name ? registeredTool : undefined),
    } as unknown as AgentExtensionRegistry;
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: { run } as unknown as AgentToolRunnerLike,
      emitLifecycleEvents: false,
    });

    await expect(
      executor.execute(
        { name: "ToolA", expectedContractDigest: "old-digest" },
        {
          requestId: "request-stale-contract",
          toolAccessGrant: createAgentToolAccessGrant({
            authorizedToolNames: ["ToolA"],
            exposedToolNames: ["ToolA"],
          }),
        },
      ),
    ).rejects.toThrow("ToolA");
    expect(run).not.toHaveBeenCalled();
  });
});
