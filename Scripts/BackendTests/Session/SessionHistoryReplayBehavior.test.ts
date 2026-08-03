import { describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentDomainEvent,
  type AgentEventEnvelope,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentRunEventHistoryReplayChunkSize } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionEventFactory } from "../../../Source/AgentSystem/Session/AgentSessionEventFactory.js";
import { AgentSessionHistoryReplay } from "../../../Source/AgentSystem/Session/AgentSessionHistoryReplay.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import type { AgentHistoryStepRun } from "../../../Source/AgentSystem/Session/AgentSessionEventTypes.js";

describe("Session history replay behavior", () => {
  test("emits not-found without starting replay for an unknown session", async () => {
    const fixture = createReplayFixture();
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId: "missing-session",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionNotFound,
        data: expect.objectContaining({ operation: "session.history" }),
      }),
    ]);
  });

  test("streams entries and run events in bounded chunks with ordered lifecycle events", async () => {
    const fixture = createReplayFixture();
    const sessionId = "chunked-session";
    fixture.store.open(sessionId);
    const entries = Array.from({ length: 51 }, (_, index) => userEntry(`request-${index}`, `message-${index}`, index));
    fixture.store.persistEntries(sessionId, entries);
    Array.from({ length: AgentRunEventHistoryReplayChunkSize + 1 }, (_, index) =>
      runEvent(sessionId, `request-${index}`, index),
    ).forEach((event) => fixture.store.persistRunEvent(sessionId, event));
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      refresh: true,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.SessionHistoryStarted,
      AgentEventKinds.SessionHistoryChunk,
      AgentEventKinds.SessionHistoryChunk,
      AgentEventKinds.SessionRunHistoryChunk,
      AgentEventKinds.SessionRunHistoryChunk,
      AgentEventKinds.SessionHistoryCompleted,
    ]);
    const entryChunks = events.filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    expect(entryChunks.map((event) => readArrayLength(event.data, "entries"))).toEqual([50, 1]);
    const runChunks = events.filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk);
    expect(runChunks.map((event) => readArrayLength(event.data, "events"))).toEqual([
      AgentRunEventHistoryReplayChunkSize,
      1,
    ]);
    expect(events.at(0)?.data).toEqual(
      expect.objectContaining({
        totalEntries: 51,
        messageCount: 51,
        refresh: true,
      }),
    );
  });

  test("uses repository pages without calling the legacy full-history readers", async () => {
    const repository = new PageOnlyHistoryRepository();
    const fixture = createReplayFixture({
      repository,
      entryPageSize: 2,
      stepRunPageSize: 2,
      runEventPageSize: 2,
    });
    const sessionId = "page-only-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(
      sessionId,
      Array.from({ length: 5 }, (_, index) => userEntry(`request-${index}`, `message-${index}`, index)),
    );
    for (let index = 0; index < 5; index += 1) {
      fixture.store.persistTurnArtifacts(sessionId, `request-${index}`, [], [stepTrace(index)]);
      fixture.store.persistRunSnapshot(snapshot(sessionId, `request-${index}`, "completed", index));
    }
    Array.from({ length: 5 }, (_, index) => runEvent(sessionId, `request-${index}`, index)).forEach((event) =>
      fixture.store.persistRunEvent(sessionId, event),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk)
        .map((event) => readArrayLength(event.data, "entries")),
    ).toEqual([2, 2, 1]);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk)
        .map((event) => readArrayLength(event.data, "events")),
    ).toEqual([2, 2, 1]);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionHistorySteps)
        .map((event) => readArrayLength(event.data, "runs")),
    ).toEqual([2, 2, 1]);
  });

  test("replays a fixed high-water snapshot when new history arrives after replay starts", async () => {
    const fixture = createReplayFixture({ entryPageSize: 1, runEventPageSize: 1 });
    const sessionId = "fixed-history-snapshot";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [userEntry("request-before", "before", 1)]);
    fixture.store.persistRunEvent(sessionId, runEvent(sessionId, "request-before", 1));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-before", "completed", 1));
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
        if (event.kind !== AgentEventKinds.SessionHistoryStarted) return;
        fixture.store.persistEntries(sessionId, [userEntry("request-after", "after", 2)]);
        fixture.store.persistRunEvent(sessionId, runEvent(sessionId, "request-after", 2));
        fixture.store.persistRunSnapshot(snapshot(sessionId, "request-after", "completed", 2));
      },
    });

    expect(replayedEntryRequestIds(events)).toEqual(["request-before"]);
    expect(replayedStepRequestIds(events)).toEqual(["request-before"]);
    expect(replayedRunEventRequestIds(events)).toEqual(["request-before"]);
  });

  test("keeps run-snapshot values fixed when a run settles after replay starts", async () => {
    const fixture = createReplayFixture({ stepRunPageSize: 1 });
    const sessionId = "fixed-run-snapshot-value";
    const requestId = "request-settling";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "running", 1));
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
        if (event.kind !== AgentEventKinds.SessionHistoryStarted) return;
        fixture.store.persistRunSnapshot({
          ...snapshot(sessionId, requestId, "failed", 1),
          errorMessage: "Settled after replay started.",
        });
      },
    });

    expect(replayedStepRuns(events)).toEqual([expect.objectContaining({ requestId, status: "running" })]);
    expect(fixture.store.loadRunSnapshots(sessionId)).toEqual([
      expect.objectContaining({ requestId, status: "failed" }),
    ]);
  });

  test("merges persisted traces and lifecycle snapshots into stable history runs", async () => {
    const fixture = createReplayFixture();
    const sessionId = "run-session";
    fixture.store.open(sessionId);
    const entries = [
      userEntry("request-complete", "Complete request", 1),
      assistantEntry("request-complete", "Complete answer", 2),
      userEntry("request-missing-data", "Missing trace request", 3),
      userEntry("request-running", "Running request", 4),
      userEntry("request-failed", "Failed request", 5),
    ];
    fixture.store.persistEntries(sessionId, entries);
    fixture.store.persistTurnArtifacts(
      sessionId,
      "request-complete",
      [],
      [
        {
          step: 1,
          seq: 0,
          kind: "answer",
          status: "done",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    );
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-complete", "completed", 1));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-missing-data", "completed", 3));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-running", "running", 4));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-failed", "failed", 5));

    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });
    const runs = replayedStepRuns(events);

    expect(
      runs.map((run) => ({
        requestId: run.requestId,
        status: run.status,
        traces: run.traces.length,
      })),
    ).toEqual([
      { requestId: "request-complete", status: "completed", traces: 1 },
      { requestId: "request-missing-data", status: "failed", traces: 1 },
      { requestId: "request-running", status: "running", traces: 0 },
      { requestId: "request-failed", status: "failed", traces: 1 },
    ]);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        input: "Complete request",
        endedAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    expect(runs[1]?.traces[0]).toEqual(
      expect.objectContaining({
        kind: "answer",
        status: "failed",
        title: "回复数据丢失",
        errorMessage: expect.stringContaining("重新发送请求"),
      }),
    );
  });

  test("projects assistant decision entries as visible final answers", async () => {
    const fixture = createReplayFixture();
    const sessionId = "assistant-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [assistantEntry("request-answer", "Visible answer", 1)]);
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunk = events.find((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    const entries = readRecord(chunk?.data)?.entries;
    expect(entries).toEqual([
      expect.objectContaining({
        visible: { kind: "final_answer", text: "Visible answer" },
      }),
    ]);
  });

  test("extracts the user-visible answer from persisted final-answer XML", async () => {
    const fixture = createReplayFixture();
    const sessionId = "assistant-xml-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [
      assistantEntry("request-xml", "<FinalAnswer><answer>XML answer</answer></FinalAnswer>", 1),
    ]);
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunk = events.find((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    expect(readRecord(chunk?.data)?.entries).toEqual([
      expect.objectContaining({ visible: { kind: "final_answer", text: "XML answer" } }),
    ]);
  });

  test("keeps a failed snapshot failed even when partial traces were persisted", async () => {
    const fixture = createReplayFixture();
    const sessionId = "failed-with-trace";
    const requestId = "request-failed-with-trace";
    fixture.store.open(sessionId);
    const entries = [userEntry(requestId, "Run the task", 1)];
    fixture.store.persistEntries(sessionId, entries);
    fixture.store.persistTurnArtifacts(
      sessionId,
      requestId,
      [],
      [
        {
          step: 1,
          seq: 0,
          kind: "tool",
          status: "done",
          startedAt: timestamp(1),
          endedAt: timestamp(2),
        },
      ],
    );
    fixture.store.persistRunSnapshot({
      ...snapshot(sessionId, requestId, "failed", 1),
      errorMessage: "The next step failed.",
    });

    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(replayedStepRuns(events)).toEqual([
      expect.objectContaining({ requestId, status: "failed", traces: expect.any(Array) }),
    ]);
  });

  test("recovers unresolved approvals and interaction input for terminal runs", async () => {
    const fixture = createReplayFixture();
    const sessionId = "interrupted-waits-session";
    const requestId = "request-interrupted";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [userEntry(requestId, "Run an approved command", 1)]);
    fixture.store.persistRunSnapshot({
      ...snapshot(sessionId, requestId, "failed", 1),
      errorMessage: "Run interrupted by server restart.",
    });
    fixture.store.persistRunEvent(sessionId, runEvent(sessionId, requestId, 1));
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 2, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-interrupted",
        status: "pending",
      }),
    );
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 3, AgentEventKinds.InteractionInputRequested, {
        interactionId: "interaction-interrupted",
        status: "pending",
      }),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunks = events.filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk);
    const replayed = chunks.flatMap((event) => {
      const value = readRecord(event.data)?.events;
      return Array.isArray(value) ? value : [];
    }) as AgentEventEnvelope[];
    expect(replayed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.ApprovalResolved,
          data: expect.objectContaining({
            approvalId: "approval-interrupted",
            status: "cancelled",
            disposition: "interrupt",
          }),
        }),
        expect.objectContaining({
          kind: AgentEventKinds.InteractionInputResolved,
          data: expect.objectContaining({
            interactionId: "interaction-interrupted",
            status: "resolved",
            action: "cancel",
          }),
        }),
      ]),
    );
  });

  test("does not synthesize a wait resolution when the persisted resolution is on a later page", async () => {
    const fixture = createReplayFixture({ runEventPageSize: 1 });
    const sessionId = "resolved-wait-pages";
    const requestId = "request-resolved-wait";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "failed", 1));
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 1, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-resolved",
        status: "pending",
      }),
    );
    fixture.store.persistRunEvent(sessionId, {
      ...waitEvent(sessionId, requestId, 2, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-resolved",
        status: "approved",
      }),
      kind: AgentEventKinds.ApprovalResolved,
    });
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(replayedRunEvents(events).filter((event) => event.kind === AgentEventKinds.ApprovalResolved)).toEqual([
      expect.not.objectContaining({ detailId: expect.stringContaining("history_recovered") }),
    ]);
  });
});

