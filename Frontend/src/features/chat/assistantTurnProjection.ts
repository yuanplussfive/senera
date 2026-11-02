import type { ChatMessage, RunRecord } from "../../store/sessionStore";

export interface AssistantTurnListItem {
  __assistantTurn: true;
  key: string;
  requestId?: string;
  createdAt: string;
  messages: ChatMessage[];
  run?: RunRecord;
  streaming: boolean;
}

export type ProjectedMessageListItem = ChatMessage | AssistantTurnListItem;

interface AssistantTurnProjectionCache {
  readonly items: readonly ProjectedMessageListItem[];
  readonly itemKeys: readonly string[];
  readonly turnIndexesByRequestId: ReadonlyMap<string, number>;
  readonly runsByRequestId: Map<string, RunRecord>;
  readonly runsSource: readonly RunRecord[];
  readonly streamingRequestId?: string;
}

const assistantTurnProjectionCache = new WeakMap<readonly ChatMessage[], AssistantTurnProjectionCache>();
const eventAssistantTurnProjectionCache = new WeakMap<readonly ChatMessage[], AssistantTurnProjectionCache>();
const projectedMessageListItemKeys = new WeakMap<readonly ProjectedMessageListItem[], readonly string[]>();

export type AssistantTurnProjectionScope = "conversation" | "event";

export function isAssistantTurnListItem(item: ProjectedMessageListItem | undefined): item is AssistantTurnListItem {
  return !!item && "__assistantTurn" in item;
}

export function readProjectedMessageListItemKeys(items: readonly ProjectedMessageListItem[]): readonly string[] {
  const cached = projectedMessageListItemKeys.get(items);
  if (cached) return cached;
  const keys = items.map(readProjectedMessageListItemKey);
  projectedMessageListItemKeys.set(items, keys);
  return keys;
}

export function projectAssistantTurns(
  messages: readonly ChatMessage[],
  runs: readonly RunRecord[],
  streamingRun?: RunRecord,
  options?: { readonly scope?: AssistantTurnProjectionScope },
): ProjectedMessageListItem[] {
  const cache = selectAssistantTurnProjectionCache(options?.scope);
  const cached = cache.get(messages);
  if (cached && streamingRun && canProjectLiveRunFromCache(cached, runs, streamingRun)) {
    const liveProjection = projectLiveRunOntoItems(cached, streamingRun);
    cache.set(messages, {
      items: liveProjection.items,
      itemKeys: liveProjection.itemKeys,
      turnIndexesByRequestId: liveProjection.turnIndexesByRequestId,
      runsByRequestId: cached.runsByRequestId,
      runsSource: cached.runsSource,
      streamingRequestId: streamingRun.requestId,
    });
    projectedMessageListItemKeys.set(liveProjection.items, liveProjection.itemKeys);
    return liveProjection.items as ProjectedMessageListItem[];
  }
  if (cached && !streamingRun && cached.streamingRequestId === undefined && doRunRecordsMatch(cached, runs)) {
    return cached.items as ProjectedMessageListItem[];
  }

  const runsByRequestId = new Map(runs.map((run) => [run.requestId, run]));
  const requestOccurrences = new Map<string, number>();
  const assistantRequestIds = new Set(
    messages
      .filter((message) => message.role === "assistant" && message.requestId)
      .map((message) => message.requestId!),
  );
  const orphanTerminalRuns = runs
    .filter((run) => run.status === "cancelled" || run.status === "completed")
    .filter((run) => !assistantRequestIds.has(run.requestId))
    .filter(hasTerminalRunEvidence)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const orphanRunsByRequestId = new Map(orphanTerminalRuns.map((run) => [run.requestId, run]));
  const renderedRequestIds = new Set<string>();
  const items: ProjectedMessageListItem[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      // Host delivery is durable model input, not a human-authored conversation turn.
      const hostInput = message.role === "user" && (message.metadata?.hostInput || message.metadata?.backgroundTask);
      if (!hostInput) items.push(message);
      if (message.requestId) {
        const orphanRun = orphanRunsByRequestId.get(message.requestId);
        if (orphanRun) {
          items.push(projectTerminalRunSlice(orphanRun));
          renderedRequestIds.add(orphanRun.requestId);
        }
      }
      continue;
    }

    const previous = items.at(-1);
    if (
      isAssistantTurnListItem(previous) &&
      message.requestId !== undefined &&
      previous.requestId === message.requestId
    ) {
      previous.messages.push(message);
      continue;
    }

    const scope = message.requestId ?? message.id;
    const occurrence = requestOccurrences.get(scope) ?? 0;
    requestOccurrences.set(scope, occurrence + 1);
    items.push({
      __assistantTurn: true,
      key: `assistant-turn:${scope}:${occurrence}`,
      requestId: message.requestId,
      createdAt: message.createdAt,
      messages: [message],
      run: message.requestId ? runsByRequestId.get(message.requestId) : undefined,
      streaming: false,
    });
    if (message.requestId) renderedRequestIds.add(message.requestId);
  }

  for (const run of orphanTerminalRuns) {
    if (renderedRequestIds.has(run.requestId)) continue;
    items.push(projectTerminalRunSlice(run));
    renderedRequestIds.add(run.requestId);
  }

  if (streamingRun) {
    const existing = findLatestTurn(items, streamingRun.requestId);
    if (existing) {
      existing.run = streamingRun;
      existing.streaming = true;
    } else {
      const occurrence = requestOccurrences.get(streamingRun.requestId) ?? 0;
      items.push({
        __assistantTurn: true,
        key: `assistant-turn:${streamingRun.requestId}:${occurrence}`,
        requestId: streamingRun.requestId,
        createdAt: streamingRun.startedAt,
        messages: [],
        run: streamingRun,
        streaming: true,
      });
    }
  }

  rememberAssistantTurnProjection(cache, messages, items, runs, runsByRequestId, streamingRun?.requestId);
  return items;
}

