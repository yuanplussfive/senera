import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";

/**
 * Projects the two host-owned identity references supported by preset
 * Markdown. This is deliberately a narrow token substitution, not a general
 * template language: the resulting Markdown is still escaped by the prompt
 * renderer as ordinary preset content.
 */
export function renderAgentPromptPresetIdentity(markdown: string, identity: AgentIdentityDisplayValues): string {
  return markdown.replace(/\{\{\s*(user|assistant)\s*\}\}/giu, (_token, role: string) => {
    return identity[role.toLowerCase() as keyof AgentIdentityDisplayValues];
  });
}
