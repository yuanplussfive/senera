import { z } from "zod";

/**
 * Resident state is the host-derived, per-turn "inner weather" that lets a
 * statically stable persona stay present across long tool loops. It carries
 * only subjective stance (how the resident is currently taking things), never
 * facts, file content or policy. Values are produced by a deterministic
 * ruleset, never by the model, so behaviour is testable and replayable.
 */

export const AgentResidentBearingValues = ["direct", "wry", "gentle", "excited", "calm"] as const;
export const AgentResidentMoodValues = ["relaxed", "focused", "trying", "relieved", "amused", "tense"] as const;
export const AgentResidentFootingValues = ["on_whim", "data_gathering", "in_the_middle_of", "done"] as const;

export const AgentResidentStateSchema = z
  .object({
    /** Persona default register; stable across the session and never moved by signals. */
    bearing: z.enum(AgentResidentBearingValues),
    /** Current emotional stance, advanced through a deterministic transition ruleset. */
    mood: z.enum(AgentResidentMoodValues),
    /** Where in the current activity the resident is. */
    footing: z.enum(AgentResidentFootingValues),
    /** The concrete subject attention currently rests on (a city, file, topic, user). */
    target: z.string().trim().min(1).max(48).optional(),
  })
  .strict();

export type AgentResidentState = z.infer<typeof AgentResidentStateSchema>;
export type AgentResidentBearing = (typeof AgentResidentBearingValues)[number];
export type AgentResidentMood = (typeof AgentResidentMoodValues)[number];
export type AgentResidentFooting = (typeof AgentResidentFootingValues)[number];

export const AgentResidentUserSentimentValues = ["positive", "negative", "neutral", "absent"] as const;
export type AgentResidentUserSentiment = (typeof AgentResidentUserSentimentValues)[number];

/** Structural signals consumed by the engine to advance one turn of state. */
export interface AgentResidentStateSignals {
  readonly bearing: AgentResidentBearing;
  readonly userSentiment: AgentResidentUserSentiment;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly newTaskRequested: boolean;
  readonly taskConcluded: boolean;
  readonly focusedObject?: string;
}

const AgentResidentEvent = {
  Progress: "progress",
  Setback: "setback",
  Stuck: "stuck",
  Praise: "praise",
  Friction: "friction",
  Idle: "idle",
} as const;
type AgentResidentEvent = (typeof AgentResidentEvent)[keyof typeof AgentResidentEvent];

/**
 * Every (mood, event) pair maps explicitly to a next mood. The table is fully
 * enumerated — there is no fallback branch and no LLM guess — so a given mood
 * sequence always converges the same way and can be asserted exhaustively.
 */
const MoodTransitions: Readonly<Record<AgentResidentMood, Readonly<Record<AgentResidentEvent, AgentResidentMood>>>> = {
  relaxed: {
    progress: "focused",
    setback: "trying",
    stuck: "tense",
    praise: "amused",
    friction: "tense",
    idle: "relaxed",
  },
  focused: {
    progress: "relieved",
    setback: "trying",
    stuck: "tense",
    praise: "amused",
    friction: "tense",
    idle: "focused",
  },
  trying: {
    progress: "relieved",
    setback: "trying",
    stuck: "tense",
    praise: "amused",
    friction: "tense",
    idle: "trying",
  },
  relieved: {
    progress: "relaxed",
    setback: "trying",
    stuck: "tense",
    praise: "amused",
    friction: "tense",
    idle: "relaxed",
  },
  amused: {
    progress: "relieved",
    setback: "trying",
    stuck: "tense",
    praise: "amused",
    friction: "tense",
    idle: "focused",
  },
  tense: { progress: "focused", setback: "tense", stuck: "tense", praise: "relaxed", friction: "tense", idle: "tense" },
};

export function initialResidentState(bearing: AgentResidentBearing = "direct"): AgentResidentState {
  return { bearing, mood: "relaxed", footing: "on_whim" };
}

/**
 * Advances one turn of resident state from structural signals. Mood moves by
 * the enumerated ruleset; footing follows the activity stream; attention
 * (target) latches onto the first concrete subject and only drops when a new
 * subject appears.
 */
export function nextResidentState(prev: AgentResidentState, signals: AgentResidentStateSignals): AgentResidentState {
  const mood = MoodTransitions[prev.mood][primaryEvent(signals)];
  const footing = deriveFooting(signals);
  const candidate = signals.focusedObject?.trim();
  const target = candidate ? candidate.slice(0, 48) : prev.target;
  return {
    bearing: signals.bearing,
    mood,
    footing,
    ...(target ? { target } : {}),
  };
}

function primaryEvent(signals: AgentResidentStateSignals): AgentResidentEvent {
  if (signals.userSentiment === "negative") return AgentResidentEvent.Friction;
  if (signals.userSentiment === "positive") return AgentResidentEvent.Praise;
  const { toolSuccessCount: successes, toolFailureCount: failures } = signals;
  if (failures > 0) return failures >= 2 && successes === 0 ? AgentResidentEvent.Stuck : AgentResidentEvent.Setback;
  if (successes > 0) return AgentResidentEvent.Progress;
  return AgentResidentEvent.Idle;
}

function deriveFooting(signals: AgentResidentStateSignals): AgentResidentFooting {
  if (signals.newTaskRequested) return "on_whim";
  if (signals.taskConcluded) return "done";
  if (signals.toolSuccessCount > 0 || signals.toolFailureCount > 0) return "in_the_middle_of";
  return "on_whim";
}
