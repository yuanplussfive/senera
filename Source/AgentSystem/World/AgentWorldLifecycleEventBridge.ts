import { Temporal } from "@js-temporal/polyfill";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentOrchestrationDomainEvent } from "../Orchestration/AgentOrchestrationEventTypes.js";
import type { AgentRunDomainEvent } from "../Events/AgentRunEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { AgentMemoryDeletionSink } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import type { AgentWorldAttributes } from "./AgentWorldTypes.js";
import { projectAgentModelPayload, projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";
import {
  createAgentTextParts,
  identityPart,
  textPart,
  renderAgentTextParts,
  type AgentTextParts,
} from "../Text/AgentTextParts.js";

const WorldLifecycleEventTypePrefixes = ["tool.", "run.", "scheduled.", "child."] as const;

type WorldLifecycleProjection = {
  readonly subjectId: string;
  readonly type: string;
  readonly summaryParts: AgentTextParts;
  readonly attributes: AgentWorldAttributes;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly evidenceRefs: readonly string[];
};

/**
 * Projects observable execution lifecycle into the append-only world ledger.
 * Model deltas and prompt internals are intentionally excluded: they are not
 * physical world changes and would make the timeline noisy and expensive.
 */
export class AgentWorldLifecycleEventBridge implements AgentMemoryDeletionSink {
  constructor(
    private readonly options: {
      readonly ledger: AgentWorldEventLedger;
      readonly agenda: AgentAgendaService;
      readonly timeZone: () => string;
      readonly now?: () => string;
      readonly onChanged?: () => void;
      readonly logger?: AgentLogger;
    },
  ) {}

  observe(event: AgentDomainEvent): void {
    try {
      const observedAt = this.options.now?.() ?? new Date().toISOString();
      const projection = projectWorldLifecycleEvent(event, observedAt);
      if (!projection) return;
      const timeZone = this.options.timeZone();
      const world = this.options.agenda.snapshot(timeZone, new Date(Date.parse(observedAt))).world;
      const existing = this.options.ledger.eventByIdempotencyKey(projection.idempotencyKey);
      const summary = projectAgentModelText(renderAgentTextParts(projection.summaryParts)).text;
      const attributes = projectAgentModelPayload(projection.attributes).value as AgentWorldAttributes;
      this.options.ledger.append({
        worldId: world.id,
        timeZone,
        subject: { id: projection.subjectId, kind: "event" },
        type: projection.type,
        summary,
        summaryParts: projection.summaryParts,
        changes: [
          {
            kind: "entity_upsert",
            entity: {
              id: projection.subjectId,
              kind: "event",
              label: summary,
              parentId: null,
              attributes,
            },
          },
        ],
        evidenceRefs: projection.evidenceRefs,
        occurredAt: projection.occurredAt,
        recordedAt: observedAt,
        idempotencyKey: projection.idempotencyKey,
      });
      if (!existing) this.options.onChanged?.();
    } catch (error) {
      this.options.logger?.warn("world.lifecycle_event.persist_failed", {
        eventKind: event.kind,
        error: serializeError(error),
      });
    }
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const timeZone = this.options.timeZone();
    const world = this.options.agenda.snapshot(timeZone).world;
    const references =
      impact.scope === "from_request"
        ? (impact.requestIds ?? (impact.requestId ? [impact.requestId] : [])).map(requestEvidenceRef)
        : [`senera://session/${encodeURIComponent(requireText(impact.sessionId, "session id"))}`];
    if (references.length === 0) return;
    const deleted = WorldLifecycleEventTypePrefixes.reduce(
      (total, eventTypePrefix) =>
        total +
        this.options.ledger.deleteDerivedEvents({
          worldId: world.id,
          eventTypePrefix,
          evidenceRefs: references,
        }),
      0,
    );
    if (deleted > 0) this.options.onChanged?.();
  }
}

function projectWorldLifecycleEvent(event: AgentDomainEvent, observedAt: string): WorldLifecycleProjection | undefined {
  const evidenceRef = worldEventEvidenceRef(event);
  const projected = (() => {
    switch (event.kind) {
      case AgentEventKinds.ToolCallStarted:
        return projectToolLifecycle(event as ToolLifecycleEvent, evidenceRef, observedAt, "started");
      case AgentEventKinds.ToolCallCompleted:
        return projectToolLifecycle(event as ToolLifecycleEvent, evidenceRef, observedAt, "completed");
      case AgentEventKinds.ToolCallFailed:
        return projectToolLifecycle(event as ToolLifecycleEvent, evidenceRef, observedAt, "failed");
      case AgentEventKinds.RunFailed:
        return projectRunFailure(event as RunFailureEvent, evidenceRef, observedAt);
      case AgentEventKinds.RunCancelled:
        return projectRunCancellation(event as RunCancellationEvent, evidenceRef, observedAt);
      case AgentEventKinds.ScheduledTaskRunStarted:
        return projectScheduledLifecycle(event as ScheduledTaskLifecycleEvent, evidenceRef, observedAt, "started");
      case AgentEventKinds.ScheduledTaskRunCompleted:
        return projectScheduledLifecycle(event as ScheduledTaskLifecycleEvent, evidenceRef, observedAt, "completed");
      case AgentEventKinds.ScheduledTaskRunFailed:
        return projectScheduledLifecycle(event as ScheduledTaskLifecycleEvent, evidenceRef, observedAt, "failed");
      case AgentEventKinds.ChildRunStarted:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "started");
      case AgentEventKinds.ChildRunCompleted:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "completed");
      case AgentEventKinds.ChildRunPartialCompleted:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "partial_completed");
      case AgentEventKinds.ChildRunFailed:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "failed");
      case AgentEventKinds.ChildRunCancelled:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "cancelled");
      case AgentEventKinds.ChildRunTimedOut:
        return projectChildLifecycle(event as ChildLifecycleEvent, evidenceRef, observedAt, "timed_out");
      default:
        return undefined;
    }
  })();
  if (!projected) return undefined;
  return {
    ...projected,
    evidenceRefs: uniqueStrings([
      ...projected.evidenceRefs,
      ...worldSessionEvidenceRefs(event),
      ...worldRequestEvidenceRefs(event),
    ]),
  };
}

