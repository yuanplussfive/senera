import { type AgentEventSink, withEventContext } from "../Events/AgentEvent.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentChildAgentRunResult } from "./AgentChildAgentRuntime.js";
import {
  AgentMergePromptBuilder,
  type AgentMergePrompt,
} from "./AgentMergePromptBuilder.js";
import type { AgentDelegationPlan } from "./AgentDelegationPlan.js";

export interface AgentMergePolicyExecutorOptions {
  workspaceRoot: string;
  systemTemplateFile: string;
  model: AgentLanguageModel;
}

export interface AgentMergePolicyRunInput {
  requestId: string;
  step: number;
  plan: AgentDelegationPlan;
  childResults: readonly AgentChildAgentRunResult[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export interface AgentMergePolicyRunResult {
  workflowName: string;
  mergePolicyName: string;
  status: "completed";
  mode: "directModel";
  text: string;
  prompt: AgentMergePrompt;
}

export class AgentMergePolicyExecutor {
  private readonly promptBuilder: AgentMergePromptBuilder;

  constructor(private readonly options: AgentMergePolicyExecutorOptions) {
    this.promptBuilder = new AgentMergePromptBuilder({
      workspaceRoot: options.workspaceRoot,
      systemTemplateFile: options.systemTemplateFile,
    });
  }

  async run(input: AgentMergePolicyRunInput): Promise<AgentMergePolicyRunResult> {
    throwIfAborted(input.signal);
    const prompt = this.promptBuilder.build({
      parent: {
        requestId: input.requestId,
        step: input.step,
      },
      plan: input.plan,
      childResults: input.childResults,
    });
    throwIfAborted(input.signal);

    const response = await this.options.model.complete({
      requestId: input.requestId,
      step: input.step,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
      onEvent: this.createScopedEventSink(input),
      signal: input.signal,
    });
    throwIfAborted(input.signal);

    return {
      workflowName: input.plan.workflow.name,
      mergePolicyName: input.plan.mergePolicy.name,
      status: "completed",
      mode: "directModel",
      text: response.text,
      prompt,
    };
  }

  private createScopedEventSink(input: AgentMergePolicyRunInput): AgentEventSink | undefined {
    if (!input.onEvent) {
      return undefined;
    }

    return (event) => input.onEvent?.(
      withEventContext(event, {
        scope: {
          parentRequestId: input.requestId,
          workflowName: input.plan.workflow.name,
          role: "merge",
        },
      }),
    );
  }
}
