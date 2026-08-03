import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";
import { SkillManageSystemTool } from "./SkillManageSystemTool.js";
import { LearningManageSystemTool } from "./LearningManageSystemTool.js";
import { createDocumentExtractSystemTool } from "./DocumentExtractSystemTool.js";
import { createImageAnalyzeSystemTool } from "./ImageAnalyzeSystemTool.js";

export function createAgentSystemTools(
  config: AgentSystemConfig,
  modelProviderId?: string,
): readonly AgentSystemToolDefinition[] {
  return [
    SkillManageSystemTool,
    LearningManageSystemTool,
    createDocumentExtractSystemTool(config.Extensions?.["agent-document-tools"]?.Configuration),
    createImageAnalyzeSystemTool(config.Extensions?.["agent-image-tools"]?.Configuration, modelProviderId),
  ];
}
