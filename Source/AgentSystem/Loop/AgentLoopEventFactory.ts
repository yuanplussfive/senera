import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentExecutionResult } from "../Decision/AgentDecisionExecutor.js";
import type { AgentProjectedTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentRetryInstruction } from "../Retry/AgentRetryableError.js";
import type { SanitizedDecisionXml } from "../Decision/AgentDecisionXmlSanitizer.js";
import type { AgentDecision } from "../Types/ToolRuntimeTypes.js";
import type { AgentActionPlanResult } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentActionPlannerStageEvent } from "../ActionPlanner/AgentActionPlannerTelemetry.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import { AgentLoopDecisionEventFactory } from "./AgentLoopDecisionEventFactory.js";
import { AgentLoopPlannerEventFactory } from "./AgentLoopPlannerEventFactory.js";
import { AgentLoopPromptEventFactory } from "./AgentLoopPromptEventFactory.js";
import { AgentLoopRunEventFactory } from "./AgentLoopRunEventFactory.js";
import { AgentLoopToolEventFactory } from "./AgentLoopToolEventFactory.js";

export class AgentLoopEventFactory {
  private readonly runEvents = new AgentLoopRunEventFactory();
  private readonly promptEvents = new AgentLoopPromptEventFactory();
  private readonly plannerEvents = new AgentLoopPlannerEventFactory();
  private readonly decisionEvents = new AgentLoopDecisionEventFactory();
  private readonly toolEvents = new AgentLoopToolEventFactory();

  runStarted(requestId: string, input: string): AgentDomainEvent {
    return this.runEvents.runStarted(requestId, input);
  }

  promptRendered(
    requestId: string,
    step: number,
    prompt: string,
    tokenCount: number,
  ): AgentDomainEvent[] {
    return this.promptEvents.promptRendered(requestId, step, prompt, tokenCount);
  }

  actionPlanned(
    requestId: string,
    step: number,
    plan: AgentActionPlanResult,
    loadedToolNames: "all" | string[],
    rootCommand?: AgentRootCommand,
    activeSkills: readonly AgentActivatedSkill[] = [],
  ): AgentDomainEvent[] {
    return this.plannerEvents.actionPlanned(
      requestId,
      step,
      plan,
      loadedToolNames,
      rootCommand,
      activeSkills,
    );
  }

  interactionRouted(
    requestId: string,
    step: number,
    route: AgentInteractionRouteResult,
    loadedToolNames: "all" | string[],
    rootCommand?: AgentRootCommand,
  ): AgentDomainEvent[] {
    return this.plannerEvents.interactionRouted(
      requestId,
      step,
      route,
      loadedToolNames,
      rootCommand,
    );
  }

  actionPlannerStage(
    requestId: string,
    step: number,
    event: AgentActionPlannerStageEvent,
  ): AgentDomainEvent {
    return this.plannerEvents.actionPlannerStage(requestId, step, event);
  }

  sanitizedDecisionXml(
    requestId: string,
    step: number,
    sanitized: SanitizedDecisionXml,
  ): AgentDomainEvent[] {
    return this.decisionEvents.sanitizedDecisionXml(requestId, step, sanitized);
  }

  parsedDecision(requestId: string, step: number, decision: AgentDecision): AgentDomainEvent[] {
    return this.decisionEvents.parsedDecision(requestId, step, decision);
  }

  retryPlanned(
    requestId: string,
    step: number,
    attempt: number,
    instruction: AgentRetryInstruction,
  ): AgentDomainEvent[] {
    return this.decisionEvents.retryPlanned(requestId, step, attempt, instruction);
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
    return this.toolEvents.toolCallsPlanned(requestId, step, toolNames, metadata);
  }

  toolCallStarted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
  ): AgentDomainEvent {
    return this.toolEvents.toolCallStarted(requestId, step, index, toolName, callId);
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    preview?: string,
  ): AgentDomainEvent {
    return this.toolEvents.toolCallCompleted(requestId, step, index, toolName, callId, preview);
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
    return this.toolEvents.toolCallFailed(requestId, step, index, toolName, callId, message, code);
  }

  toolResults(
    requestId: string,
    step: number,
    execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>,
    resultXml: string,
  ): AgentDomainEvent[] {
    return this.toolEvents.toolResults(requestId, step, execution, resultXml);
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string): AgentDomainEvent[] {
    return this.runEvents.terminal(projected, requestId);
  }
}
