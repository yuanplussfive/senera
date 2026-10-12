import { z } from "zod";

/**
 * Describes whether a tool call can change workspace content. The declaration
 * is part of the tool input contract so the host can avoid starting a
 * workspace observer for commands that are explicitly read-only.
 */
export const AgentWorkspaceEffects = Object.freeze({
  Read: "read",
  Mutate: "mutate",
} as const);

export type AgentWorkspaceEffect = (typeof AgentWorkspaceEffects)[keyof typeof AgentWorkspaceEffects];

export const AgentWorkspaceEffectSchema = z
  .enum([AgentWorkspaceEffects.Read, AgentWorkspaceEffects.Mutate])
  .describe("Whether the command only reads the workspace or may change workspace content.");

export interface AgentWorkspaceObservationIntentOptions {
  /** Declarative tool-contract metadata, not model-provided input. */
  readonly workspaceWritable?: boolean;
}

/**
 * Filesystem observation is opt-in. Explicit input effects take precedence;
 * otherwise the registered tool contract decides whether the tool may write.
 * Unknown tools do not start a watcher and must provide an exact mutation
 * receipt when they change workspace content.
 */
export function requiresWorkspaceObservation(
  input: Readonly<Record<string, unknown>>,
  options: AgentWorkspaceObservationIntentOptions = {},
): boolean {
  const nestedArguments = input.arguments;
  const nestedEffect =
    typeof nestedArguments === "object" && nestedArguments !== null && !Array.isArray(nestedArguments)
      ? (nestedArguments as Record<string, unknown>).workspaceEffect
      : undefined;
  const declaredEffect = input.workspaceEffect ?? nestedEffect;
  if (declaredEffect === AgentWorkspaceEffects.Read) return false;
  if (declaredEffect === AgentWorkspaceEffects.Mutate) return true;
  return options.workspaceWritable === true;
}
