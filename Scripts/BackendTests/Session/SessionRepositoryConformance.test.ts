import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AgentConversationEntry } from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentEventEnvelope,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { createAgentTurnPreparationSnapshot } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import {
  AgentSessionCommandConflictError,
  AgentSessionCommandStates,
  type AgentSessionCommandDescriptor,
} from "../../../Source/AgentSystem/Session/AgentSessionCommand.js";
import {
  AgentSessionHistoryMutationKinds,
  AgentSessionPiMutationKinds,
} from "../../../Source/AgentSystem/Session/AgentSessionHistoryMutation.js";
import type {
  AgentSessionRepository,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
} from "../../../Source/AgentSystem/Session/AgentSessionRepository.js";
import {
  InMemorySessionRepository,
  SqliteSessionRepository,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { createTemporaryDirectory, removeDirectory, toolRootCommand } from "../Support/AgentTestFixtures.js";

interface RepositoryFixture {
  readonly repository: AgentSessionRepository;
  close(): void;
}

interface RepositoryAdapter {
  readonly name: string;
  create(): RepositoryFixture;
}

const RepositoryAdapters: readonly RepositoryAdapter[] = [
  {
    name: "memory",
    create: () => {
      const repository = new InMemorySessionRepository();
      return { repository, close: () => repository.close() };
    },
  },
  {
    name: "sqlite",
    create: () => {
      const directory = createTemporaryDirectory("senera-session-conformance");
      const repository = new SqliteSessionRepository(path.join(directory, "session.db"));
      return {
        repository,
        close: () => {
          repository.close();
          removeDirectory(directory);
        },
      };
    },
  },
];

for (const adapter of RepositoryAdapters) {
  describe(`Session repository conformance (${adapter.name})`, () => {
    let fixture: RepositoryFixture;

    beforeEach(() => {
      fixture = adapter.create();
    });

    afterEach(() => {
      fixture.close();
    });

    test("preserves session ordering, scoped entry identity, message counts, and atomic appends", () => {
      const repository = fixture.repository;
      repository.upsertSession(session("session-a", 1));
      repository.upsertSession(session("session-b", 2));
      repository.appendEntries("session-a", [
        { sequence: 0, entry: userEntry("request-a", "A", "first") },
        { sequence: 1, entry: userEntry("request-a", "A again", "second") },
        { sequence: 2, entry: assistantEntry("request-a", "Done") },
      ]);
      repository.appendEntry("session-b", userEntry("request-b", "B", "first"), 0);

      expect(repository.listSessions()).toEqual([
        expect.objectContaining({ id: "session-b", entryCount: 1, messageCount: 1, conversation: [] }),
        expect.objectContaining({ id: "session-a", entryCount: 3, messageCount: 2, conversation: [] }),
      ]);
      expect(repository.loadEntries("session-a").map((entry) => entry.id)).toEqual([
        "request-a:user:first",
        "request-a:user:second",
        "request-a:assistant",
      ]);
      expect(repository.loadFirstUserMessage("session-a")).toEqual(
        expect.objectContaining({ kind: "user.message", content: "A" }),
      );

      expect(() =>
        repository.appendEntries("session-a", [
          { sequence: 3, entry: userEntry("request-a", "duplicate", "first") },
          { sequence: 4, entry: userEntry("request-c", "must roll back") },
        ]),
      ).toThrow();
      expect(repository.loadEntries("session-a")).toHaveLength(3);

      expect(() => repository.appendEntry("session-a", userEntry("request-c", "wrong sequence"), 2)).toThrow();
      expect(repository.loadEntries("session-a")).toHaveLength(3);
    });

    test("loads only the first user message for catalog title projection", () => {
      const repository = fixture.repository;
      const sessionId = "session-first-user";
      repository.upsertSession(session(sessionId));
      repository.appendEntries(sessionId, [
        { sequence: 0, entry: assistantEntry("request-system", "Prelude") },
        { sequence: 1, entry: userEntry("request-first", "First user message") },
        { sequence: 2, entry: userEntry("request-second", "Second user message") },
      ]);

      expect(repository.loadFirstUserMessage(sessionId)).toEqual(
        expect.objectContaining({ requestId: "request-first", content: "First user message" }),
      );
      expect(repository.loadFirstUserMessage("missing-session")).toBeUndefined();
    });

    test("keeps entry, trace, event, and snapshot pages bounded by captured high-water marks", () => {
      const repository = fixture.repository;
      const sessionId = "session-pages";
      repository.upsertSession(session(sessionId));
      repository.appendEntries(
        sessionId,
        Array.from({ length: 5 }, (_, sequence) => ({
          sequence,
          entry: userEntry(`request-${sequence}`, `message-${sequence}`),
        })),
      );
      for (let sequence = 0; sequence < 5; sequence += 1) {
        const requestId = `request-${sequence}`;
        repository.persistTurnArtifacts(
          sessionId,
          [],
          [{ requestId, turnSequence: sequence, trace: stepTrace(sequence) }],
        );
        repository.appendRunEvent(sessionId, runEvent(sessionId, requestId, sequence + 1));
        repository.upsertRunSnapshot(runSnapshot(sessionId, requestId, "running", sequence));
      }
      const captured = repository.captureHistorySnapshot(sessionId);
      expect(captured).toEqual(
        expect.objectContaining({
          entryCount: 5,
          entryHighWaterMark: 4,
          stepTraceHighWaterMark: 5,
          runSnapshotHighWaterMark: 5,
          runEventHighWaterMark: 5,
        }),
      );

      repository.appendEntry(sessionId, userEntry("request-late", "late"), 5);
      repository.persistTurnArtifacts(
        sessionId,
        [],
        [{ requestId: "request-late", turnSequence: 5, trace: stepTrace(5) }],
      );
      repository.appendRunEvent(sessionId, runEvent(sessionId, "request-late", 6));
      repository.upsertRunSnapshot(runSnapshot(sessionId, "request-late", "running", 5));
      repository.upsertRunSnapshot(runSnapshot(sessionId, "request-4", "failed", 4));

      expect(readEntryRequestPages(repository, sessionId, captured!.entryHighWaterMark!, 2)).toEqual([
        ["request-0", "request-1"],
        ["request-2", "request-3"],
        ["request-4"],
      ]);
      expect(readTraceRequestPages(repository, sessionId, captured!.stepTraceHighWaterMark!, 2)).toEqual([
        ["request-0", "request-1"],
        ["request-2", "request-3"],
        ["request-4"],
      ]);
      expect(readEventRequestPages(repository, sessionId, captured!.runEventHighWaterMark!, 2)).toEqual([
        ["request-0", "request-1"],
        ["request-2", "request-3"],
        ["request-4"],
      ]);
      expect(readSnapshotRequestPages(repository, sessionId, captured!.runSnapshotHighWaterMark!, 2)).toEqual([
        ["request-0", "request-1"],
        ["request-2", "request-3"],
        ["request-4"],
      ]);
      expect(
        repository
          .loadEntriesForRequests(sessionId, ["request-3", "request-1", "request-3", "request-late"], 4)
          .map((entry) => entry.requestId),
      ).toEqual(["request-1", "request-3"]);
      expect(
        repository
          .loadRunSnapshotsForRequests(sessionId, ["request-4"], captured!.runSnapshotHighWaterMark!)
          .map((snapshot) => snapshot.status),
      ).toEqual(["running"]);
    });

    test("retains run snapshot revisions and deletion tombstones for bounded replay", () => {
      const repository = fixture.repository;
      const sessionId = "session-revisions";
      repository.upsertSession(session(sessionId));
      repository.appendEntries(sessionId, [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
      ]);
      repository.upsertRunSnapshot(runSnapshot(sessionId, "request-a", "completed", 0));
      repository.upsertRunSnapshot(runSnapshot(sessionId, "request-b", "running", 1));
      const beforeUpdate = repository.captureHistorySnapshot(sessionId)!.runSnapshotHighWaterMark!;

      repository.upsertRunSnapshot(runSnapshot(sessionId, "request-b", "failed", 2));
      const beforeDelete = repository.captureHistorySnapshot(sessionId)!.runSnapshotHighWaterMark!;
      repository.truncateFromRequest(sessionId, "request-b");
      const afterDelete = repository.captureHistorySnapshot(sessionId)!.runSnapshotHighWaterMark!;

      expect(repository.loadRunSnapshotsForRequests(sessionId, ["request-b"], beforeUpdate)).toEqual([
        expect.objectContaining({ requestId: "request-b", status: "running" }),
      ]);
      expect(repository.loadRunSnapshotsForRequests(sessionId, ["request-b"], beforeDelete)).toEqual([
        expect.objectContaining({ requestId: "request-b", status: "failed" }),
      ]);
      expect(repository.loadRunSnapshotsForRequests(sessionId, ["request-b"], afterDelete)).toEqual([]);
      expect(repository.loadRunSnapshots(sessionId).map((snapshot) => snapshot.requestId)).toEqual(["request-a"]);
    });

    test("deduplicates durable history and truncates every request-scoped projection", () => {
      const repository = fixture.repository;
      const sessionId = "session-truncate";
      repository.upsertSession(session(sessionId));
      repository.appendEntries(sessionId, [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
        { sequence: 2, entry: userEntry("request-c", "C") },
      ]);
      for (let sequence = 0; sequence < 3; sequence += 1) {
        const requestId = `request-${String.fromCharCode(97 + sequence)}`;
        const trace = { requestId, turnSequence: sequence, trace: stepTrace(sequence) };
        repository.persistTurnArtifacts(sessionId, [], [trace, trace]);
        const event = runEvent(sessionId, requestId, sequence + 1);
        repository.appendRunEvents(sessionId, [event, event]);
        repository.upsertRunSnapshot(runSnapshot(sessionId, requestId, "completed", sequence));
        repository.upsertTurnPreparation(sessionId, requestId, turnPreparation(requestId));
      }

      expect(repository.loadStepTraces(sessionId)).toHaveLength(3);
      expect(repository.loadRunEvents(sessionId)).toHaveLength(3);
      expect(repository.truncateFromRequest(sessionId, "request-b")).toBe(2);
      expect(repository.loadEntries(sessionId).map((entry) => entry.requestId)).toEqual(["request-a"]);
      expect(repository.loadStepTraces(sessionId).map((item) => item.requestId)).toEqual(["request-a"]);
      expect(repository.loadRunEvents(sessionId).map((event) => event.requestId)).toEqual(["request-a"]);
      expect(repository.loadRunSnapshots(sessionId).map((snapshot) => snapshot.requestId)).toEqual(["request-a"]);
      expect(repository.loadTurnPreparation(sessionId, "request-a")).toBeDefined();
      expect(repository.loadTurnPreparation(sessionId, "request-b")).toBeUndefined();
      expect(repository.loadTurnPreparation(sessionId, "request-c")).toBeUndefined();
    });

    test("admits commands exactly once, rejects identity reuse, and commits terminal state", () => {
      const repository = fixture.repository;
      const sessionId = "session-command";
      const requestId = "request-command";
      repository.upsertSession(session(sessionId));
      const command = sessionCommand(requestId);
      const startCommit = turnCommit({
        sessionId,
        requestId,
        entries: [{ sequence: 0, entry: userEntry(requestId, "Start") }],
        snapshot: runSnapshot(sessionId, requestId, "running", 0),
        events: [runEvent(sessionId, requestId, 1)],
      });

      expect(repository.beginRun(command, startCommit)).toEqual(
        expect.objectContaining({ kind: "accepted", command: expect.objectContaining({ state: "running" }) }),
      );
      expect(repository.beginRun(command, startCommit)).toEqual(
        expect.objectContaining({ kind: "replayed", command: expect.objectContaining({ state: "running" }) }),
      );
      expect(repository.loadEntries(sessionId)).toHaveLength(1);
      expect(() => repository.beginRun({ ...command, payloadHash: "different" }, startCommit)).toThrow(
        AgentSessionCommandConflictError,
      );

      repository.persistTurnCommit({
        ...turnCommit({
          sessionId,
          requestId,
          entries: [{ sequence: 1, entry: assistantEntry(requestId, "Done") }],
          snapshot: runSnapshot(sessionId, requestId, "completed", 1),
          events: [],
        }),
        commandId: command.commandId,
      });
      expect(repository.loadCommand(sessionId, command.commandId)).toEqual(
        expect.objectContaining({ state: AgentSessionCommandStates.Completed }),
      );
      expect(repository.truncateFromRequest(sessionId, requestId)).toBe(2);
      expect(repository.loadCommand(sessionId, command.commandId)).toBeUndefined();
    });

    test("journals and commits history mutations with stable identity", () => {
      const repository = fixture.repository;
      const sessionId = "session-mutation";
      repository.upsertSession(session(sessionId));
      repository.appendEntries(sessionId, [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
      ]);
      const mutation = {
        mutationId: "mutation-a",
        kind: AgentSessionHistoryMutationKinds.Truncate,
        sessionId,
        fromRequestId: "request-b",
        pi: { kind: AgentSessionPiMutationKinds.None },
        createdAt: timestamp(10),
      } as const;

      repository.stageHistoryMutation(mutation);
      expect(repository.loadPendingHistoryMutation(sessionId)).toEqual(mutation);
      expect(repository.listPendingHistoryMutations()).toEqual([mutation]);
      expect(() => repository.stageHistoryMutation({ ...mutation, mutationId: "mutation-b" })).toThrow();
      expect(() => repository.commitHistoryMutation("wrong-mutation", session(sessionId, 20))).toThrow();
      expect(repository.loadPendingHistoryMutation(sessionId)).toEqual(mutation);

      expect(repository.commitHistoryMutation(mutation.mutationId, session(sessionId, 20))).toBe(1);
      expect(repository.loadPendingHistoryMutation(sessionId)).toBeUndefined();
      expect(repository.loadEntries(sessionId).map((entry) => entry.requestId)).toEqual(["request-a"]);
    });
  });
}

function session(id: string, updatedOffset = 0) {
  return {
    id,
    status: "idle" as const,
    createdAt: timestamp(0),
    updatedAt: timestamp(updatedOffset),
    conversation: [],
    metadata: { title: id },
  };
}

function userEntry(
  requestId: string,
  content: string,
  identity = "user",
): Extract<AgentConversationEntry, { kind: "user.message" }> {
  return {
    id: `${requestId}:user:${identity}`,
    requestId,
    timestamp: timestamp(0),
    kind: "user.message",
    content,
  };
}

function assistantEntry(
  requestId: string,
  xml: string,
): Extract<AgentConversationEntry, { kind: "assistant.decision" }> {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: timestamp(1),
    kind: "assistant.decision",
    xml,
  };
}

