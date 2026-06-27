import {
  EvidenceVerificationStatus,
  type ActionPlanInput,
  type TaskFrame,
} from "./BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types/AgentConfigTypes.js";
import { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";
import type { AgentToolCallPlannerPromptInput } from "./AgentToolCallPlannerPromptJson.js";
import {
  isAgentEmptyToolCallPlanError,
  parseToolCallPlan,
  type AgentParsedToolCallPlan,
  type AgentPlannedToolCall,
} from "./AgentToolCallPlannerSchema.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
  summarizePlannerFailure,
} from "./AgentActionPlannerFailure.js";
import {
  parseEvidenceVerification,
  parseTaskFrame,
  parseTurnUnderstanding,
} from "./AgentActionPlannerSchema.js";
import {
  AgentActionPlannerStageNames,
  type AgentActionPlannerStageName,
  type AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import type {
  AgentActionCapabilityNeed,
  AgentActionPlanResult,
} from "./AgentActionPlannerTypes.js";
import { AgentCancellationError, throwIfAborted } from "./AgentCancellation.js";
import {
  AgentCompletionGate,
  type AgentCompletionEvidenceVerification,
  type AgentCompletionGateDecision,
  type AgentCompletionRequirementStatus,
} from "./AgentCompletionGate.js";
import {
  projectInteractionRoute,
  type AgentInteractionRouteResult,
} from "./AgentInteractionRouter.js";

export type {
  AgentActionCapabilityNeed,
  AgentActionDecision,
  AgentActionKind,
  AgentActionPlanResult,
} from "./AgentActionPlannerTypes.js";
export {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlannerTypes.js";

export type AgentToolCallPlanningOutcome =
  | {
      kind: "calls";
      calls: AgentPlannedToolCall[];
      repaired: boolean;
    }
  | {
      kind: "needsDiscovery";
      queries: string[];
      needs: AgentActionCapabilityNeed[];
      reason: string;
      issues: string[];
      repaired: boolean;
    }
  | {
      kind: "blocked";
      reason: string;
      issues: string[];
      repaired: boolean;
    };

export class AgentActionPlanner {
  private readonly turnUnderstandingClient: AgentActionPlannerModelClient;
  private readonly taskFrameClient: AgentActionPlannerModelClient;
  private readonly evidenceClient: AgentActionPlannerModelClient;
  private readonly completionGate: AgentCompletionGate;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    _catalog: unknown,
  ) {
    this.turnUnderstandingClient = new AgentActionPlannerModelClient(model, config.TurnUnderstandingClient, {
      maxRepairAttempts: config.MaxRepairAttempts,
    });
    this.taskFrameClient = new AgentActionPlannerModelClient(model, config.TaskFrameClient, {
      maxRepairAttempts: config.MaxRepairAttempts,
    });
    this.evidenceClient = new AgentActionPlannerModelClient(model, config.EvidenceClient, {
      maxRepairAttempts: config.MaxRepairAttempts,
    });
    this.completionGate = new AgentCompletionGate({
      verify: async ({ input, taskFrame, signal }) =>
        projectEvidenceVerification(parseEvidenceVerification(await this.evidenceClient.verifyTaskEvidence({
          input,
          taskFrame,
        }, { signal }))),
    });
  }

  async plan(options: {
    requestId: string;
    input: ActionPlanInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<AgentActionPlanResult> {
    if (!this.isEnabled()) {
      throw new Error("Action Planner 未启用或配置不完整。");
    }

    try {
      const input = await this.understandInputWithStage(options.input, options.onStage, options.signal);
      throwIfAborted(options.signal);
      const taskFrame = await this.runStage(
        AgentActionPlannerStageNames.BuildTaskFrame,
        options.onStage,
        () => this.buildTaskFrameOrRepair(input, options.signal),
        (result) => ({
          repaired: result.repaired,
          taskFrame: result.value,
        }),
      );
      throwIfAborted(options.signal);
      await options.onStage?.({
        status: "started",
        stage: AgentActionPlannerStageNames.EvaluateEvidence,
      });
      const evidenceDecision = await this.completionGate.decide({
        input,
        taskFrame: taskFrame.value,
        signal: options.signal,
      });
      await options.onStage?.({
        status: "completed",
        stage: AgentActionPlannerStageNames.EvaluateEvidence,
        selectedAction: evidenceDecision.action.action,
        evidenceDecision,
      });

      if (evidenceDecision.action.action === "answer") {
        return {
          kind: "planned",
          decision: evidenceDecision.action,
          input,
          taskFrame: taskFrame.value,
          evidenceDecision,
          selectedAction: "answer",
          selectionRepaired: taskFrame.repaired,
          payloadRepaired: false,
        };
      }

      return {
        kind: "planned",
        decision: evidenceDecision.action,
        input,
        taskFrame: taskFrame.value,
        evidenceDecision,
        selectedAction: evidenceDecision.action.action,
        selectionRepaired: taskFrame.repaired,
        payloadRepaired: false,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      throw new Error(`Action Planner 生成失败：${summarizePlannerFailure(error)}`);
    }
  }

  async route(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
  }): Promise<AgentInteractionRouteResult> {
    return (await this.routeWithInput(options)).route;
  }

  async routeWithInput(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<{
    route: AgentInteractionRouteResult;
    input: ActionPlanInput;
  }> {
    if (!this.isEnabled()) {
      throw new Error("Interaction Router 未启用或配置不完整。");
    }

    try {
      throwIfAborted(options.signal);
      const input = await this.understandInputWithStage(options.input, options.onStage, options.signal);
      return {
        route: projectInteractionRoute(await this.taskFrameClient.routeInteraction(input, {
          signal: options.signal,
        })),
        input,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      throw new Error(`Interaction Router 生成失败：${summarizePlannerFailure(error)}`);
    }
  }

  async planToolCalls(options: {
    input: AgentToolCallPlannerPromptInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<AgentParsedToolCallPlan & { repaired: boolean }> {
    if (!this.isEnabled()) {
      throw new Error("ToolCall Planner 未启用或配置不完整。");
    }

    try {
      throwIfAborted(options.signal);
      const input = await this.understandToolCallPromptInput(options.input, options.signal, options.onStage);
      return await this.buildToolCallPlanOrRepair(input, options.signal);
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      throw new Error(`ToolCall Planner 生成失败：${summarizePlannerFailure(error)}`);
    }
  }

  async planToolCallOutcome(options: {
    input: AgentToolCallPlannerPromptInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<AgentToolCallPlanningOutcome> {
    if (!this.isEnabled()) {
      throw new Error("ToolCall Planner 未启用或配置不完整。");
    }

    let preparedInput = options.input;
    try {
      throwIfAborted(options.signal);
      preparedInput = await this.understandToolCallPromptInput(options.input, options.signal, options.onStage);
      const preflight = this.toolCallDiscoveryPreflight(preparedInput);
      if (preflight) {
        return preflight;
      }
      const plan = await this.buildToolCallPlanOrRepair(preparedInput, options.signal);
      return {
        kind: "calls",
        calls: plan.calls,
        repaired: plan.repaired,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      if (isAgentEmptyToolCallPlanError(error)) {
        return this.emptyToolCallPlanOutcome(preparedInput, error, true);
      }
      throw new Error(`ToolCall Planner 生成失败：${summarizePlannerFailure(error)}`);
    }
  }

  private async buildTaskFrameOrRepair(input: ActionPlanInput, signal?: AbortSignal): Promise<{
    value: TaskFrame;
    repaired: boolean;
  }> {
    try {
      return {
        value: parseTaskFrame(await this.taskFrameClient.buildTaskFrame(input, { signal }), input),
        repaired: false,
      };
    } catch (error) {
      return this.repairTaskFrameUntilParsed(input, error, signal);
    }
  }

  private async understandToolCallPromptInput(
    input: AgentToolCallPlannerPromptInput,
    signal?: AbortSignal,
    onStage?: AgentActionPlannerStageSink,
  ): Promise<AgentToolCallPlannerPromptInput> {
    return {
      ...input,
      actionInput: await this.understandInputWithStage(input.actionInput, onStage, signal),
    };
  }

  private async understandInputWithStage(
    input: ActionPlanInput,
    onStage: AgentActionPlannerStageSink | undefined,
    signal?: AbortSignal,
  ): Promise<ActionPlanInput> {
    if (input.turnUnderstanding) {
      return input;
    }

    return this.runStage(
      AgentActionPlannerStageNames.UnderstandUserTurn,
      onStage,
      () => this.understandInput(input, signal),
      (result) => ({
        turnUnderstanding: result.turnUnderstanding ?? undefined,
      }),
    );
  }

  private async understandInput(
    input: ActionPlanInput,
    signal?: AbortSignal,
  ): Promise<ActionPlanInput> {
    if (input.turnUnderstanding) {
      return input;
    }

    try {
      const understanding = parseTurnUnderstanding(
        await this.turnUnderstandingClient.understandUserTurn(input, { signal }),
        input,
      );
      return {
        ...input,
        turnUnderstanding: understanding,
      };
    } catch (error) {
      return {
        ...input,
        turnUnderstanding: await this.repairTurnUnderstandingUntilParsed(input, error, signal),
      };
    }
  }

  private async repairTurnUnderstandingUntilParsed(
    input: ActionPlanInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<NonNullable<ActionPlanInput["turnUnderstanding"]>> {
    let currentError = initialError;
    for (let attempt = 1; attempt <= this.config.MaxRepairAttempts; attempt += 1) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(currentError);
      if (!isRepairablePlanningFailure(failure.error)) {
        throw currentError;
      }

      try {
        const repaired = await this.turnUnderstandingClient.repairTurnUnderstanding({
          input,
          invalidUnderstanding: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        }, { signal });
        return parseTurnUnderstanding(repaired, input);
      } catch (error) {
        currentError = error;
      }
    }

    throw currentError;
  }

  private async buildToolCallPlanOrRepair(
    input: AgentToolCallPlannerPromptInput,
    signal?: AbortSignal,
  ): Promise<AgentParsedToolCallPlan & { repaired: boolean }> {
    try {
      return {
        ...parseToolCallPlan(await this.taskFrameClient.planToolCalls(input, { signal }), {
          allowedTools: input.rootCommand.allowedTools,
          toolContracts: input.toolContracts,
        }),
        repaired: false,
      };
    } catch (error) {
      return this.repairToolCallPlanUntilParsed(input, error, signal);
    }
  }

  private async repairTaskFrameUntilParsed(
    input: ActionPlanInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<{
    value: TaskFrame;
    repaired: boolean;
  }> {
    let currentError = initialError;
    for (let attempt = 1; attempt <= this.config.MaxRepairAttempts; attempt += 1) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(currentError);
      if (!isRepairablePlanningFailure(failure.error)) {
        throw currentError;
      }

      try {
        const repaired = await this.taskFrameClient.repairTaskFrame({
          input,
          invalidTaskFrame: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        }, { signal });
        return {
          value: parseTaskFrame(repaired, input),
          repaired: true,
        };
      } catch (error) {
        currentError = error;
      }
    }

    throw currentError;
  }

  private toolCallDiscoveryPreflight(
    input: AgentToolCallPlannerPromptInput,
  ): AgentToolCallPlanningOutcome | undefined {
    const hasAllowedTools = input.rootCommand.allowedTools.length > 0;
    const hasToolContracts = input.toolContracts.length > 0;
    if (hasAllowedTools && hasToolContracts) {
      return undefined;
    }

    return this.emptyToolCallPlanOutcome(input, undefined, false, [
      !hasAllowedTools ? "allowedTools: 当前 RootCommand 没有可调用工具。" : undefined,
      !hasToolContracts ? "toolContracts: 当前提示上下文没有可用工具签名。" : undefined,
    ].filter((issue): issue is string => Boolean(issue)));
  }

  private emptyToolCallPlanOutcome(
    input: AgentToolCallPlannerPromptInput,
    error: unknown,
    repaired: boolean,
    extraIssues: readonly string[] = [],
  ): AgentToolCallPlanningOutcome {
    const issues = uniqueStrings([
      ...extraIssues,
      ...(error ? issueMessages(error) : []),
    ]);

    if (input.rootCommand.action === "discover_tools") {
      return {
        kind: "blocked",
        reason: "工具发现阶段没有生成可执行工具调用。",
        issues,
        repaired,
      };
    }

    return {
      kind: "needsDiscovery",
      queries: this.discoveryQueriesForEmptyToolPlan(input),
      needs: input.rootCommand.needs,
      reason: "工具调用计划为空，需要先发现可用工具能力。",
      issues,
      repaired,
    };
  }

  private discoveryQueriesForEmptyToolPlan(input: AgentToolCallPlannerPromptInput): string[] {
    return uniqueStrings([
      ...input.rootCommand.toolSearchQueries,
      ...(input.rootCommand.taskContract?.discoveryQueries ?? []),
      input.rootCommand.instruction ?? "",
      input.rootCommand.taskContract?.nextStepPurpose ?? "",
      input.rootCommand.objective,
      input.actionInput.currentUserTurn.content,
    ]);
  }

  private async repairToolCallPlanUntilParsed(
    input: AgentToolCallPlannerPromptInput,
    initialError: unknown,
    signal?: AbortSignal,
  ): Promise<AgentParsedToolCallPlan & { repaired: boolean }> {
    let currentError = initialError;
    for (let attempt = 1; attempt <= this.config.MaxRepairAttempts; attempt += 1) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(currentError);
      if (!isRepairablePlanningFailure(failure.error)) {
        throw currentError;
      }

      try {
        const repaired = await this.taskFrameClient.repairToolCallPlan({
          input,
          invalidPlan: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        }, { signal });
        return {
          ...parseToolCallPlan(repaired, {
            allowedTools: input.rootCommand.allowedTools,
            toolContracts: input.toolContracts,
          }),
          repaired: true,
        };
      } catch (error) {
        currentError = error;
      }
    }

    throw currentError;
  }

  private async runStage<T>(
    stage: AgentActionPlannerStageName,
    onStage: AgentActionPlannerStageSink | undefined,
    work: () => Promise<T>,
    completed: (result: T) => {
      selectedAction?: string;
      repaired?: boolean;
      turnUnderstanding?: NonNullable<ActionPlanInput["turnUnderstanding"]>;
      taskFrame?: TaskFrame;
      evidenceDecision?: AgentCompletionGateDecision;
    },
  ): Promise<T> {
    await onStage?.({
      status: "started",
      stage,
    });
    try {
      const result = await work();
      await onStage?.({
        status: "completed",
        stage,
        ...completed(result),
      });
      return result;
    } catch (error) {
      await onStage?.({
        status: "failed",
        stage,
        message: summarizePlannerFailure(error),
      });
      throw error;
    }
  }

  private isEnabled(): boolean {
    return this.config.Enabled
      && isPlannerClientReady(this.config.TurnUnderstandingClient)
      && isPlannerClientReady(this.config.TaskFrameClient)
      && isPlannerClientReady(this.config.EvidenceClient);
  }
}

function isPlannerClientReady(client: ResolvedAgentActionPlannerConfig["TaskFrameClient"]): boolean {
  return Boolean(client.BaseUrl.trim())
    && Boolean(client.ApiKey.trim())
    && Boolean(client.Model.trim());
}

function projectEvidenceVerification(
  verification: ReturnType<typeof parseEvidenceVerification>,
): AgentCompletionEvidenceVerification {
  return {
    ready: verification.ready,
    summary: verification.summary,
    requirements: verification.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      need: requirement.need,
      status: projectEvidenceVerificationStatus(requirement.status),
      evidenceUris: requirement.evidenceUris,
      artifactUris: requirement.artifactUris,
      reason: requirement.reason,
      missingFacts: requirement.missingFacts,
      unsupportedClaims: requirement.unsupportedClaims,
    })),
  };
}

function projectEvidenceVerificationStatus(
  status: EvidenceVerificationStatus,
): AgentCompletionRequirementStatus {
  switch (status) {
    case EvidenceVerificationStatus.Satisfied:
      return "satisfied";
    case EvidenceVerificationStatus.Partial:
      return "partial";
    case EvidenceVerificationStatus.Blocked:
      return "blocked";
    case EvidenceVerificationStatus.Missing:
      return "missing";
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
