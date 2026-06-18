import { ActionKind, type ActionPlanInput } from "./BamlClient/baml_client/index.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
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
  ActionKindMap,
  assertSelectedAction,
  parseActionDecision,
  parseActionSelection,
} from "./AgentActionPlannerSchema.js";
import {
  AgentActionPlannerStageNames,
  type AgentActionPlannerStageName,
  type AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import type {
  AgentActionDecision,
  AgentActionPlanResult,
} from "./AgentActionPlannerTypes.js";
import { AgentCancellationError, throwIfAborted } from "./AgentCancellation.js";

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
  private readonly client: AgentActionPlannerModelClient;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    private readonly catalog: {
      list(): AgentToolCatalogItem[];
    },
  ) {
    this.client = new AgentActionPlannerModelClient(model, config.Client);
  }

  async plan(options: {
    requestId: string;
    input: ActionPlanInput;
    signal?: AbortSignal;
    onStage?: AgentActionPlannerStageSink;
  }): Promise<AgentActionPlanResult> {
    if (!this.isEnabled()) {
      return {
        kind: "fallback",
        reason: "disabled",
      };
    }

    const input = options.input;

    try {
      throwIfAborted(options.signal);
      const selection = await this.runStage(
        AgentActionPlannerStageNames.SelectAction,
        options.onStage,
        () => this.selectActionOrRepair(input, options.signal),
        (result) => ({
          selectedAction: ActionKindMap[result.action],
          repaired: result.repaired,
        }),
      );
      throwIfAborted(options.signal);
      if (selection.action === ActionKind.Answer) {
        return {
          kind: "planned",
          decision: {
            action: "answer",
          },
          input,
          selectedAction: ActionKindMap[selection.action],
          selectionRepaired: selection.repaired,
          payloadRepaired: false,
        };
      }

      const payload = await this.runStage(
        AgentActionPlannerStageNames.BuildActionPayload,
        options.onStage,
        () => this.buildPayloadOrRepair(input, selection.action, options.signal),
        (result) => ({
          selectedAction: ActionKindMap[selection.action],
          repaired: result.repaired,
        }),
      );

      return {
        kind: "planned",
        decision: payload.decision,
        input,
        selectedAction: ActionKindMap[selection.action],
        selectionRepaired: selection.repaired,
        payloadRepaired: payload.repaired,
      };
    } catch (error) {
      if (error instanceof AgentCancellationError || options.signal?.aborted) {
        throw error instanceof AgentCancellationError ? error : new AgentCancellationError();
      }
      return this.fallback(input, error);
    }
  }

  private async selectActionOrRepair(input: ActionPlanInput, signal?: AbortSignal): Promise<{
    action: ActionKind;
    repaired: boolean;
  }> {
    try {
      return {
        action: parseActionSelection(await this.client.selectAction(input, { signal })),
        repaired: false,
      };
    } catch (error) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(error);
      if (this.config.MaxRepairAttempts <= 0 || !isRepairablePlanningFailure(failure.error)) {
        throw error;
      }

      const repaired = await this.client.repairActionSelection({
        input,
        invalidSelection: stringifyIssueValue(failure.invalidOutput ?? failure.error),
        issues: issueMessages(failure.error),
      }, { signal });
      return {
        action: parseActionSelection(repaired),
        repaired: true,
      };
    }
  }

  private async buildPayloadOrRepair(
    input: ActionPlanInput,
    selectedAction: ActionKind,
    signal?: AbortSignal,
  ): Promise<{
    decision: AgentActionDecision;
    repaired: boolean;
  }> {
    try {
      const decision = parseActionDecision(await this.client.buildPayload({
        input,
        selectedAction,
      }, { signal }), this.catalog);
      assertSelectedAction(decision, selectedAction);
      return {
        decision,
        repaired: false,
      };
    } catch (error) {
      throwIfAborted(signal);
      const failure = normalizePlanningFailure(error);
      if (this.config.MaxRepairAttempts <= 0 || !isRepairablePlanningFailure(failure.error)) {
        throw error;
      }

      const decision = parseActionDecision(await this.client.repairPayload({
        input,
        selectedAction,
        invalidDecision: stringifyIssueValue(failure.invalidOutput ?? failure.error),
        issues: issueMessages(failure.error),
      }, { signal }), this.catalog);
      assertSelectedAction(decision, selectedAction);
      return {
        decision,
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

  private fallback(input: ActionPlanInput, error: unknown): AgentActionPlanResult {
    return {
      kind: "fallback",
      reason: summarizePlannerFailure(error),
      input,
    };
  }

  private isEnabled(): boolean {
    return this.config.Enabled
      && Boolean(this.config.Client.BaseUrl.trim())
      && Boolean(this.config.Client.ApiKey.trim())
      && Boolean(this.config.Client.Model.trim());
  }
}