function runEvent(sessionId: string, requestId: string, sequence: number): AgentEventEnvelope {
  return {
    eventId: `${sessionId}:${requestId}:event:${sequence}`,
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    sessionId,
    requestId,
    sequence,
    timestamp: timestamp(sequence),
    data: { input: requestId },
  };
}

function runSnapshot(
  sessionId: string,
  requestId: string,
  status: StoredRunSnapshot["status"],
  offset: number,
): StoredRunSnapshot {
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

function stepTrace(offset: number) {
  return { step: 1, seq: 0, kind: "tool", status: "done", output: `trace-${offset}` } as const;
}

function turnPreparation(input: string) {
  const rootCommand = toolRootCommand();
  return createAgentTurnPreparationSnapshot({
    runtimeFingerprint: "runtime-conformance",
    userInput: input,
    loadedToolNames: [],
    toolAccessGrant: rootCommand.toolAccessGrant,
    rootCommand,
    activeSkills: [],
  });
}

function sessionCommand(requestId: string): AgentSessionCommandDescriptor {
  return {
    commandId: requestId,
    operationKind: "session.message",
    payloadHash: `payload:${requestId}`,
    requestId,
    createdAt: timestamp(0),
  };
}

function turnCommit(input: {
  readonly sessionId: string;
  readonly requestId: string;
  readonly entries: AgentSessionTurnCommit["entries"];
  readonly snapshot: StoredRunSnapshot;
  readonly events: readonly AgentEventEnvelope[];
}): AgentSessionTurnCommit {
  return {
    sessionId: input.sessionId,
    requestId: input.requestId,
    entries: input.entries,
    traces: [],
    snapshot: input.snapshot,
    runEvents: input.events,
  };
}

function readEntryRequestPages(
  repository: AgentSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let after: number | undefined;
  do {
    const page = repository.loadEntryPage(sessionId, { after, through, pageSize });
    pages.push(page.items.map((entry) => entry.requestId));
    after = page.nextCursor;
  } while (after !== undefined);
  return pages;
}

function readTraceRequestPages(
  repository: AgentSessionRepository,
  sessionId: string,
  throughRowId: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let after: Parameters<AgentSessionRepository["loadStepTracePage"]>[1]["after"];
  do {
    const page = repository.loadStepTracePage(sessionId, { after, throughRowId, pageSize });
    pages.push(page.items.map((item) => item.requestId));
    after = page.nextCursor;
  } while (after !== undefined);
  return pages;
}

function readEventRequestPages(
  repository: AgentSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let after: number | undefined;
  do {
    const page = repository.loadRunEventPage(sessionId, { after, through, pageSize });
    pages.push(page.items.flatMap((event) => (event.requestId ? [event.requestId] : [])));
    after = page.nextCursor;
  } while (after !== undefined);
  return pages;
}

function readSnapshotRequestPages(
  repository: AgentSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let after: number | undefined;
  do {
    const page = repository.loadRunSnapshotPage(sessionId, { after, through, pageSize });
    pages.push(page.items.map((snapshot) => snapshot.requestId));
    after = page.nextCursor;
  } while (after !== undefined);
  return pages;
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}
