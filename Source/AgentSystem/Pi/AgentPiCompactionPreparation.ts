import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  estimateTokens,
  findCutPoint,
  findTurnStartIndex,
  sessionEntryToContextMessages,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";

export interface AgentPiCompactionPreparation {
  readonly firstKeptEntryId: string;
  readonly messagesToSummarize: readonly AgentMessage[];
  readonly turnPrefixMessages: readonly AgentMessage[];
  readonly retainedMessages: readonly AgentMessage[];
  readonly previousSummary?: string;
  readonly tokensBefore: number;
}

/**
 * Builds a compaction cut exclusively from Pi's public session contracts. This
 * mirrors Pi's turn-safe cut semantics without importing an unexported dist path.
 */
export function prepareAgentPiCompaction(
  pathEntries: readonly SessionEntry[],
  settings: AgentPiResolvedCompactionSettings,
  measuredTokensBefore?: number,
): AgentPiCompactionPreparation | undefined {
  if (pathEntries.length === 0 || pathEntries.at(-1)?.type === "compaction") return undefined;

  const previousCompactionIndex = findPreviousCompactionIndex(pathEntries);
  const previousCompaction =
    previousCompactionIndex >= 0 && pathEntries[previousCompactionIndex]?.type === "compaction"
      ? pathEntries[previousCompactionIndex]
      : undefined;
  const boundaryStart = resolveBoundaryStart(pathEntries, previousCompactionIndex, previousCompaction);
  const tokensBefore = measuredTokensBefore ?? estimateSessionTokens(pathEntries);
  const preferredCutPoint = findCutPoint(
    [...pathEntries],
    boundaryStart,
    pathEntries.length,
    settings.keepRecentTokens,
  );
  const preferred = buildPreparationFromCutPoint(
    pathEntries,
    boundaryStart,
    preferredCutPoint,
    previousCompaction,
    tokensBefore,
  );
  if (preferred) return preferred;

  // Pi deliberately never cuts on a toolResult. When the newest completed
  // result alone crosses keepRecentTokens, its public cut-point algorithm can
  // fall back to the boundary and report no history. Retain that result with
  // the assistant tool-call that owns it, then summarize the earlier prefix.
  const activeBatchCutPoint = findTrailingToolBatchCutPoint(pathEntries, boundaryStart);
  return activeBatchCutPoint
    ? buildPreparationFromCutPoint(pathEntries, boundaryStart, activeBatchCutPoint, previousCompaction, tokensBefore)
    : undefined;
}

function buildPreparationFromCutPoint(
  entries: readonly SessionEntry[],
  boundaryStart: number,
  cutPoint: { firstKeptEntryIndex: number; turnStartIndex: number; isSplitTurn: boolean },
  previousCompaction: Extract<SessionEntry, { type: "compaction" }> | undefined,
  tokensBefore: number,
): AgentPiCompactionPreparation | undefined {
  const firstKeptEntry = entries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry) return undefined;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize = messagesFromEntries(entries, boundaryStart, historyEnd);
  const turnPrefixMessages = cutPoint.isSplitTurn
    ? messagesFromEntries(entries, cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    retainedMessages: messagesFromEntries(entries, cutPoint.firstKeptEntryIndex, entries.length),
    ...(previousCompaction ? { previousSummary: previousCompaction.summary } : {}),
    tokensBefore,
  };
}

function findTrailingToolBatchCutPoint(
  entries: readonly SessionEntry[],
  boundaryStart: number,
): { firstKeptEntryIndex: number; turnStartIndex: number; isSplitTurn: boolean } | undefined {
  let lastMessageIndex = entries.length - 1;
  while (lastMessageIndex >= boundaryStart && entries[lastMessageIndex]?.type !== "message") lastMessageIndex -= 1;
  const lastMessage = entries[lastMessageIndex];
  if (!isToolResultEntry(lastMessage)) return undefined;

  let firstResultIndex = lastMessageIndex;
  const resultCallIds: string[] = [];
  while (firstResultIndex >= boundaryStart) {
    const entry = entries[firstResultIndex];
    if (!isToolResultEntry(entry)) break;
    resultCallIds.push(entry.message.toolCallId);
    firstResultIndex -= 1;
  }
  const assistantIndex = firstResultIndex;
  const assistantEntry = entries[assistantIndex];
  if (!isAssistantEntry(assistantEntry)) return undefined;

  const toolCallIds = assistantEntry.message.content.flatMap((entry) => (entry.type === "toolCall" ? [entry.id] : []));
  if (!sameNonEmptySet(toolCallIds, resultCallIds)) return undefined;

  const turnStartIndex = findTurnStartIndex([...entries], assistantIndex, boundaryStart);
  return {
    firstKeptEntryIndex: assistantIndex,
    turnStartIndex,
    isSplitTurn: turnStartIndex !== -1,
  };
}

type AgentPiSessionMessageEntry = Extract<SessionEntry, { type: "message" }>;

function isToolResultEntry(
  entry: SessionEntry | undefined,
): entry is AgentPiSessionMessageEntry & { readonly message: ToolResultMessage } {
  return entry?.type === "message" && entry.message.role === "toolResult";
}

function isAssistantEntry(
  entry: SessionEntry | undefined,
): entry is AgentPiSessionMessageEntry & { readonly message: AssistantMessage } {
  return entry?.type === "message" && entry.message.role === "assistant";
}

function sameNonEmptySet(first: readonly string[], second: readonly string[]): boolean {
  if (first.length === 0 || first.length !== second.length) return false;
  const firstSet = new Set(first);
  return firstSet.size === first.length && second.every((value) => firstSet.has(value));
}

function findPreviousCompactionIndex(entries: readonly SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === "compaction") return index;
  }
  return -1;
}

function resolveBoundaryStart(
  entries: readonly SessionEntry[],
  previousCompactionIndex: number,
  previousCompaction: Extract<SessionEntry, { type: "compaction" }> | undefined,
): number {
  if (!previousCompaction) return 0;
  const firstKeptEntryIndex = entries.findIndex((entry) => entry.id === previousCompaction.firstKeptEntryId);
  return firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : previousCompactionIndex + 1;
}

function messagesFromEntries(entries: readonly SessionEntry[], start: number, end: number): AgentMessage[] {
  if (start < 0 || end <= start) return [];
  return entries
    .slice(start, end)
    .flatMap((entry) => (entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)));
}

function estimateSessionTokens(entries: readonly SessionEntry[]): number {
  return buildSessionContext([...entries]).messages.reduce((total, message) => total + estimateTokens(message), 0);
}
