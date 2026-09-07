import crypto from "node:crypto";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentContinuityObservation, AgentContinuitySignal } from "./AgentContinuityDomain.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";

/** Converts lifecycle events into host-owned, current runtime signals. */
export class AgentContinuityEventBridge {
  constructor(
    private readonly options: {
      readonly store: AgentContinuitySqliteStore;
      readonly identity: AgentContinuityIdentityContext;
      readonly now?: () => string;
      readonly logger?: AgentLogger;
    },
  ) {}

  observe(event: AgentDomainEvent): void {
    try {
      const signal = projectRuntimeSignal(
        event,
        this.options.identity,
        this.options.now?.() ?? new Date().toISOString(),
      );
      if (!signal) return;
      this.options.store.recordObservation(signal.observation);
      this.options.store.upsertSignal(signal.value);
    } catch (error) {
      this.options.logger?.warn("continuity.runtime_signal.persist_failed", {
        eventKind: event.kind,
        error: serializeError(error),
      });
    }
  }
}

interface RuntimeSignalProjection {
  readonly observation: AgentContinuityObservation;
  readonly value: AgentContinuitySignal;
}

function projectRuntimeSignal(
  event: AgentDomainEvent,
  identity: AgentContinuityIdentityContext,
  observedAt: string,
): RuntimeSignalProjection | undefined {
  const sourceRef = runtimeEventSourceRef(event);
  const payload = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const projected = readEventSignal(event.kind, payload);
  if (!projected) return undefined;
  const scope = { kind: "runtime" as const, id: identity.runtimeId };
  const signal: AgentContinuitySignal = {
    scope,
    namespace: projected.namespace,
    key: projected.key,
    value: projected.value,
    valueType: "string",
    authority: "system_observed",
    confidence: 1,
    observedAt,
    sourceRefs: [sourceRef],
  };
  return {
    value: signal,
    observation: {
      id: sourceRef,
      uri: `senera://continuity-event/${encodeURIComponent(sourceRef)}`,
      kind: "runtime.signal",
      summary: `${projected.namespace}.${projected.key} = ${projected.value}`,
      payload: {
        kind: "runtime_signal",
        eventKind: event.kind,
        namespace: projected.namespace,
        key: projected.key,
        value: projected.value,
      },
      sourceRefs: [sourceRef],
      watermark: sourceRef,
      scope,
      authority: "system_observed",
      confidence: 1,
      occurredAt: observedAt,
      observedAt,
      createdAtMs: Date.parse(observedAt),
    },
  };
}

function readEventSignal(
  kind: AgentDomainEvent["kind"],
  data: Record<string, unknown>,
): { readonly namespace: string; readonly key: string; readonly value: string } | undefined {
  if (kind === AgentEventKinds.ToolCallCompleted || kind === AgentEventKinds.ToolCallFailed) {
    const toolName = readNonEmptyString(data.toolName);
    if (!toolName) return undefined;
    return {
      namespace: "runtime.tool",
      key: normalizeSignalKey(toolName),
      value: kind === AgentEventKinds.ToolCallCompleted ? "completed" : "failed",
    };
  }
  if (
    kind === AgentEventKinds.ScheduledTaskRunStarted ||
    kind === AgentEventKinds.ScheduledTaskRunCompleted ||
    kind === AgentEventKinds.ScheduledTaskRunFailed
  ) {
    const taskId = readNonEmptyString(data.taskId);
    if (!taskId) return undefined;
    return {
      namespace: "runtime.schedule",
      key: normalizeSignalKey(taskId),
      value: readNonEmptyString(data.status) ?? lifecycleValue(kind),
    };
  }
  if (
    kind === AgentEventKinds.ChildRunQueued ||
    kind === AgentEventKinds.ChildRunStarted ||
    kind === AgentEventKinds.ChildRunCompleted ||
    kind === AgentEventKinds.ChildRunPartialCompleted ||
    kind === AgentEventKinds.ChildRunFailed ||
    kind === AgentEventKinds.ChildRunCancelled ||
    kind === AgentEventKinds.ChildRunTimedOut
  ) {
    const childRunId = readNonEmptyString(data.childRunId);
    if (!childRunId) return undefined;
    return {
      namespace: "runtime.child",
      key: normalizeSignalKey(childRunId),
      value: readNonEmptyString(data.status) ?? lifecycleValue(kind),
    };
  }
  return undefined;
}

function lifecycleValue(kind: AgentDomainEvent["kind"]): string {
  return kind.slice(kind.lastIndexOf(".") + 1);
}

function runtimeEventSourceRef(event: AgentDomainEvent): string {
  const raw = event.eventId ?? JSON.stringify({ kind: event.kind, context: event.context, data: event.data });
  return `senera://event/${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

function normalizeSignalKey(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._:-]+/gu, "_");
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
