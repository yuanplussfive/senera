import {
  type ActionPlanInput,
} from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";
import type { AgentToolCallPlannerPromptInput } from "../AgentToolCallPlannerPromptJson.js";
import {
  isAgentEmptyToolCallPlanError,
  type AgentParsedToolCallPlan,
} from "../AgentToolCallPlannerSchema.js";
import {
  summarizePlannerFailure,
} from "./AgentActionPlannerFailure.js";
import { parseEvidenceVerification } from "./AgentActionPlannerSchema.js";
import {
  AgentActionPlannerStageNames,
  type AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import type { AgentActionPlanResult } from "./AgentActionPlannerTypes.js";
import { AgentCancellationError, throwIfAborted } from "../AgentCancellation.js";
import {
  AgentCompletionGate,
} from "../Loop/AgentCompletionGate.js";
import {
  projectInteractionRoute,
  type AgentInteractionRouteResult,
} from "./AgentInteractionRouter.js";
import { projectEvidenceVerification } from "./AgentActionPlannerEvidenceProjection.js";
import { runAgentActionPlannerStage } from "./AgentActionPlannerStageRunner.js";
import {
  emptyToolCallPlanOutcome,
  toolCallDiscoveryPreflight,
  type AgentToolCallPlanningOutcome,
} from "./AgentToolCallPlanningOutcome.js";
import { AgentActionPlannerUnderstanding } from "./AgentActionPlannerUnderstanding.js";
import { AgentTaskFrameBuilder } from "./AgentTaskFrameBuilder.js";
import { AgentToolCallPlanBuilder } from "./AgentToolCallPlanBuilder.js";
import { isActionPlannerReady } from "./AgentActionPlannerReadiness.js";

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
export type { AgentToolCallPlanningOutcome } from "./AgentToolCallPlanningOutcome.js";

export class AgentActionPlanner {
  private readonly turnUnderstandingClient: AgentActionPlannerModelClient;
  private readonly taskFrameClient: AgentActionPlannerModelClient;
  private readonly evidenceClient: AgentActionPlannerModelClient;
  private readonly completionGate: AgentCompletionGate;
  private readonly understanding: AgentActionPlannerUnderstanding;
  private readonly taskFrames: AgentTaskFrameBuilder;
  private readonly toolCallPlans: AgentToolCallPlanBuilder;

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
    this.understanding = new AgentActionPlannerUnderstanding(
      this.turnUnderstandingClient,
      config.MaxRepairAttempts,
    );
    this.taskFrames = new AgentTaskFrameBuilder(
      this.taskFrameClient,
      config.MaxRepairAttempts,
    );
    this.toolCallPlans = new AgentToolCallPlanBuilder(
      this.taskFrameClient,
      this.understanding,
      config.MaxRepairAttempts,
    );
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
      const input = await this.understanding.understandWithStage(options.input, options.onStage, options.signal);
      throwIfAborted(options.signal);
      const taskFrame = await runAgentActionPlannerStage(
        AgentActionPlannerStageNames.BuildTaskFrame,
        options.onStage,
        () => this.taskFrames.buildOrRepair(input, options.signal),
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
      const input = await this.understanding.understandWithStage(options.input, options.onStage, options.signal);
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
      const input = await this.toolCallPlans.prepareInput(options.input, options.signal, options.onStage);
      return await this.toolCallPlans.buildOrRepair(input, options.signal);
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
      preparedInput = await this.toolCallPlans.prepareInput(options.input, options.signal, options.onStage);
      const preflight = toolCallDiscoveryPreflight(preparedInput);
      if (preflight) {
        return preflight;
      }
      const plan = await this.toolCallPlans.buildOrRepair(preparedInput, options.signal);
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
        return emptyToolCallPlanOutcome(preparedInput, {
          error,
          repaired: true,
        });
      }
      throw new Error(`ToolCall Planner 生成失败：${summarizePlannerFailure(error)}`);
    }
  }

  private isEnabled(): boolean {
    return isActionPlannerReady(this.config);
  }
}