function createReplayFixture(
  options: {
    repository?: InMemorySessionRepository;
    entryPageSize?: number;
    stepRunPageSize?: number;
    runEventPageSize?: number;
  } = {},
) {
  const store = new AgentSessionStore({ repository: options.repository ?? new InMemorySessionRepository() });
  const replay = new AgentSessionHistoryReplay({
    store,
    eventFactory: new AgentSessionEventFactory(),
    paging: {
      entryPageSize: options.entryPageSize,
      stepRunPageSize: options.stepRunPageSize,
      runEventPageSize: options.runEventPageSize,
    },
  });
  return { replay, store };
}

class PageOnlyHistoryRepository extends InMemorySessionRepository {
  override loadEntries(): AgentConversationEntry[] {
    throw new Error("Full conversation loading is forbidden during paged history replay.");
  }

  override loadRunEvents(): AgentEventEnvelope[] {
    throw new Error("Full run-event loading is forbidden during paged history replay.");
  }

  override loadStepTraces(_sessionId: string): never {
    throw new Error("Full step-trace loading is forbidden during paged history replay.");
  }

  override loadRunSnapshots(_sessionId: string): never {
    throw new Error("Full run-snapshot loading is forbidden during paged history replay.");
  }

  override loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    assertBoundedLookup(requestIds, 2);
    return super.loadEntriesForRequests(sessionId, requestIds, throughSequence);
  }

  override loadRunSnapshotsForRequests(sessionId: string, requestIds: readonly string[], throughSequence: number) {
    assertBoundedLookup(requestIds, 2);
    return super.loadRunSnapshotsForRequests(sessionId, requestIds, throughSequence);
  }

  override loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number) {
    assertBoundedLookup(requestIds, 2);
    return super.loadStepTraceRequestIds(sessionId, requestIds, throughRowId);
  }
}

