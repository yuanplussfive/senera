import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import {
  assertAgentSessionRepositoryPageSize,
  normalizeAgentSessionRequestIds,
} from "../Session/AgentSessionHistoryPaging.js";
import type { AgentSessionCursorPage, AgentSessionCursorPageRequest } from "../Session/AgentSessionRepository.js";

export interface InMemorySessionEntryPrefix {
  readonly entries: Array<{ entry: AgentConversationEntry; sequence: number }>;
  readonly requestIds: ReadonlySet<string>;
}

export class InMemorySessionEntryStore {
  private readonly entries = new Map<string, AgentConversationEntry[]>();
  private readonly entryIds = new Map<string, Set<string>>();
  private readonly indexesByRequest = new Map<string, Map<string, number[]>>();
  private readonly materializedMessageKeys = new Map<string, Set<string>>();

  entryCount(sessionId: string): number {
    return this.entries.get(sessionId)?.length ?? 0;
  }

  messageCount(sessionId: string): number {
    return this.materializedMessageKeys.get(sessionId)?.size ?? 0;
  }

  highWaterMark(sessionId: string): number | undefined {
    const count = this.entryCount(sessionId);
    return count > 0 ? count - 1 : undefined;
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    return this.indexesByRequest.get(sessionId)?.has(requestId) ?? false;
  }

  firstSequence(sessionId: string, requestId: string): number | undefined {
    return this.indexesByRequest.get(sessionId)?.get(requestId)?.[0];
  }

  requestIdsFrom(sessionId: string, requestId: string): string[] {
    const entries = this.entries.get(sessionId) ?? [];
    const anchor = this.firstSequence(sessionId, requestId) ?? -1;
    return anchor < 0 ? [] : [...new Set(entries.slice(anchor).map((entry) => entry.requestId))];
  }

  prefixThroughRequest(sessionId: string, requestId: string): InMemorySessionEntryPrefix | undefined {
    const sourceEntries = this.entries.get(sessionId) ?? [];
    const boundary = this.indexesByRequest.get(sessionId)?.get(requestId)?.at(-1) ?? -1;
    if (boundary < 0) return undefined;
    const entries = sourceEntries.slice(0, boundary + 1);
    return {
      entries: entries.map((entry, sequence) => ({ entry: structuredClone(entry), sequence })),
      requestIds: new Set(entries.map((entry) => entry.requestId)),
    };
  }

  load(sessionId: string): AgentConversationEntry[] {
    return [...(this.entries.get(sessionId) ?? [])];
  }

  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined {
    return this.entries.get(sessionId)?.find((entry) => entry.kind === "user.message");
  }

  loadPage(sessionId: string, request: AgentSessionCursorPageRequest): AgentSessionCursorPage<AgentConversationEntry> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const start = (request.after ?? -1) + 1;
    const entries = this.entries.get(sessionId) ?? [];
    const rows = entries.slice(start, Math.min(request.through + 1, start + pageSize + 1));
    return {
      items: rows.slice(0, pageSize),
      nextCursor: rows.length > pageSize ? start + pageSize - 1 : undefined,
    };
  }

  loadForRequests(sessionId: string, requestIds: readonly string[], throughSequence: number): AgentConversationEntry[] {
    const selected = new Set(normalizeAgentSessionRequestIds(requestIds));
    if (selected.size === 0) return [];
    const entries = this.entries.get(sessionId) ?? [];
    const byRequest = this.indexesByRequest.get(sessionId);
    if (!byRequest) return [];
    const indexes = [...selected].flatMap((requestId) => byRequest.get(requestId) ?? []);
    indexes.sort((left, right) => left - right);
    return indexes.flatMap((index) => (index <= throughSequence && entries[index] ? [entries[index]] : []));
  }

  assertCanAppend(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    const existingIds = this.entryIds.get(sessionId);
    const incomingIds = new Set<string>();
    for (const { entry } of entries) {
      if (existingIds?.has(entry.id) || incomingIds.has(entry.id)) {
        throw new Error(`Conversation entry already exists: ${sessionId}/${entry.id}`);
      }
      incomingIds.add(entry.id);
    }
    const startingSequence = this.entryCount(sessionId);
    for (const [offset, item] of entries.entries()) {
      if (item.sequence !== startingSequence + offset) {
        throw new Error(`Conversation entry sequence is not contiguous: ${sessionId}/${item.sequence}`);
      }
    }
  }

  append(sessionId: string, entry: AgentConversationEntry, sequence?: number): void {
    const list = this.entries.get(sessionId) ?? [];
    const ids = this.entryIds.get(sessionId) ?? new Set<string>();
    if (ids.has(entry.id)) throw new Error(`Conversation entry already exists: ${sessionId}/${entry.id}`);
    const nextSequence = sequence ?? list.length;
    if (nextSequence !== list.length) {
      throw new Error(`Conversation entry sequence is not contiguous: ${sessionId}/${nextSequence}`);
    }
    list.push(entry);
    this.entries.set(sessionId, list);
    ids.add(entry.id);
    this.entryIds.set(sessionId, ids);
    const byRequest = this.indexesByRequest.get(sessionId) ?? new Map<string, number[]>();
    const indexes = byRequest.get(entry.requestId) ?? [];
    indexes.push(nextSequence);
    byRequest.set(entry.requestId, indexes);
    this.indexesByRequest.set(sessionId, byRequest);
    const messageKeys = this.materializedMessageKeys.get(sessionId) ?? new Set<string>();
    messageKeys.add(`${entry.kind}:${entry.requestId}`);
    this.materializedMessageKeys.set(sessionId, messageKeys);
  }

  appendMany(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    this.assertCanAppend(sessionId, entries);
    for (const { entry, sequence } of entries) this.append(sessionId, entry, sequence);
  }

  install(sessionId: string, entries: AgentConversationEntry[]): void {
    const ids = new Set<string>();
    const byRequest = new Map<string, number[]>();
    const messageKeys = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      ids.add(entry.id);
      messageKeys.add(`${entry.kind}:${entry.requestId}`);
      const indexes = byRequest.get(entry.requestId) ?? [];
      indexes.push(index);
      byRequest.set(entry.requestId, indexes);
    }
    this.entries.set(sessionId, entries);
    this.entryIds.set(sessionId, ids);
    this.indexesByRequest.set(sessionId, byRequest);
    this.materializedMessageKeys.set(sessionId, messageKeys);
  }

  deleteFrom(sessionId: string, requestId: string): number {
    const list = this.entries.get(sessionId);
    if (!list) return 0;
    const index = this.firstSequence(sessionId, requestId) ?? -1;
    if (index < 0) return 0;
    const removed = list.length - index;
    this.install(sessionId, list.slice(0, index));
    return removed;
  }

  deleteSession(sessionId: string): void {
    this.entries.delete(sessionId);
    this.entryIds.delete(sessionId);
    this.indexesByRequest.delete(sessionId);
    this.materializedMessageKeys.delete(sessionId);
  }
}
