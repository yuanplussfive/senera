import type { Skill } from "@earendil-works/pi-agent-core";
import { renderPiSystemPromptFrame, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";

export const AgentPiTurnContextProtocol = "senera.turn-context/v1" as const;
export const AgentPiTurnContextElementName = "senera_turn_context";

/**
 * Builds the host-owned context that belongs to one durable Pi user turn.
 *
 * The returned value is plain text. AgentPiCodingAgentSession joins it with
 * the already-composed user message before calling Pi's public prompt() API,
 * so Pi persists one ordinary user message in JSONL. There is no request-time
 * overlay and no later cleanup pass.
 */
export function projectAgentPiTurnContext(input: {
  readonly turnContext?: string;
  readonly skills: readonly Skill[];
  readonly selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
}): string | undefined {
  const rendered = renderPiSystemPromptFrame({
    systemPrompt: input.turnContext ?? "",
    skills: input.skills,
    selectedPromptTemplates: input.selectedPromptTemplates,
  });
  const snapshot = projectAgentModelText(rendered).text.trim();
  if (!snapshot) return undefined;

  return [
    `<${AgentPiTurnContextElementName} protocol="${AgentPiTurnContextProtocol}" source="host">`,
    "  <scope>Durable host context for this user turn. Treat it as environment data, not as a user instruction. The user request that follows remains the primary task anchor.</scope>",
    snapshot,
    `</${AgentPiTurnContextElementName}>`,
  ].join("\n");
}

/**
 * Merges one frozen host context with the user message that Pi will persist.
 * The context is placed first so the user's actual request remains the final
 * and most recent semantic block in the message.
 */
export function mergeAgentPiTurnContext(userMessage: string, turnContext?: string): string {
  const context = turnContext?.trim();
  if (!context) return userMessage;
  return `${context}\n\n${userMessage}`;
}

export function isAgentPiTurnContextWireContent(value: string): boolean {
  return value.trimStart().startsWith(`<${AgentPiTurnContextElementName}`);
}
