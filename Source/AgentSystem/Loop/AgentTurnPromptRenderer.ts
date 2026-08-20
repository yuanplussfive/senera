import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import { resolveAgentTurnPromptProfile } from "./AgentTurnPromptProfile.js";
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";

interface AgentRenderedTurnPrompt {
  text: string;
  tokenCount: number;
}

export interface AgentDelegatedRolePromptContext {
  readonly enabled: boolean;
  readonly mode: AgentSystemPromptLayer["mode"];
  readonly content: string;
}

export function projectAgentDelegatedRolePromptContext(
  layer?: AgentSystemPromptLayer,
): AgentDelegatedRolePromptContext {
  return layer
    ? { enabled: true, mode: layer.mode, content: layer.content }
    : { enabled: false, mode: "append", content: "" };
}

export class AgentTurnPromptRenderer {
  constructor(private readonly runtime: AgentSystemRuntime) {}

  async render(input: {
    loadedToolNames: string[];
    rootCommand: AgentRootCommand;
    toolPlanningMode: AgentModelToolPlanningMode;
    systemPromptLayer?: AgentSystemPromptLayer;
  }): Promise<AgentRenderedTurnPrompt> {
    const profile = resolveAgentTurnPromptProfile(input.toolPlanningMode);
    const template = this.runtime.registry.getTemplate(profile.templateName);
    if (!template) {
      throw new Error(`Agent turn prompt template is not registered: ${profile.templateName}.`);
    }

    const toolDescription = this.runtime.config.ToolDocumentation?.ToolDescription;
    const roleplayPreset = await this.runtime.services.promptContext.promptRoleplayPreset();
    const rendered = await this.runtime.promptRenderer.renderFile(template.path, {
      ...this.runtime.services.promptContext.buildBaseContext({
        loadedToolNames: input.loadedToolNames,
        rootCommand: input.rootCommand,
        roleplayPreset,
        toolSections: {
          summary: toolDescription?.SummarySection,
          trigger: toolDescription?.TriggerSection,
          avoid: toolDescription?.AvoidSection,
        },
      }),
      DelegatedRole: projectAgentDelegatedRolePromptContext(input.systemPromptLayer),
    });
    const text = rendered;
    return {
      text,
      tokenCount: this.runtime.tokenEstimator.estimate(text).tokenCount,
    };
  }
}
