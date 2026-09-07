import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import {
  AgentHostCapabilityNames,
  listDefaultAgentHostCapabilityNames,
} from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentChildWorkspaceAccessModes } from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { AgentSubagentPreflight } from "../../../Source/AgentSystem/Orchestration/AgentSubagentPreflight.js";
import { resolveAgentSubagentModelPool } from "../../../Source/AgentSystem/Orchestration/AgentSubagentModelPool.js";
import { AgentSubagentRoleCatalog } from "../../../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import {
  AgentSubagentToolGrantError,
  AgentSubagentToolGrantProjector,
} from "../../../Source/AgentSystem/Orchestration/AgentSubagentToolGrantProjector.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { modelConfig, registeredTool } from "./AgentDelegationTestSupport.js";

describe("agent delegation capability resolution", () => {
  test("rejects stale concrete parent Tool grants", () => {
    const projector = new AgentSubagentToolGrantProjector();

    expect(() =>
      projector.project(
        ["MissingTool"],
        { getTool: () => undefined, listTools: () => [] },
        {
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          canDelegate: false,
          allowedAgentNames: [],
        },
      ),
    ).toThrow(AgentSubagentToolGrantError);
    try {
      projector.project(
        ["MissingTool"],
        { getTool: () => undefined, listTools: () => [] },
        {
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          canDelegate: false,
          allowedAgentNames: [],
        },
      );
    } catch (error) {
      expect(error).toMatchObject({ code: "authorized_tool_unregistered", toolName: "MissingTool" });
    }
  });

  test("inherits concrete Tools while enforcing workspace and delegation policy", async () => {
    const tools = {
      ShellCommandTool: registeredTool("ShellCommandTool", "host.shell-command", "ReadWrite"),
      WorkspaceRead: registeredTool("WorkspaceRead", "workspace.file.read", "ReadOnly"),
      WorkspaceGrep: registeredTool("WorkspaceGrep", "workspace.content.search", "ReadOnly"),
      WorkspaceFind: registeredTool("WorkspaceFind", "workspace.file.find", "ReadOnly"),
      WorkspaceList: registeredTool("WorkspaceList", "workspace.directory.list", "ReadOnly"),
      WorkspaceApplyPatch: registeredTool("WorkspaceApplyPatch", "workspace.apply-patch", "ReadWrite"),
      GitInspect: registeredTool("GitInspect", "repository.git.inspect", "ReadOnly"),
      GitMutate: registeredTool("GitMutate", "repository.git.mutate", "ReadWrite"),
      AgentSpawn: registeredTool("AgentSpawn", "orchestration.agent-spawn", "ReadOnly", "delegation"),
      AgentContactSupervisor: registeredTool(
        "AgentContactSupervisor",
        "orchestration.agent-contact-supervisor",
        "ReadOnly",
        "internal",
      ),
    };
    const registry = toolRegistry(tools);
    const authorizedToolNames = Object.keys(tools).filter((name) => name !== "AgentContactSupervisor");
    const preflight = new AgentSubagentPreflight();
    const common = {
      workspaceRoot: process.cwd(),
      modelPool: resolveAgentSubagentModelPool(modelConfig(), "main"),
      parentModelProviderId: "main",
      parentThinkingLevel: "low" as const,
      authorizedToolNames,
      registry,
    };

    const worker = await preflight.resolve({
      ...common,
      runId: "preflight-worker",
      agent: "worker",
      task: "Implement one change.",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
      configuredThinkingLevel: "medium",
    });
    expect(worker.launchContract.role).toMatchObject({ id: "worker", canDelegate: false });
    expect(worker.model).toMatchObject({ selectedModelProviderId: "main", thinkingLevel: "high" });
    expect(worker.promptLayer.content).toContain("terminal assistant response");
    expect(worker.promptLayer.content).not.toContain("JSON Schema");
    expect(worker.allowedToolNames).toEqual([
      "ShellCommandTool",
      "WorkspaceRead",
      "WorkspaceGrep",
      "WorkspaceFind",
      "WorkspaceList",
      "WorkspaceApplyPatch",
      "GitInspect",
      "GitMutate",
      "AgentContactSupervisor",
    ]);
    expect(worker.allowedToolNames).not.toContain("AgentSpawn");
    expect(worker.capabilityCeiling.allowedAgents).toEqual([]);

    const delegate = await preflight.resolve({
      ...common,
      runId: "preflight-delegate",
      agent: "delegate",
      task: "Complete one focused task.",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
      configuredThinkingLevel: "medium",
    });
    expect(delegate.launchContract.role).toMatchObject({ id: "delegate", canDelegate: true });
    expect(delegate.allowedToolNames).toContain("AgentSpawn");
    expect(delegate.capabilityCeiling.allowedAgents).toContain("reviewer");
    expect(delegate.model.thinkingLevel).toBe("medium");

    const requestedThinking = await preflight.resolve({
      ...common,
      runId: "preflight-requested-thinking",
      agent: "worker",
      task: "Complete one focused task.",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
      configuredThinkingLevel: "medium",
      requestedThinking: "minimal",
    });
    expect(requestedThinking.model.thinkingLevel).toBe("minimal");

    const reviewer = await preflight.resolve({
      ...common,
      runId: "preflight-reviewer",
      agent: "reviewer",
      task: "Review the repository without changing it.",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
    });
    expect(reviewer.allowedToolNames).toEqual([
      "WorkspaceRead",
      "WorkspaceGrep",
      "WorkspaceFind",
      "WorkspaceList",
      "GitInspect",
      "AgentContactSupervisor",
    ]);
    expect(reviewer.allowedToolNames).not.toContain("ShellCommandTool");
    expect(reviewer.allowedToolNames).not.toContain("WorkspaceApplyPatch");
    expect(reviewer.allowedToolNames).not.toContain("GitMutate");
    expect(reviewer.allowedToolNames).not.toContain("AgentSpawn");
  });

  test("monotonically narrows exact Tool and role identities for nested children", async () => {
    const tools = {
      WorkspaceRead: registeredTool("WorkspaceRead", "workspace.file.read", "ReadOnly"),
      WorkspaceGrep: registeredTool("WorkspaceGrep", "workspace.content.search", "ReadOnly"),
      GitInspect: registeredTool("GitInspect", "repository.git.inspect", "ReadOnly"),
      AgentContactSupervisor: registeredTool(
        "AgentContactSupervisor",
        "orchestration.agent-contact-supervisor",
        "ReadOnly",
        "internal",
      ),
    };
    const registry = toolRegistry(tools);
    const inheritedCapabilityCeiling = {
      version: 2 as const,
      allowedTools: Object.keys(tools),
      allowedAgents: ["reviewer"],
      denyExtensions: true,
      sources: ["senera.parent-child"],
    };
    const preflight = new AgentSubagentPreflight();
    const common = {
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
      workspaceRoot: process.cwd(),
      modelPool: resolveAgentSubagentModelPool(modelConfig(), "main"),
      parentModelProviderId: "main",
      authorizedToolNames: ["WorkspaceRead", "WorkspaceGrep", "GitInspect"],
      inheritedCapabilityCeiling,
      registry,
    };

    const reviewer = await preflight.resolve({
      ...common,
      runId: "nested-reviewer",
      agent: "reviewer",
      task: "Review the authorized workspace state.",
    });
    expect(reviewer.allowedToolNames).toEqual(Object.keys(tools));
    expect(reviewer.capabilityCeiling.allowedAgents).toEqual([]);
    expect(reviewer.capabilityCeiling.sources).toContain("senera.parent-child");

    await expect(
      preflight.resolve({
        ...common,
        runId: "nested-worker",
        agent: "worker",
        task: "Attempt to widen the inherited role ceiling.",
      }),
    ).rejects.toMatchObject({ code: "agent_not_allowed" });
  });

  test("loads every built-in role against the real extension catalog with concrete Tool grants", async () => {
    const registry = new AgentExtensionRegistry();
    const definitions = createAgentSystemTools(modelConfig());
    new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
    });
    const authorizedToolNames = registry
      .listTools()
      .filter((tool) => tool.childGrant !== "internal")
      .map((tool) => tool.name);
    const roleCatalog = new AgentSubagentRoleCatalog();
    const preflight = new AgentSubagentPreflight({ roleCatalog });

    expect(registry.getTool("AgentSpawn")).toMatchObject({
      handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.AgentSpawn },
      childGrant: "delegation",
    });
    expect(registry.getTool("AgentContactSupervisor")).toMatchObject({ childGrant: "internal" });
    expect(registry.getTool("Todo")).toMatchObject({ childGrant: "internal", execution: { Workspace: "ReadOnly" } });

    for (const role of roleCatalog.snapshot(process.cwd()).roles) {
      const plan = await preflight.resolve({
        runId: `real-role-${role.id}`,
        agent: role.id,
        task: `Validate the ${role.id} role contract.`,
        workspaceAccess: role.workspaceAccess,
        workspaceRoot: process.cwd(),
        modelPool: resolveAgentSubagentModelPool(modelConfig(), "main"),
        parentModelProviderId: "main",
        authorizedToolNames,
        registry,
      });
      const definition = roleCatalog.resolve(process.cwd(), role.id);
      expect(plan.launchContract.role).toMatchObject({ id: role.id, canDelegate: role.canDelegate });
      expect(plan.pinnedSkills.map((skill) => skill.name)).toEqual([...definition.skills]);
      expect(plan.allowedToolNames).toContain("AgentContactSupervisor");
      expect(plan.allowedToolNames).toContain("Todo");
      expect(plan.allowedToolNames).toContain("GitInspect");
      expect(plan.allowedToolNames).not.toEqual(expect.arrayContaining(["read", "grep", "git", "bash"]));
      if (role.workspaceAccess === AgentChildWorkspaceAccessModes.ReadOnly) {
        expect(plan.allowedToolNames.every((name) => registry.getTool(name)?.execution.Workspace === "ReadOnly")).toBe(
          true,
        );
        expect(plan.allowedToolNames).not.toContain("GitMutate");
      } else {
        expect(plan.allowedToolNames).toContain("GitMutate");
      }
      if (role.canDelegate) expect(plan.allowedToolNames).toContain("AgentSpawn");
      else expect(plan.allowedToolNames).not.toContain("AgentSpawn");
    }
  });
});

function toolRegistry<T extends Record<string, ReturnType<typeof registeredTool>>>(tools: T) {
  const skills = new Map(
    new AgentSkillScanner()
      .scanRoot(path.resolve("System", "Extensions", "agent-delegation", "skills"))
      .map((skill) => [skill.name, skill] as const),
  );
  return {
    getTool: (name: string) => tools[name as keyof T],
    listTools: () => Object.values(tools),
    getSkill: (name: string) => skills.get(name),
  };
}
