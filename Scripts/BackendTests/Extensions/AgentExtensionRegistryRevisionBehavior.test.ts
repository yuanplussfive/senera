import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createTool } from "../ToolSearch/ToolSearchTestFixtures.js";
import type { RegisteredSkill } from "../../../Source/AgentSystem/Skills/AgentSkillTypes.js";

describe("Agent extension registry revision", () => {
  test("advances when a tool extension is registered, replaced, or removed", () => {
    const registry = new AgentExtensionRegistry();
    const first = createTool({
      name: "RevisionTool",
      title: "Revision tool",
      summary: "Inspect the first catalog revision.",
      tags: ["revision"],
      actions: ["inspect"],
      targets: ["catalog"],
      priority: 1,
    });
    const replacement = {
      ...first,
      search: {
        ...first.search!,
        Summary: "Inspect the replacement catalog revision.",
      },
    };

    expect(registry.revision).toBe(0);
    registry.registerToolExtension(first.owner, [first]);
    expect(registry.revision).toBe(1);

    registry.replaceToolExtension(first.owner, [replacement]);
    expect(registry.revision).toBe(2);

    registry.removeToolExtension(first.owner.name);
    expect(registry.revision).toBe(3);

    registry.removeToolExtension(first.owner.name);
    expect(registry.revision).toBe(3);
  });

  test("projects System contributions over conflicting MCP and workspace candidates", () => {
    const registry = new AgentExtensionRegistry();
    const mcp = withOwner(
      createTool({
        name: "Inspect",
        title: "MCP inspect",
        summary: "Inspect through MCP.",
        tags: ["inspect"],
        actions: ["inspect"],
        targets: ["workspace"],
        priority: 100,
      }),
      "workspace-mcp",
    );
    const system = withOwner(
      createTool({
        name: "Inspect",
        title: "System inspect",
        summary: "Inspect through the host.",
        tags: ["inspect"],
        actions: ["inspect"],
        targets: ["workspace"],
        priority: 1,
        rootKind: "System",
      }),
      "system-host",
    );
    const workspaceSkill = skill("inspect-workflow", "standalone", "workspace");
    const systemSkill = skill("inspect-workflow", "system", "system");

    registry.registerToolExtension(mcp.owner, [mcp]);
    registry.registerSkill(workspaceSkill);
    registry.registerToolExtension(system.owner, [system]);
    registry.registerSkill(systemSkill);

    expect(registry.getTool("Inspect")).toBe(system);
    expect(registry.getSkill("inspect-workflow")).toBe(systemSkill);
    expect(registry.listToolsForOwner(mcp.owner)).toEqual([mcp]);

    registry.removeToolExtension(system.owner);
    registry.removeSkills("system:system");

    expect(registry.getTool("Inspect")).toBe(mcp);
    expect(registry.getSkill("inspect-workflow")).toBe(workspaceSkill);
  });
});

function skill(name: string, kind: "system" | "standalone", id: string): RegisteredSkill {
  return {
    source: { kind, id, displayName: id, priority: kind === "system" ? 1 : 100 },
    name,
    description: `${id} Skill.`,
    descriptionFile: `${id}/${name}/SKILL.md`,
    recommendedTools: [],
    evidenceRequirements: [],
  };
}

function withOwner<T extends ReturnType<typeof createTool>>(tool: T, name: string): T {
  return { ...tool, owner: { ...tool.owner, name } };
}
