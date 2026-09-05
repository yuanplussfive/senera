import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity learning jobs", () => {
  test("persists facts before an independently retryable rule pass", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/staged";
    try {
      insertEpisode(kernel, episodeUri);

      store.enqueueLearning(episodeUri, 1_000);
      expect(store.claimLearningJob(episodeUri, "facts", 999)).toBeUndefined();
      expect(store.listDueLearningJobs(1_000, 10)).toEqual([
        expect.objectContaining({ episodeUri, stage: "facts", status: "pending", attempts: 0 }),
      ]);
      const factJob = store.claimLearningJob(episodeUri, "facts", 1_000)!;
      expect(factJob).toEqual(expect.objectContaining({ stage: "facts", status: "running", attempts: 1 }));

      expect(
        store.completeFactLearning(
          learningClaim(factJob),
          { observations: [], facts: ["用户偏好先给结论。"], relations: [], needsRulePass: true },
          1_001,
        ),
      ).toBe("committed");
      expect(store.listDueLearningJobs(1_001, 10)).toEqual([
        expect.objectContaining({
          episodeUri,
          stage: "rules",
          status: "pending",
          facts: ["用户偏好先给结论。"],
          needsRulePass: true,
        }),
      ]);

      const ruleJob = store.claimLearningJob(episodeUri, "rules", 1_001)!;
      store.failLearningJob(learningClaim(ruleJob), {
        terminal: false,
        nextAttemptAtMs: 2_000,
        lastError: "rule model unavailable",
        nowMs: 1_001,
      });
      expect(store.listDueLearningJobs(1_999, 10)).toEqual([]);
      expect(store.listDueLearningJobs(2_000, 10)).toEqual([
        expect.objectContaining({ stage: "rules", status: "retry", attempts: ruleJob.attempts }),
      ]);

      const retriedRuleJob = store.claimLearningJob(episodeUri, "rules", 2_000)!;
      expect(retriedRuleJob).toEqual(
        expect.objectContaining({ stage: "rules", attempts: 2, facts: ["用户偏好先给结论。"] }),
      );
      expect(store.completeRuleLearning(learningClaim(retriedRuleJob), { signals: [], rules: [] }, 2_001)).toBe(
        "committed",
      );
      expect(store.listDueLearningJobs(Number.MAX_SAFE_INTEGER, 10)).toEqual([]);
      expect(
        kernel.connection
          .prepare("SELECT fact_status, fact_attempts, rule_status, rule_attempts FROM continuity_learning_jobs")
          .get(),
      ).toEqual({ fact_status: "completed", fact_attempts: 1, rule_status: "completed", rule_attempts: 2 });
    } finally {
      kernel.close();
    }
  });

  test("recovers an interrupted stage without discarding completed facts", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-recovery");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/interrupted";
    try {
      insertEpisode(kernel, episodeUri);
      store.enqueueLearning(episodeUri, 1_000);
      store.claimLearningJob(episodeUri, "facts", 1_000);

      expect(store.recoverInterruptedLearningJobs(1_100)).toBe(1);
      expect(store.listDueLearningJobs(1_100, 10)).toEqual([
        expect.objectContaining({ stage: "facts", status: "retry", attempts: 1 }),
      ]);

      const retriedFactJob = store.claimLearningJob(episodeUri, "facts", 1_100)!;
      store.completeFactLearning(
        learningClaim(retriedFactJob),
        { observations: [], facts: ["用户计划下周六运动。"], relations: [], needsRulePass: true },
        1_101,
      );
      store.claimLearningJob(episodeUri, "rules", 1_101);

      expect(store.recoverInterruptedLearningJobs(1_200)).toBe(1);
      expect(store.listDueLearningJobs(1_200, 10)).toEqual([
        expect.objectContaining({
          stage: "rules",
          status: "retry",
          attempts: 1,
          facts: ["用户计划下周六运动。"],
        }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("keeps a claimed stage stable when the same episode is enqueued again", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-idempotent");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/idempotent";
    try {
      insertEpisode(kernel, episodeUri);
      store.enqueueLearning(episodeUri, 1_000);
      expect(store.claimLearningJob(episodeUri, "facts", 1_000)).toEqual(
        expect.objectContaining({ status: "running", attempts: 1 }),
      );

      store.enqueueLearning(episodeUri, 2_000);

      expect(store.listDueLearningJobs(2_000, 10)).toEqual([]);
      expect(
        kernel.connection.prepare("SELECT fact_status, fact_attempts FROM continuity_learning_jobs").get(),
      ).toEqual({ fact_status: "running", fact_attempts: 1 });
    } finally {
      kernel.close();
    }
  });

  test("orders jobs by the due time of the stage that can actually run", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-order");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const laterEpisode = "senera://memory-episode/later-active-stage";
    const earlierEpisode = "senera://memory-episode/earlier-active-stage";
    try {
      insertEpisode(kernel, laterEpisode);
      insertEpisode(kernel, earlierEpisode);
      store.enqueueLearning(laterEpisode, 1_000);
      const laterClaim = store.claimLearningJob(laterEpisode, "facts", 1_000)!;
      store.failLearningJob(learningClaim(laterClaim), {
        terminal: false,
        nextAttemptAtMs: 3_000,
        lastError: "retry later",
        nowMs: 1_001,
      });
      store.enqueueLearning(earlierEpisode, 2_000);

      expect(store.listDueLearningJobs(3_000, 1)).toEqual([
        expect.objectContaining({ episodeUri: earlierEpisode, nextAttemptAtMs: 2_000 }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("releases pending deferred fact jobs at a compaction boundary", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-flush");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/deferred";
    try {
      insertEpisode(kernel, episodeUri);
      store.enqueueLearning(episodeUri, 5_000);

      expect(store.releasePendingLearningJobs(2_000)).toBe(1);
      expect(store.listDueLearningJobs(1_999, 10)).toEqual([]);
      expect(store.listDueLearningJobs(2_000, 10)).toEqual([
        expect.objectContaining({ episodeUri, stage: "facts", nextAttemptAtMs: 2_000 }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("debounces only unclaimed deferred facts in the active session", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-idle");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const sameSessionDeferred = "senera://memory-episode/same-session-deferred";
    const sameSessionImmediate = "senera://memory-episode/same-session-immediate";
    const otherSession = "senera://memory-episode/other-session";
    try {
      insertEpisode(kernel, sameSessionDeferred, "session-shared");
      insertEpisode(kernel, sameSessionImmediate, "session-shared");
      insertEpisode(kernel, otherSession, "session-other");
      store.enqueueLearning(sameSessionDeferred, 2_000);
      store.enqueueLearning(sameSessionImmediate, 1_000);
      store.enqueueLearning(otherSession, 2_000);

      expect(store.deferPendingFactJobsForSession("session-shared", 1_000, 5_000)).toBe(1);
      expect(store.listDueLearningJobs(1_999, 10)).toEqual([
        expect.objectContaining({ episodeUri: sameSessionImmediate, nextAttemptAtMs: 1_000 }),
      ]);
      expect(store.listDueLearningJobs(4_999, 10)).toEqual([
        expect.objectContaining({ episodeUri: sameSessionImmediate, nextAttemptAtMs: 1_000 }),
        expect.objectContaining({ episodeUri: otherSession, nextAttemptAtMs: 2_000 }),
      ]);
      expect(store.listDueLearningJobs(5_000, 10)).toEqual([
        expect.objectContaining({ episodeUri: sameSessionImmediate, nextAttemptAtMs: 1_000 }),
        expect.objectContaining({ episodeUri: otherSession, nextAttemptAtMs: 2_000 }),
        expect.objectContaining({ episodeUri: sameSessionDeferred, nextAttemptAtMs: 5_000 }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("treats a deleted episode as a superseded claim instead of throwing", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-deleted");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/deleted-while-running";
    try {
      insertEpisode(kernel, episodeUri);
      store.enqueueLearning(episodeUri, 1_000);
      const job = store.claimLearningJob(episodeUri, "facts", 1_000)!;

      kernel.connection.prepare("DELETE FROM memory_episodes WHERE uri = ?").run(episodeUri);

      expect(
        store.completeFactLearning(
          learningClaim(job),
          { observations: [], facts: [], relations: [], needsRulePass: false },
          1_001,
        ),
      ).toBe("superseded");
      expect(
        store.failLearningJob(learningClaim(job), {
          terminal: false,
          nextAttemptAtMs: 2_000,
          lastError: "request cancelled",
          nowMs: 1_001,
        }),
      ).toBe("superseded");
    } finally {
      kernel.close();
    }
  });

  test("prevents a recovered worker from committing through an older attempt", () => {
    const workspace = createTemporaryDirectory("senera-continuity-job-claim-version");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const episodeUri = "senera://memory-episode/claim-version";
    try {
      insertEpisode(kernel, episodeUri);
      store.enqueueLearning(episodeUri, 1_000);
      const stale = store.claimLearningJob(episodeUri, "facts", 1_000)!;
      store.recoverInterruptedLearningJobs(1_100);
      const current = store.claimLearningJob(episodeUri, "facts", 1_100)!;

      expect(
        store.completeFactLearning(
          learningClaim(stale),
          { observations: [], facts: ["stale"], relations: [], needsRulePass: false },
          1_101,
        ),
      ).toBe("superseded");
      expect(
        store.completeFactLearning(
          learningClaim(current),
          { observations: [], facts: ["current"], relations: [], needsRulePass: false },
          1_102,
        ),
      ).toBe("committed");
    } finally {
      kernel.close();
    }
  });
});

function learningClaim(job: NonNullable<ReturnType<AgentContinuitySqliteStore["claimLearningJob"]>>) {
  return { episodeUri: job.episodeUri, stage: job.stage, attempt: job.attempts };
}

function insertEpisode(kernel: AgentSqliteDatabaseKernel, uri: string, sessionId?: string): void {
  const suffix = uri.slice(uri.lastIndexOf("/") + 1);
  kernel.connection
    .prepare(
      `INSERT INTO memory_episodes (
        id, uri, session_id, request_id, status, raw_user_text, standalone_request,
        context_mode, context_basis, topic, summary, started_at, completed_at, updated_at,
        started_at_ms, completed_at_ms, updated_at_ms, time_zone, local_date, local_hour, metadata_json
      ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `episode-${suffix}`,
      uri,
      sessionId ?? `session-${suffix}`,
      `request-${suffix}`,
      "Remember this.",
      "Remember this.",
      "current",
      "current turn",
      "memory",
      "Remember this.",
      "2026-08-23T01:00:00.000Z",
      "2026-08-23T01:00:01.000Z",
      "2026-08-23T01:00:01.000Z",
      1_000,
      1_001,
      1_001,
      "Asia/Shanghai",
      "2026-08-23",
      "09",
      "{}",
    );
}
