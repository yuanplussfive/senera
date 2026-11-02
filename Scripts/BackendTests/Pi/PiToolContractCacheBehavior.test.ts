import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { createAgentToolExecutionDigest } from "../../../Source/AgentSystem/ToolContracts/AgentToolContractIdentity.js";
import { createAgentToolContractDelivery } from "../../../Source/AgentSystem/ToolSearch/AgentToolContractDelivery.js";
import { createAgentPiToolObservation } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentToolDescriptionProtocol } from "../../../Source/AgentSystem/ToolSearch/AgentToolMetaToolProtocol.js";
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
import {
  createAgentSystemTools,
  listAgentSystemExtensionHostCapabilityUniverse,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentTodoToolNames } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";
import type { AgentTodoService } from "../../../Source/AgentSystem/Todos/AgentTodoService.js";

describe("Pi tool contract cache behavior", () => {
  test("keeps delivered image contracts across UI and execution updates but invalidates hidden schema changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-tool-identity-"));
    try {
      fs.mkdirSync(path.join(root, "explore"));
      fs.copyFileSync("System/Extensions/explore/domain.json", path.join(root, "explore/domain.json"));
      fs.cpSync("System/Extensions/explore/agent-image-tools", path.join(root, "explore/agent-image-tools"), {
        recursive: true,
      });
      const file = path.join(root, "explore/agent-image-tools/tools/ImageGenerate.tool.json");
      const source = JSON.parse(fs.readFileSync(file, "utf8"));
      const readTool = () => {
        const catalog = new AgentExtensionRegistry();
        new AgentSystemExtensionCatalog().registerRoot(catalog, root, {
          capabilities: new Set(
            ["ImageGenerate", "ImageModels", "ImageAnalyze"].map((name) => `system.tool.agent-image-tools.${name}`),
          ),
        });
        return catalog.getTool("ImageGenerate")!;
      };
      const original = readTool();
      const registry = new AgentExtensionRegistry();
      registry.registerToolExtension(original.owner, [original]);
      const execute = vi.fn(async () => ({ content: [], details: {} }));
      const projector = new AgentPiToolRegistryProjector({
        config: { ModelProviders: [] },
        registry,
        toolPlanningMode: "baml",
        execution: { execute } as unknown as AgentPiToolExecutionBridge,
        availableExecutionTargets: () => ["Local"],
      });
      const delivery = createAgentToolContractDelivery(original, ["Local"]);
      const context: Context = {
        messages: [
          {
            role: "toolResult",
            toolCallId: "describe",
            toolName: "ToolDescribe",
            isError: false,
            timestamp: 1,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  createAgentPiToolObservation({
                    status: "success",
                    execution_status: "completed",
                    output_availability: "complete",
                    detail: {
                      evidence: [],
                      result: { type: AgentToolDescriptionProtocol.type, tools: [delivery.description] },
                    },
                  }),
                ),
              },
            ],
            details: { senera: { toolContractReceipts: [delivery.receipt] } },
          },
        ],
      };
      const exposure = new AgentToolExposureState(
        createAgentToolAccessGrant({
          authorizedToolNames: [original.name],
          exposedToolNames: [original.name],
        }),
      );
      const initial = projector.createToolSet();
      const callable = initial.materialize(() => ({}))[0]!;

      source.presentation.icon = "image";
      source.search.Capabilities[0].Title = "Create an image";
      const manifestPath = path.join(root, "explore/agent-image-tools/extension.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.displayName = { "zh-CN": "图像工具", "en-US": "Image tools" };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.writeFileSync(file, JSON.stringify(source));
      const restyled = readTool();
      registry.replaceToolExtension(restyled.owner, [restyled]);
      expect(restyled.owner.revision).not.toBe(original.owner.revision);
      expect(restyled.contract?.digest).toBe(original.contract?.digest);
      expect(projector.createToolSet().fingerprint).toBe(initial.fingerprint);
      projector.synchronizeContractEvidence(context, exposure);
      expect(exposure.hasConfirmedContract(restyled.name, restyled.contract?.digest)).toBe(true);
      await callable.execute("restyled", { prompt: "Draw a tree" });
      expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ tool: restyled }));

      source.runtime.MaxConcurrency = 2;
      fs.writeFileSync(file, JSON.stringify(source));
      const reconfigured = readTool();
      registry.replaceToolExtension(reconfigured.owner, [reconfigured]);
      expect(reconfigured.contract?.digest).toBe(original.contract?.digest);
      expect(createAgentToolExecutionDigest(reconfigured)).not.toBe(createAgentToolExecutionDigest(original));
      expect(projector.createToolSet().fingerprint).not.toBe(initial.fingerprint);
      projector.synchronizeContractEvidence(context, exposure);
      expect(exposure.hasConfirmedContract(reconfigured.name, reconfigured.contract?.digest)).toBe(true);
      await expect(callable.execute("stale", { prompt: "Draw a tree" })).rejects.toThrow("ImageGenerate");
      expect(execute).toHaveBeenCalledOnce();

      source.inputSchema.properties.prompt.minLength = 2;
      fs.writeFileSync(file, JSON.stringify(source));
      const constrained = readTool();
      registry.replaceToolExtension(constrained.owner, [constrained]);
      expect(constrained.contract?.digest).not.toBe(original.contract?.digest);
      expect(createAgentToolContractDelivery(constrained, ["Local"]).description[2]).toEqual(delivery.description[2]);
      projector.synchronizeContractEvidence(context, exposure);
      expect(exposure.hasConfirmedContract(constrained.name, constrained.contract?.digest)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("registers immutable contracts and reuses parameter schemas across turn projections", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);
    const tools = registry.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["subagent", "send_message", "list_agents", "interrupt_agent", "schedule_edit"]),
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
    for (const toolName of ["SkillManage", "GitInspect", "GitMutate", "schedule_edit"]) {
      expect(second.find((tool) => tool.name === toolName)?.parameters, toolName).toMatchObject({ type: "object" });
    }
  }, 15_000);

  test("projects the full replacement Todo contract without inventing item IDs", () => {
    const registry = new AgentExtensionRegistry();
    const projector = toolProjector(registry);
    registerSystemTools(registry);
    const tools = projector.project();
    const write = tools.find((tool) => tool.name === AgentTodoToolNames.Write);
    expect(write?.parameters).toMatchObject({
      type: "object",
      required: ["todos"],
      additionalProperties: false,
      properties: { todos: { type: "array", items: { required: ["content", "status"], additionalProperties: false } } },
    });
    expect(tools.some((tool) => ["TodoAdd", "TodoUpdate", "TodoRead"].includes(tool.name))).toBe(false);
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
    expect(prompt).toContain("on-demand");
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
    tool.description = `${tool.description ?? tool.name} (updated instructions)`;

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
  const definitions = createAgentSystemTools({ ModelProviders: [] }, undefined, {
    todos: {} as AgentTodoService,
  });
  new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
    capabilityUniverse: listAgentSystemExtensionHostCapabilityUniverse({ ModelProviders: [] }),
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
