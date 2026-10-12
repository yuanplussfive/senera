import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import {
  AgentSkillActivationScores,
  AgentSkillActivationService,
} from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import type { RegisteredSkill } from "../../../Source/AgentSystem/Skills/AgentSkillTypes.js";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentSkillSelector } from "../../../Source/AgentSystem/Skills/AgentSkillSelector.js";
import { AgentCapabilitySearchIndex } from "../../../Source/AgentSystem/ToolSearch/AgentCapabilitySearchIndex.js";
import { buildSkillCapabilityDocument } from "../../../Source/AgentSystem/ToolSearch/AgentCapabilityDocumentBuilder.js";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import { createTool } from "../ToolSearch/ToolSearchTestFixtures.js";

describe("Skill activation", () => {
  test("activates pinned Skills before semantic routing and rejects missing pins", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({ ...skill("workspace-investigation", "Inspect a workspace."), revision: "revision-a" });
    const service = new AgentSkillActivationService(registry);

    const activated = await service.activate({
      input: "Use $workspace-investigation to inspect the workspace.",
      pinnedSkills: [
        { name: "workspace-investigation", revision: "revision-a" },
        { name: "workspace-investigation", revision: "revision-a" },
      ],
    });

    expect(activated).toEqual([
      expect.objectContaining({
        name: "workspace-investigation",
        revision: "revision-a",
        score: AgentSkillActivationScores.PinnedConfiguration,
        matchedFields: [{ term: "workspace-investigation", fields: ["pinnedConfiguration"] }],
      }),
    ]);
    await expect(
      service.activate({ input: "Inspect it.", pinnedSkills: [{ name: "missing-skill", revision: "revision-a" }] }),
    ).rejects.toThrow(/Pinned Skills are not registered: missing-skill/u);
    await expect(
      service.activate({
        input: "Inspect it.",
        pinnedSkills: [{ name: "workspace-investigation", revision: "revision-before-reload" }],
      }),
    ).rejects.toThrow(/Pinned Skill revisions changed before activation/u);
  });

  test("prioritizes explicit $skill-name invocations and merges semantic matches without duplicates", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill(skill("weather-forecast", "Query current weather and forecasts."));
    registry.registerSkill(skill("web-research", "Research current external web facts."));

    const activated = await new AgentSkillActivationService(registry).activate({
      input: "Use $weather-forecast and also research current web facts.",
    });

    expect(activated[0]).toMatchObject({
      name: "weather-forecast",
      matchedTerms: ["$weather-forecast"],
      matchedFields: [{ fields: ["explicitInvocation"] }],
      score: AgentSkillActivationScores.ExplicitInvocation,
    });
    expect(activated.filter((candidate) => candidate.name === "weather-forecast")).toHaveLength(1);
    expect(activated.map((candidate) => candidate.name)).toContain("web-research");
  });

  test("fails explicitly for an unknown slash Skill instead of routing to a semantic fallback", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill(skill("web-research", "Research current external web facts."));

    await expect(
      new AgentSkillActivationService(registry).activate({ input: "/missing-skill research current web facts" }),
    ).rejects.toThrow("Explicit Skill commands are not registered: /missing-skill.");
  });

  test("keeps model-disabled Skills out of automatic routing while allowing explicit activation", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("internal-playbook", "Inspect internal operational playbooks."),
      disableModelInvocation: true,
    });

    const service = new AgentSkillActivationService(registry);
    expect(await service.activate({ input: "Inspect internal operational playbooks." })).toEqual([]);
    expect((await service.activate({ input: "Use /internal-playbook now." })).map((item) => item.name)).toEqual([
      "internal-playbook",
    ]);
  });

  test("does not activate a Skill from scenario evidence without a semantic match", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });
    const routingEvidence = {
      skillScenarioEvidence: () => [
        {
          skillName: "csv-column-selector",
          skillRevision: "revision-2",
          rankScore: 0.8,
          terms: ["批量提取"],
        },
      ],
    };

    const activated = await new AgentSkillActivationService(registry, routingEvidence).activate({
      input: "批量提取这些数据",
    });

    expect(activated).toEqual([]);
  });

  test("uses revision-bound scenario evidence to rerank a semantic Skill candidate", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });
    const activated = await new AgentSkillActivationService(registry, {
      skillScenarioEvidence: () => [
        {
          skillName: "csv-column-selector",
          skillRevision: "revision-2",
          rankScore: 0.8,
          terms: ["批量提取"],
        },
      ],
    }).activate({ input: "Project selected columns，批量提取这些数据" });

    expect(activated).toEqual([
      expect.objectContaining({
        name: "csv-column-selector",
        matchedFields: expect.arrayContaining([{ term: "批量提取", fields: ["completedScenario"] }]),
      }),
    ]);
  });

  test("ignores scenario evidence from an older Skill revision", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });

    const activated = await new AgentSkillActivationService(registry, {
      skillScenarioEvidence: () => [
        {
          skillName: "csv-column-selector",
          skillRevision: "revision-1",
          rankScore: 1,
          terms: ["批量提取"],
        },
      ],
    }).activate({ input: "批量提取这些数据" });

    expect(activated).toEqual([]);
  });

  test("does not treat every allowed tool name as Skill activation evidence", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill(skill("database-migration", "Run UnrelatedDatabaseMigrationTool for schema migrations."));
    const service = new AgentSkillActivationService(registry);

    expect(
      await service.activate({
        input: "Summarize the current conversation.",
        rootCommand: rootCommand(["UnrelatedDatabaseMigrationTool"], []),
      }),
    ).toEqual([]);
    expect(
      (
        await service.activate({
          input: "Summarize the current conversation.",
          rootCommand: rootCommand(["UnrelatedDatabaseMigrationTool"], ["UnrelatedDatabaseMigrationTool"]),
        })
      ).map((candidate) => candidate.name),
    ).toContain("database-migration");
  });

  test("includes already exposed tools as retrieval evidence for mini-cn Skill routing", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill(skill("workspace-inspection", "Inspect workspace files and summarize findings."));
    let observedQuery = "";
    const service = new AgentSkillActivationService(registry, {
      skillScenarioEvidence: () => [],
      selectSkills: async ({ query }) => {
        observedQuery = query;
        return [];
      },
    });

    await service.activate({
      input: "Inspect the current workspace.",
      availableToolNames: ["WorkspaceRead", "WorkspaceFind"],
    });

    expect(observedQuery).toContain("Inspect the current workspace.");
    expect(observedQuery).toContain("available tools: WorkspaceRead, WorkspaceFind");
  });

  test("shares vector reranking with Tool retrieval", async () => {
    const skills = [
      skill("alpha-workspace-search", "Search workspace records."),
      skill("beta-workspace-search", "Search workspace records."),
    ];
    const index = new AgentCapabilitySearchIndex(skills.map(buildSkillCapabilityDocument), {
      tokenizer: new AgentToolSearchTokenizer(),
      embedding: {
        client: {
          async embed(request) {
            return {
              model: "test-embed",
              vectors: request.input.map((text) => (text.includes("workspace") ? [1, 0] : [0, 1])),
            };
          },
        },
        model: "test-embed",
      },
    });

    const selected = await new AgentSkillSelector(index).selectHybrid({
      query: "search workspace records",
      skills,
    });

    expect(selected.length).toBe(2);
  });

  test("derives Skill recommendation routes from the registered tool loading declaration", async () => {
    const registry = new AgentExtensionRegistry();
    const direct = createTool({
      name: "WorkspaceApplyPatch",
      title: "Apply patch",
      summary: "Modify workspace files.",
      tags: ["workspace", "patch"],
      actions: ["patch"],
      targets: ["workspace"],
      priority: 1,
      loading: "Bootstrap",
    });
    const dynamic = createTool({
      name: "mcp__image__generate",
      title: "Generate image",
      summary: "Generate an image from a prompt.",
      tags: ["image", "generate"],
      actions: ["generate"],
      targets: ["image"],
      priority: 1,
      loading: "Dynamic",
    });
    registry.registerToolExtension(direct.owner, [direct]);
    registry.registerToolExtension(dynamic.owner, [dynamic]);
    registry.registerSkill({
      ...skill("creative-workspace", "Edit a workspace and generate visual assets."),
      recommendedTools: [direct.name, dynamic.name],
    });

    const service = new AgentSkillActivationService(registry);
    const activated = await service.activate({ input: "/creative-workspace complete the task" });

    expect(service.recommendedToolRouting(activated)).toEqual({
      directToolNames: [direct.name],
      dynamicToolNames: [dynamic.name],
      nativeToolNames: [],
      requiredToolNames: [],
    });
  });

  test("loads every registered tool owned by an explicitly selected Plugin", async () => {
    const registry = new AgentExtensionRegistry();
    const pluginTool = createTool({
      name: "PluginDynamicTool",
      title: "Plugin capability",
      summary: "A capability owned by the selected Plugin.",
      tags: ["plugin"],
      actions: ["inspect"],
      targets: ["workspace"],
      priority: 1,
    });
    const pluginOwner = { ...pluginTool.owner, kind: "plugin" as const, name: "visual-tools" };
    registry.registerToolExtension(pluginOwner, [{ ...pluginTool, owner: pluginOwner }]);
    const service = new AgentSkillActivationService(registry);

    expect(service.recommendedToolRouting([], [{ kind: "plugin", id: "visual-tools", revision: "plugin-r1" }])).toEqual(
      {
        directToolNames: [],
        dynamicToolNames: [pluginTool.name],
        nativeToolNames: [pluginTool.name],
        requiredToolNames: [pluginTool.name],
      },
    );
  });

  test("loads every registered tool owned by an explicitly selected MCP server", async () => {
    const registry = new AgentExtensionRegistry();
    const mcpTool = createTool({
      name: "mcp__weather__forecast",
      title: "Weather forecast",
      summary: "Read the weather forecast.",
      tags: ["weather"],
      actions: ["read"],
      targets: ["weather"],
      priority: 1,
    });
    const mcpOwner = { ...mcpTool.owner, kind: "mcp" as const, name: "weather" };
    registry.registerToolExtension(mcpOwner, [{ ...mcpTool, owner: mcpOwner }]);

    expect(
      new AgentSkillActivationService(registry).recommendedToolRouting(
        [],
        [{ kind: "mcp", id: "weather", revision: "package-r1" }],
      ),
    ).toEqual({
      directToolNames: [],
      dynamicToolNames: [mcpTool.name],
      nativeToolNames: [mcpTool.name],
      requiredToolNames: [mcpTool.name],
    });

    await expect(
      new AgentSkillActivationService(registry).activate({
        input: "Use the selected MCP server.",
        explicitActivations: [{ kind: "mcp", id: "weather", revision: "package-r1" }],
      }),
    ).resolves.toEqual([]);
  });
});

function skill(name: string, description: string): RegisteredSkill {
  return {
    source: { kind: "system", id: name, displayName: "Senera" },
    name,
    description,
    descriptionFile: `System/Skills/${name}/SKILL.md`,
    content: `# ${name}`,
    recommendedTools: [],
    evidenceRequirements: [],
  };
}

function rootCommand(allowedTools: readonly string[], preferredTools: readonly string[]): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "answer",
    outputMode: "final_text",
    toolAccess: "restricted",
    objective: "Summarize the conversation.",
    instruction: null,
    toolAccessGrant: toolAccessGrant(allowedTools, preferredTools),
    forbiddenOutputs: [],
    insufficiencyPolicy: "answer",
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "user",
      start: "",
      format: "text",
      rules: [],
      repair: { instruction: "", rules: [] },
    },
  };
}
