import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { StoredRunSnapshot } from "./AgentSessionRepository.js";
import { agentUnknownRecordOrEmpty, readAgentNonEmptyString } from "../Core/AgentUnknownValue.js";

export function recoverInterruptedRunWaitEvents(
  events: readonly AgentEventEnvelope[],
  snapshots: readonly StoredRunSnapshot[],
): AgentEventEnvelope[] {
  const recovery = new AgentSessionHistoryWaitRecovery();
  recovery.observe(events, snapshots);
  const recovered = recovery.complete();
  return recovered.length > 0 ? [...events, ...recovered] : [...events];
}

interface PendingWait {
  readonly event: AgentEventEnvelope;
  readonly snapshot: StoredRunSnapshot;
  readonly kind: "approval" | "interaction";
}

export class AgentSessionHistoryWaitRecovery {
  private readonly pending = new Map<string, PendingWait>();
  private maximumSequence = 0;
  private completed = false;

  observe(events: readonly AgentEventEnvelope[], snapshots: readonly StoredRunSnapshot[]): void {
    if (this.completed) throw new Error("Session history wait recovery is already complete.");
    const terminalRuns = new Map(
      snapshots
        .filter((snapshot) => snapshot.status !== "running")
        .map((snapshot) => [snapshot.requestId, snapshot] as const),
    );
    for (const event of events) this.observeEvent(event, terminalRuns);
  }

  complete(): AgentEventEnvelope[] {
    if (this.completed) return [];
    this.completed = true;
    const recovered: AgentEventEnvelope[] = [];
    for (const wait of this.pending.values()) {
      this.maximumSequence += 1;
      const data = agentUnknownRecordOrEmpty(wait.event.data);
      recovered.push(
        wait.kind === "approval"
          ? recoveredEnvelope(wait.event, this.maximumSequence, AgentEventKinds.ApprovalResolved, {
              ...data,
              status: "cancelled",
              disposition: "interrupt",
              message: wait.snapshot.errorMessage,
              resolvedAt: wait.snapshot.endedAt ?? wait.snapshot.updatedAt,
            })
          : recoveredEnvelope(wait.event, this.maximumSequence, AgentEventKinds.InteractionInputResolved, {
              ...data,
              status: "resolved",
              action: "cancel",
              resolutionMessage: wait.snapshot.errorMessage,
              resolvedAt: wait.snapshot.endedAt ?? wait.snapshot.updatedAt,
            }),
      );
    }
    this.pending.clear();
    return recovered;
  }

  private observeEvent(event: AgentEventEnvelope, terminalRuns: ReadonlyMap<string, StoredRunSnapshot>): void {
    this.maximumSequence = Math.max(this.maximumSequence, event.sequence);
    const data = agentUnknownRecordOrEmpty(event.data);

    if (event.kind === AgentEventKinds.ApprovalResolved) {
      this.resolve("approval", readAgentNonEmptyString(data.approvalId));
      return;
    }
    if (event.kind === AgentEventKinds.InteractionInputResolved) {
      this.resolve("interaction", readAgentNonEmptyString(data.interactionId));
      return;
    }

    const snapshot = event.requestId ? terminalRuns.get(event.requestId) : undefined;
    if (!snapshot) return;
    if (event.kind === AgentEventKinds.ApprovalRequested) {
      this.register("approval", readAgentNonEmptyString(data.approvalId), event, snapshot);
      return;
    }
    if (event.kind === AgentEventKinds.InteractionInputRequested) {
      this.register("interaction", readAgentNonEmptyString(data.interactionId), event, snapshot);
    }
  }

  private register(
    kind: PendingWait["kind"],
    id: string | undefined,
    event: AgentEventEnvelope,
    snapshot: StoredRunSnapshot,
  ): void {
    if (!id) return;
    const key = waitKey(kind, id);
    if (this.pending.has(key)) return;
    this.pending.set(key, { kind, event, snapshot });
  }

  private resolve(kind: PendingWait["kind"], id: string | undefined): void {
    if (!id) return;
    const key = waitKey(kind, id);
    this.pending.delete(key);
  }
}

function waitKey(kind: PendingWait["kind"], id: string): string {
  return `${kind}:${id}`;
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
    timestamp: readAgentNonEmptyString(data.resolvedAt) ?? source.timestamp,
    detailId: `${source.detailId ?? readRecoveryId(data)}:history_recovered`,
    data,
  };
}

function readRecoveryId(data: Record<string, unknown>): string {
  return readAgentNonEmptyString(data.approvalId) ?? readAgentNonEmptyString(data.interactionId) ?? "wait";
}