function assertBoundedLookup(requestIds: readonly string[], maximum: number): void {
  if (requestIds.length > maximum) throw new Error(`Request lookup exceeded page bound: ${requestIds.length}`);
}

function userEntry(
  requestId: string,
  content: string,
  offset: number,
): Extract<AgentConversationEntry, { kind: "user.message" }> {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: timestamp(offset),
    kind: AgentConversationEntryKinds.UserMessage,
    content,
  };
}

function assistantEntry(
  requestId: string,
  content: string,
  offset: number,
): Extract<AgentConversationEntry, { kind: "assistant.decision" }> {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: timestamp(offset),
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: content,
  };
}

function snapshot(sessionId: string, requestId: string, status: "running" | "completed" | "failed", offset: number) {
  return {
    sessionId,
    requestId,
    input: requestId,
    status,
    startedAt: timestamp(offset),
    updatedAt: timestamp(offset + 1),
    endedAt: status === "running" ? undefined : timestamp(offset + 1),
  };
}

function runEvent(sessionId: string, requestId: string, sequence: number): AgentEventEnvelope {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    sequence,
    timestamp: timestamp(sequence),
    sessionId,
    requestId,
    data: { input: requestId },
  };
}

function stepTrace(offset: number) {
  return {
    step: offset + 1,
    seq: 0,
    kind: "tool" as const,
    status: "done" as const,
    startedAt: timestamp(offset),
    endedAt: timestamp(offset + 1),
  };
}

