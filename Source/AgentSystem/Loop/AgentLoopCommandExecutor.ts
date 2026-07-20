import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentActionPlannerContextBuilder } from "../ActionPlanner/AgentActionPlannerContext.js";
import { AgentPlanningCommandHandler } from "../ActionPlanner/AgentPlanningCommandHandler.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { AgentPiTurnExecutor } from "../Pi/AgentPiTurnExecutor.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type { AgentLoopCommand, AgentLoopCommandResult } from "./AgentLoopStateTypes.js";

export interface AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
  agentLoopConfig?: ResolvedAgentLoopConfig;
}

export class AgentLoopCommandExecutor {
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly planning: AgentPlanningCommandHandler;
  private readonly piTurn: AgentPiTurnExecutor;

  constructor(private readonly options: AgentLoopCommandExecutorOptions) {
    const agentLoopConfig = options.agentLoopConfig ?? options.runtime.agentLoopConfig;
    const actionPlannerContextBuilder = new AgentActionPlannerContextBuilder(
      options.runtime.workspaceRoot,
      options.runtime.artifactsConfig.RootDir,
      {
        stalledStepLag: options.runtime.actionPlannerConfig.Evidence.StalledStepLag,
      },
    );
    this.planning = new AgentPlanningCommandHandler({
      runtime: options.runtime,
      eventFactory: this.eventFactory,
      actionPlannerContextBuilder,
      agentLoopConfig,
    });
    this.piTurn = new AgentPiTurnExecutor({
      runtime: options.runtime,
    });
  }

  async execute(
    command: AgentLoopCommand,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    return matchByKind(command, {
      prepare_interaction: (entry) => this.planning.prepareInteraction(entry, onEvent, signal),
      render_prompt: (entry) => this.renderPrompt(entry),
      run_pi_turn: (entry) => this.piTurn.run(entry, onEvent, signal),
    });
  }

  private async renderPrompt(
    command: Extract<AgentLoopCommand, { kind: "render_prompt" }>,
  ): Promise<AgentLoopCommandResult> {
    const template = this.options.runtime.registry.getTemplate("BaseSystemPrompt");
    if (!template) {
      throw new Error("BaseSystemPrompt 模板没有注册。");
    }

    const toolDescription = this.options.runtime.config.PluginDocumentation?.ToolDescription;
    const roleplayPreset = await this.options.runtime.services.promptContext.promptRoleplayPreset();

    const prompt = await this.options.runtime.promptRenderer.renderFile(template.path, {
      ...this.options.runtime.services.promptContext.buildBaseContext({
        loadedToolNames: command.loadedToolNames,
        rootCommand: command.rootCommand,
        roleplayPreset,
        skillQuery: command.input,
        activeSkills: command.activeSkills,
        toolSections: {
          summary: toolDescription?.SummarySection,
          trigger: toolDescription?.TriggerSection,
          avoid: toolDescription?.AvoidSection,
        },
      }),
    });
    const renderedPrompt = command.systemPromptPreamble ? `${command.systemPromptPreamble}\n\n${prompt}` : prompt;

    return {
      kind: "succeeded",
      output: {
        kind: "prompt_rendered",
        requestId: command.requestId,
        step: command.step,
        prompt: renderedPrompt,
        promptTokenCount: this.options.runtime.tokenEstimator.estimate(renderedPrompt).tokenCount,
      },
    };
  }
}
