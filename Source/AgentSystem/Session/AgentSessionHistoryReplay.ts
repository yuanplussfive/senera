import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentRunEventHistoryReplayChunkSize } from "../Events/AgentRunEventHistoryPolicy.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { StoredRunSnapshot } from "./AgentSqliteSessionRepository.js";
import type { AgentHistoryStepRun } from "./AgentSessionEventTypes.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionStore } from "./AgentSessionStore.js";

const SessionHistoryEntryChunkSize = 50;

export interface AgentSessionHistoryReplayOptions {
  store: AgentSessionStore;
  conversationPolicy: AgentConversationPolicy;
  eventFactory: AgentSessionEventFactory;
}

export class AgentSessionHistoryReplay {
  constructor(private readonly options: AgentSessionHistoryReplayOptions) {}

  async replay(request: {
    sessionId: string;
    refresh?: boolean;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const entries = await this.loadHistoryEntries(request);
    if (!entries) {
      return;
    }

    await this.emitHistoryStarted(request, entries);
    await this.emitEntryChunks(request, entries);
    await this.emitStepRuns(request, entries);
    await this.emitRunEventChunks(request);
    await this.emitHistoryCompleted(request);
  }

  buildStepRuns(
    sessionId: string,
    entries: readonly AgentConversationEntry[],
  ): AgentHistoryStepRun[] {
    const entryIndex = new AgentSessionHistoryEntryIndex(entries);
    const runsByRequest = new Map<string, AgentHistoryStepRun>();

    for (const run of this.options.store.loadStepTraces(sessionId)) {
      const userEntry = entryIndex.userMessage(run.requestId);
      const assistantEntry = entryIndex.assistantDecision(run.requestId);
      runsByRequest.set(run.requestId, {
        requestId: run.requestId,
        input: userEntry?.content ?? "",
        startedAt: userEntry?.timestamp ?? run.traces[0]?.startedAt ?? "",
        endedAt: assistantEntry?.timestamp,
        status: "completed",
        modelProvider: assistantEntry?.metadata?.run?.modelProvider ?? userEntry?.metadata?.run?.modelProvider,
        traces: run.traces,
      });
    }

    for (const snapshot of this.options.store.loadRunSnapshots(sessionId)) {
      this.mergeSnapshotRun(runsByRequest, snapshot);
    }

    return Array.from(runsByRequest.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  private async loadHistoryEntries(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<AgentConversationEntry[] | undefined> {
    const store = this.options.store;
    const lookup = store.get(request.sessionId);
    const entries = store.loadConversation(request.sessionId);
    const persisted = lookup.kind === "found" || entries.length > 0 || store.hasPersistedSession(request.sessionId);

    if (persisted) {
      return entries;
    }

    await emitAgentEvent(
      request.onEvent,
      this.options.eventFactory.notFound(request.sessionId, "session.history"),
    );
    return undefined;
  }

  private async emitHistoryStarted(
    request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink },
    entries: readonly AgentConversationEntry[],
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryStarted,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        totalEntries: entries.length,
        messageCount: this.options.conversationPolicy.materialize(entries).length,
        refresh: request.refresh || undefined,
      },
    });
  }

