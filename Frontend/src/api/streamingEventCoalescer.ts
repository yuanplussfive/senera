import { EventKinds, type EventEnvelope, type ExecutionResourceOutputData } from "./eventTypes";

type EventIndex = Map<string, number>;

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
  const modelIndexes: EventIndex = new Map();
  const resourceOutputIndexes: EventIndex = new Map();

  for (const env of queue) {
    if (env.kind === EventKinds.ModelDelta) {
      mergeIndexedEvent(merged, modelIndexes, modelDeltaKey(env), env, mergeModelDelta);
      continue;
    }
    if (env.kind === EventKinds.ExecutionResourceOutput) {
      mergeIndexedEvent(merged, resourceOutputIndexes, resourceOutputKey(env), env, mergeResourceOutput);
      continue;
    }
    merged.push(env);
  }

  return merged;
}

function mergeIndexedEvent(
  events: EventEnvelope[],
  indexes: EventIndex,
  key: string,
  current: EventEnvelope,
  merge: (previous: EventEnvelope, current: EventEnvelope) => EventEnvelope | undefined,
): void {
  const index = indexes.get(key);
  const previous = index === undefined ? undefined : events[index];
  const next = previous ? merge(previous, current) : undefined;
  if (next && index !== undefined) {
    events[index] = next;
    return;
  }
  indexes.set(key, events.length);
  events.push(current);
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
