import type { Skill } from "@earendil-works/pi-agent-core";
import { sha256Hex } from "../Core/AgentHash.js";
import { renderPiSystemPromptFrame, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";

export const AgentPiTurnContextCustomType = "senera.turn_context";
export const AgentPiTurnContextElementName = "senera_turn_context";

export interface AgentPiTurnContextMessage {
  readonly customType: typeof AgentPiTurnContextCustomType;
  readonly content: string;
  readonly display: false;
  readonly details: {
    readonly revision: string;
  };
}

/** Projects volatile Senera context into one hidden, append-only Pi turn message. */
export function projectAgentPiTurnContextMessage(input: {
  readonly turnContext?: string;
  readonly skills: readonly Skill[];
  readonly selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
}): AgentPiTurnContextMessage | undefined {
  const renderedSnapshot = renderPiSystemPromptFrame({
    systemPrompt: input.turnContext ?? "",
    skills: input.skills,
    selectedPromptTemplates: input.selectedPromptTemplates,
  });
  const snapshot = projectAgentModelText(renderedSnapshot).text.trim();
  if (!snapshot) return undefined;
  const revision = sha256Hex(snapshot);
  const content = [
    `<${AgentPiTurnContextElementName} attribution="root" revision="${revision}">`,
    "  <scope>This snapshot applies to the immediately preceding user message and its tool loop. In later turns it is historical evidence; the latest senera_turn_context supersedes it for active memory, world, workflow, Skill, and resource state.</scope>",
    snapshot,
    `</${AgentPiTurnContextElementName}>`,
  ].join("\n");
  return {
    customType: AgentPiTurnContextCustomType,
    content,
    display: false,
    details: { revision },
  };
}

export function isAgentPiTurnContextWireContent(value: string): boolean {
  return value.trimStart().startsWith(`<${AgentPiTurnContextElementName}`);
}
