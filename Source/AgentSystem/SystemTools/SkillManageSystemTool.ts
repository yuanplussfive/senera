import { z } from "zod";
import { AgentManagedExtensionService } from "../ManagedExtensions/AgentManagedExtensionService.js";
import { AgentSkillRecommendedToolsSchema } from "../Skills/AgentSkillToolBinding.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";

const SkillName = z.string().trim().min(1).describe("Lowercase kebab-case Skill directory name.");
const SkillDescription = z.string().trim().min(1).describe("Trigger-focused Skill description.");
const SkillInstructions = z.string().trim().min(1).describe("Initial or replacement SKILL.md instructions.");
const RecommendedTools = AgentSkillRecommendedToolsSchema.describe(
  "Exact registered tool names to prioritize whenever this Skill activates. Omit when no specific tool is required.",
);

const SkillManageInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: SkillName,
      description: SkillDescription,
      instructions: SkillInstructions,
      recommendedTools: RecommendedTools.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      name: SkillName,
      description: SkillDescription.optional(),
      instructions: SkillInstructions.optional(),
      recommendedTools: RecommendedTools.optional(),
    })
    .strict(),
  z.object({ action: z.literal("validate"), name: SkillName }).strict(),
  z.object({ action: z.literal("remove"), name: SkillName }).strict(),
]);

const SkillManageOutput = z
  .object({
    status: z.enum(["created", "updated", "valid", "removed"]),
    action: z.enum(["create", "update", "validate", "remove"]),
    name: z.string(),
    path: z.string().optional(),
    diagnostics: z.object({ item: z.array(z.object({}).passthrough()) }).strict(),
    recommendedTools: z.array(z.string()),
    guidance: z.string(),
  })
  .strict();

export const SkillManageSystemTool = defineSystemTool({
  extension: {
    name: "agent-skill-manager",
    displayName: {
      "zh-CN": "技能管理",
      "en-US": "Skill Management",
    },
    description: {
      "zh-CN": "创建、校验、原子更新和移除工作区技能包。",
      "en-US": "Creates, validates, atomically updates, and removes workspace Skills.",
    },
    priority: 2,
    skills: ["skill-creator"],
  },
  metadata: {
    observation: StandardAgentToolObservationProjection,
    description:
      "Create, update, validate, or remove a standard Skill package under .senera/skills, including optional bindings to registered tools.",
    permissions: ["filesystem:write:.senera/skills"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadWrite" },
    search: {
      Summary: "创建、更新、校验或移除标准 SKILL.md 技能包。",
      Tags: ["创建技能", "Skill", "工作流", "技能包", "热更新"],
      Capabilities: [
        {
          Id: "skill.manage",
          Title: "Skill management",
          Description: "Manage draft and published standard Skill packages in the workspace.",
          Facets: {
            Actions: ["create", "update", "validate", "remove"],
            Targets: ["skill", "skill-package"],
            Inputs: ["name", "description", "instructions", "recommended-tools"],
            Outputs: ["skill-package", "diagnostics"],
            Effects: ["workspace-change", "runtime-refresh"],
          },
          Aliases: ["创建 skill", "添加技能", "校验 skill", "更新工作流"],
          Risk: { SideEffect: "workspace-change", Permission: "write" },
        },
      ],
      UseCases: ["用户要求创建可复用工作流、维护 SKILL.md 或发布 Skill 包。"],
      Examples: ["创建一个 JSON 字段选择 Skill", "校验刚写好的技能"],
      Avoid: ["不要用于创建原生工具、MCP server 或普通项目源码。"],
    },
  },
  name: "SkillManage",
  input: SkillManageInput,
  output: SkillManageOutput,
  execute(input, context) {
    return SkillManageOutput.parse(
      new AgentManagedExtensionService(context.workspaceRoot, context.registry).manageSkill(input),
    );
  },
});
