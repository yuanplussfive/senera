import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import { readAgentNonBlankString, readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

/**
 * Context field keys used to locate the conversation summary text within the
 * BAML prompt envelope. These match the property names on
 * {@link AgentPiAssistantMessageCompileInput} serialized by the BAML prompt
 * factory via {@link buildPiPromptJson}.
 */
const ContextFieldKeys = {
  SeneraRuntime: "seneraRuntime",
  ConversationSummaryText: "conversationSummaryText",
} as const;

/**
 * Result of extracting the conversation summary from a BAML planner context.
 */
interface AgentPlannerCompactionSummaryExtraction {
  /**
   * The conversation summary text (already formatted with XML tags by
   * {@link AgentPiCompactionSummaryFormatter}), or `undefined` when no
   * compaction summary is present in the context.
   */
  readonly summaryText: string | undefined;

  /**
   * A shallow copy of the input context with `conversationSummaryText`
   * removed from `seneraRuntime`, ensuring the summary is not duplicated
   * inside `plannerInput` after projection.
   */
  readonly sanitizedContext: Record<string, unknown>;
}

/**
 * Extracts the conversation summary text from the BAML planner context and
 * returns a sanitized copy that omits the summary field.
 *
 * The summary text lives at `context.seneraRuntime.conversationSummaryText`.
 * After extraction, the returned `sanitizedContext` has the field stripped
 * so that downstream serialization (e.g. into `plannerInput`) does not
 * duplicate the summary payload.
 *
 * @param context - The `context` object from the BAML prompt envelope.
 */
export function extractPlannerCompactionSummary(
  context: Record<string, unknown>,
): AgentPlannerCompactionSummaryExtraction {
  const seneraRuntime = readAgentUnknownRecord(context[ContextFieldKeys.SeneraRuntime]);
  if (!seneraRuntime) {
    return { summaryText: undefined, sanitizedContext: context };
  }

  const summaryText = readAgentNonBlankString(seneraRuntime[ContextFieldKeys.ConversationSummaryText]);
  if (!summaryText) {
    return { summaryText: undefined, sanitizedContext: context };
  }

  const sanitizedSeneraRuntime = omitKey(seneraRuntime, ContextFieldKeys.ConversationSummaryText);
  return {
    summaryText,
    sanitizedContext: {
      ...context,
      [ContextFieldKeys.SeneraRuntime]: sanitizedSeneraRuntime,
    },
  };
}

/**
 * Builds a system message array containing the conversation summary text,
 * suitable for insertion before the timeline messages in the projected
 * planner prompt.
 *
 * The summary text is already formatted by
 * {@link AgentPiCompactionSummaryFormatter} with XML tag markers
 * (e.g. `<compaction_summary>`), so no additional
 * wrapping is applied here.
 *
 * @param summaryText - The formatted summary text, or `undefined` when absent.
 * @returns A single-element array containing the system message, or an empty
 *          array when `summaryText` is `undefined`.
 */
export function buildCompactionSummarySystemMessages(summaryText: string | undefined): AgentLanguageModelMessage[] {
  if (!summaryText) {
    return [];
  }
  return [
    {
      role: "system",
      content: summaryText,
    },
  ];
}

function omitKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}
