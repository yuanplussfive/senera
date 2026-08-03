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

describe("Skill activation", () => {
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

  test("does not activate a Skill from learned evidence without a semantic match", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });
    const routingEvidence = {
      skillRoutingEvidence: () => [
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

  test("uses revision-bound learning evidence to rerank a semantic Skill candidate", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });
    const activated = await new AgentSkillActivationService(registry, {
      skillRoutingEvidence: () => [
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
        matchedFields: expect.arrayContaining([{ term: "批量提取", fields: ["learnedUsage"] }]),
      }),
    ]);
  });

  test("ignores learned routing evidence from an older Skill revision", async () => {
    const registry = new AgentExtensionRegistry();
    registry.registerSkill({
      ...skill("csv-column-selector", "Project selected columns from tabular files."),
      revision: "revision-2",
    });

    const activated = await new AgentSkillActivationService(registry, {
      skillRoutingEvidence: () => [
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

  test("shares vector reranking with Tool retrieval", async () => {
    const skills = [
      skill("alpha-workspace-search", "Search workspace records."),
      skill("beta-workspace-search", "Search workspace records."),
    ];
    const index = new AgentCapabilitySearchIndex(skills.map(buildSkillCapabilityDocument), {
      tokenizer: new AgentToolSearchTokenizer(),
      rerank: {
        client: {
          rerank: async ({ documents }) => ({
            model: "rerank-test",
            results: [...documents].reverse().map((document, resultIndex) => ({
              id: document.id,
              index: documents.findIndex((candidate) => candidate.id === document.id),
              score: 1 - resultIndex / documents.length,
            })),
          }),
        },
      },
    });

    const selected = await new AgentSkillSelector(index).selectHybrid({
      query: "search workspace records",
      skills,
    });

    expect(selected.map((selection) => selection.skill.name)).toEqual([
      "beta-workspace-search",
      "alpha-workspace-search",
    ]);
    expect(selected[0]?.matchedFields).toContainEqual({
      term: "search workspace records",
      fields: ["semanticRerank"],
    });
  });
});

function skill(name: string, description: string): RegisteredSkill {
  return {
    source: { kind: "system", id: name, displayName: "Senera" },
    name,
    description,
    descriptionFile: `System/Skills/${name}/SKILL.md`,
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
