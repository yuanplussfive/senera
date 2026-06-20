import type { ActionPlanInput } from "./BamlClient/baml_client/index.js";
import type { TaskFrame } from "./BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types.js";
import { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";
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
} from "./AgentActionPlannerSchema.js";
import {
  AgentActionPlannerStageNames,
  type AgentActionPlannerStageName,
  type AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import type { AgentActionPlanResult } from "./AgentActionPlannerTypes.js";
import { AgentCancellationError, throwIfAborted } from "./AgentCancellation.js";
import {
  AgentCompletionGate,
  type AgentCompletionEvidenceVerification,
  type AgentCompletionGateDecision,
  type AgentCompletionRequirementStatus,
} from "./AgentCompletionGate.js";
import { EvidenceVerificationStatus } from "./BamlClient/baml_client/types.js";

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

export class AgentActionPlanner {
  private readonly taskFrameClient: AgentActionPlannerModelClient;
  private readonly evidenceClient: AgentActionPlannerModelClient;
  private readonly completionGate: AgentCompletionGate;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    _catalog: unknown,
  ) {
    this.taskFrameClient = new AgentActionPlannerModelClient(model, config.TaskFrameClient);
    this.evidenceClient = new AgentActionPlannerModelClient(model, config.EvidenceClient);
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

    const input = options.input;

    try {
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

  private async buildTaskFrameOrRepair(input: ActionPlanInput, signal?: AbortSignal): Promise<{
    value: TaskFrame;
    repaired: boolean;
  }> {
    try {
      return {
        value: parseTaskFrame(await this.taskFrameClient.buildTaskFrame(input, { signal })),
        repaired: false,
      };
    } catch (error) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(error);
      if (this.config.MaxRepairAttempts <= 0 || !isRepairablePlanningFailure(failure.error)) {
        throw error;
      }

      const repaired = await this.taskFrameClient.repairTaskFrame({
        input,
        invalidTaskFrame: stringifyIssueValue(failure.invalidOutput ?? failure.error),
        issues: issueMessages(failure.error),
      }, { signal });
      return {
        value: parseTaskFrame(repaired),
        repaired: true,
      };
    }
  }

  private async runStage<T>(
    stage: AgentActionPlannerStageName,
    onStage: AgentActionPlannerStageSink | undefined,
    work: () => Promise<T>,
    completed: (result: T) => {
      selectedAction?: string;
      repaired?: boolean;
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
      evidenceRefs: requirement.evidenceRefs,
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