function waitEvent(
  sessionId: string,
  requestId: string,
  sequence: number,
  kind: typeof AgentEventKinds.ApprovalRequested | typeof AgentEventKinds.InteractionInputRequested,
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Approval,
    sequence,
    timestamp: timestamp(sequence),
    sessionId,
    requestId,
    step: 1,
    data,
  };
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

function readArrayLength(value: unknown, key: string): number {
  const candidate = readRecord(value)?.[key];
  return Array.isArray(candidate) ? candidate.length : 0;
}

function replayedEntryRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk)
    .flatMap((event) => {
      const entries = readRecord(event.data)?.entries;
      return Array.isArray(entries)
        ? entries.flatMap((item) => {
            const entry = readRecord(readRecord(item)?.entry);
            return typeof entry?.requestId === "string" ? [entry.requestId] : [];
          })
        : [];
    });
}

function replayedRunEvents(events: readonly AgentDomainEvent[]): AgentEventEnvelope[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk)
    .flatMap((event) => {
      const items = readRecord(event.data)?.events;
      return Array.isArray(items) ? (items as AgentEventEnvelope[]) : [];
    });
}

function replayedStepRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return replayedStepRuns(events).map((run) => run.requestId);
}

function replayedStepRuns(events: readonly AgentDomainEvent[]): AgentHistoryStepRun[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionHistorySteps)
    .flatMap((event) => {
      const runs = readRecord(event.data)?.runs;
      return Array.isArray(runs) ? (runs as AgentHistoryStepRun[]) : [];
    });
}

function replayedRunEventRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return replayedRunEvents(events).flatMap((event) => (event.requestId ? [event.requestId] : []));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
