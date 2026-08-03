/**
 * Shared XML tag constants for compaction summary sections.
 *
 * These tags are used in three places:
 * 1. {@link AgentPiCompactionSummaryFormatter} — produces the XML tags when
 *    formatting the compaction summary.
 * 2. {@link AgentPiOpenAiPlanningProjector} (PiProxy) — detects the tags when
 *    scanning messages for a compaction boundary.
 * 3. {@link AgentPlannerSystemMessageFormatter} — registers descriptors so
 *    the tags can be used in the system message section registry.
 *
 * Centralising the tag names here eliminates the previous three-way hardcoded
 * duplication and ensures all consumers stay in sync.
 */

export const AgentCompactionSummaryTags = {
  /** XML tag wrapping the conversation summary text. */
  summary: "compaction_summary",
  /** XML tag wrapping the tool call index section. */
  toolIndex: "compaction_tool_index",
} as const;

/** Opening tag for the summary section, e.g. `<compaction_summary>`. */
export const compactionSummaryOpen = `<${AgentCompactionSummaryTags.summary}>`;

/** Closing tag for the summary section, e.g. `</compaction_summary>`. */
export const compactionSummaryClose = `</${AgentCompactionSummaryTags.summary}>`;
