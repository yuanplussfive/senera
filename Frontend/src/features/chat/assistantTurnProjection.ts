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

export function isAssistantTurnListItem(item: ProjectedMessageListItem | undefined): item is AssistantTurnListItem {
  return !!item && "__assistantTurn" in item;
}

export function projectAssistantTurns(
  messages: readonly ChatMessage[],
  runs: readonly RunRecord[],
  streamingRun?: RunRecord,
): ProjectedMessageListItem[] {
  const runsByRequestId = new Map(runs.map((run) => [run.requestId, run]));
  const requestOccurrences = new Map<string, number>();
  const assistantRequestIds = new Set(
    messages
      .filter((message) => message.role === "assistant" && message.requestId)
      .map((message) => message.requestId!),
  );
  const orphanCancelledRuns = runs
    .filter((run) => run.status === "cancelled")
    .filter((run) => !assistantRequestIds.has(run.requestId))
    .filter(hasCancelledRunEvidence)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const orphanRunsByRequestId = new Map(orphanCancelledRuns.map((run) => [run.requestId, run]));
  const renderedRequestIds = new Set<string>();
  const items: ProjectedMessageListItem[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      items.push(message);
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

  for (const run of orphanCancelledRuns) {
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

  return items;
}

function hasCancelledRunEvidence(run: RunRecord): boolean {
  return run.steps.length > 0 || (run.activities?.length ?? 0) > 0 || !!run.visibleText || !!run.displayText;
}

function projectTerminalRunSlice(run: RunRecord): AssistantTurnListItem {
  return {
    __assistantTurn: true,
    key: `assistant-run-slice:${run.requestId}`,
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
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isAssistantTurnListItem(item) && item.requestId === requestId) return item;
  }
  return undefined;
}

export function readAssistantTurnActionMessage(turn: AssistantTurnListItem): ChatMessage | undefined {
  return [...turn.messages].reverse().find((message) => message.kind !== "AssistantToolPreface");
}

export function readAssistantTurnAnchorId(message: Pick<ChatMessage, "id">): string {
  return `conversation-event:${message.id}`;
}
