import { describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../../../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
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

  test("merges persisted traces and lifecycle snapshots into stable history runs", () => {
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

    const runs = fixture.replay.buildStepRuns(sessionId, entries);

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

  test("keeps a failed snapshot failed even when partial traces were persisted", () => {
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

    expect(fixture.replay.buildStepRuns(sessionId, entries)).toEqual([
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
});

function createReplayFixture() {
  const store = new AgentSessionStore({ repository: new InMemorySessionRepository() });
  const replay = new AgentSessionHistoryReplay({
    store,
    conversationPolicy: new AgentConversationPolicy(),
    eventFactory: new AgentSessionEventFactory(),
  });
  return { replay, store };
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
