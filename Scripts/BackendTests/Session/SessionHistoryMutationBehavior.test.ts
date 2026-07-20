import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentPiSessionLifecycleStates } from "../../../Source/AgentSystem/Pi/AgentPiSessionLifecycleMetadata.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
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
