import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentMemoryProvenanceRecovery } from "../../../Source/AgentSystem/Continuity/AgentMemoryProvenanceRecovery.js";
import { AgentMemoryLearningLedger } from "../../../Source/AgentSystem/Continuity/AgentMemoryLearningLedger.js";
import { createAgentMemOSKnowledgeMetadata } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const directory = createTemporaryDirectory("senera-provenance-recovery");
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(directory, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  cleanup.push(() => {
    kernel.close();
    removeDirectory(directory);
  });
  const repository = new InMemoryAgentMemorySourceRepository();
  const ledger = new AgentMemoryLearningLedger(kernel);
  const add = (requestId: string) => {
    const timestamp = "2026-10-27T00:00:00Z";
    return repository.recordCompletedTurn({
      sessionId: "session",
      requestId,
      startedAt: timestamp,
      completedAt: timestamp,
      userEntry: {
        kind: "user.message",
        id: `${requestId}:user`,
        requestId,
        timestamp,
        content: "Keep replies concise",
      },
      assistantEntry: { kind: "assistant.decision", id: `${requestId}:assistant`, requestId, timestamp, xml: "" },
      terminal: { kind: "FinalAnswer", content: "done" },
      executedTools: [],
      modelProvider: {
        id: "test",
        providerId: "test",
        kind: "test",
        endpoint: "openai-chat",
        baseUrl: "http://localhost",
        model: "test-model",
      },
    });
  };
  return { kernel, repository, ledger, add };
}

