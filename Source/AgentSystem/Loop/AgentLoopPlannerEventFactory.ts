import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentActionPlanResult } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentActionPlannerStageEvent } from "../ActionPlanner/AgentActionPlannerTelemetry.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import {
  projectTurnUnderstandingForEvent,
} from "./AgentLoopEventProjection.js";

export class AgentLoopPlannerEventFactory {
  actionPlanned(
    requestId: string,
    step: number,
    plan: AgentActionPlanResult,
    loadedToolNames: "all" | string[],
    rootCommand?: AgentRootCommand,
    activeSkills: readonly AgentActivatedSkill[] = [],
  ): AgentDomainEvent[] {
    return [
      {
        kind: AgentEventKinds.ActionPlanned,
        context: { requestId, step },
        data: {
          status: "planned",
          action: plan.decision.action,
          expectedOutputMode: rootCommand?.outputMode,
          instruction: agentActionInstruction(plan.decision),
          askUserQuestion: plan.decision.action === "ask_user" ? plan.decision.askUser.question : undefined,
          capabilityNeeds: agentActionCapabilityNeeds(plan.decision),
          preferredTools: agentActionPreferredTools(plan.decision),
          toolSearchQueries: agentActionToolSearchQueries(plan.decision),
          loadedTools: loadedToolNames,
          currentStep: plan.input.runState.currentStep,
          runState: {
            totalToolCalls: plan.input.runState.progress.totalToolCalls,
            totalEvidence: plan.input.runState.progress.totalEvidence,
            repeatedCallCount: plan.input.runState.progress.repeatedCallCount,
            stalled: plan.input.runState.progress.stalled,
            timelineTurnCount: plan.input.timeline.length,
          },
          selectedAction: plan.selectedAction,
          selectionRepaired: plan.selectionRepaired,
          payloadRepaired: plan.payloadRepaired,
          activeSkills: activeSkills.map((skill) => ({
            name: skill.name,
            title: skill.title,
            score: skill.score,
            matchedTerms: skill.matchedTerms,
            matchedFields: skill.matchedFields,
            recommendedTools: skill.recommendedTools,
          })),
        },
      },
    ];
  }

  interactionRouted(
    requestId: string,
    step: number,
    route: AgentInteractionRouteResult,
    loadedToolNames: "all" | string[],
    rootCommand?: AgentRootCommand,
  ): AgentDomainEvent[] {
    return [
      {
        kind: AgentEventKinds.InteractionRouted,
        context: { requestId, step },
        data: {
          mode: route.mode,
          objective: route.objective,
          needsFreshEvidence: route.needsFreshEvidence,
          needsWorkspaceRead: route.needsWorkspaceRead,
          needsSideEffect: route.needsSideEffect,
          risk: route.risk,
          preferredTools: [...route.preferredTools],
          discoveryQueries: [...route.discoveryQueries],
          reason: route.reason,
          loadedTools: loadedToolNames === "all" ? "all" : [...loadedToolNames],
          expectedOutputMode: rootCommand?.outputMode,
        },
      },
    ];
  }

  actionPlannerStage(
    requestId: string,
    step: number,
    event: AgentActionPlannerStageEvent,
  ): AgentDomainEvent {
    const context = { requestId, step };

    switch (event.status) {
      case "started":
        return {
          kind: AgentEventKinds.ActionPlannerStageStarted,
          context,
          data: { stage: event.stage },
        };
      case "completed":
        return {
          kind: AgentEventKinds.ActionPlannerStageCompleted,
          context,
          data: {
            stage: event.stage,
            selectedAction: event.selectedAction,
            repaired: event.repaired,
            turnUnderstanding: event.turnUnderstanding
              ? projectTurnUnderstandingForEvent(event.turnUnderstanding)
              : undefined,
          },
        };
      case "failed":
        return {
          kind: AgentEventKinds.ActionPlannerStageFailed,
          context,
          data: {
            stage: event.stage,
            message: event.message,
          },
        };
    }
  }
}
