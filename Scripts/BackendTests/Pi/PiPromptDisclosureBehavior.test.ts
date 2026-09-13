import type { Skill } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import {
  AgentPiPromptDisclosureLedger,
  agentPiPromptTemplateDisclosureKey,
  emptyAgentPiPromptDisclosureState,
  readAgentPiPromptDisclosureState,
} from "../../../Source/AgentSystem/Pi/AgentPiPromptDisclosure.js";
import {
  renderPiSystemPromptFrame,
  type AgentPiSelectedPromptTemplateFrame,
} from "../../../Source/AgentSystem/Pi/AgentPiPromptFrameProjector.js";
import { decodeAgentPromptWire } from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";

describe("Pi prompt progressive disclosure", () => {
  test("discloses a resource body once and emits a compact reference afterwards", () => {
    const skill = testSkill("workspace-search", "Search the workspace safely.");
    const template = testTemplate("workspace-guidance", "Use the workspace search workflow.");
    const ledger = new AgentPiPromptDisclosureLedger();

    const first = ledger.plan({ skills: [skill], selectedPromptTemplates: [template] });
    const firstPrompt = renderPiSystemPromptFrame({
      systemPrompt: "Stable system.",
      skills: [skill],
      selectedPromptTemplates: [template],
      disclosure: first,
    });
    ledger.commit(first);

    expect(firstPrompt).toContain(skill.content);
    expect(firstPrompt).toContain(template.content);
    expect(firstPrompt).not.toContain("<skill_ref");
    expect(firstPrompt).not.toContain("<resource_ref>");

    const second = ledger.plan({ skills: [skill], selectedPromptTemplates: [template] });
    const secondPrompt = renderPiSystemPromptFrame({
      systemPrompt: "Stable system.",
      skills: [skill],
      selectedPromptTemplates: [template],
      disclosure: second,
    });

    expect(second.newSkills).toHaveLength(0);
    expect(second.newPromptTemplates).toHaveLength(0);
    const wire = decodeAgentPromptWire(secondPrompt.slice(secondPrompt.indexOf("senera.resources=v1")));
    expect(wire.kind).toBe("resources");
    const templates = wire.blocks.find((block) => block.id === "prompt_templates")?.value as {
      selected: unknown[];
      reused: Record<string, unknown>[];
    };
    const skills = wire.blocks.find((block) => block.id === "skills")?.value as {
      newlyDisclosed: unknown[];
      activeReferences: Record<string, unknown>[];
    };
    expect(templates.selected).toEqual([]);
    expect(templates.reused[0]).toMatchObject({
      kind: "prompt-template",
      name: "workspace-guidance",
      state: "active-reference",
      revision: expect.any(String),
    });
    expect(skills.newlyDisclosed).toEqual([]);
    expect(skills.activeReferences[0]).toMatchObject({
      kind: "skill",
      name: "workspace-search",
      location: "/skills/workspace-search/SKILL.md",
      state: "active-reference",
      revision: expect.any(String),
    });
    expect(secondPrompt).not.toContain(skill.content);
    expect(secondPrompt).not.toContain(template.content);
  });

  test("keeps a newly selected template when no Skill is active", () => {
    const template = testTemplate("workspace-guidance", "Use the workspace search workflow.");
    const ledger = new AgentPiPromptDisclosureLedger();
    const first = ledger.plan({ skills: [], selectedPromptTemplates: [template] });

    const prompt = renderPiSystemPromptFrame({
      systemPrompt: "Stable system.",
      skills: [],
      selectedPromptTemplates: [template],
      disclosure: first,
    });

    expect(first.newPromptTemplates).toEqual([template]);
    expect(prompt).toContain(template.content);
  });

  test("projects standalone Skill metadata through the shared resources wire", () => {
    const skill = testSkill("workspace-search", "Search the workspace safely.");
    const prompt = renderPiSystemPromptFrame({
      systemPrompt: "Stable system.",
      skills: [skill],
      selectedPromptTemplates: [],
    });

    expect(prompt).toContain('<skill name="workspace-search"');
    const wire = decodeAgentPromptWire(prompt.slice(prompt.indexOf("senera.resources=v1")), {
      expectedKind: "resources",
      expectedVersion: "1",
    });
    expect(wire.blocks.find((block) => block.id === "skills")?.value).toEqual({
      activeReferences: [],
      newlyDisclosed: [
        {
          kind: "skill",
          name: "workspace-search",
          description: "workspace-search description",
          location: "/skills/workspace-search/SKILL.md",
          state: "newly-disclosed",
          revision: expect.any(String),
        },
      ],
    });
  });

  test("rediscovers only the changed resource revision", () => {
    const skill = testSkill("workspace-search", "Search the workspace safely.");
    const changedSkill = testSkill("workspace-search", "Search the workspace with the updated workflow.");
    const template = testTemplate("workspace-guidance", "Use the workspace search workflow.");
    const ledger = new AgentPiPromptDisclosureLedger();

    const first = ledger.plan({ skills: [skill], selectedPromptTemplates: [template] });
    ledger.commit(first);

    const changed = ledger.plan({ skills: [changedSkill], selectedPromptTemplates: [template] });
    expect(changed.newSkills).toEqual([changedSkill]);
    expect(changed.reusedSkills).toHaveLength(0);
    expect(changed.newPromptTemplates).toHaveLength(0);
    expect(changed.reusedPromptTemplates).toHaveLength(1);
  });

  test("reset forces full disclosure after a compacted transcript", () => {
    const skill = testSkill("workspace-search", "Search the workspace safely.");
    const ledger = new AgentPiPromptDisclosureLedger();
    const first = ledger.plan({ skills: [skill], selectedPromptTemplates: [] });
    ledger.commit(first);

    expect(ledger.plan({ skills: [skill], selectedPromptTemplates: [] }).newSkills).toHaveLength(0);
    ledger.reset();
    expect(ledger.plan({ skills: [skill], selectedPromptTemplates: [] }).newSkills).toEqual([skill]);
  });

  test("template revisions include content rather than selection score", () => {
    const first = testTemplate("resource", "first");
    const second = { ...first, selectionScore: 99 };
    expect(agentPiPromptTemplateDisclosureKey(first)).toBe(agentPiPromptTemplateDisclosureKey(second));
    expect(agentPiPromptTemplateDisclosureKey(first)).not.toBe(
      agentPiPromptTemplateDisclosureKey({ ...first, content: "second" }),
    );
  });

  test("round-trips the compact checkpoint without persisting resource bodies", () => {
    const skill = testSkill("workspace-search", "Search the workspace safely.");
    const template = testTemplate("workspace-guidance", "Use the workspace search workflow.");
    const ledger = new AgentPiPromptDisclosureLedger();
    const plan = ledger.plan({ skills: [skill], selectedPromptTemplates: [template] });
    ledger.commit(plan);

    const state = ledger.state();
    expect(state).toEqual({
      version: 1,
      skillKeys: [expect.any(String)],
      promptTemplateKeys: [expect.any(String)],
    });
    expect(JSON.stringify(state)).not.toContain(skill.content);
    expect(JSON.stringify(state)).not.toContain(template.content);

    const restored = readAgentPiPromptDisclosureState([
      {
        type: "custom",
        id: "checkpoint",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "senera.prompt_disclosure",
        data: state,
      },
    ] as never);
    expect(restored.state).toEqual(state);
    expect(restored.invalidEntryId).toBeUndefined();
  });

  test("uses the latest reset checkpoint and rejects malformed state", () => {
    const reset = emptyAgentPiPromptDisclosureState();
    const entries = [
      {
        type: "custom",
        id: "old",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "senera.prompt_disclosure",
        data: { version: 1, skillKeys: ["old"], promptTemplateKeys: [] },
      },
      {
        type: "custom",
        id: "reset",
        parentId: "old",
        timestamp: new Date().toISOString(),
        customType: "senera.prompt_disclosure",
        data: reset,
      },
    ];
    expect(readAgentPiPromptDisclosureState(entries as never).state).toEqual(reset);
    expect(
      readAgentPiPromptDisclosureState([
        { ...entries[1], id: "invalid", data: { version: 1, skillKeys: [42], promptTemplateKeys: [] } },
      ] as never),
    ).toEqual({ state: reset, invalidEntryId: "invalid" });
  });

  test("treats a fork boundary as a disclosure reset until the fork records a new checkpoint", () => {
    const state = readAgentPiPromptDisclosureState([
      {
        type: "custom",
        id: "fork",
        parentId: "source",
        timestamp: new Date().toISOString(),
        customType: "senera.fork_boundary",
        data: { sourceSessionId: "source", entryId: "entry" },
      },
    ] as never);
    expect(state.state).toEqual(emptyAgentPiPromptDisclosureState());
  });
});

function testSkill(name: string, content: string): Skill {
  return {
    name,
    description: `${name} description`,
    content,
    filePath: `/skills/${name}/SKILL.md`,
  };
}

function testTemplate(name: string, content: string): AgentPiSelectedPromptTemplateFrame {
  return {
    name,
    description: `${name} description`,
    content,
    matchedTerms: [name],
    resourceKinds: ["workflow"],
    workflowRoles: ["execution"],
    selectionScore: 1,
  };
}
