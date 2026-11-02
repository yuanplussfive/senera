import {
  AgentManagedExtensionService,
  type AgentManagedSkillInput,
} from "../ManagedExtensions/AgentManagedExtensionService.js";
import { defineSystemTool, systemToolArguments } from "./AgentSystemToolDefinition.js";

export const SkillManageSystemTool = defineSystemTool({
  capability: "system.tool.agent-skill-manager.SkillManage",
  execute(input, context) {
    const arguments_ = systemToolArguments<AgentManagedSkillInput & Record<string, unknown>>(input);
    return new AgentManagedExtensionService(context.workspaceRoot, context.registry).manageSkill(arguments_);
  },
});