  private async emitEntryChunks(
    request: { sessionId: string; onEvent?: AgentEventSink },
    entries: readonly AgentConversationEntry[],
  ): Promise<void> {
    for (let index = 0; index < entries.length; index += SessionHistoryEntryChunkSize) {
      const chunk = entries.slice(index, index + SessionHistoryEntryChunkSize);
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionHistoryChunk,
        context: { sessionId: request.sessionId },
        data: {
          sessionId: request.sessionId,
          entries: chunk.map((entry) => ({
            entry,
            visible:
              entry.kind === AgentConversationEntryKinds.AssistantDecision
                ? projectAssistantHistoryVisible(entry.xml)
                : undefined,
          })),
        },
      });
    }
  }

  private async emitStepRuns(
    request: { sessionId: string; onEvent?: AgentEventSink },
    entries: readonly AgentConversationEntry[],
  ): Promise<void> {
    const runs = this.buildStepRuns(request.sessionId, entries);
    if (runs.length === 0) {
      return;
    }

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistorySteps,
      context: { sessionId: request.sessionId },
      data: { sessionId: request.sessionId, runs },
    });
  }

  private async emitRunEventChunks(
    request: { sessionId: string; onEvent?: AgentEventSink },
  ): Promise<void> {
    const runEvents = this.options.store.loadRunEvents(request.sessionId);
    for (let index = 0; index < runEvents.length; index += AgentRunEventHistoryReplayChunkSize) {
      const chunk = runEvents.slice(index, index + AgentRunEventHistoryReplayChunkSize);
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionRunHistoryChunk,
        context: { sessionId: request.sessionId },
        data: {
          sessionId: request.sessionId,
          events: chunk,
        },
      });
    }
  }

  private async emitHistoryCompleted(
    request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink },
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryCompleted,
      context: { sessionId: request.sessionId },
      data: { sessionId: request.sessionId, refresh: request.refresh || undefined },
    });
  }

  private mergeSnapshotRun(
    runsByRequest: Map<string, AgentHistoryStepRun>,
    snapshot: StoredRunSnapshot,
  ): void {
    const existing = runsByRequest.get(snapshot.requestId);
    if (existing) {
      existing.input ||= snapshot.input;
      existing.startedAt ||= snapshot.startedAt;
      existing.modelProvider ??= snapshot.modelProvider;

      if (existing.traces.length > 0) {
        existing.status = "completed";
        existing.endedAt ??= snapshot.endedAt ?? snapshot.updatedAt;
        return;
      }

      existing.endedAt = snapshot.endedAt ?? existing.endedAt;
      existing.status = snapshot.status === "completed" ? "failed" : snapshot.status;
      if (snapshot.status === "completed") {
        existing.endedAt = snapshot.endedAt ?? snapshot.updatedAt;
        existing.traces = [createMissingRunDataTrace(snapshot)];
      }
      return;
    }

    const status = snapshot.status === "completed" ? "failed" : snapshot.status;
    runsByRequest.set(snapshot.requestId, {
      requestId: snapshot.requestId,
      input: snapshot.input,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? (status === "failed" ? snapshot.updatedAt : undefined),
      status,
      modelProvider: snapshot.modelProvider,
      traces: status === "running" ? [] : [createMissingRunDataTrace(snapshot)],
    });
  }
}

function projectAssistantHistoryVisible(text: string): { kind: "final_answer"; text: string } {
  return {
    kind: "final_answer",
    text,
  };
}

class AgentSessionHistoryEntryIndex {
  private readonly users = new Map<string, Extract<AgentConversationEntry, { kind: "user.message" }>>();
  private readonly assistants = new Map<string, Extract<AgentConversationEntry, { kind: "assistant.decision" }>>();

  constructor(entries: readonly AgentConversationEntry[]) {
    for (const entry of entries) {
      this.index(entry);
    }
  }

  userMessage(requestId: string): Extract<AgentConversationEntry, { kind: "user.message" }> | undefined {
    return this.users.get(requestId);
  }

  assistantDecision(requestId: string): Extract<AgentConversationEntry, { kind: "assistant.decision" }> | undefined {
    return this.assistants.get(requestId);
  }

  private index(entry: AgentConversationEntry): void {
    if (entry.kind === AgentConversationEntryKinds.UserMessage && !this.users.has(entry.requestId)) {
      this.users.set(entry.requestId, entry);
      return;
    }

    if (entry.kind === AgentConversationEntryKinds.AssistantDecision) {
      this.assistants.set(entry.requestId, entry);
    }
  }
}

function createMissingRunDataTrace(snapshot: StoredRunSnapshot): StepTrace {
  return {
    step: 0,
    seq: 0,
    kind: "answer",
    status: "failed",
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt ?? snapshot.updatedAt,
    title: "回复数据丢失",
    errorMessage: snapshot.errorMessage ?? "回复数据丢失，请重新发送请求。",
  };
}
