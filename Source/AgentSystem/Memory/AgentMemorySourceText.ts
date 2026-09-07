import type { AgentMemorySourceRecord } from "./AgentMemorySourceRepository.js";

export type AgentMemorySourceTextPreference = "content_first" | "summary_first";

/**
 * Returns only textual evidence that was persisted with a physical source.
 * Source kind and tool name identify a record but are not evidence, so they
 * must never become synthetic recall terms or model-facing prose.
 */
export function readAgentMemorySourceText(
  source: Pick<AgentMemorySourceRecord, "textContent" | "summary">,
  preference: AgentMemorySourceTextPreference = "content_first",
): string {
  const candidates =
    preference === "summary_first" ? [source.summary, source.textContent] : [source.textContent, source.summary];
  return candidates.map(normalizeText).find(Boolean) ?? "";
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
