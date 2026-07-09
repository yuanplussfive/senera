import type {
  AgentEvent,
  AgentHarnessEvent,
  PromptTemplate,
  Skill,
} from "@earendil-works/pi-agent-core";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";

export type AgentPiHarnessEvent = AgentHarnessEvent<
  Skill,
  PromptTemplate
>;

export interface AgentPiHarnessTraceContext {
  sessionId?: string;
  requestId: string;
  step: number;
}

const CoreAgentEventTypes = new Set<AgentEvent["type"]>([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

const HarnessEventSummaries: Partial<Record<AgentPiHarnessEvent["type"], (
  event: AgentPiHarnessEvent,
) => Record<string, unknown> | undefined>> = {
  before_agent_start: (event) => ({
    promptChars: readText(event, "prompt").length,
    systemPromptChars: readText(event, "systemPrompt").length,
    skillCount: readArray(readRecord(readRecord(event)?.resources)?.skills).length,
    toolCount: readArray(readRecord(event)?.activeTools).length,
  }),
  context: (event) => ({
    messages: readArray(readRecord(event)?.messages).length,
  }),
  before_provider_request: (event) => ({
    model: readRecord(readRecord(event)?.model)?.id,
    provider: readRecord(readRecord(event)?.model)?.provider,
    sessionId: readRecord(event)?.sessionId,
    timeoutMs: readRecord(readRecord(event)?.streamOptions)?.timeoutMs,
  }),
  before_provider_payload: (event) => ({
    model: readRecord(readRecord(event)?.model)?.id,
    payload: readRecord(event)?.payload,
  }),
  after_provider_response: (event) => ({
    status: readRecord(event)?.status,
    headers: readRecord(event)?.headers,
  }),
  tool_call: (event) => ({
    toolCallId: readRecord(event)?.toolCallId,
    toolName: readRecord(event)?.toolName,
    input: readRecord(event)?.input,
  }),
  tool_result: (event) => ({
    toolCallId: readRecord(event)?.toolCallId,
    toolName: readRecord(event)?.toolName,
    isError: readRecord(event)?.isError,
    contentItems: readArray(readRecord(event)?.content).length,
    details: readRecord(event)?.details,
  }),
  resources_update: (event) => ({
    skills: readArray(readRecord(readRecord(event)?.resources)?.skills)
      .map((skill) => readRecord(skill)?.name),
    previousSkills: readArray(readRecord(readRecord(event)?.previousResources)?.skills).map((skill) =>
      readRecord(skill)?.name),
  }),
  queue_update: (event) => ({
    steer: readArray(readRecord(event)?.steer).length,
    followUp: readArray(readRecord(event)?.followUp).length,
    nextTurn: readArray(readRecord(event)?.nextTurn).length,
  }),
  save_point: (event) => ({
    hadPendingMutations: readRecord(event)?.hadPendingMutations,
  }),
  abort: (event) => ({
    clearedSteer: readArray(readRecord(event)?.clearedSteer).length,
    clearedFollowUp: readArray(readRecord(event)?.clearedFollowUp).length,
  }),
  settled: (event) => ({
    nextTurnCount: readRecord(event)?.nextTurnCount,
  }),
};

export function isPiCoreAgentEvent(event: AgentPiHarnessEvent): event is AgentEvent {
  return CoreAgentEventTypes.has(event.type as AgentEvent["type"]);
}

export function projectPiHarnessTraceEvent(
  context: AgentPiHarnessTraceContext,
  event: AgentPiHarnessEvent,
): AgentDomainEvent | undefined {
  if (isPiCoreAgentEvent(event)) {
    return undefined;
  }

  const payload = HarnessEventSummaries[event.type]?.(event) ?? event;
  return createPiTraceEvent({
    ...context,
    source: "session",
    eventType: event.type,
    payload,
  });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readText(value: unknown, key: string): string {
  const candidate = readRecord(value)?.[key];
  return typeof candidate === "string" ? candidate : "";
}
