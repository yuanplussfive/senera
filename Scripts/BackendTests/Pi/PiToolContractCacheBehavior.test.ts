import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatSkillInvocation } from "@earendil-works/pi-agent-core";
import { loadSkills, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { toPosixPath } from "../../../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiToolRegistryProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import type { AgentPiToolExecutionBridge } from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { renderPiSystemPromptFrame } from "../../../Source/AgentSystem/Pi/AgentPiPromptFrameProjector.js";
import { AgentPiSkillResolver } from "../../../Source/AgentSystem/Pi/AgentPiSkillResolver.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import type { AgentActivatedSkill } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";

describe("Pi tool contract cache behavior", () => {
  test("registers immutable contracts and reuses parameter schemas across turn projections", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);
    const tools = registry.listTools();

    expect(tools).toHaveLength(19);
    for (const tool of tools) {
      expect(tool.contract?.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(tool.contract)).toBe(true);
      expect(Object.isFrozen(tool.contract?.arguments?.jsonSchema)).toBe(true);
    }

    const first = projector.project({ requestId: "request-1" });
    const second = projector.project({ requestId: "request-2" });

    expect(second.map((tool) => tool.parameters)).toEqual(first.map((tool) => tool.parameters));
    second.forEach((tool, index) => expect(tool.parameters).toBe(first[index]?.parameters));
  }, 15_000);

  test("resolves activated Skills from the Pi resource catalog by stable file identity", () => {
    const skill = new AgentSkillScanner()
      .scanRoot(path.resolve("System/Skills"))
      .find((candidate) => candidate.name === "execution-workflow");
    if (!skill) throw new Error("Missing execution-workflow System Skill.");
    const activeSkill = {
      name: skill.name,
      revision: skill.revision ?? skill.source.id,
      title: skill.name,
      summary: skill.description,
      useCases: [],
      avoid: [],
      recommendedTools: [],
      evidenceRequirements: [],
      descriptionFile: skill.descriptionFile,
      matchedTerms: ["workflow"],
      matchedFields: [{ term: "workflow", fields: ["description"] }],
      score: 1,
    };

    const catalog = loadSkillsFromDir({ dir: path.dirname(skill.descriptionFile), source: "system" });
    const projectedSkill = new AgentPiSkillResolver().resolve([activeSkill], catalog)[0];
    if (!projectedSkill) throw new Error("Missing projected execution-workflow Skill.");

    expect(projectedSkill.content).toContain("# Execution Workflow");
    expect(projectedSkill.filePath).toBe(toPosixPath(skill.descriptionFile));
    expect(formatSkillInvocation(projectedSkill)).toContain(
      `References are relative to ${path.dirname(skill.descriptionFile).split(path.sep).join(path.posix.sep)}.`,
    );
  });

  test("rejects colliding or path-mismatched Pi Skill identities", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-pi-skills-"));
    try {
      const first = writeSkill(root, "first", "shared-skill", "First body.");
      writeSkill(root, "second", "shared-skill", "Second body.");
      const catalog = loadSkills({ cwd: root, agentDir: root, skillPaths: [root], includeDefaults: false });
      const resolver = new AgentPiSkillResolver();

      expect(() => resolver.resolve([activatedSkill("shared-skill", first)], catalog)).toThrow(/ambiguous between/u);
      expect(() =>
        resolver.resolve(
          [activatedSkill(catalog.skills[0]?.name ?? "missing", path.join(root, "absent", "SKILL.md"))],
          { skills: catalog.skills.slice(0, 1), diagnostics: [] },
        ),
      ).toThrow(/absent from the Pi ResourceLoader catalog/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("injects selected Skill bodies once as unmodified Markdown with optional author comments", () => {
    const markdownWithEof = [
      "# YAML Skill",
      "",
      "```yaml",
      "enabled: true",
      "```",
      "",
      "<!-- YAML_SKILL_EOF: Complete skill. -->",
    ].join("\n");
    const plainMarkdown = "# Plain Skill\n\nNo terminal comment is required.";
    const prompt = renderPiSystemPromptFrame({
      systemPrompt: "System instructions.",
      skills: [
        {
          name: "yaml-skill",
          description: "YAML workflow",
          content: markdownWithEof,
          filePath: "/skills/yaml/SKILL.md",
        },
        {
          name: "plain-skill",
          description: "Plain workflow",
          content: plainMarkdown,
          filePath: "/skills/plain/SKILL.md",
        },
      ],
      selectedPromptTemplates: [],
    });

    expect(prompt.split(markdownWithEof)).toHaveLength(2);
    expect(prompt.split(plainMarkdown)).toHaveLength(2);
    expect(prompt).toContain("```yaml\nenabled: true\n```");
    expect(prompt).toContain("<!-- YAML_SKILL_EOF: Complete skill. -->");
    expect(prompt).not.toContain("<code_block>");
    expect(prompt).not.toContain("<matched_terms>");
    expect(prompt).not.toContain("<available_skills>");
  });

  test("changes the tool fingerprint when a projected descriptor changes", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);

    const first = projector.createToolSet().fingerprint;
    const tool = registry.listTools()[0]!;
    (tool.owner as { title?: string }).title = `${tool.owner.title ?? tool.name} (updated)`;

    expect(projector.createToolSet().fingerprint).not.toBe(first);
  });
});

function toolProjector(registry: AgentExtensionRegistry): AgentPiToolRegistryProjector {
  return new AgentPiToolRegistryProjector({
    config: { ModelProviders: [] },
    registry,
    execution: {
      execute: async () => ({ content: [], details: { senera: { toolName: "test", result: {} } } }),
    } as unknown as AgentPiToolExecutionBridge,
  });
}

function registerSystemTools(registry: AgentExtensionRegistry): void {
  const definitions = createAgentSystemTools({ ModelProviders: [] });
  new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
  });
}

function writeSkill(root: string, directory: string, name: string, body: string): string {
  const skillRoot = path.join(root, directory);
  fs.mkdirSync(skillRoot, { recursive: true });
  const filePath = path.join(skillRoot, "SKILL.md");
  fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: Verification Skill.\n---\n\n${body}\n`, "utf8");
  return filePath;
}

function activatedSkill(name: string, descriptionFile: string): AgentActivatedSkill {
  return {
    name,
    revision: "verification",
    title: name,
    summary: "Verification Skill.",
    useCases: [],
    avoid: [],
    recommendedTools: [],
    evidenceRequirements: [],
    descriptionFile,
    matchedTerms: [],
    matchedFields: [],
    score: 1,
  };
}
