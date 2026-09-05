import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentResidentProfileService } from "../../../Source/AgentSystem/Profile/AgentResidentProfileService.js";
import { AgentResidentProfileSqliteStore } from "../../../Source/AgentSystem/Profile/AgentResidentProfileSqliteStore.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const directories = new Set<string>();

afterEach(() => {
  for (const directory of directories) removeDirectory(directory);
  directories.clear();
});

describe("resident profile ledger", () => {
  test("keeps one active version per profile key and merges repeated evidence", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    try {
      const scope = { kind: "user" as const, id: root };
      store.upsert({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/one"],
      });
      store.upsert({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/two"],
      });
      store.upsert({
        subject: "user",
        key: "居住地点",
        value: "北京",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/three"],
      });

      expect(store.listActive([scope])).toEqual([
        expect.objectContaining({ key: "居住地点", value: "北京", status: "active" }),
      ]);
      expect(store.listActive([scope])[0]?.sourceRefs).toEqual(["senera://memory-source/three"]);
    } finally {
      store.close();
    }
  });

  test("does not let weaker repeated evidence downgrade profile authority", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    try {
      const scope = { kind: "user" as const, id: root };
      store.upsert({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/explicit"],
      });

      const merged = store.upsert({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "model_inferred",
        confidence: 0.4,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/inferred"],
      });

      expect(merged).toMatchObject({ authority: "user_explicit", confidence: 1 });
      expect(store.listActive([scope])[0]).toMatchObject({ authority: "user_explicit", confidence: 1 });
      expect(store.listActive([scope])[0]?.sourceRefs).toEqual([
        "senera://memory-source/explicit",
        "senera://memory-source/inferred",
      ]);
    } finally {
      store.close();
    }
  });

  test("does not let a weaker conflicting value replace an effective profile", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    try {
      const scope = { kind: "user" as const, id: root };
      const explicit = store.upsert({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/explicit"],
      });

      const retained = store.upsert({
        subject: "user",
        key: "居住地点",
        value: "北京",
        scope,
        authority: "model_inferred",
        confidence: 0.6,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/inferred"],
      });

      expect(retained).toMatchObject({ id: explicit.id, value: "上海", authority: "user_explicit" });
      expect(store.listActive([scope])).toHaveLength(1);
      expect(store.listActive([scope])[0]).toMatchObject({ value: "上海", authority: "user_explicit" });
    } finally {
      store.close();
    }
  });

  test("deduplicates evidence when the same episode is learned again", () => {
    const root = createRoot();
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(root, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentResidentProfileSqliteStore(database);
    try {
      const draft = {
        subject: "user" as const,
        key: "居住地点",
        value: "上海",
        scope: { kind: "user" as const, id: root },
        authority: "user_explicit" as const,
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/same-episode"],
      };
      store.upsert(draft, "2026-08-24T01:00:00.000Z");
      store.upsert(draft, "2026-08-24T02:00:00.000Z");

      const active = store.listActive([draft.scope])[0];
      expect(active).toMatchObject({ supportCount: 1, sourceRefs: ["senera://memory-source/same-episode"] });
      expect(database.connection.prepare("SELECT COUNT(*) AS count FROM resident_profile_evidence").get()).toEqual({
        count: 1,
      });
    } finally {
      database.close();
    }
  });

  test("restores the previous profile version with a clean lineage after deletion", () => {
    const root = createRoot();
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(root, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentResidentProfileSqliteStore(database);
    try {
      const scope = { kind: "user" as const, id: root };
      const old = store.upsert(
        {
          subject: "user",
          key: "居住地点",
          value: "上海",
          scope,
          authority: "user_explicit",
          confidence: 1,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["senera://memory-source/old"],
        },
        "2026-08-24T01:00:00.000Z",
      );
      const newer = store.upsert(
        {
          subject: "user",
          key: "居住地点",
          value: "杭州",
          scope,
          authority: "user_explicit",
          confidence: 1,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["senera://memory-source/new"],
        },
        "2026-08-24T02:00:00.000Z",
      );

      store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["senera://memory-source/new"] });

      expect(store.listActive([scope])).toEqual([
        expect.objectContaining({ value: "上海", sourceRefs: ["senera://memory-source/old"], supersededBy: null }),
      ]);
      expect(
        database.connection
          .prepare("SELECT status, superseded_by FROM resident_profile_records WHERE id = ?")
          .get(old.id),
      ).toEqual({ status: "active", superseded_by: null });
      expect(
        database.connection
          .prepare("SELECT COUNT(*) AS count FROM resident_profile_records WHERE id = ?")
          .get(newer.id),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("rolls back the complete profile batch when one draft is invalid", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    try {
      expect(() =>
        store.upsertMany([
          {
            subject: "user",
            key: "语言",
            value: "中文",
            scope: { kind: "user", id: root },
            authority: "user_explicit",
            confidence: 1,
            temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
            sourceRefs: ["senera://memory-source/language"],
          },
          {
            subject: "user",
            key: "时区",
            value: "Asia/Shanghai",
            scope: { kind: "user", id: root },
            authority: "user_explicit",
            confidence: 1,
            temporal: { until: "not-a-lifetime", timeZone: "Asia/Shanghai" },
            sourceRefs: ["senera://memory-source/time-zone"],
          },
        ]),
      ).toThrow();
      expect(store.listActive([{ kind: "user", id: root }])).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("projects stable claims for a new session and excludes expired claims", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    const service = new AgentResidentProfileService({ store });
    try {
      const scope = { kind: "user" as const, id: root };
      service.record({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/residence"],
      });
      service.record({
        subject: "user",
        key: "临时饮食安排",
        value: "不喝咖啡",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "2026-08-22T00:00:00+08:00", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/temporary"],
      });

      expect(service.promptContext([scope], new Date("2026-08-23T00:00:00+08:00"))).toEqual([
        expect.objectContaining({ subject: "user", key: "居住地点", claim: "居住地点: 上海" }),
      ]);
    } finally {
      store.close();
    }
  });

  test("regroups legacy flat evidence into per-episode rows and re-scores support", () => {
    const root = createRoot();
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(root, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentResidentProfileSqliteStore(database);
    try {
      insertEpisodeSources(database, "episode-1", ["source-a"]);
      insertEpisodeSources(database, "episode-2", ["source-b"]);
      const scope = { kind: "user" as const, id: root };
      const record = store.upsert(
        {
          subject: "user",
          key: "居住地点",
          value: "上海",
          scope,
          authority: "user_explicit",
          confidence: 1,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["source-a", "source-b"],
        },
        "2026-08-24T01:00:00.000Z",
      );
      expect(record).toMatchObject({ supportCount: 2, maturity: "active" });

      // Emulate the migration 0025 placeholder state: one flat legacy evidence
      // row and the support_count column default.
      database.connection.prepare("DELETE FROM resident_profile_evidence WHERE profile_id = ?").run(record.id);
      database.connection
        .prepare(
          `INSERT INTO resident_profile_evidence (
             profile_id, evidence_key, source_refs_json, authority, confidence, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          `legacy_${record.id}`,
          JSON.stringify(["source-a", "source-b"]),
          "user_explicit",
          1,
          "2026-08-24T01:00:00.000Z",
        );
      database.connection.prepare("UPDATE resident_profile_records SET support_count = 1 WHERE id = ?").run(record.id);

      const result = store.reconcileLegacyLedger();
      expect(result).toEqual({ regrouped: 1, rescored: 1 });
      expect(
        database.connection
          .prepare<[string], { count: number }>(
            "SELECT COUNT(*) AS count FROM resident_profile_evidence WHERE profile_id = ?",
          )
          .get(record.id),
      ).toEqual({ count: 2 });
      const active = store.listActive([scope])[0];
      expect(active).toMatchObject({ supportCount: 2, maturity: "active" });
      expect([...(active?.sourceRefs ?? [])].sort()).toEqual(["source-a", "source-b"]);

      expect(store.reconcileLegacyLedger()).toEqual({ regrouped: 0, rescored: 0 });
    } finally {
      database.close();
    }
  });

  test("collapses legacy evidence from a single episode into one evidence unit", () => {
    const root = createRoot();
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(root, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentResidentProfileSqliteStore(database);
    try {
      insertEpisodeSources(database, "episode-1", ["source-a", "source-b"]);
      const scope = { kind: "user" as const, id: root };
      const record = store.upsert(
        {
          subject: "user",
          key: "居住地点",
          value: "上海",
          scope,
          authority: "model_inferred",
          confidence: 0.7,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["source-a", "source-b"],
        },
        "2026-08-24T01:00:00.000Z",
      );
      expect(record).toMatchObject({ supportCount: 1, maturity: "candidate" });

      database.connection.prepare("DELETE FROM resident_profile_evidence WHERE profile_id = ?").run(record.id);
      database.connection
        .prepare(
          `INSERT INTO resident_profile_evidence (
             profile_id, evidence_key, source_refs_json, authority, confidence, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          `legacy_${record.id}`,
          JSON.stringify(["source-a", "source-b"]),
          "model_inferred",
          0.7,
          "2026-08-24T01:00:00.000Z",
        );

      const result = store.reconcileLegacyLedger();
      expect(result).toEqual({ regrouped: 1, rescored: 0 });
      expect(
        database.connection
          .prepare<[string], { count: number }>(
            "SELECT COUNT(*) AS count FROM resident_profile_evidence WHERE profile_id = ?",
          )
          .get(record.id),
      ).toEqual({ count: 1 });
      expect(store.listActive([scope])[0]).toMatchObject({
        supportCount: 1,
        maturity: "candidate",
      });
    } finally {
      database.close();
    }
  });

  test("projects one stable claim when several scopes carry the same profile key", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    const service = new AgentResidentProfileService({ store });
    try {
      service.record({
        subject: "user",
        key: "回答语言",
        value: "中文",
        scope: { kind: "user", id: root },
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/user-language"],
      });
      service.record({
        subject: "user",
        key: "回答语言",
        value: "English",
        scope: { kind: "session", id: "session-1" },
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "session", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/session-language"],
      });

      expect(
        service.promptContext([
          { kind: "user", id: root },
          { kind: "session", id: "session-1" },
        ]),
      ).toEqual([expect.objectContaining({ key: "回答语言", claim: "回答语言: English" })]);
    } finally {
      store.close();
    }
  });

  test("orders prompt profiles by evidence strength before budget truncation", () => {
    const root = createRoot();
    const store = new AgentResidentProfileSqliteStore(path.join(root, "memory.sqlite"));
    const service = new AgentResidentProfileService({ store });
    try {
      const scope = { kind: "user" as const, id: root };
      service.record(
        {
          subject: "user",
          key: "最近备注",
          value: "普通",
          scope,
          authority: "model_inferred",
          confidence: 0.5,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["senera://memory-source/recent"],
        },
        "2026-08-24T01:00:00.000Z",
      );
      service.record(
        {
          subject: "user",
          key: "居住地点",
          value: "上海",
          scope,
          authority: "user_explicit",
          confidence: 1,
          temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
          sourceRefs: ["senera://memory-source/residence"],
        },
        "2026-08-24T00:00:00.000Z",
      );

      expect(service.promptContext([scope]).map((entry) => entry.key)).toEqual(["居住地点", "最近备注"]);
    } finally {
      store.close();
    }
  });
});

function createRoot(): string {
  const root = createTemporaryDirectory("senera-resident-profile");
  directories.add(root);
  return root;
}

function insertEpisodeSources(
  kernel: AgentSqliteDatabaseKernel,
  episodeId: string,
  sourceIds: readonly string[],
): void {
  const episodeUri = `senera://memory-episode/${episodeId}`;
  const timestamp = "2026-08-24T01:00:00.000Z";
  kernel.connection
    .prepare(
      `INSERT INTO memory_episodes (
         id, uri, session_id, request_id, status, raw_user_text, standalone_request,
         context_mode, context_basis, topic, summary, started_at, completed_at, updated_at,
         started_at_ms, completed_at_ms, updated_at_ms, time_zone, local_date, local_hour, metadata_json
       ) VALUES (?, ?, 'session-1', ?, 'completed', '', '', '', '', '', '', ?, ?, ?, ?, ?, ?,
         'Asia/Shanghai', '2026-08-24', '09', '{}')`,
    )
    .run(
      episodeId,
      episodeUri,
      `request-${episodeId}`,
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
       'Asia/Shanghai', '2026-08-24', '09', '{}')`,
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
