import type { AgentPiActivatedSkill as Skill } from "./AgentPiSkillCatalog.js";
import { renderPiSystemPromptFrame, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { projectAgentModelTextContent } from "../Text/AgentModelPayloadProjection.js";

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
  // Producers budget complete entries by tokens. Cutting the assembled wire
  // by characters can remove identities, references, or closing delimiters.
  const snapshot = projectAgentModelTextContent(rendered).text.trim();
  if (!snapshot) return undefined;

  return [
    `<${AgentPiTurnContextElementName} protocol="${AgentPiTurnContextProtocol}" source="host">`,
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
