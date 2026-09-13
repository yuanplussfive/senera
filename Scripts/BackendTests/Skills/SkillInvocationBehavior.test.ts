import { describe, expect, test } from "vitest";
import {
  AgentSkillInvocationRegistry,
  parseAgentExplicitSkillNames,
  parseAgentSkillInvocations,
} from "../../../Source/AgentSystem/Skills/AgentSkillInvocation.js";
import type { RegisteredSkill } from "../../../Source/AgentSystem/Skills/AgentSkillTypes.js";

describe("Skill invocation registry", () => {
  test("accepts slash commands and keeps dollar syntax as compatibility", () => {
    expect(parseAgentSkillInvocations("Use /workspace-investigation then $web-research.")).toEqual([
      expect.objectContaining({ name: "workspace-investigation", syntax: "slash", token: "/workspace-investigation" }),
      expect.objectContaining({ name: "web-research", syntax: "dollar", token: "$web-research" }),
    ]);
    expect(parseAgentExplicitSkillNames("https://example.test/a /tmp/file /workspace-investigation")).toEqual([
      "workspace-investigation",
    ]);
  });

  test("derives commands from the live Skill catalog and rejects duplicate identities", () => {
    const skill = registeredSkill("workspace-investigation");
    const registry = new AgentSkillInvocationRegistry([skill]);
    expect(registry.list()).toEqual([
      {
        command: "/workspace-investigation",
        name: "workspace-investigation",
        description: skill.description,
        revision: skill.source.id,
      },
    ]);
    expect(registry.resolve("/workspace-investigation")).toBe(skill);
    expect(() => new AgentSkillInvocationRegistry([skill, skill])).toThrow(/ambiguous/u);
  });
});

function registeredSkill(name: string): RegisteredSkill {
  return {
    source: { kind: "system", id: name, displayName: "Senera" },
    name,
    description: `Use ${name}.`,
    descriptionFile: `System/Skills/${name}/SKILL.md`,
    recommendedTools: [],
    evidenceRequirements: [],
  };
}
