import { describe, expect, test, vi } from "vitest";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import {
  createAgentTurnPreparationSnapshot,
  isAgentTurnPreparationReusable,
  parseAgentTurnPreparationSnapshot,
  withAgentTurnPreparationBoundary,
} from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import { AgentTurnPreparationService } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationService.js";
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

  test("prepares skills, tool exposure, and root authority without a model call", async () => {
    const resolvePlannedLoadedTools = vi.fn(async () => ["ToolSearch", "WorkspaceListFiles"]);
    const rememberAutoSearch = vi.fn();
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, rememberAutoSearch },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillTools: () => ["WorkspaceListFiles"],
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
      currentLoadedTools: ["ToolSearch"],
      currentSetPolicy: "retain",
      preferredTools: ["WorkspaceListFiles"],
      discover: true,
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
      loadedToolNames: ["ToolSearch", "WorkspaceListFiles"],
      allowedToolNames: undefined,
    });
    expect(rememberAutoSearch).toHaveBeenCalledWith("request-a", "Inspect the workspace", prepared.loadedToolNames);
    expect(prepared.toolAccessGrant.exposedToolNames).toEqual(prepared.loadedToolNames);
  });

  test("carries a delegated run Tool ceiling into the authoritative root grant", async () => {
    const resolvePlannedLoadedTools = vi.fn(async () => ["WorkspaceRead", "DocumentExtract", "SkillManage"]);
    const buildRootCommand = vi.fn(({ loadedToolNames }) => rootCommand(loadedToolNames));
    const service = new AgentTurnPreparationService({
      services: {
        retrieval: { resolvePlannedLoadedTools, rememberAutoSearch: vi.fn() },
        promptContext: {
          activateSkills: async () => [],
          recommendedSkillTools: () => ["DocumentExtract", "WorkspaceRead", "SkillManage"],
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
