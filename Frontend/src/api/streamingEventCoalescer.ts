import { EventKinds, type EventEnvelope } from "./eventTypes";

type StreamingBucket = {
  model?: EventEnvelope;
  decision?: EventEnvelope;
};

export const StreamingEventFlushPolicy = {
  targetFrameRateHz: 60,
  maxPendingFrames: 3,
} as const;

export const StreamingEventMaxLatencyMs = Math.ceil(
  (1000 / StreamingEventFlushPolicy.targetFrameRateHz) *
    StreamingEventFlushPolicy.maxPendingFrames,
);

const StreamingEventKinds: ReadonlySet<string> = new Set([
  EventKinds.ModelDelta,
  EventKinds.DecisionXmlProgress,
]);

export function isBufferedStreamingEvent(kind: string): boolean {
  return StreamingEventKinds.has(kind);
}

export function coalesceStreamingEvents(queue: readonly EventEnvelope[]): EventEnvelope[] {
  const byRun = new Map<string, StreamingBucket>();

  for (const env of queue) {
    const key = streamingEventKey(env);
    const bucket = byRun.get(key) ?? {};

    if (env.kind === EventKinds.ModelDelta) {
      bucket.model = mergeModelDelta(bucket.model, env);
    } else if (env.kind === EventKinds.DecisionXmlProgress) {
      bucket.decision = env;
    }

    byRun.set(key, bucket);
  }

  return Array.from(byRun.values()).flatMap((bucket) => [
    ...(bucket.model ? [bucket.model] : []),
    ...(bucket.decision ? [bucket.decision] : []),
  ]);
}

function streamingEventKey(env: EventEnvelope): string {
  return [
    env.sessionId ?? "",
    env.requestId ?? "",
    env.step ?? "",
  ].join("\u0000");
}

function mergeModelDelta(
  previous: EventEnvelope | undefined,
  current: EventEnvelope,
): EventEnvelope {
  if (!previous) return current;
  return {
    ...current,
    sequence: previous.sequence,
    timestamp: previous.timestamp,
    data: {
      text: readDeltaText(previous) + readDeltaText(current),
    },
  };
}

function readDeltaText(env: EventEnvelope): string {
  return typeof (env.data as { text?: unknown }).text === "string"
    ? (env.data as { text: string }).text
    : "";
}