function projectToolLifecycle(
  event: ToolLifecycleEvent,
  evidenceRef: string,
  observedAt: string,
  status: "started" | "completed" | "failed",
): WorldLifecycleProjection {
  const toolName = requireText(event.data.toolName, "tool name");
  const subjectId = scopedEntityId("tool-call", event.context.sessionId, event.context.requestId, event.data.callId);
  const presentation = "presentation" in event.data ? event.data.presentation : undefined;
  const headline = presentation?.headline?.trim();
  const purpose = "purpose" in event.data ? event.data.purpose?.trim() : undefined;
  const failure = status === "failed" && "message" in event.data ? event.data.message.trim() : undefined;
  const summaryParts =
    status === "started"
      ? residentSummary(`开始${toolName}${purpose ? `：${purpose}` : ""}`)
      : status === "completed"
        ? residentSummary(`完成${toolName}${headline ? `：${headline}` : ""}`)
        : residentSummary(`执行${toolName}失败：${requireText(failure, "tool failure message")}`);
  const references = [
    evidenceRef,
    ...(presentation?.evidence?.flatMap((entry) => (entry.evidenceUri ? [entry.evidenceUri] : [])) ?? []),
    ...(presentation?.artifactUri ? [presentation.artifactUri] : []),
  ];
  return {
    subjectId,
    type: `tool.${status}`,
    summaryParts,
    attributes: {
      lifecycle: status,
      toolName,
      ...("callId" in event.data ? { callId: event.data.callId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(headline ? { headline } : {}),
      ...("durationMs" in event.data && typeof event.data.durationMs === "number"
        ? { durationMs: event.data.durationMs }
        : {}),
    },
    occurredAt:
      status === "started" && "startedAt" in event.data && event.data.startedAt
        ? notAfter(event.data.startedAt, observedAt)
        : observedAt,
    idempotencyKey: `world-lifecycle:${eventIdentity(event, event.data.callId)}:${status}`,
    evidenceRefs: uniqueStrings(references),
  };
}

function projectRunFailure(event: RunFailureEvent, evidenceRef: string, observedAt: string): WorldLifecycleProjection {
  const message = requireText(event.data.message, "run failure message");
  const subjectId = scopedEntityId("run", event.context.sessionId, event.context.requestId);
  return {
    subjectId,
    type: "run.failed",
    summaryParts: residentSummary(`未能完成这次处理：${message}`),
    attributes: { lifecycle: "failed", ...(event.data.code ? { code: event.data.code } : {}) },
    occurredAt: observedAt,
    idempotencyKey: `world-lifecycle:${eventIdentity(event)}:failed`,
    evidenceRefs: [evidenceRef],
  };
}

function projectRunCancellation(
  event: RunCancellationEvent,
  evidenceRef: string,
  observedAt: string,
): WorldLifecycleProjection {
  const subjectId = scopedEntityId("run", event.context.sessionId, event.context.requestId);
  return {
    subjectId,
    type: "run.cancelled",
    summaryParts: residentSummary("停止了这次处理。"),
    attributes: { lifecycle: "cancelled", reason: event.data.reason },
    occurredAt: observedAt,
    idempotencyKey: `world-lifecycle:${eventIdentity(event)}:cancelled`,
    evidenceRefs: [evidenceRef],
  };
}

function projectScheduledLifecycle(
  event: ScheduledTaskLifecycleEvent,
  evidenceRef: string,
  observedAt: string,
  status: "started" | "completed" | "failed",
): WorldLifecycleProjection {
  const taskId = requireText(event.data.taskId, "scheduled task id");
  const runId = requireText(event.data.runId, "scheduled run id");
  const subjectId = scopedEntityId("scheduled-run", undefined, taskId, runId);
  const label = event.context.scope?.workflowName?.trim() || taskId;
  const summaryParts =
    status === "started"
      ? residentSummary(`开始执行计划“${label}”`)
      : status === "completed"
        ? residentSummary(`完成计划“${label}”`)
        : residentSummary(`执行计划“${label}”失败${event.data.error ? `：${event.data.error}` : ""}`);
  return {
    subjectId,
    type: `scheduled.${status}`,
    summaryParts,
    attributes: {
      lifecycle: status,
      taskId,
      runId,
      ...(event.data.error ? { error: event.data.error } : {}),
    },
    occurredAt: observedAt,
    idempotencyKey: `world-lifecycle:${eventIdentity(event, runId)}:${status}`,
    evidenceRefs: [evidenceRef],
  };
}

function projectChildLifecycle(
  event: ChildLifecycleEvent,
  evidenceRef: string,
  observedAt: string,
  status: "started" | "completed" | "partial_completed" | "failed" | "cancelled" | "timed_out",
): WorldLifecycleProjection {
  const childRunId = requireText(event.data.childRunId, "child run id");
  const agentName = requireText(event.data.agentName, "child agent name");
  const error = "error" in event.data && typeof event.data.error === "string" ? event.data.error.trim() : undefined;
  const subjectId = scopedEntityId("child-run", undefined, childRunId);
  const summaryParts =
    status === "started"
      ? residentSummary(`派遣${agentName}开始处理一件事`)
      : status === "completed"
        ? textSummary(`${agentName}完成了派遣任务`)
        : status === "partial_completed"
          ? textSummary(`${agentName}完成了部分派遣任务`)
          : status === "cancelled"
            ? textSummary(`${agentName}的派遣任务已停止`)
            : status === "timed_out"
              ? textSummary(`${agentName}的派遣任务超时`)
              : textSummary(`${agentName}的派遣任务失败${error ? `：${error}` : ""}`);
  return {
    subjectId,
    type: `child.${status}`,
    summaryParts,
    attributes: {
      lifecycle: status,
      childRunId,
      agentName,
      ...(event.data.ownerRunId ? { ownerRunId: event.data.ownerRunId } : {}),
      ...(event.data.nodeId ? { nodeId: event.data.nodeId } : {}),
      ...(error ? { error } : {}),
    },
    occurredAt: observedAt,
    idempotencyKey: `world-lifecycle:${eventIdentity(event, childRunId)}:${status}`,
    evidenceRefs: [evidenceRef],
  };
}

function worldEventEvidenceRef(event: AgentDomainEvent): string {
  const identity = event.eventId ?? sha256HexOfCanonicalJson(event);
  return `senera://event/${encodeURIComponent(identity)}`;
}

function eventIdentity(event: AgentDomainEvent, semanticId?: string): string {
  const context = event.context as AgentEventContext;
  return sha256HexOfCanonicalJson({
    kind: event.kind,
    sessionId: context.sessionId,
    requestId: context.requestId,
    step: context.step,
    semanticId,
  }).slice(0, 32);
}

function worldSessionEvidenceRefs(event: AgentDomainEvent): string[] {
  const context = event.context as AgentEventContext;
  const data = event.data as Record<string, unknown>;
  const sessionId =
    readNonEmptyText(context.sessionId) ?? readNonEmptyText(data.sessionId) ?? readNonEmptyText(data.childSessionId);
  return sessionId ? [`senera://session/${encodeURIComponent(sessionId)}`] : [];
}

function worldRequestEvidenceRefs(event: AgentDomainEvent): string[] {
  const requestId = readNonEmptyText((event.context as AgentEventContext).requestId);
  return requestId ? [requestEvidenceRef(requestId)] : [];
}

function requestEvidenceRef(requestId: string): string {
  return `senera://request/${encodeURIComponent(requestId)}`;
}

function scopedEntityId(
  prefix: string,
  sessionId: string | undefined,
  requestId: string | undefined,
  id?: string,
): string {
  return `senera://${prefix}/${sha256HexOfCanonicalJson({ sessionId, requestId, id }).slice(0, 32)}`;
}

function notAfter(value: string, observedAt: string): string {
  const candidate = Temporal.Instant.from(value).toString();
  return Temporal.Instant.compare(Temporal.Instant.from(candidate), Temporal.Instant.from(observedAt)) <= 0
    ? candidate
    : observedAt;
}

function requireText(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`World lifecycle ${label} must not be empty.`);
  return normalized;
}

function readNonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function residentSummary(text: string): AgentTextParts {
  return createAgentTextParts([identityPart("resident"), textPart(text)]);
}

function textSummary(text: string): AgentTextParts {
  return createAgentTextParts([textPart(text)]);
}

type ToolLifecycleEvent =
  | Extract<AgentToolDomainEvent, { kind: typeof AgentEventKinds.ToolCallStarted }>
  | Extract<AgentToolDomainEvent, { kind: typeof AgentEventKinds.ToolCallCompleted }>
  | Extract<AgentToolDomainEvent, { kind: typeof AgentEventKinds.ToolCallFailed }>;
type RunFailureEvent = Extract<AgentRunDomainEvent, { kind: typeof AgentEventKinds.RunFailed }>;
type RunCancellationEvent = Extract<AgentRunDomainEvent, { kind: typeof AgentEventKinds.RunCancelled }>;
type ScheduledTaskLifecycleEvent = Extract<
  AgentOrchestrationDomainEvent,
  { data: { taskId: string; runId: string; sessionId: string; status: string } }
>;
type ChildLifecycleEvent = Extract<
  AgentOrchestrationDomainEvent,
  {
    data: {
      childRunId: string;
      ownerRunId: string;
      nodeId: string;
      childSessionId: string;
      agentName: string;
      status: string;
    };
  }
>;