describe("source-verified attribution migration", () => {
  test("recovers subject and task from exact retained provenance without inventing evidence", () => {
    const f = fixture();
    const original = f.add("first");
    const task = f.ledger.task({ sessionId: "session", requestId: "first", subject: { id: "owner", kind: "user" } });
    const metadata = createAgentMemOSKnowledgeMetadata({ ...original, operationKey: "original", type: "context" });
    const recover = createAgentMemoryProvenanceRecovery(f.repository, f.ledger);
    const recovered = recover({ type: "context", metadata });
    expect(recovered).toMatchObject({ senera_subject_id: "owner", senera_task_id: task.taskId });
    expect(recovered?.senera_source_uris).toEqual(metadata.senera_source_uris);
    expect(f.ledger.quality("knowledge")).toMatchObject({ weight: 50, helpfulCount: 0 });
    if (!recovered) throw new Error("Expected verified provenance recovery.");
    expect(recover({ type: "context", metadata: recovered })).toBeUndefined();
  });

  test("does not infer an owner from session identity, missing sender data or mixed subjects", () => {
    const f = fixture();
    const first = f.add("first");
    delete first.episode.metadata.memorySubject;
    const metadata = createAgentMemOSKnowledgeMetadata({ ...first, operationKey: "original", type: "preference" });
    expect(createAgentMemoryProvenanceRecovery(f.repository)({ type: "preference", metadata })).toBeUndefined();
    first.episode.metadata.memorySubject = { id: "owner", kind: "user" };
    const second = f.add("second");
    second.episode.metadata.memorySubject = { id: "channel-member", kind: "user" };
    const mixed = {
      ...metadata,
      senera_source_uris: [...metadata.senera_source_uris!, ...second.sources.map((s) => s.uri)],
      senera_source_request_ids: ["first", "second"],
    };
    expect(createAgentMemoryProvenanceRecovery(f.repository)({ type: "preference", metadata: mixed })).toBeUndefined();
    const sessionOnly = {
      ...metadata,
      senera_episode_uri: undefined,
      senera_source_uris: [],
      senera_source_request_ids: [],
    };
    expect(
      createAgentMemoryProvenanceRecovery(f.repository)({ type: "preference", metadata: sessionOnly }),
    ).toBeUndefined();
  });

  test("rejects missing sources and conflicting task bindings", () => {
    const f = fixture();
    const original = f.add("first");
    const metadata = createAgentMemOSKnowledgeMetadata({ ...original, operationKey: "original", type: "context" });
    f.ledger.task({ sessionId: "session", requestId: "first", subject: { id: "owner", kind: "user" } });
    const recover = createAgentMemoryProvenanceRecovery(f.repository, f.ledger);
    expect(
      recover({ type: "context", metadata: { ...metadata, senera_source_uris: ["missing-source"] } }),
    ).toBeUndefined();
    expect(
      recover({
        type: "context",
        metadata: { ...metadata, senera_source_session_ids: ["session", "unproven-session"] },
      }),
    ).toBeUndefined();
    expect(recover({ type: "context", metadata: { ...metadata, senera_task_id: "unproven-task" } })).toBeUndefined();
    original.episode.metadata.memorySubject = { id: "another-subject", kind: "user" };
    expect(recover({ type: "context", metadata })).toBeUndefined();
  });

  test("migrates retired evidence scores once, retains audit records and preserves new snapshots across restart", () => {
    const directory = createTemporaryDirectory("senera-memory-utility-migration");
    const databasePath = path.join(directory, "memory.sqlite");
    const original = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: { ...AgentMemoryDatabaseContract, migrations: AgentMemoryDatabaseContract.migrations.slice(0, 8) },
    });
    const store = new AgentContinuitySqliteStore(original);
    store.createMemorySnapshot("empty", { entries: [], diaryIndex: "" }, "2026-10-27T00:00:00Z");
    original.connection
      .prepare("INSERT INTO continuity_memory_boundaries(session_id,generation,boundary_key) VALUES('old',0,'initial')")
      .run();
    original.connection
      .prepare(
        "INSERT INTO continuity_memory_snapshot_versions(session_id,generation,entries_json,created_at) VALUES('old',0,?,'2026-10-26T00:00:00Z')",
      )
      .run(
        JSON.stringify([
          {
            id: "knowledge",
            revision: "v1",
            type: "fact",
            summary: "Verified fact",
            occurredAt: "2026-10-26T00:00:00Z",
          },
        ]),
      );
    original.connection.exec(`
      INSERT INTO memory_knowledge_scores(node_id,importance) VALUES('knowledge',80);
      INSERT INTO memory_knowledge_evidence VALUES('knowledge','wrong-contradiction',-1);
      INSERT INTO memory_knowledge_evidence_sources VALUES('knowledge','wrong-contradiction','source','session','request','irrelevant statement');
      INSERT INTO memory_task_requests VALUES('session','request','task','owner','user','2026-10-27T00:00:00Z');
      INSERT INTO memory_recall_receipts VALUES('session','request','task','knowledge','v1','Retained preference','snapshot',1);
      INSERT INTO memory_task_completions VALUES('session','request','2026-10-27T00:00:00Z');
      INSERT INTO memory_utility_settlements VALUES('session','request','task','knowledge',-1);
    `);
    original.close();
    const upgraded = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentMemoryDatabaseContract });
    cleanup.push(() => {
      upgraded.close();
      removeDirectory(directory);
    });
    expect(upgraded.recovery).toBeUndefined();
    expect(upgraded.connection.pragma("foreign_key_check")).toEqual([]);
    const restarted = new AgentContinuitySqliteStore(upgraded);
    expect(restarted.readMemorySnapshot("empty")).toBeUndefined();
    expect(restarted.snapshotGeneration("empty")).toBe(2);
    expect(restarted.readMemorySnapshot("old")).toBeUndefined();
    expect(restarted.snapshotGeneration("old")).toBe(2);
    const ledger = new AgentMemoryLearningLedger(upgraded);
    expect(ledger.quality("knowledge")).toMatchObject({
      weight: 50,
      recallCount: 1,
      unhelpfulCount: 0,
      pendingCount: 1,
    });
    expect(ledger.pendingScoreUpdates().map((update) => update.nodeId)).toContain("knowledge");
    expect(
      upgraded.connection.prepare("SELECT outcome,contract_version FROM memory_utility_settlements").get(),
    ).toEqual({ outcome: "unhelpful", contract_version: 1 });
    expect(
      upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'memory_knowledge_evidence%'").all(),
    ).toEqual([]);
    restarted.createMemorySnapshot("empty", { entries: [], diaryIndex: "" }, "2026-10-28T00:00:00Z");
    new AgentContinuitySqliteStore(upgraded);
    expect(restarted.readMemorySnapshot("empty")).toEqual({ entries: [], diaryIndex: "" });
    expect(restarted.snapshotGeneration("empty")).toBe(2);
    expect(restarted.snapshotGeneration("old")).toBe(2);
    expect(upgraded.connection.prepare("SELECT count(*) count FROM continuity_memory_snapshot_versions").get()).toEqual(
      { count: 1 },
    );
  });

  test("restores an empty subject-bound snapshot after closing and reopening the database", () => {
    const directory = createTemporaryDirectory("senera-empty-memory-restart");
    cleanup.push(() => removeDirectory(directory));
    const databasePath = path.join(directory, "memory.sqlite");
    const original = new AgentContinuitySqliteStore(databasePath);
    try {
      original.prepareSnapshotSubject("session", "member");
      original.createMemorySnapshot(
        "session",
        { entries: [], diaryIndex: "# Memory index\n\n- [Saved title](2026/10/26/diary.md) — 2026-10-26" },
        "2026-10-27T00:00:00Z",
      );
    } finally {
      original.close();
    }
    const restored = new AgentContinuitySqliteStore(databasePath);
    try {
      expect(restored.readMemorySnapshot("session", "member")).toEqual({
        entries: [],
        diaryIndex: "# Memory index\n\n- [Saved title](2026/10/26/diary.md) — 2026-10-26",
      });
      expect(restored.readMemorySnapshot("session", "another-member")).toBeUndefined();
      expect(restored.snapshotGeneration("session")).toBe(0);
      restored.clearMemorySnapshot("session", "compaction");
      expect(restored.readMemorySnapshot("session", "member")).toBeUndefined();
      expect(restored.snapshotGeneration("session")).toBe(1);
    } finally {
      restored.close();
    }
  });
});
