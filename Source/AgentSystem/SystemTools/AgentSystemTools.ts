import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { listDefaultAgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import type { AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";
import { SkillManageSystemTool } from "./SkillManageSystemTool.js";
import { createCodemodeSystemTool } from "./CodemodeSystemTool.js";
import { createDocumentExtractSystemTool } from "./DocumentExtractSystemTool.js";
import { createImageAnalyzeSystemTool } from "./ImageAnalyzeSystemTool.js";
import { createImageGenerateSystemTools } from "./ImageGenerateSystemTool.js";
import { ResourcePathSystemTool } from "./ResourcePathSystemTool.js";
import { PiWorkspaceSystemTools } from "./PiWorkspaceSystemTools.js";
import { AgentGitSystemTools } from "./AgentGitSystemTools.js";
import { createWebSystemTools } from "./WebSystemTools.js";
import { createAgentBrowserSystemTools } from "./AgentBrowserSystemTools.js";
import { AgentTodoSystemTools } from "./AgentTodoSystemTool.js";
import type { AgentBrowserRuntime } from "../Browser/AgentBrowserRuntime.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";
import type { AgentChannelToolPort } from "../Channels/AgentChannelToolPort.js";
import { AgentChannelToolCapabilities, createAgentChannelSystemTools } from "../Channels/AgentChannelSystemTools.js";

export interface AgentSystemToolsRuntimeOptions {
  readonly browserRuntime?: AgentBrowserRuntime;
  readonly model?: string;
  readonly resolveModel?: (configuredModelId: string) => string;
  readonly todos?: AgentTodoService;
  readonly imageNormalization?: AgentImageNormalizationService;
  /** Channel-scoped operations are injected by the host after channel lifecycle assembly. */
  readonly channelTools?: AgentChannelToolPort;
}

export function createAgentSystemTools(
  config: AgentSystemConfig,
  modelProviderId?: string,
  options: AgentSystemToolsRuntimeOptions = {},
): readonly AgentSystemToolDefinition[] {
  return [
    createCodemodeSystemTool(config.Extensions?.codemode?.Configuration),
    SkillManageSystemTool,
    ...(options.todos ? AgentTodoSystemTools : []),
    createDocumentExtractSystemTool(config.Extensions?.["agent-document-tools"]?.Configuration),
    createImageAnalyzeSystemTool(config.Extensions?.["agent-image-tools"]?.Configuration, modelProviderId, {
      imageNormalization: options.imageNormalization,
    }),
    ...createImageGenerateSystemTools(
      config.Extensions?.["agent-image-tools"]?.Configuration,
      options.imageNormalization,
    ),
    ResourcePathSystemTool,
    ...PiWorkspaceSystemTools,
    ...AgentGitSystemTools,
    ...createWebSystemTools(config.Extensions?.["web-tools"]?.Configuration, {
      browserRuntime: options.browserRuntime,
      model: options.model,
      resolveModel: options.resolveModel,
    }),
    ...createAgentBrowserSystemTools(config.Extensions?.["agent-browser"]?.Configuration, options.browserRuntime),
    ...(options.channelTools ? createAgentChannelSystemTools(options.channelTools) : []),
  ];
}

/**
 * Complete implementation capability namespace used by package verification
 * and settings discovery. It describes executable bindings only; a runtime
 * still publishes only definitions whose dependency was explicitly supplied.
 */
export function listAgentSystemToolImplementationCapabilities(
  config: AgentSystemConfig,
  modelProviderId?: string,
): ReadonlySet<string> {
  return new Set([
    ...createAgentSystemTools(config, modelProviderId).map((definition) => definition.capability),
    ...AgentTodoSystemTools.map((definition) => definition.capability),
    ...Object.values(AgentChannelToolCapabilities),
  ]);
}

/**
 * Complete host-capability namespace understood by bundled System extension
 * packages. It is intentionally distinct from a composition's live bindings:
 * the catalog uses this set to validate package declarations, while a runtime
 * publishes only capabilities that its concrete services actually bound.
 */
export function listAgentSystemExtensionHostCapabilityUniverse(
  config: AgentSystemConfig,
  modelProviderId?: string,
): ReadonlySet<string> {
  return new Set([
    ...listDefaultAgentHostCapabilityNames(),
    ...listAgentSystemToolImplementationCapabilities(config, modelProviderId),
  ]);
}
