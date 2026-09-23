/**
 * Perception is a deterministic, first-person, present-tense narration of what
 * a tool result means to the resident persona. It is a projection citizen like
 * `observationProjection`, never a side-channel and never hardcoded per tool:
 *
 * - `perception` (optional declaration on a tool contract) carries only data:
 *   how the result is experienced (`kind`), whether it lies within the
 *   resident's current scene (`scope`), what was experienced (`object`), and an
 *   optional template whose `{field}` placeholders are filled from the result.
 * - The composer derives the visible phrase deterministically. It never invents
 *   perception the resident cannot honestly hold: remote results always fall
 *   back to "retrieved" wording; only `scope: local` grants "sensing" wording.
 *
 * There is deliberately no per-tool handler map; every tool resolves through
 * one composer. This keeps the narration medium-agnostic, testable, and bounded.
 */

export const AgentToolPerceptionKinds = {
  /** The result is the resident's current surroundings (temperature, scene). */
  Environment: "environment",
  /** The result was fetched from somewhere outside the resident's current scene. */
  Retrieved: "retrieved",
  /** The result reports something that has happened. */
  Event: "event",
  /** The result surfaced memory of the resident's own past. */
  Recall: "recall",
  /** The result records an action the resident itself performed. */
  Action: "action",
} as const;

export type AgentToolPerceptionKind = (typeof AgentToolPerceptionKinds)[keyof typeof AgentToolPerceptionKinds];

export const AgentToolPerceptionScopes = {
  /** The result references the resident's current, physically present scene. */
  Local: "local",
  /** The result references somewhere the resident cannot directly sense. */
  Remote: "remote",
} as const;

export type AgentToolPerceptionScope = (typeof AgentToolPerceptionScopes)[keyof typeof AgentToolPerceptionScopes];

export interface AgentToolPerceptionDeclaration {
  readonly kind: AgentToolPerceptionKind;
  readonly scope: AgentToolPerceptionScope;
  /**
   * What was experienced, in the resident's own words (e.g. "苏州那边的天气").
   * Optional: when absent the composer falls back to a compact result digest.
   */
  readonly object?: string;
  /**
   * Optional phrase with `{field}` placeholders resolved from the result before
   * the narration anchor is prefixed. Keeps narration without losing facts.
   */
  readonly template?: string;
}