function canProjectLiveRunFromCache(
  cached: AssistantTurnProjectionCache,
  nextRuns: readonly RunRecord[],
  streamingRun: RunRecord,
): boolean {
  if (cached.streamingRequestId && cached.streamingRequestId !== streamingRun.requestId) return false;
  return doRunRecordsMatch(cached, nextRuns, streamingRun.requestId);
}

function doRunRecordsMatch(
  cached: AssistantTurnProjectionCache,
  nextRuns: readonly RunRecord[],
  ignoredRequestId?: string,
): boolean {
  if (cached.runsSource === nextRuns) return true;
  if (cached.runsByRequestId.size !== nextRuns.length) return false;
  for (const run of nextRuns) {
    const requestId = run.requestId;
    if (requestId === ignoredRequestId) continue;
    if (cached.runsByRequestId.get(requestId) !== run) return false;
  }
  return true;
}

function projectLiveRunOntoItems(
  cached: AssistantTurnProjectionCache,
  streamingRun: RunRecord,
): Pick<AssistantTurnProjectionCache, "items" | "itemKeys" | "turnIndexesByRequestId"> {
  const { items } = cached;
  const existingIndex = cached.turnIndexesByRequestId.get(streamingRun.requestId) ?? -1;
  if (existingIndex < 0) {
    const appended = {
      __assistantTurn: true as const,
      key: `assistant-turn:${streamingRun.requestId}:0`,
      requestId: streamingRun.requestId,
      createdAt: streamingRun.startedAt,
      messages: [],
      run: streamingRun,
      streaming: true,
    };
    const turnIndexesByRequestId = new Map(cached.turnIndexesByRequestId);
    turnIndexesByRequestId.set(streamingRun.requestId, items.length);
    return { items: [...items, appended], itemKeys: [...cached.itemKeys, appended.key], turnIndexesByRequestId };
  }
  const existing = items[existingIndex] as AssistantTurnListItem;
  if (existing.run === streamingRun && existing.streaming) {
    return { items, itemKeys: cached.itemKeys, turnIndexesByRequestId: cached.turnIndexesByRequestId };
  }
  const projected = [...items];
  projected[existingIndex] = { ...existing, run: streamingRun, streaming: true };
  return { items: projected, itemKeys: cached.itemKeys, turnIndexesByRequestId: cached.turnIndexesByRequestId };
}

function rememberAssistantTurnProjection(
  cache: WeakMap<readonly ChatMessage[], AssistantTurnProjectionCache>,
  messages: readonly ChatMessage[],
  items: ProjectedMessageListItem[],
  runsSource: readonly RunRecord[],
  runsByRequestId: Map<string, RunRecord>,
  streamingRequestId?: string,
): void {
  const itemKeys = readProjectedMessageListItemKeys(items);
  const turnIndexesByRequestId = new Map<string, number>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (isAssistantTurnListItem(item) && item.requestId) turnIndexesByRequestId.set(item.requestId, index);
  }
  cache.set(messages, { items, itemKeys, turnIndexesByRequestId, runsByRequestId, runsSource, streamingRequestId });
}

function selectAssistantTurnProjectionCache(
  scope: AssistantTurnProjectionScope | undefined,
): WeakMap<readonly ChatMessage[], AssistantTurnProjectionCache> {
  return scope === "event" ? eventAssistantTurnProjectionCache : assistantTurnProjectionCache;
}

function readProjectedMessageListItemKey(item: ProjectedMessageListItem, index: number): string {
  return isAssistantTurnListItem(item) ? item.key : item.id || `__placeholder__:${index}`;
}

function hasTerminalRunEvidence(run: RunRecord): boolean {
  return (
    run.steps.length > 0 ||
    (run.activities?.length ?? 0) > 0 ||
    (run.thinkingBlocks?.length ?? 0) > 0 ||
    !!run.visibleText ||
    !!run.displayText
  );
}

function projectTerminalRunSlice(run: RunRecord): AssistantTurnListItem {
  return {
    __assistantTurn: true,
    key: `assistant-turn:${run.requestId}:0`,
    requestId: run.requestId,
    createdAt: run.startedAt,
    messages: [],
    run,
    streaming: false,
  };
}

function findLatestTurn(
  items: readonly ProjectedMessageListItem[],
  requestId: string,
): AssistantTurnListItem | undefined {
  const index = findLatestTurnIndex(items, requestId);
  return index >= 0 ? (items[index] as AssistantTurnListItem) : undefined;
}

function findLatestTurnIndex(items: readonly ProjectedMessageListItem[], requestId: string): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isAssistantTurnListItem(item) && item.requestId === requestId) return index;
  }
  return -1;
}

export function readAssistantTurnActionMessage(turn: AssistantTurnListItem): ChatMessage | undefined {
  return [...turn.messages].reverse().find((message) => message.kind !== "AssistantToolPreface");
}

export function readAssistantTurnAnchorId(message: Pick<ChatMessage, "id">): string {
  return `conversation-event:${message.id}`;
}
