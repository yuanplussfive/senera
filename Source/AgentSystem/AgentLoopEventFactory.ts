import {
  AgentEventKinds,
  createEventDetailId,
  summarizePrompt,
  summarizeXmlDocument,
  type AgentDomainEvent,
} from "./AgentEvent.js";
import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import type { AgentProjectedTerminalResult } from "./AgentExecutionProjector.js";
import type { AgentRetryInstruction } from "./AgentRetryableError.js";
import type { SanitizedDecisionXml } from "./AgentDecisionXmlSanitizer.js";
import type { AgentDecision } from "./Types/ToolRuntimeTypes.js";
import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionPlanResult,
} from "./AgentActionPlanner.js";
import type { AgentActionPlannerStageEvent } from "./AgentActionPlannerTelemetry.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";
import type { AgentActivatedSkill } from "./AgentSkillActivation.js";
import type { AgentCompletionGateDecision } from "./AgentCompletionGate.js";
import type { TaskFrame, TurnUnderstanding } from "./BamlClient/baml_client/types.js";
import type { AgentInteractionRouteResult } from "./AgentInteractionRouter.js";

export class AgentLoopEventFactory {
  runStarted(requestId: string, input: string): AgentDomainEvent {
    return {
      kind: AgentEventKinds.RunStarted,
      context: {
        requestId,
      },
      data: {
        input,
      },
    };
  }

  promptRendered(
    requestId: string,
    step: number,
    prompt: string,
    tokenCount: number,
  ): AgentDomainEvent[] {
    const summary = summarizePrompt(prompt, tokenCount);

    return [
      {
        kind: summary.kind,
        context: {
          requestId,
          step,
        },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.PromptRendered,
        context: {
          requestId,
          step,
        },
        data: {
          prompt,
        },
      },
    ];
  }

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
        context: {
          requestId,
          step,
        },
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
          taskFrame: plan.taskFrame
            ? projectTaskFrameForEvent(plan.taskFrame)
            : undefined,
          evidenceDecision: plan.evidenceDecision
            ? projectEvidenceDecisionForEvent(plan.evidenceDecision)
            : undefined,
          activeSkills: activeSkills.map((skill) => ({
            name: skill.name,
            title: skill.title,
            score: skill.score,
            matchedTerms: skill.matchedTerms,
            matchedFields: skill.matchedFields,
            recommendedTools: skill.recommendedTools,
            recommendedAgents: skill.recommendedAgents,
            recommendedWorkflows: skill.recommendedWorkflows,
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
        context: {
          requestId,
          step,
        },
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
    const context = {
      requestId,
      step,
    };

    switch (event.status) {
      case "started":
        return {
          kind: AgentEventKinds.ActionPlannerStageStarted,
          context,
          data: {
            stage: event.stage,
          },
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
            taskFrame: event.taskFrame
              ? projectTaskFrameForEvent(event.taskFrame)
              : undefined,
            evidenceDecision: event.evidenceDecision
              ? projectEvidenceDecisionForEvent(event.evidenceDecision)
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

  sanitizedDecisionXml(
    requestId: string,
    step: number,
    sanitized: SanitizedDecisionXml,
  ): AgentDomainEvent[] {
    if (!sanitized.changed) {
      return [];
    }

    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionXmlDetail,
      "sanitized",
    );
    const summary = summarizeXmlDocument(sanitized.xml, {
      sanitized: true,
      detailId,
    });

    return [
      {
        kind: summary.kind,
        context: {
          requestId,
          step,
        },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.DecisionXmlDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          rawXml: sanitized.raw,
          xml: sanitized.xml,
          sanitized: true,
        },
      },
    ];
  }

  parsedDecision(requestId: string, step: number, decision: AgentDecision): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionParsedDetail,
      decision.kind.toLowerCase(),
    );

    return [
      {
        kind: AgentEventKinds.DecisionParsed,
        context: {
          requestId,
          step,
        },
        data: {
          root: decision.root,
          decisionKind: decision.kind,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.DecisionParsedDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          root: decision.root,
          decisionKind: decision.kind,
          payload: decision.payload,
        },
      },
    ];
  }

  retryPlanned(
    requestId: string,
    step: number,
    attempt: number,
    instruction: AgentRetryInstruction,
  ): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.RetryDetail,
      String(attempt),
    );

    return [
      {
        kind: AgentEventKinds.RetryPlanned,
        context: {
          requestId,
          step,
        },
        data: {
          attempt,
          code: instruction.code,
          message: instruction.message,
          retryable: instruction.retryable,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.RetryDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          instruction,
        },
      },
    ];
  }

  toolCallsPlanned(
    requestId: string,
    step: number,
    toolNames: string[],
    metadata: {
      status?: "planned" | "discovery_escalated" | "blocked";
      reason?: string;
      issues?: readonly string[];
    } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallsPlanned,
      context: {
        requestId,
        step,
      },
      data: {
        toolCount: toolNames.length,
        tools: toolNames,
        status: metadata.status ?? "planned",
        reason: metadata.reason,
        issues: metadata.issues ? [...metadata.issues] : undefined,
      },
    };
  }

  toolCallStarted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallStarted,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
      },
    };
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    preview?: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallCompleted,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
        preview,
      },
    };
  }

  toolCallFailed(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    message: string,
    code?: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallFailed,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
        message,
        code,
      },
    };
  }

  toolResults(
    requestId: string,
    step: number,
    execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>,
    resultXml: string,
  ): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.ToolResultsDetail,
      "tool-results",
    );

    return [
      {
        kind: AgentEventKinds.ToolResults,
        context: {
          requestId,
          step,
        },
        data: {
          toolCount: Array.isArray(execution.value) ? execution.value.length : 0,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.ToolResultsDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          xml: resultXml,
          value: execution.value,
        },
      },
    ];
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string): AgentDomainEvent[] {
    return [
      projected.event,
      {
        kind: AgentEventKinds.RunCompleted,
        context: {
          requestId,
        },
        data: {},
      },
    ];
  }
}

function projectTaskFrameForEvent(taskFrame: TaskFrame) {
  return {
    taskType: taskFrame.taskType,
    answerGoal: taskFrame.answerGoal,
    intentTags: taskFrame.intentTags,
    targetRefs: taskFrame.targetRefs,
    candidateTools: taskFrame.candidateTools,
    discoveryQueries: taskFrame.discoveryQueries,
    requiredEffects: taskFrame.requiredEffects,
    requiredEvidence: taskFrame.requiredEvidence,
    userInputNeeds: taskFrame.userInputNeeds,
    nextStepPurpose: taskFrame.nextStepPurpose,
    completionCriteria: taskFrame.completionCriteria,
    notes: taskFrame.notes,
  };
}

function projectTurnUnderstandingForEvent(turnUnderstanding: TurnUnderstanding) {
  return {
    rawUserTurn: turnUnderstanding.rawUserTurn,
    standaloneRequest: turnUnderstanding.standaloneRequest,
    contextMode: turnUnderstanding.contextMode,
    contextBasis: turnUnderstanding.contextBasis,
    missingContext: turnUnderstanding.missingContext,
  };
}

function projectEvidenceDecisionForEvent(decision: AgentCompletionGateDecision) {
  return {
    ready: decision.ready,
    missingNeeds: decision.missingNeeds,
    satisfiedNeeds: decision.satisfiedNeeds,
    requirementStates: decision.requirementStates,
    progress: decision.progress,
    verification: decision.verification,
    recommendedTools: decision.recommendedTools,
    searchQueries: decision.searchQueries,
  };
}
