import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentProjectedTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import { AgentLoopPromptEventFactory } from "./AgentLoopPromptEventFactory.js";
import { AgentLoopRunEventFactory } from "./AgentLoopRunEventFactory.js";
import { AgentLoopToolEventFactory } from "./AgentLoopToolEventFactory.js";
import type { AgentToolResultPresentation } from "../Types/ToolRuntimeTypes.js";

export class AgentLoopEventFactory {
  private readonly runEvents = new AgentLoopRunEventFactory();
  private readonly promptEvents = new AgentLoopPromptEventFactory();
  private readonly toolEvents = new AgentLoopToolEventFactory();

  runStarted(requestId: string, input: string): AgentDomainEvent {
    return this.runEvents.runStarted(requestId, input);
  }

  promptRendered(requestId: string, step: number, prompt: string, tokenCount: number): AgentDomainEvent[] {
    return this.promptEvents.promptRendered(requestId, step, prompt, tokenCount);
  }

  toolCallsPlanned(
    requestId: string,
    step: number,
    toolNames: string[],
    metadata: {
      status?: "planned" | "discovery_escalated" | "blocked";
      executionMode?: "parallel" | "sequential";
      batchId?: string;
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
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return this.toolEvents.toolCallStarted(requestId, step, index, toolName, callId, metadata);
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    presentation?: AgentToolResultPresentation,
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return this.toolEvents.toolCallCompleted(requestId, step, index, toolName, callId, presentation, metadata);
  }

  toolCallFailed(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    message: string,
    code?: string,
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return this.toolEvents.toolCallFailed(requestId, step, index, toolName, callId, message, code, metadata);
  }

  toolCallResultDetail(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    value: unknown,
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return this.toolEvents.toolCallResultDetail(requestId, step, index, toolName, callId, value, metadata);
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string): AgentDomainEvent[] {
    return this.runEvents.terminal(projected, requestId);
  }
}
