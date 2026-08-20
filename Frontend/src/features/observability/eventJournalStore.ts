import { create } from "zustand";
import type { AgentTransportObservation } from "../../api/agentTransportObserver";
import { EventSpecs, type EventKind, type EventLayer, type EventPhase } from "../../api/generatedEventCatalog";
import { projectEventForJournal, readJsonPointer } from "./eventJournalProjection";

export const EventJournalPolicy = {
  maxRecords: 2_000,
  maxBytes: 2 * 1024 * 1024,
  maxAgeMs: 30 * 60 * 1_000,
  metadataBytes: 256,
} as const;

export interface EventJournalRecord {
  readonly id: string;
  readonly localSequence: number;
  readonly connectionId: string;
  readonly observedAt: string;
  readonly observedAtEpoch: number;
  readonly direction: "inbound" | "outbound" | "system";
  readonly stage: "wire" | "projected" | "command" | "lifecycle" | "malformed";
  readonly kind: string;
  readonly layer?: EventLayer;
  readonly phase?: EventPhase;
  readonly sequence?: number;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly commandId?: string;
  readonly resourceId?: string;
  readonly step?: number;
  readonly observedByteLength?: number;
  readonly retainedByteLength: number;
  readonly projection?: Record<string, unknown>;
  readonly projectionOmitted: boolean;
  readonly summary?: string;
}

interface EventJournalState {
  readonly records: readonly EventJournalRecord[];
  readonly totalBytes: number;
  readonly recording: boolean;
  readonly viewPausedAt?: number;
  readonly wireCapture: boolean;
  readonly selectedId?: string;
  append: (observations: readonly AgentTransportObservation[]) => void;
  clear: () => void;
  setRecording: (recording: boolean) => void;
  setViewPaused: (paused: boolean) => void;
  setWireCapture: (enabled: boolean) => void;
  select: (id?: string) => void;
}

let nextJournalSequence = 1;

export const useEventJournalStore = create<EventJournalState>((set, get) => ({
  records: [],
  totalBytes: 0,
  recording: true,
  wireCapture: false,
  append: (observations) => {
    const state = get();
    if (!state.recording) return;
    const additions = observations.flatMap((observation) =>
      observation.stage === "wire" && !state.wireCapture ? [] : [createJournalRecord(observation)],
    );
    if (additions.length === 0) return;
    const now = Date.now();
    const cutoff = now - EventJournalPolicy.maxAgeMs;
    const records = [...state.records.filter((record) => record.observedAtEpoch >= cutoff), ...additions];
    let totalBytes = records.reduce((total, record) => total + record.retainedByteLength, 0);
    while (records.length > EventJournalPolicy.maxRecords || totalBytes > EventJournalPolicy.maxBytes) {
      const removed = records.shift();
      if (!removed) break;
      totalBytes -= removed.retainedByteLength;
    }
    const selectedId =
      state.selectedId && records.some((record) => record.id === state.selectedId) ? state.selectedId : undefined;
    set({ records, totalBytes, selectedId });
  },
  clear: () => set({ records: [], totalBytes: 0, selectedId: undefined, viewPausedAt: undefined }),
  setRecording: (recording) => set({ recording }),
  setViewPaused: (paused) => set({ viewPausedAt: paused ? (get().records.at(-1)?.localSequence ?? 0) : undefined }),
  setWireCapture: (wireCapture) => set({ wireCapture }),
  select: (selectedId) => set({ selectedId }),
}));

function createJournalRecord(observation: AgentTransportObservation): EventJournalRecord {
  const localSequence = nextJournalSequence;
  nextJournalSequence += 1;
  const base = {
    id: `journal-${localSequence}`,
    localSequence,
    connectionId: observation.connectionId,
    observedAt: observation.observedAt,
    observedAtEpoch: Date.parse(observation.observedAt),
    direction: observation.direction,
    stage: observation.stage,
    observedByteLength: observation.byteLength,
  } as const;

  if (observation.stage === "projected") {
    const { envelope } = observation;
    const projection = projectEventForJournal(envelope);
    return {
      ...base,
      kind: envelope.kind,
      layer: envelope.layer,
      phase: envelope.phase,
      sequence: envelope.sequence,
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      step: envelope.step,
      resourceId: readProjectedResourceId(envelope.kind, projection.value),
      retainedByteLength: EventJournalPolicy.metadataBytes + projection.byteLength,
      projection: projection.value,
      projectionOmitted: projection.omitted,
      summary: projection.summary,
    };
  }
  if (observation.stage === "command") {
    return {
      ...base,
      kind: observation.requestType,
      ...observation.correlation,
      retainedByteLength: EventJournalPolicy.metadataBytes,
      projectionOmitted: false,
    };
  }
  if (observation.stage === "lifecycle") {
    return {
      ...base,
      kind: `socket.${observation.state}`,
      retainedByteLength: EventJournalPolicy.metadataBytes,
      projectionOmitted: false,
      summary: formatLifecycleSummary(observation),
    };
  }
  if (observation.stage === "malformed") {
    return {
      ...base,
      kind: "socket.malformed",
      layer: "error",
      retainedByteLength: EventJournalPolicy.metadataBytes,
      projectionOmitted: false,
      summary: observation.message,
    };
  }
  return {
    ...base,
    kind: "transport.frame",
    retainedByteLength: EventJournalPolicy.metadataBytes,
    projectionOmitted: false,
    summary: observation.byteLength === undefined ? undefined : `${observation.byteLength} B`,
  };
}

function readProjectedResourceId(kind: string, projection: Record<string, unknown> | undefined): string | undefined {
  const observation = EventSpecs[kind as EventKind]?.observation;
  if (!observation || !("resourceIdPointer" in observation)) return undefined;
  const resourceIdPointer = observation.resourceIdPointer;
  if (!resourceIdPointer) return undefined;
  const resourceId = readJsonPointer(projection, resourceIdPointer);
  return typeof resourceId === "string" && resourceId.length > 0 ? resourceId : undefined;
}

function formatLifecycleSummary(
  observation: Extract<AgentTransportObservation, { stage: "lifecycle" }>,
): string | undefined {
  if (observation.state === "retry_scheduled") {
    return `attempt=${observation.attempt ?? 0}  delay=${observation.delayMs ?? 0}ms`;
  }
  if (observation.state === "closed") {
    return `code=${observation.code ?? 0}${observation.reason ? `  reason=${observation.reason}` : ""}`;
  }
  return undefined;
}
