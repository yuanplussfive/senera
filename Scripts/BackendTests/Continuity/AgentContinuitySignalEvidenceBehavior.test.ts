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

describe("continuity signal evidence", () => {
  test("does not let weaker evidence replace an explicit signal", () => {
    const fixture = createStore();
    try {
      fixture.store.upsertSignal(
        signal(fixture.scope, true, "user_explicit", "source-user", "2026-08-25T01:00:00.000Z"),
      );
      fixture.store.upsertSignal(
        signal(fixture.scope, false, "model_inferred", "source-model", "2026-08-25T02:00:00.000Z"),
      );

      expect(fixture.store.listSignals([fixture.scope])).toEqual([
        expect.objectContaining({ value: true, authority: "user_explicit", sourceRefs: ["source-user"] }),
      ]);
    } finally {
      fixture.close();
    }
  });

  test("rebuilds the previous head after its newer evidence is deleted", () => {
    const fixture = createStore();
    try {
      fixture.store.upsertSignal(
        signal(fixture.scope, false, "user_explicit", "source-old", "2026-08-25T01:00:00.000Z"),
      );
      fixture.store.upsertSignal(
        signal(fixture.scope, true, "user_explicit", "source-new", "2026-08-25T02:00:00.000Z"),
      );

      fixture.store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-new"] });

      expect(fixture.store.listSignals([fixture.scope])).toEqual([
        expect.objectContaining({ value: false, sourceRefs: ["source-old"] }),
      ]);
    } finally {
      fixture.close();
    }
  });

  test("groups multiple physical sources from one episode as one evidence unit", () => {
    const fixture = createStore();
    try {
      insertEpisodeSources(fixture.kernel, "episode-1", ["source-a", "source-b"]);
      fixture.store.upsertSignal(
        signal(fixture.scope, true, "system_observed", "source-a", "2026-08-25T01:00:00.000Z"),
      );
      fixture.store.upsertSignal(
        signal(fixture.scope, true, "system_observed", "source-b", "2026-08-25T01:01:00.000Z"),
      );

      const evidenceCount = fixture.kernel.connection
        .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM continuity_signal_evidence")
        .get()?.count;
      expect(evidenceCount).toBe(1);
      expect(fixture.store.listSignals([fixture.scope])[0].sourceRefs).toEqual(["source-a", "source-b"]);
    } finally {
      fixture.close();
    }
  });
});

function signal(
  scope: { kind: "workspace"; id: string },
  value: boolean,
  authority: "user_explicit" | "system_observed" | "model_inferred",
  sourceRef: string,
  observedAt: string,
) {
  return {
    scope,
    namespace: "activity",
    key: "exercise.completed",
    value,
    valueType: "boolean" as const,
    authority,
    confidence: authority === "model_inferred" ? 0.8 : 1,
    observedAt,
    sourceRefs: [sourceRef],
  };
}

function createStore() {
  const workspace = createTemporaryDirectory("senera-signal-evidence");
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel);
  return {
    kernel,
    store,
    scope: { kind: "workspace" as const, id: workspace },
    close: () => kernel.close(),
  };
}

function insertEpisodeSources(
  kernel: AgentSqliteDatabaseKernel,
  episodeId: string,
  sourceIds: readonly string[],
): void {
  const episodeUri = `senera://memory-episode/${episodeId}`;
  const timestamp = "2026-08-25T01:00:00.000Z";
  kernel.connection
    .prepare(
      `INSERT INTO memory_episodes (
         id, uri, session_id, request_id, status, raw_user_text, standalone_request,
         context_mode, context_basis, topic, summary, started_at, completed_at, updated_at,
         started_at_ms, completed_at_ms, updated_at_ms, time_zone, local_date, local_hour, metadata_json
       ) VALUES (?, ?, 'session-1', 'request-1', 'completed', '', '', '', '', '', '', ?, ?, ?, ?, ?, ?,
         'Asia/Shanghai', '2026-08-25', '09', '{}')`,
    )
    .run(
      episodeId,
      episodeUri,
      timestamp,
      timestamp,
      timestamp,
      Date.parse(timestamp),
      Date.parse(timestamp),
      Date.parse(timestamp),
    );
  const insertSource = kernel.connection.prepare(
    `INSERT INTO memory_sources (
       id, uri, episode_id, episode_uri, session_id, request_id, source_kind, role, text_content,
       summary, conversation_entry_id, evidence_uri, artifact_uri, tool_name, created_at, updated_at,
       created_at_ms, updated_at_ms, time_zone, local_date, local_hour, metadata_json
     ) VALUES (?, ?, ?, ?, 'session-1', 'request-1', 'user_message', 'user', '', '', '', '', '', '', ?, ?, ?, ?,
       'Asia/Shanghai', '2026-08-25', '09', '{}')`,
  );
  for (const sourceId of sourceIds) {
    insertSource.run(
      sourceId,
      sourceId,
      episodeId,
      episodeUri,
      timestamp,
      timestamp,
      Date.parse(timestamp),
      Date.parse(timestamp),
    );
  }
}
