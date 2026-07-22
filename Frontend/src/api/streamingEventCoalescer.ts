import { EventKinds, type EventEnvelope, type ExecutionResourceOutputData } from "./eventTypes";

export const StreamingEventFlushPolicy = {
  targetFrameRateHz: 60,
  maxPendingFrames: 3,
} as const;

export const StreamingEventMaxLatencyMs = Math.ceil(
  (1000 / StreamingEventFlushPolicy.targetFrameRateHz) * StreamingEventFlushPolicy.maxPendingFrames,
);

const StreamingEventKinds: ReadonlySet<string> = new Set([EventKinds.ModelDelta, EventKinds.ExecutionResourceOutput]);

export function isBufferedStreamingEvent(kind: string): boolean {
  return StreamingEventKinds.has(kind);
}

export function coalesceStreamingEvents(queue: readonly EventEnvelope[]): EventEnvelope[] {
  const merged: EventEnvelope[] = [];

  for (const current of queue) {
    const previousIndex = merged.length - 1;
    const previous = merged[previousIndex];
    const coalesced = previous ? mergeAdjacentStreamingEvents(previous, current) : undefined;
    if (coalesced) {
      merged[previousIndex] = coalesced;
      continue;
    }
    merged.push(current);
  }

  return merged;
}

function mergeAdjacentStreamingEvents(previous: EventEnvelope, current: EventEnvelope): EventEnvelope | undefined {
  if (previous.kind !== current.kind) return undefined;
  if (current.kind === EventKinds.ModelDelta && modelDeltaKey(previous) === modelDeltaKey(current)) {
    return mergeModelDelta(previous, current);
  }
  if (
    current.kind === EventKinds.ExecutionResourceOutput &&
    resourceOutputKey(previous) === resourceOutputKey(current)
  ) {
    return mergeResourceOutput(previous, current);
  }
  return undefined;
}

function modelDeltaKey(env: EventEnvelope): string {
  return [env.sessionId ?? "", env.requestId ?? "", env.step ?? ""].join("\u0000");
}

function resourceOutputKey(env: EventEnvelope): string {
  return [env.sessionId ?? "", readResourceOutput(env).resourceId].join("\u0000");
}

function mergeModelDelta(previous: EventEnvelope, current: EventEnvelope): EventEnvelope {
  return {
    ...current,
    sequence: previous.sequence,
    timestamp: previous.timestamp,
    data: {
      text: readDeltaText(previous) + readDeltaText(current),
    },
  };
}

function mergeResourceOutput(previous: EventEnvelope, current: EventEnvelope): EventEnvelope | undefined {
  const previousData = readResourceOutput(previous);
  const currentData = readResourceOutput(current);
  if (previousData.stream !== currentData.stream || currentData.cursor !== previousData.cursor + 1) return undefined;
  return {
    ...current,
    sequence: previous.sequence,
    timestamp: previous.timestamp,
    data: {
      ...currentData,
      cursorStart: previousData.cursorStart ?? previousData.cursor,
      text: previousData.text + currentData.text,
      byteLength: previousData.byteLength + currentData.byteLength,
      truncated: previousData.truncated || currentData.truncated || undefined,
    } satisfies ExecutionResourceOutputData,
  };
}

function readDeltaText(env: EventEnvelope): string {
  return typeof (env.data as { text?: unknown }).text === "string" ? (env.data as { text: string }).text : "";
}

function readResourceOutput(env: EventEnvelope): ExecutionResourceOutputData {
  return env.data as ExecutionResourceOutputData;
}
