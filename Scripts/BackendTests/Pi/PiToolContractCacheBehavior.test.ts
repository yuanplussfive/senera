import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatSkillInvocation } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiToolRegistryProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import type { AgentPiToolExecutionBridge } from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { renderPiSystemPromptFrame } from "../../../Source/AgentSystem/Pi/AgentPiPromptFrameProjector.js";
import {
  projectAgentPiActivatedSkills,
  projectAgentPiSkillCatalog,
} from "../../../Source/AgentSystem/Pi/AgentPiSkillCatalog.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import type { AgentActivatedSkill } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentTodoToolNames } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";

describe("Pi tool contract cache behavior", () => {
  test("registers immutable contracts and reuses parameter schemas across turn projections", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);
    const tools = registry.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "AgentSpawn",
        "AgentWait",
        "AgentInput",
        "AgentStop",
        "AgentResume",
        "AgentScheduleManage",
      ]),
    );
    for (const tool of tools) {
      expect(tool.contract?.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(tool.contract)).toBe(true);
      expect(Object.isFrozen(tool.contract?.arguments?.jsonSchema)).toBe(true);
    }

    const first = projector.project({ requestId: "request-1" });
    const second = projector.project({ requestId: "request-2" });

    expect(second.map((tool) => tool.parameters)).toEqual(first.map((tool) => tool.parameters));
    second.forEach((tool, index) => expect(tool.parameters).toBe(first[index]?.parameters));
    for (const toolName of ["SkillManage", "GitInspect", "GitMutate", "AgentScheduleManage"]) {
      expect(second.find((tool) => tool.name === toolName)?.parameters, toolName).toMatchObject({ type: "object" });
    }
  }, 15_000);

  test("projects split Todo tools to Pi without widening the update contract", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);

    const tools = projector.project();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(Object.values(AgentTodoToolNames)));

    const update = tools.find((tool) => tool.name === AgentTodoToolNames.Update);
    const schema = update?.parameters as {
      readonly properties?: {
        readonly updates?: {
          readonly items?: { readonly anyOf?: readonly { readonly required?: readonly string[] }[] };
        };
      };
    };
    expect(schema.properties?.updates?.items?.anyOf?.map((branch) => branch.required)).toEqual([
      ["id", "status"],
      ["id", "content"],
      ["id", "content", "status"],
    ]);
  });

  test("projects the validated Skill body without discovering or reading it again", () => {
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
      content: skill.content,
      matchedTerms: ["workflow"],
      matchedFields: [{ term: "workflow", fields: ["description"] }],
      score: 1,
    };

    const projectedSkill = projectAgentPiActivatedSkills([activeSkill])[0];
    if (!projectedSkill) throw new Error("Missing projected execution-workflow Skill.");

    expect(projectedSkill.content).toContain("# Execution Workflow");
    expect(projectedSkill.filePath).toBe(`senera://skills/${skill.name}/SKILL.md`);
    expect(formatSkillInvocation(projectedSkill)).toContain(
      `References are relative to senera://skills/${skill.name}.`,
    );
  });

  test("uses the registry winner for colliding names and keeps an activated revision across updates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-pi-skills-"));
    try {
      const systemFile = writeSkill(root, "system/shared-skill", "shared-skill", "System body.");
      const projectFile = writeSkill(root, "project/shared-skill", "shared-skill", "Project body.");
      const scanner = new AgentSkillScanner();
      const registry = new AgentExtensionRegistry();
      registry.registerSkill({
        ...scanner.readSkillDirectory(path.dirname(systemFile)),
        source: { kind: "system", id: "shared-skill", displayName: "System", priority: 10 },
      });
      registry.registerSkill(scanner.readSkillDirectory(path.dirname(projectFile)));
      const firstCatalog = projectAgentPiSkillCatalog(registry.listSkills());
      expect(firstCatalog.skills).toHaveLength(1);
      expect(firstCatalog.skills[0]?.filePath).toBe(systemFile);

      const activated = activatedSkill("shared-skill", systemFile);
      const turnCatalog = projectAgentPiSkillCatalog(registry.listSkills(), [activated]);
      fs.rmSync(path.dirname(systemFile), { recursive: true });
      registry.removeSkills("system:shared-skill");
      expect(projectAgentPiActivatedSkills([activated])[0]?.content).toBe("System body.");
      expect(projectAgentPiSkillCatalog(registry.listSkills(), [activated])).toEqual(turnCatalog);
      const nextCatalog = projectAgentPiSkillCatalog(registry.listSkills());
      expect(nextCatalog.skills[0]?.filePath).toBe(projectFile);
      expect(nextCatalog.fingerprint).not.toBe(firstCatalog.fingerprint);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("projects selected Skill metadata without injecting bodies into the request", () => {
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

    expect(prompt).not.toContain(markdownWithEof);
    expect(prompt).not.toContain(plainMarkdown);
    expect(prompt).toContain("yaml-skill");
    expect(prompt).toContain("plain-skill");
    expect(prompt).not.toContain("/skills/yaml/SKILL.md");
    expect(prompt).not.toContain("/skills/plain/SKILL.md");
    expect(prompt).not.toContain("revision:");
    expect(prompt).toContain("load-complete-bodies-on-demand");
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

  test("changes the tool fingerprint when an internal resource contract changes", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);

    const first = projector.createToolSet().fingerprint;
    const tool = registry.listTools().find((candidate) => candidate.name === "WorkspaceApplyPatch");
    if (!tool) throw new Error("Missing WorkspaceApplyPatch.");
    const replacement = {
      ...tool,
      handler: {
        ...tool.handler,
        resources: (tool.handler.resources ?? []).map((resource, index) =>
          index === 0 ? { ...resource, Parameters: { ...resource.Parameters, Intent: "replace" } } : resource,
        ),
      },
    };
    registry.replaceToolExtension(tool.owner, [replacement]);

    expect(projector.createToolSet().fingerprint).not.toBe(first);
  });

  test("removes the execution selector when a dual-target tool is Local-only at runtime", () => {
    const registry = new AgentExtensionRegistry();
    let availableExecutionTargets: Array<"Local" | "Sandbox"> = ["Local"];
    const projector = toolProjector(registry, () => availableExecutionTargets);
    registerSystemTools(registry);

    const localOnly = projector.project().find((tool) => tool.name === "ShellCommandTool");
    expect(localOnly?.parameters.properties).not.toHaveProperty("executionTarget");
    const localFingerprint = projector.createToolSet().fingerprint;

    availableExecutionTargets = ["Local", "Sandbox"];
    const sandboxEnabled = projector.project().find((tool) => tool.name === "ShellCommandTool");
    expect(sandboxEnabled?.parameters.properties).toMatchObject({
      executionTarget: { enum: ["Sandbox", "Local"] },
    });
    expect(projector.createToolSet().fingerprint).not.toBe(localFingerprint);
  });
});

function toolProjector(
  registry: AgentExtensionRegistry,
  availableExecutionTargets?: () => readonly ("Local" | "Sandbox")[],
): AgentPiToolRegistryProjector {
  return new AgentPiToolRegistryProjector({
    config: { ModelProviders: [] },
    registry,
    toolPlanningMode: "baml",
    execution: {
      execute: async () => ({ content: [], details: { senera: { toolName: "test", result: {} } } }),
    } as unknown as AgentPiToolExecutionBridge,
    availableExecutionTargets,
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
    content: new AgentSkillScanner().readSkillDirectory(path.dirname(descriptionFile), name).content,
    matchedTerms: [],
    matchedFields: [],
    score: 1,
  };
}
