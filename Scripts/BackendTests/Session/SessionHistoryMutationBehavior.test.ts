import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentPiSessionLifecycleStates } from "../../../Source/AgentSystem/Pi/AgentPiSessionLifecycleMetadata.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentSessionArtifactLifecycle } from "../../../Source/AgentSystem/Session/AgentSessionArtifactLifecycle.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { assistantEntry, createManagerFixture, turnPreparation, userEntry } from "./SessionManagerTestFixtures.js";

describe("Session history mutation behavior", () => {
  test("keeps SQLite history intact when Pi alignment fails before regeneration", async () => {
    const rewindError = new Error("Pi rewind unavailable");
    const fixture = createManagerFixture({
      piSessionMutations: {
        rewind: vi.fn(async () => {
          throw rewindError;
        }),
        reset: vi.fn(async () => true),
      },
    });
    await seedRegenerationSession(fixture, "session-regenerate-failure", "boundary-b");

    await expect(
      fixture.manager.regenerateFromRequest({
        sessionId: "session-regenerate-failure",
        fromRequestId: "request-b",
        requestId: "request-replacement",
        input: "B",
      }),
    ).rejects.toBe(rewindError);

    expect(fixture.store.loadConversation("session-regenerate-failure").map((entry) => entry.requestId)).toEqual([
      "request-a",
      "request-a",
      "request-b",
      "request-b",
    ]);
    expect(fixture.repository.listPendingHistoryMutations()).toEqual([
      expect.objectContaining({
        sessionId: "session-regenerate-failure",
        fromRequestId: "request-b",
        pi: expect.objectContaining({ kind: "rewind", entryId: "boundary-b" }),
      }),
    ]);
  });

  test("falls back to a Pi reset before committing regeneration when the branch boundary is missing", async () => {
    const rewind = vi.fn(async () => false);
    const reset = vi.fn(async () => false);
    const fixture = createManagerFixture({ piSessionMutations: { rewind, reset } });
    await seedRegenerationSession(fixture, "session-regenerate-reset", "missing-boundary");

    await fixture.manager.regenerateFromRequest({
      sessionId: "session-regenerate-reset",
      fromRequestId: "request-b",
      requestId: "request-replacement",
      input: "B",
    });

    expect(rewind).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(fixture.repository.listPendingHistoryMutations()).toEqual([]);
    expect(fixture.store.get("session-regenerate-reset")).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          metadata: expect.objectContaining({
            piSession: expect.objectContaining({ state: AgentPiSessionLifecycleStates.Absent }),
          }),
        }),
      }),
    );
  });

  test("recovers a durable history mutation journal before accepting requests after restart", async () => {
    const directory = createTemporaryDirectory("senera-history-mutation-recovery");
    const databasePath = path.join(directory, "session.db");
    let repository = new SqliteSessionRepository(databasePath);
    try {
      const failing = createManagerFixture({
        repository,
        piSessionMutations: {
          rewind: vi.fn(async () => {
            throw new Error("simulated process interruption");
          }),
          reset: vi.fn(async () => false),
        },
      });
      await seedRegenerationSession(failing, "session-journal-recovery", "boundary-b");
      await expect(
        failing.manager.regenerateFromRequest({
          sessionId: "session-journal-recovery",
          fromRequestId: "request-b",
          requestId: "request-replacement",
          input: "B",
        }),
      ).rejects.toThrow("simulated process interruption");
      repository.close();

      repository = new SqliteSessionRepository(databasePath);
      const rewind = vi.fn(async () => true);
      const recovered = createManagerFixture({
        repository,
        piSessionMutations: { rewind, reset: vi.fn(async () => false) },
      });
      await recovered.manager.ready();

      expect(rewind).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-journal-recovery", entryId: "boundary-b" }),
      );
      expect(recovered.store.loadConversation("session-journal-recovery").map((entry) => entry.requestId)).toEqual([
        "request-a",
        "request-a",
      ]);
      expect(repository.listPendingHistoryMutations()).toEqual([]);
    } finally {
      repository.close();
      removeDirectory(directory);
    }
  });

  test("rejects a missing boundary before invoking Pi, memory, or artifact side effects", async () => {
    const rewind = vi.fn(async () => true);
    const reset = vi.fn(async () => true);
    const memory = new AgentMemoryService({ sourceRepository: new InMemoryAgentMemorySourceRepository() });
    const deleteMemory = vi.spyOn(memory, "deleteFromSessionRequest");
    const artifacts = artifactLifecycle();
    const fixture = createManagerFixture({
      memoryService: memory,
      piSessionMutations: { rewind, reset },
      artifactSessionCleanup: artifacts,
    });
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "session-missing-boundary" });
    fixture.store.persistEntries("session-missing-boundary", [userEntry("request-a", "A")]);

    await fixture.manager.truncateFromRequest({
      sessionId: "session-missing-boundary",
      requestId: "request-missing",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(rewind).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(deleteMemory).not.toHaveBeenCalled();
    expect(artifacts.removeSessionArtifactsFromRequests).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-missing-boundary")).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.RequestInvalid,
        data: expect.objectContaining({ code: "session_history_boundary_missing" }),
      }),
    ]);
  });

  test("replays owned cleanup when SQLite commit fails after external side effects", async () => {
    const directory = createTemporaryDirectory("senera-history-cleanup-recovery");
    const databasePath = path.join(directory, "session.db");
    let repository = new SqliteSessionRepository(databasePath);
    const memory = new AgentMemoryService({ sourceRepository: new InMemoryAgentMemorySourceRepository() });
    const deleteMemory = vi.spyOn(memory, "deleteFromSessionRequest");
    const artifacts = artifactLifecycle();
    try {
      const failing = createManagerFixture({ repository, memoryService: memory, artifactSessionCleanup: artifacts });
      await failing.manager.createSession({ sessionId: "session-cleanup-recovery" });
      failing.store.persistEntries("session-cleanup-recovery", [
        userEntry("request-a", "A"),
        assistantEntry("request-a", "Answer A"),
        userEntry("request-b", "B"),
      ]);
      vi.spyOn(repository, "commitHistoryMutation").mockImplementationOnce(() => {
        throw new Error("simulated SQLite commit failure");
      });

      await expect(
        failing.manager.truncateFromRequest({
          sessionId: "session-cleanup-recovery",
          requestId: "request-b",
        }),
      ).rejects.toThrow("simulated SQLite commit failure");
      expect(repository.listPendingHistoryMutations()).toHaveLength(1);
      expect(repository.loadEntries("session-cleanup-recovery")).toHaveLength(3);
      repository.close();

      repository = new SqliteSessionRepository(databasePath);
      const recovered = createManagerFixture({ repository, memoryService: memory, artifactSessionCleanup: artifacts });
      await recovered.manager.ready();

      expect(deleteMemory).toHaveBeenCalledTimes(2);
      expect(artifacts.removeSessionArtifactsFromRequests).toHaveBeenCalledTimes(2);
      expect(recovered.store.loadConversation("session-cleanup-recovery").map((entry) => entry.requestId)).toEqual([
        "request-a",
        "request-a",
      ]);
      expect(repository.listPendingHistoryMutations()).toEqual([]);
    } finally {
      repository.close();
      removeDirectory(directory);
    }
  });
});

async function seedRegenerationSession(
  fixture: ReturnType<typeof createManagerFixture>,
  sessionId: string,
  piBranchBoundaryId: string,
): Promise<void> {
  await fixture.manager.createSession({ sessionId });
  fixture.store.persistEntries(sessionId, [
    userEntry("request-a", "A"),
    assistantEntry("request-a", "Answer A"),
    userEntry("request-b", "B"),
    assistantEntry("request-b", "Answer B"),
  ]);
  fixture.store.persistTurnPreparation(sessionId, "request-b", {
    ...turnPreparation("B"),
    piBranchBoundaryId,
  });
}

function artifactLifecycle(): AgentSessionArtifactLifecycle {
  return {
    retainForkArtifacts: vi.fn(async () => undefined),
    removeSessionArtifacts: vi.fn(async () => undefined),
    removeSessionArtifactsFromRequests: vi.fn(async () => undefined),
  };
}
