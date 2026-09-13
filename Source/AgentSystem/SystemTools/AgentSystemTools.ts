import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";
import { SkillManageSystemTool } from "./SkillManageSystemTool.js";
import { LearningManageSystemTool } from "./LearningManageSystemTool.js";
import { createDocumentExtractSystemTool } from "./DocumentExtractSystemTool.js";
import { createImageAnalyzeSystemTool } from "./ImageAnalyzeSystemTool.js";
import { PiWorkspaceSystemTools } from "./PiWorkspaceSystemTools.js";
import { AgentGitSystemTools } from "./AgentGitSystemTools.js";
import { createWebSystemTools } from "./WebSystemTools.js";
import { createAgentBrowserSystemTools } from "./AgentBrowserSystemTools.js";
import { AgentTodoSystemTool } from "./AgentTodoSystemTool.js";
import { createSeneraSelfSystemTools } from "./SeneraSelfSystemTool.js";
import type { AgentBrowserRuntime } from "../Browser/AgentBrowserRuntime.js";
import { isAgentSystemExtensionApplicable, type AgentSystemExtensionPlatform } from "./AgentSystemExtensionPlatform.js";
import type { AgentSelfServicePort } from "../SelfService/AgentSelfServiceTypes.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";

export interface AgentSystemToolsRuntimeOptions {
  readonly browserRuntime?: AgentBrowserRuntime;
  readonly platform?: AgentSystemExtensionPlatform;
  readonly selfService?: AgentSelfServicePort;
  readonly approvalRuntime?: AgentApprovalRuntime;
}

export function createAgentSystemTools(
  config: AgentSystemConfig,
  modelProviderId?: string,
  options: AgentSystemToolsRuntimeOptions = {},
): readonly AgentSystemToolDefinition[] {
  const definitions = [
    SkillManageSystemTool,
    LearningManageSystemTool,
    AgentTodoSystemTool,
    createDocumentExtractSystemTool(config.Extensions?.["agent-document-tools"]?.Configuration),
    createImageAnalyzeSystemTool(config.Extensions?.["agent-image-tools"]?.Configuration, modelProviderId),
    ...PiWorkspaceSystemTools,
    ...AgentGitSystemTools,
    ...createWebSystemTools(config.Extensions?.["web-tools"]?.Configuration),
    ...createAgentBrowserSystemTools(config.Extensions?.["agent-browser"]?.Configuration, options.browserRuntime),
    ...createSeneraSelfSystemTools(options.selfService, options.approvalRuntime),
  ];
  return definitions.filter((definition) =>
    isAgentSystemExtensionApplicable(definition.extension.platforms, options.platform),
  );
}
