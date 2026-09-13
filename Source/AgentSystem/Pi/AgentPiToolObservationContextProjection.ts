import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { escapeXml } from "../Prompt/AgentTurnRequestComposer.js";
import { readAgentPiMessageTextContent, readAgentPiToolObservation } from "./AgentPiToolObservation.js";
import { projectAgentPiToolObservationForContext } from "../PiShared/AgentPiToolObservationProjection.js";

const ToolObservationAttributionPrefix = '<observation attribution="tool">';
const ToolObservationAttributionSuffix = "</observation>";

/**
 * Projects an old Artifact-backed tool result without changing the persisted
 * Pi transcript. The full result remains in the Artifact; the provider only
 * needs continuity facts and the retrieval coordinate after this boundary.
 */
export function projectAgentPiToolObservationContextMessage(message: AgentMessage): AgentMessage | undefined {
  if (message.role !== "toolResult") return undefined;

  const text = readAgentPiMessageTextContent(message);
  const observation = readAgentPiToolObservation(text);
  if (!observation) {
    return undefined;
  }
  const projectedObservation = projectAgentPiToolObservationForContext(observation);
  if (projectedObservation === observation) return undefined;

  const projected = stringifyAgentCanonicalJson(projectedObservation);
  const wireText =
    text.startsWith(ToolObservationAttributionPrefix) && text.endsWith(ToolObservationAttributionSuffix)
      ? `${ToolObservationAttributionPrefix}${escapeXml(projected)}${ToolObservationAttributionSuffix}`
      : projected;
  let replaced = false;
  const content: typeof message.content = [];
  for (const part of message.content) {
    if (part.type === "image") continue;
    if (!replaced) {
      replaced = true;
      content.push({ ...part, text: wireText });
      continue;
    }
    content.push(part);
  }
  return replaced ? { ...message, content } : undefined;
}
