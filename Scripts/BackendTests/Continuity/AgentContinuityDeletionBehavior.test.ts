import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentResidentProfileSqliteStore } from "../../../Source/AgentSystem/Profile/AgentResidentProfileSqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity source deletion", () => {
  test("removes fact concept links when the observation loses its last source", () => {
    const workspace = createTemporaryDirectory("senera-continuity-fact-concept-cleanup");
    workspaces.add(workspace);
    const kernel = createKernel(workspace);
    const store = new AgentContinuitySqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(
        fact("concept-cleanup", "用户住在上海。", ["source-concept-cleanup"], scope, "profile.residence"),
      );
      expect(store.listConcepts([scope])).toEqual([
        expect.objectContaining({ label: "用户住在上海。", recordCount: 1 }),
      ]);

      store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-concept-cleanup"] });

      expect(store.listConcepts([scope])).toEqual([]);
      expect(
        kernel.connection
          .prepare<[string], { count: number }>(
            "SELECT COUNT(*) AS count FROM continuity_record_concepts WHERE record_uri = ? AND record_kind = 'fact'",
          )
          .get("senera://continuity-learning/concept-cleanup"),
      ).toEqual({ count: 0 });
    } finally {
      kernel.close();
    }
  });

  test("removes profile concept links when a profile loses its last source", () => {
    const workspace = createTemporaryDirectory("senera-continuity-profile-concept-cleanup");
    workspaces.add(workspace);
    const kernel = createKernel(workspace);
    const profiles = new AgentResidentProfileSqliteStore(kernel);
    const continuity = new AgentContinuitySqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      profiles.upsert({
        subject: "user",
        key: "居住地",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["source-profile-concept-cleanup"],
      });
      expect(continuity.listConcepts([scope])).toEqual([expect.objectContaining({ label: "居住地", recordCount: 1 })]);

      profiles.deleteSources({
        sessionId: "session-1",
        episodeUris: [],
        sourceUris: ["source-profile-concept-cleanup"],
      });

      expect(continuity.listConcepts([scope])).toEqual([]);
    } finally {
      kernel.close();
    }
  });

  test("restores the previous fact and removes source-only rules and signals", () => {
    const workspace = createTemporaryDirectory("senera-continuity-deletion");
    workspaces.add(workspace);
    const kernel = createKernel(workspace);
    const store = new AgentContinuitySqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact("old", "用户住在上海。", ["source-old"], scope, "profile.residence"));
      store.recordObservation(fact("new", "用户住在杭州。", ["source-new"], scope, "profile.residence"));
      store.upsertSignal({
        scope,
        namespace: "activity",
        key: "exercise.completed",
        value: true,
        valueType: "boolean",
        authority: "user_explicit",
        confidence: 1,
        observedAt: "2026-08-24T01:00:00.000Z",
        sourceRefs: ["source-new"],
      });
      store.recordRule({
        title: "杭州天气提醒",
        condition: { kind: "always" },
        action: { kind: "notify", summary: "提醒查看天气。", activation: "once" },
        scope: { kind: "workspace", id: workspace },
        authority: "user_explicit",
        confidence: 1,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["source-new"],
      });

      store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-new"] });

      expect(store.listFactHeads([scope])).toEqual([
        expect.objectContaining({ claim: "用户住在上海。", sourceRefs: ["source-old"] }),
      ]);
      expect(store.listSignals([scope])).toEqual([]);
      expect(store.listRules([{ kind: "workspace", id: workspace }])).toEqual([]);
    } finally {
      kernel.close();
    }
  });

  test("keeps a derived record when another physical source still supports it", () => {
    const workspace = createTemporaryDirectory("senera-continuity-source-retention");
    workspaces.add(workspace);
    const kernel = createKernel(workspace);
    const profiles = new AgentResidentProfileSqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      profiles.upsert({
        subject: "user",
        key: "居住地",
        value: "上海",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["source-old"],
      });
      profiles.upsert({
        subject: "user",
        key: "居住地",
        value: "杭州",
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["source-new", "source-keep"],
      });

      profiles.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-new"] });

      expect(profiles.listActive([scope])[0]).toMatchObject({ value: "杭州", sourceRefs: ["source-keep"] });
    } finally {
      kernel.close();
    }
  });

  test("removes learning vectors when their last source is deleted", () => {
    const workspace = createTemporaryDirectory("senera-continuity-vector-deletion");
    workspaces.add(workspace);
    const kernel = createKernel(workspace);
    const store = new AgentContinuitySqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      const observation = fact("vector", "用户喜欢无糖咖啡。", ["source-vector"], scope, "preference.coffee");
      store.recordObservation(observation);
      store.upsertObservationEmbeddings(
        [
          {
            observationUri: observation.uri,
            model: "test-embed",
            textSha256: "hash",
            vector: [1, 0],
          },
        ],
        "2026-08-24T01:00:00.000Z",
      );

      store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-vector"] });

      expect(store.listObservationEmbeddings([observation.uri])).toHaveProperty("size", 0);
    } finally {
      kernel.close();
    }
  });
});

function createKernel(workspace: string): AgentSqliteDatabaseKernel {
  return new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
}

function fact(
  id: string,
  summary: string,
  sourceRefs: readonly string[],
  scope: AgentContinuityObservation["scope"],
  factKey: string,
): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, factKey, until: "permanent" },
    sourceRefs,
    watermark: `watermark-${id}`,
    scope,
    authority: "user_explicit",
    confidence: 1,
    occurredAt: `2026-08-24T01:00:0${id === "old" ? "1" : "2"}.000Z`,
    observedAt: `2026-08-24T01:00:0${id === "old" ? "1" : "2"}.000Z`,
    createdAtMs: Date.parse(`2026-08-24T01:00:0${id === "old" ? "1" : "2"}.000Z`),
  };
}
