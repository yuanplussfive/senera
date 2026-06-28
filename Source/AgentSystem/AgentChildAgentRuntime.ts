import { type AgentEventSink, withEventContext } from "./AgentEvent.js";
import type { AgentLanguageModel } from "./ModelEndpoints/AgentLanguageModel.js";
import { throwIfAborted } from "./AgentCancellation.js";
import type { AgentLoop } from "./Loop/AgentLoop.js";
import type { AgentCompletedRunResult } from "./AgentExecutionProjector.js";
import {
  AgentChildPromptBuilder,
  type AgentChildPrompt,
} from "./AgentChildPromptBuilder.js";
import type {
  AgentDelegationJob,
  AgentDelegationPlan,
} from "./AgentDelegationPlan.js";
import type {
  ResolvedAgentDelegationRuntimeProfileConfig,
  ResolvedAgentLoopConfig,
} from "./Types/AgentConfigTypes.js";

export interface AgentChildAgentLoopFactoryInput {
  runtimeProfile: ResolvedAgentDelegationRuntimeProfileConfig;
  modelProviderId?: string;
  agentLoopConfig: ResolvedAgentLoopConfig;
}

export type AgentChildAgentLoopFactory = (
  input: AgentChildAgentLoopFactoryInput,
) => AgentLoop;

export type AgentChildModelFactory = (modelProviderId?: string) => AgentLanguageModel;

export type AgentChildRuntimeProfileResolver = (
  profileName: string,
) => ResolvedAgentDelegationRuntimeProfileConfig | undefined;

export interface AgentChildAgentRuntimeOptions {
  workspaceRoot: string;
  systemTemplateFile: string;
  model?: AgentLanguageModel;
  modelFactory?: AgentChildModelFactory;
  loopFactory?: AgentChildAgentLoopFactory;
  runtimeProfileResolver?: AgentChildRuntimeProfileResolver;
}

export interface AgentChildAgentRunInput {
  requestId: string;
  step: number;
  plan: AgentDelegationPlan;
  job: AgentDelegationJob;
  latestUserRequest: string;
  evidenceUris?: readonly string[];
  artifactUris?: readonly string[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export interface AgentChildAgentRunResult {
  jobId: string;
  workflowName: string;
  agentName: string;
  status: "completed";
  mode: "directModel" | "agentLoop";
  text: string;
  prompt: AgentChildPrompt;
  loopResult?: AgentCompletedRunResult;
}

export class AgentChildAgentRuntime {
  private readonly promptBuilder: AgentChildPromptBuilder;

  constructor(private readonly options: AgentChildAgentRuntimeOptions) {
    this.promptBuilder = new AgentChildPromptBuilder({
      workspaceRoot: options.workspaceRoot,
      systemTemplateFile: options.systemTemplateFile,
    });
  }

  async runJob(input: AgentChildAgentRunInput): Promise<AgentChildAgentRunResult> {
    throwIfAborted(input.signal);
    const prompt = this.promptBuilder.build({
      parent: {
        requestId: input.requestId,
        step: input.step,
      },
      plan: input.plan,
      job: input.job,
      latestUserRequest: input.latestUserRequest,
      evidenceUris: input.evidenceUris,
      artifactUris: input.artifactUris,
    });
    throwIfAborted(input.signal);

    const runtimeProfile = this.options.runtimeProfileResolver?.(input.job.runtimeProfile);
    if (runtimeProfile?.Mode === "agentLoop") {
      return this.runAgentLoopJob(input, prompt, runtimeProfile);
    }

    const model = this.resolveModel(runtimeProfile?.ModelProviderId);
    const onEvent = this.createScopedEventSink(input);
    const response = await model.complete({
      requestId: input.job.jobId,
      step: input.step,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
      onEvent,
      signal: input.signal,
    });
    throwIfAborted(input.signal);

    return {
      jobId: input.job.jobId,
      workflowName: input.job.workflowName,
      agentName: input.job.agentName,
      status: "completed",
      mode: "directModel",
      text: response.text,
      prompt,
    };
  }

  private async runAgentLoopJob(
    input: AgentChildAgentRunInput,
    prompt: AgentChildPrompt,
    runtimeProfile: ResolvedAgentDelegationRuntimeProfileConfig,
  ): Promise<AgentChildAgentRunResult> {
    const loadedToolNames = this.resolveInitialLoadedTools(input.job, runtimeProfile);
    const agentLoopConfig = this.resolveAgentLoopConfig(runtimeProfile, loadedToolNames);
    const loop = this.options.loopFactory?.({
      runtimeProfile,
      modelProviderId: runtimeProfile.ModelProviderId,
      agentLoopConfig,
    });
    if (!loop) {
      throw new Error(`子代理 RuntimeProfile 需要 agentLoop，但没有配置 loopFactory：${runtimeProfile.Name}`);
    }

    const loopResult = await loop.run({
      requestId: input.job.jobId,
      input: prompt.materializedContext.content,
      messages: prompt.messages,
      conversationEntries: [],
      loadedToolNames,
      systemPromptPreamble: prompt.systemPrompt,
      onEvent: this.createScopedEventSink(input),
      signal: input.signal,
    });
    throwIfAborted(input.signal);

    return {
      jobId: input.job.jobId,
      workflowName: input.job.workflowName,
      agentName: input.job.agentName,
      status: "completed",
      mode: "agentLoop",
      text: this.readTerminalText(loopResult),
      prompt,
      loopResult,
    };
  }

  private resolveModel(modelProviderId: string | undefined): AgentLanguageModel {
    if (this.options.modelFactory) {
      return this.options.modelFactory(modelProviderId);
    }

    if (this.options.model && !modelProviderId) {
      return this.options.model;
    }

    if (this.options.model) {
      return this.options.model;
    }

    throw new Error("子代理 directModel 模式没有可用模型。");
  }

  private resolveInitialLoadedTools(
    job: AgentDelegationJob,
    runtimeProfile: ResolvedAgentDelegationRuntimeProfileConfig,
  ): "all" | string[] {
    const configured = runtimeProfile.AgentLoop.LoadedTools;
    return configured === "dynamic"
      ? [...job.recommendedTools.item]
      : configured;
  }

  private resolveAgentLoopConfig(
    runtimeProfile: ResolvedAgentDelegationRuntimeProfileConfig,
    loadedToolNames: "all" | string[],
  ): ResolvedAgentLoopConfig {
    return {
      ...runtimeProfile.AgentLoop,
      LoadedTools: loadedToolNames,
    };
  }

  private readTerminalText(result: AgentCompletedRunResult): string {
    return result.terminal.kind === "FinalAnswer"
      ? result.terminal.content
      : result.terminal.question;
  }

  private createScopedEventSink(input: AgentChildAgentRunInput): AgentEventSink | undefined {
    if (!input.onEvent) {
      return undefined;
    }

    return (event) => input.onEvent?.(
      withEventContext(event, {
        scope: {
          parentRequestId: input.requestId,
          workflowName: input.job.workflowName,
          jobId: input.job.jobId,
          agentName: input.job.agentName,
          role: "childAgent",
        },
      }),
    );
  }
}
