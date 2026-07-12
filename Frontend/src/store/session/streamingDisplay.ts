import type { MotionLevel } from "../../shared/motion";

export interface StreamingDisplayPolicy {
  cadenceMs: number;
  minGraphemesPerTick: number;
  backlogGraphemesPerAcceleration: number;
  maxGraphemesPerTick: number;
}

export interface StreamingDisplayState {
  displayText: string;
  targetText: string;
}

export interface StreamingDisplayAdvanceResult extends StreamingDisplayState {
  changed: boolean;
  pending: boolean;
}

export const StreamingDisplayPolicies = {
  full: {
    cadenceMs: 18,
    minGraphemesPerTick: 2,
    backlogGraphemesPerAcceleration: 28,
    maxGraphemesPerTick: 12,
  },
  reduced: {
    cadenceMs: 12,
    minGraphemesPerTick: 8,
    backlogGraphemesPerAcceleration: 36,
    maxGraphemesPerTick: 40,
  },
  none: {
    cadenceMs: 0,
    minGraphemesPerTick: Number.MAX_SAFE_INTEGER,
    backlogGraphemesPerAcceleration: Number.MAX_SAFE_INTEGER,
    maxGraphemesPerTick: Number.MAX_SAFE_INTEGER,
  },
} as const satisfies Record<MotionLevel, StreamingDisplayPolicy>;

type IntlSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

type IntlSegmenterConstructor = new (
  locale?: string | string[],
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => IntlSegmenter;

export function readStreamingDisplayCadenceMs(level: MotionLevel): number {
  return StreamingDisplayPolicies[level].cadenceMs;
}

export function hasStreamingDisplayPending(state: StreamingDisplayState): boolean {
  return state.displayText !== state.targetText;
}

export function advanceStreamingDisplayText(
  state: StreamingDisplayState,
  level: MotionLevel,
): StreamingDisplayAdvanceResult {
  const policy = StreamingDisplayPolicies[level];
  const normalized = normalizeStreamingDisplayState(state);

  if (!normalized.targetText || level === "none") {
    return {
      ...normalized,
      displayText: normalized.targetText,
      changed: state.displayText !== normalized.targetText,
      pending: false,
    };
  }

  const remaining = Array.from(segmentGraphemes(normalized.targetText.slice(normalized.displayText.length)));
  const nextSegment = remaining.slice(0, readGraphemesPerTick(remaining.length, policy)).join("");
  const displayText = normalized.displayText + nextSegment;

  return {
    ...normalized,
    displayText,
    changed: displayText !== state.displayText,
    pending: displayText !== normalized.targetText,
  };
}

export function alignStreamingDisplayTarget(state: StreamingDisplayState): StreamingDisplayState {
  const normalized = normalizeStreamingDisplayState(state);
  if (!normalized.targetText) {
    return normalized.displayText ? { ...normalized, displayText: "" } : normalized;
  }
  return normalized;
}

function normalizeStreamingDisplayState(state: StreamingDisplayState): StreamingDisplayState {
  if (!state.displayText) return state;
  if (state.targetText.startsWith(state.displayText)) return state;
  return {
    ...state,
    displayText: "",
  };
}

function readGraphemesPerTick(backlog: number, policy: StreamingDisplayPolicy): number {
  const accelerated = policy.minGraphemesPerTick + Math.floor(backlog / policy.backlogGraphemesPerAcceleration);
  return Math.min(policy.maxGraphemesPerTick, accelerated);
}

function segmentGraphemes(value: string): Iterable<string> {
  const Segmenter = readIntlSegmenter();
  if (!Segmenter) return Array.from(value);
  const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value), (entry) => entry.segment);
}

function readIntlSegmenter(): IntlSegmenterConstructor | undefined {
  return (Intl as typeof Intl & { Segmenter?: IntlSegmenterConstructor }).Segmenter;
}
