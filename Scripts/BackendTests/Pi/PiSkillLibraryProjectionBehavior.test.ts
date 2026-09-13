import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { renderAgentPiSkillLibraryPrompt } from "../../../Source/AgentSystem/Pi/AgentPiSkillLibraryPrompt.js";
import { decodeAgentPromptWire } from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { projectAgentSkillLibraryCatalog } from "../../../Source/AgentSystem/Skills/AgentSkillLibraryCatalog.js";
import type { RegisteredSkill } from "../../../Source/AgentSystem/Skills/AgentSkillTypes.js";

describe("Pi Skill library projection", () => {
  test("projects a logical, on-demand directory without host paths or bodies", () => {
    const registry = registryWithSkills([
      registeredSkill({
        name: "workspace-search",
        description: "Search the workspace safely.",
        descriptionFile: "C:\\private\\skills\\workspace-search\\SKILL.md",
        revision: "revision-workspace-search",
        search: {
          Tags: ["workspace", "search"],
          UseCases: ["inspect source"],
          Capabilities: [{ Id: "workspace.read" }],
        },
      }),
      registeredSkill({
        name: "manual-only",
        description: "A Skill selected only by explicit invocation.",
        descriptionFile: "/srv/private/manual-only/SKILL.md",
        revision: "revision-manual-only",
        disableModelInvocation: true,
      }),
    ]);

    const catalog = projectAgentSkillLibraryCatalog(registry);
    const prompt = renderAgentPiSkillLibraryPrompt(catalog);

    expect(catalog.entries).toHaveLength(2);
    expect(catalog.entries[0]).toMatchObject({
      name: "manual-only",
      state: "explicit-only",
      load: "on-demand",
      entry: "senera://skills/manual-only/SKILL.md",
    });
    expect(catalog.entries[1]).toMatchObject({
      name: "workspace-search",
      scope: "standalone",
      tags: ["search", "workspace"],
      useCases: ["inspect source"],
      capabilities: ["workspace.read"],
      entry: "senera://skills/workspace-search/SKILL.md",
    });
    expect(JSON.stringify(catalog)).not.toContain("private");
    expect(prompt).not.toContain("C:\\private");
    expect(prompt).not.toContain("/srv/private");
    expect(prompt).toContain("senera.skill_library=v1");
    expect(prompt).toContain("directory-only");
  });

  test("keeps the directory stable when only host paths change", () => {
    const first = projectAgentSkillLibraryCatalog(
      registryWithSkills([
        registeredSkill({
          name: "web-research",
          description: "Research current external information.",
          descriptionFile: "C:\\one\\web-research\\SKILL.md",
          revision: "same-revision",
        }),
      ]),
    );
    const second = projectAgentSkillLibraryCatalog(
      registryWithSkills([
        registeredSkill({
          name: "web-research",
          description: "Research current external information.",
          descriptionFile: "/container/two/web-research/SKILL.md",
          revision: "same-revision",
        }),
      ]),
    );

    expect(second).toEqual(first);
  });

  test("uses the lossless prompt wire for the directory", () => {
    const catalog = projectAgentSkillLibraryCatalog(
      registryWithSkills([
        registeredSkill({
          name: "document-understanding",
          description: "Read and inspect uploaded documents.",
          descriptionFile: "/host/document-understanding/SKILL.md",
          revision: "document-revision",
        }),
      ]),
    );
    const prompt = renderAgentPiSkillLibraryPrompt(catalog);
    const wire = decodeAgentPromptWire(prompt.slice(prompt.indexOf("senera.skill_library=v1")), {
      expectedKind: "skill_library",
      expectedVersion: "1",
    });

    expect(wire.blocks).toHaveLength(1);
    expect(wire.blocks[0]?.id).toBe("directory");
    expect(wire.blocks[0]?.value).toEqual({
      entries: [expect.objectContaining({ name: "document-understanding" })],
      protocol: "senera.skill-library/v1",
      revision: catalog.revision,
    });
  });
});

function registryWithSkills(skills: readonly RegisteredSkill[]): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  registry.replaceSkills("standalone:test", skills);
  return registry;
}

function registeredSkill(
  input: Pick<RegisteredSkill, "name" | "description" | "descriptionFile" | "revision"> &
    Partial<Pick<RegisteredSkill, "search" | "disableModelInvocation">>,
): RegisteredSkill {
  return {
    source: { kind: "standalone", id: "test", displayName: "Test" },
    name: input.name,
    description: input.description,
    descriptionFile: input.descriptionFile,
    revision: input.revision,
    recommendedTools: [],
    evidenceRequirements: [],
    ...(input.search ? { search: input.search } : {}),
    ...(input.disableModelInvocation ? { disableModelInvocation: true } : {}),
  };
}
