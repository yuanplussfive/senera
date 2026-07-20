import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { StoredRunSnapshot } from "./AgentSessionRepository.js";

export function recoverInterruptedRunWaitEvents(
  events: readonly AgentEventEnvelope[],
  snapshots: readonly StoredRunSnapshot[],
): AgentEventEnvelope[] {
  const terminalRuns = new Map(
    snapshots
      .filter((snapshot) => snapshot.status !== "running")
      .map((snapshot) => [snapshot.requestId, snapshot] as const),
  );
  if (terminalRuns.size === 0) return [...events];

  const resolvedApprovals = collectResolvedIds(events, AgentEventKinds.ApprovalResolved, "approvalId");
  const resolvedInteractions = collectResolvedIds(events, AgentEventKinds.InteractionInputResolved, "interactionId");
  let sequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
  const recovered = events.flatMap((event) => {
    const snapshot = event.requestId ? terminalRuns.get(event.requestId) : undefined;
    if (!snapshot) return [];
    const data = readRecord(event.data);

    if (event.kind === AgentEventKinds.ApprovalRequested) {
      const approvalId = readString(data.approvalId);
      if (!approvalId || resolvedApprovals.has(approvalId)) return [];
      resolvedApprovals.add(approvalId);
      sequence += 1;
      return [
        recoveredEnvelope(event, sequence, AgentEventKinds.ApprovalResolved, {
          ...data,
          status: "cancelled",
          disposition: "interrupt",
          message: snapshot.errorMessage,
          resolvedAt: snapshot.endedAt ?? snapshot.updatedAt,
        }),
      ];
    }

    if (event.kind === AgentEventKinds.InteractionInputRequested) {
      const interactionId = readString(data.interactionId);
      if (!interactionId || resolvedInteractions.has(interactionId)) return [];
      resolvedInteractions.add(interactionId);
      sequence += 1;
      return [
        recoveredEnvelope(event, sequence, AgentEventKinds.InteractionInputResolved, {
          ...data,
          status: "resolved",
          action: "cancel",
          resolutionMessage: snapshot.errorMessage,
          resolvedAt: snapshot.endedAt ?? snapshot.updatedAt,
        }),
      ];
    }

    return [];
  });

  return recovered.length > 0 ? [...events, ...recovered] : [...events];
}

function collectResolvedIds(events: readonly AgentEventEnvelope[], kind: string, key: string): Set<string> {
  return new Set(
    events.flatMap((event) => {
      if (event.kind !== kind) return [];
      const id = readString(readRecord(event.data)[key]);
      return id ? [id] : [];
    }),
  );
}

function recoveredEnvelope(
  source: AgentEventEnvelope,
  sequence: number,
  kind: typeof AgentEventKinds.ApprovalResolved | typeof AgentEventKinds.InteractionInputResolved,
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    ...source,
    kind,
    sequence,
    timestamp: readString(data.resolvedAt) ?? source.timestamp,
    detailId: `${source.detailId ?? readRecoveryId(data)}:history_recovered`,
    data,
  };
}

function readRecoveryId(data: Record<string, unknown>): string {
  return readString(data.approvalId) ?? readString(data.interactionId) ?? "wait";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
