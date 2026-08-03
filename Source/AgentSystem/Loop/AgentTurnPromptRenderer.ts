import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";

interface AgentRenderedTurnPrompt {
  text: string;
  tokenCount: number;
}

export class AgentTurnPromptRenderer {
  constructor(private readonly runtime: AgentSystemRuntime) {}

  async render(input: {
    loadedToolNames: string[];
    rootCommand: AgentRootCommand;
    systemPromptPreamble?: string;
  }): Promise<AgentRenderedTurnPrompt> {
    const template = this.runtime.registry.getTemplate("BaseSystemPrompt");
    if (!template) {
      throw new Error("BaseSystemPrompt 模板没有注册。");
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
    });
    const text = input.systemPromptPreamble ? `${input.systemPromptPreamble}\n\n${rendered}` : rendered;
    return {
      text,
      tokenCount: this.runtime.tokenEstimator.estimate(text).tokenCount,
    };
  }
}
