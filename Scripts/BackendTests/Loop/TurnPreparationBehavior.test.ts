import { describe, expect, test, vi } from "vitest";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import {
  createAgentTurnPreparationSnapshot,
  isAgentTurnPreparationReusable,
  parseAgentTurnPreparationSnapshot,
  withAgentTurnPreparationBoundary,
} from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import { AgentTurnPreparationService } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationService.js";
import { buildAgentStateCard } from "../../../Source/AgentSystem/StateCard/AgentStateCardBuilder.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";

describe("Turn preparation behavior", () => {
  test("reuses a preparation only for the same input and runtime generation", () => {
    const snapshot = preparation();

    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-a",
        userInput: "Inspect the workspace",
      }),
    ).toBe(true);
    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-b",
        userInput: "Inspect the workspace",
      }),
    ).toBe(false);
    expect(
      isAgentTurnPreparationReusable(snapshot, {
        runtimeFingerprint: "runtime-a",
        userInput: "Edit the workspace",
      }),
    ).toBe(false);
  });

  test("derives direct Skill recommendations from the registry route without preloading Dynamic tools", async () => {
    const resolvePlannedLoadedTools = vi.fn(async (options: { currentLoadedTools?: readonly string[] }) => [
      ...(options.currentLoadedTools ?? []),
    ]);
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, resolveStateCard },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillToolRouting: () => ({
            directToolNames: ["WorkspaceInspect"],
            dynamicToolNames: ["WorkspaceListFiles"],
            nativeToolNames: [],
            requiredToolNames: [],
          }),
          buildRootCommand,
        },
      },
    });

    const prepared = await service.prepare({
      requestId: "request-a",
      userInput: "Inspect the workspace",
      loadedToolNames: ["ToolSearch"],
    });

    expect(resolvePlannedLoadedTools).toHaveBeenCalledWith({
      input: "Inspect the workspace",
      currentLoadedTools: ["ToolSearch", "WorkspaceInspect"],
      currentSetPolicy: "retain",
      preferredTools: ["WorkspaceListFiles"],
      requiredToolNames: [],
      discover: false,
      queries: [],
      needs: [],
    });
    expect(buildRootCommand).toHaveBeenCalledWith({
      decision: {
        action: "use_tools",
        useTools: {
          preferredTools: ["WorkspaceListFiles"],
          instruction: "",
          needs: [],
        },
      },
      loadedToolNames: ["ToolSearch", "WorkspaceInspect"],
      allowedToolNames: undefined,
    });
    expect(prepared.toolAccessGrant.exposedToolNames).toEqual(prepared.loadedToolNames);
  });

  test("loads exact tools from an explicit activation without semantic discovery", async () => {
    const resolvePlannedLoadedTools = vi.fn(
      async (options: { currentLoadedTools?: readonly string[]; requiredToolNames?: readonly string[] }) => [
        ...(options.currentLoadedTools ?? []),
        ...(options.requiredToolNames ?? []),
      ],
    );
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, resolveStateCard },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillToolRouting: () => ({
            directToolNames: [],
            dynamicToolNames: ["PluginDynamicTool"],
            nativeToolNames: ["PluginDynamicTool"],
            requiredToolNames: ["PluginDynamicTool"],
          }),
          buildRootCommand,
        },
      },
    });

    const prepared = await service.prepare({
      requestId: "request-explicit-plugin",
      userInput: "Use the selected plugin",
      loadedToolNames: ["ToolSearch"],
      explicitActivations: [{ kind: "plugin", id: "visual-tools", revision: "plugin-r1" }],
    });

    expect(resolvePlannedLoadedTools).toHaveBeenCalledWith({
      input: "Use the selected plugin",
      currentLoadedTools: ["ToolSearch"],
      currentSetPolicy: "retain",
      preferredTools: ["PluginDynamicTool"],
      requiredToolNames: ["PluginDynamicTool"],
      discover: false,
      queries: [],
      needs: [],
    });
    expect(prepared.loadedToolNames).toEqual(["ToolSearch", "PluginDynamicTool"]);
    expect(prepared.nativeToolNames).toEqual(["PluginDynamicTool"]);
    expect(buildRootCommand).toHaveBeenCalledWith(
      expect.objectContaining({ loadedToolNames: ["ToolSearch", "PluginDynamicTool"] }),
    );
  });

  test("fails explicitly when an activated tool cannot be loaded", async () => {
    const resolvePlannedLoadedTools = vi.fn(async (options: { currentLoadedTools?: readonly string[] }) => [
      ...(options.currentLoadedTools ?? []),
    ]);
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, resolveStateCard },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillToolRouting: () => ({
            directToolNames: [],
            dynamicToolNames: [],
            nativeToolNames: [],
            requiredToolNames: ["PluginDynamicTool"],
          }),
          buildRootCommand: vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames)),
        },
      },
    });

    await expect(
      service.prepare({
        requestId: "request-missing-explicit-plugin",
        userInput: "Use the selected plugin",
        loadedToolNames: ["ToolSearch"],
        explicitActivations: [{ kind: "plugin", id: "visual-tools", revision: "plugin-r1" }],
      }),
    ).rejects.toThrow("Explicit activation requires unavailable tool: PluginDynamicTool.");
  });

  test("promotes a matching confirmed capability and skips duplicate discovery", async () => {
    const resolvePlannedLoadedTools = vi.fn(async (options: { currentLoadedTools?: readonly string[] }) => [
      ...(options.currentLoadedTools ?? []),
    ]);
    const reusableCapabilities = vi.fn(() => [
      {
        toolName: "WorkspaceListFiles",
        catalogRevision: "catalog-a",
        contractDigest: "contract-a",
        query: "Inspect the workspace files",
        arguments: { path: "workspace" },
        confirmedAt: 1,
        lastUsedAt: 1,
      },
    ]);
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, resolveStateCard, reusableCapabilities },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillToolRouting: () => ({
            directToolNames: [],
            dynamicToolNames: [],
            nativeToolNames: [],
            requiredToolNames: [],
          }),
          buildRootCommand,
        },
      },
    });

    const prepared = await service.prepare({
      requestId: "request-reuse",
      sessionId: "session-reuse",
      userInput: "Inspect the workspace files",
      loadedToolNames: ["ToolSearch"],
    });

    expect(reusableCapabilities).toHaveBeenCalledWith({
      sessionId: "session-reuse",
      logicalCacheScope: undefined,
      query: "Inspect the workspace files",
      authorizedToolNames: undefined,
    });
    expect(resolvePlannedLoadedTools).toHaveBeenCalledWith({
      input: "Inspect the workspace files",
      currentLoadedTools: ["ToolSearch", "WorkspaceListFiles"],
      currentSetPolicy: "retain",
      preferredTools: [],
      requiredToolNames: [],
      discover: false,
      queries: [],
      needs: [],
    });
    expect(prepared.loadedToolNames).toEqual(["ToolSearch", "WorkspaceListFiles"]);
  });

  test("carries a delegated run Tool ceiling into the authoritative root grant", async () => {
    const resolvePlannedLoadedTools = vi.fn(async () => ["WorkspaceRead", "DocumentExtract", "SkillManage"]);
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, resolveStateCard },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillToolRouting: () => ({
            directToolNames: ["WorkspaceRead", "SkillManage"],
            dynamicToolNames: ["DocumentExtract"],
            nativeToolNames: [],
            requiredToolNames: [],
          }),
          buildRootCommand,
        },
      },
    });

    const prepared = await service.prepare({
      requestId: "request-child",
      userInput: "Review the workspace",
      loadedToolNames: ["DocumentExtract"],
      allowedToolNames: ["WorkspaceRead"],
    });

    expect(prepared.loadedToolNames).toEqual(["WorkspaceRead"]);
    expect(buildRootCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        loadedToolNames: ["WorkspaceRead"],
        allowedToolNames: ["WorkspaceRead"],
      }),
    );
  });

  test("reuses a preparation only under the same Tool authorization ceiling", () => {
    const restricted = preparation(["WorkspaceListFiles"]);
    const base = {
      runtimeFingerprint: "runtime-a",
      userInput: "Inspect the workspace",
    };

    expect(
      isAgentTurnPreparationReusable(restricted, {
        ...base,
        allowedToolNames: ["WorkspaceListFiles"],
      }),
    ).toBe(true);
    expect(isAgentTurnPreparationReusable(restricted, base)).toBe(false);
    expect(
      isAgentTurnPreparationReusable(restricted, {
        ...base,
        allowedToolNames: ["WorkspaceListFiles", "DocumentExtract"],
      }),
    ).toBe(false);
  });

  test("rejects obsolete or internally inconsistent snapshots structurally", () => {
    const snapshot = preparation();

    expect(parseAgentTurnPreparationSnapshot(snapshot)).toMatchObject({
      runtimeFingerprint: "runtime-a",
      loadedToolNames: ["WorkspaceListFiles"],
    });
    expect(parseAgentTurnPreparationSnapshot({ ...snapshot, route: { mode: "tool_agent_loop" } })).toBeUndefined();
    expect(parseAgentTurnPreparationSnapshot({ ...snapshot, loadedToolNames: [] })).toBeUndefined();
    expect(
      parseAgentTurnPreparationSnapshot({ ...snapshot, toolAuthorizationCeiling: ["DocumentExtract"] }),
    ).toBeUndefined();
  });

  test("reconstructs the immutable access grant when adding a Pi branch boundary", () => {
    const snapshot = preparation();
    const bounded = withAgentTurnPreparationBoundary(snapshot, "branch-a");

    expect(bounded.piBranchBoundaryId).toBe("branch-a");
    expect(bounded.toolAccessGrant).not.toBe(snapshot.toolAccessGrant);
    expect(Object.isFrozen(bounded.toolAccessGrant)).toBe(true);
    expect(Object.isFrozen(bounded.toolAccessGrant.exposedToolNames)).toBe(true);
  });
});

async function resolveStateCard({ currentRequest }: { currentRequest: string }) {
  return buildAgentStateCard({ currentRequest, history: [] });
}

function preparation(allowedToolNames?: readonly string[]) {
  const command = rootCommand(["WorkspaceListFiles"]);
  return createAgentTurnPreparationSnapshot({
    runtimeFingerprint: "runtime-a",
    userInput: "Inspect the workspace",
    allowedToolNames,
    loadedToolNames: ["WorkspaceListFiles"],
    toolAccessGrant: command.toolAccessGrant,
    rootCommand: command,
    activeSkills: [],
  });
}

function rootCommand(loadedToolNames: readonly string[]): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "Complete the current request.",
    instruction: "Inspect the workspace",
    toolAccessGrant: toolAccessGrant(loadedToolNames, loadedToolNames),
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "Report missing capabilities.",
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "answer_body",
      format: "final_text",
      rules: [],
      repair: { instruction: "Return only the user-facing answer.", rules: [] },
    },
  };
}
