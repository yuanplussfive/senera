import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { recordAgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteFacts.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity fact timeline and paraphrase reconciliation", () => {
  test("routes a paraphrased write onto the existing fact key instead of creating a duplicate head", () => {
    const fixture = createFixture("senera-fact-recon-paraphrase");
    const { store, scope } = fixture;
    try {
      store.recordObservation(fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"));
      store.recordObservation(fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"));

      const heads = store.listFactHeads([scope]);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toMatchObject({
        claim: "用户居住在上海。",
        validFrom: "2026-08-25T01:00:00.000Z",
        status: "active",
        supersededBy: null,
        sourceRefs: ["source-obs-1", "source-obs-2"],
        supportCount: 2,
        supportMass: 1,
      });
      const operations = store
        .listFactHistory(scope, heads[0].factKey)
        .map((entry) => `${entry.operation}:${entry.claim}`);
      expect(operations).toEqual(["reinforced:用户居住在上海。", "created:用户住在上海。"]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps valid_from stable across reinforcements and resets it when the claim changes", () => {
    const fixture = createFixture("senera-fact-recon-valid-from");
    const { store, scope } = fixture;
    try {
      store.recordObservation(fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"));
      const key = store.listFactHeads([scope])[0].factKey;

      store.recordObservation(fact(scope, "obs-2", "用户住在上海。", "2026-08-25T02:00:00.000Z"));
      expect(store.listFactHeads([scope])[0]).toMatchObject({
        factKey: key,
        validFrom: "2026-08-25T01:00:00.000Z",
        updatedAt: "2026-08-25T02:00:00.000Z",
      });

      store.recordObservation(fact(scope, "obs-3", "用户住在东京。", "2026-08-25T03:00:00.000Z", key));
      expect(store.listFactHeads([scope])).toHaveLength(1);
      expect(store.listFactHeads([scope])[0]).toMatchObject({
        factKey: key,
        claim: "用户住在东京。",
        validFrom: "2026-08-25T03:00:00.000Z",
      });
    } finally {
      fixture.kernel.close();
    }
  });

  test("restores the prior claim version with its evidence after deleting the newer paraphrase", () => {
    const fixture = createFixture("senera-fact-recon-version-delete");
    const { store, scope } = fixture;
    try {
      store.recordObservation(fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"));
      store.recordObservation(fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"));

      store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-obs-2"] });

      expect(store.listFactHeads([scope])[0]).toMatchObject({
        claim: "用户住在上海。",
        sourceRefs: ["source-obs-1"],
        supportCount: 1,
        supportMass: 1,
      });
    } finally {
      fixture.kernel.close();
    }
  });

  test("converges pre-existing duplicate heads onto the oldest identity and records lineage", () => {
    const fixture = createFixture("senera-fact-recon-legacy");
    const { kernel, store, scope } = fixture;
    try {
      store.recordObservation(fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"));
      // Legacy duplicate written before reconciliation existed: a different
      // paraphrase claim that landed under its own hash key.
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"),
      );
      expect(store.listFactHeads([scope])).toHaveLength(2);
      const older = store.listFactHeads([scope]).find((head) => head.claim === "用户住在上海。");

      store.recordObservation(fact(scope, "obs-3", "用户住在上海。", "2026-08-25T03:00:00.000Z"));

      const heads = store.listFactHeads([scope]);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toMatchObject({ factKey: older?.factKey, supersededBy: null });
      expect(heads[0].sourceRefs).toEqual(["source-obs-1", "source-obs-2", "source-obs-3"]);

      const olderKey = requireFactKey(store, scope, "用户住在上海。");
      const supersededRow = kernel.connection
        .prepare<[string, string, string], { status: string; superseded_by: string }>(
          "SELECT status, superseded_by FROM continuity_fact_heads WHERE scope_kind = ? AND scope_id = ? AND fact_key != ?",
        )
        .get(scope.kind, scope.id, olderKey);
      expect(supersededRow?.status).toBe("superseded");
      expect(supersededRow?.superseded_by).toBe(olderKey);
    } finally {
      fixture.kernel.close();
    }
  });

  test("sweeps legacy paraphrase duplicates once and stays idempotent", () => {
    const fixture = createFixture("senera-fact-recon-sweep");
    const { kernel, store, scope } = fixture;
    try {
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-3", "用户喜欢猫。", "2026-08-25T02:30:00.000Z"),
      );

      const first = store.reconcileFacts([scope], new Date("2026-08-25T03:00:00.000Z"));
      expect(first).toMatchObject({ scopes: 1, supersededFacts: 1 });

      const heads = store.listFactHeads([scope]);
      expect(heads.map((head) => head.claim).sort()).toEqual(["用户住在上海。", "用户喜欢猫。"]);
      expect(heads.find((head) => head.claim === "用户住在上海。")?.sourceRefs).toEqual([
        "source-obs-1",
        "source-obs-2",
      ]);
      const survivorKey = requireFactKey(store, scope, "用户住在上海。");
      expect(
        kernel.connection
          .prepare<[string, string, string], { count: number }>(
            "SELECT COUNT(*) AS count FROM continuity_fact_heads WHERE scope_kind = ? AND scope_id = ? AND superseded_by = ?",
          )
          .get(scope.kind, scope.id, survivorKey),
      ).toEqual({ count: 1 });

      const second = store.reconcileFacts([scope], new Date("2026-08-25T04:00:00.000Z"));
      expect(second).toMatchObject({ supersededFacts: 0 });
    } finally {
      fixture.kernel.close();
    }
  });

  test("routes a new paraphrase through every equivalent legacy head and keeps the oldest identity", () => {
    const fixture = createFixture("senera-fact-recon-legacy-route");
    const { kernel, store, scope } = fixture;
    try {
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"),
      );
      const oldest = store.listFactHeads([scope]).find((head) => head.claim === "用户住在上海。")?.factKey;

      store.recordObservation(fact(scope, "obs-3", "用户在上海居住。", "2026-08-25T03:00:00.000Z"));

      const heads = store.listFactHeads([scope]);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toMatchObject({ factKey: oldest, claim: "用户在上海居住。" });
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps an existing explicit key canonical while folding legacy equivalents into it", () => {
    const fixture = createFixture("senera-fact-recon-explicit-canonical");
    const { kernel, store, scope } = fixture;
    try {
      store.recordObservation(
        fact(scope, "explicit", "用户居住在上海。", "2026-08-25T01:00:00.000Z", "profile.residence"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "legacy", "用户住在上海。", "2026-08-25T02:00:00.000Z"),
      );

      store.recordObservation(
        fact(scope, "rewrite", "用户在上海居住。", "2026-08-25T03:00:00.000Z", "profile.residence"),
      );

      const heads = store.listFactHeads([scope]);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toMatchObject({ factKey: "profile.residence", claim: "用户在上海居住。" });
    } finally {
      fixture.kernel.close();
    }
  });

  test("lets a first explicit key take ownership of equivalent legacy heads", () => {
    const fixture = createFixture("senera-fact-recon-explicit-migration");
    const { kernel, store, scope } = fixture;
    try {
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "legacy", "用户住在上海。", "2026-08-25T01:00:00.000Z"),
      );
      store.recordObservation(
        fact(scope, "explicit", "用户居住在上海。", "2026-08-25T02:00:00.000Z", "profile.residence"),
      );

      const heads = store.listFactHeads([scope]);
      expect(heads).toHaveLength(1);
      expect(heads[0]).toMatchObject({ factKey: "profile.residence", supportCount: 2 });
      expect(heads[0]?.sourceRefs).toEqual(["source-explicit", "source-legacy"]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("reactivates an explicit key after a reconciliation sweep supersedes its historical row", () => {
    const fixture = createFixture("senera-fact-recon-explicit-reactivation");
    const { kernel, store, scope } = fixture;
    try {
      store.recordObservation(
        fact(scope, "explicit-old", "用户住在上海。", "2026-08-25T02:00:00.000Z", "profile.residence"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "legacy-older", "用户居住在上海。", "2026-08-25T01:00:00.000Z"),
      );

      store.reconcileFacts([scope], new Date("2026-08-25T03:00:00.000Z"));
      expect(() =>
        store.recordObservation(
          fact(scope, "explicit-new", "用户在上海居住。", "2026-08-25T04:00:00.000Z", "profile.residence"),
        ),
      ).not.toThrow();

      expect(store.listFactHeads([scope])).toMatchObject([
        expect.objectContaining({
          factKey: "profile.residence",
          claim: "用户在上海居住。",
          status: "active",
          supersededBy: null,
        }),
      ]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("respects the configured fuzzy threshold instead of a hidden constant", () => {
    const fixture = createFixture("senera-fact-recon-threshold", {
      FactIdentityFuzzyScore: 1.1,
    });
    const { store, scope } = fixture;
    try {
      store.recordObservation(fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"));
      store.recordObservation(fact(scope, "obs-2", "用户居住在上海。", "2026-08-25T02:00:00.000Z"));

      expect(store.listFactHeads([scope])).toHaveLength(2);
    } finally {
      fixture.kernel.close();
    }
  });

  test("does not merge polarity-changing writes that reuse a fact key", () => {
    const fixture = createFixture("senera-fact-recon-polarity-key");
    const { store, scope } = fixture;
    try {
      const key = "profile.preference";
      store.recordObservation(fact(scope, "obs-1", "用户喜欢咖啡。", "2026-08-25T01:00:00.000Z", key));
      store.recordObservation(fact(scope, "obs-2", "用户不喜欢咖啡。", "2026-08-25T02:00:00.000Z", key));

      const head = store.listFactHeads([scope])[0];
      expect(head).toMatchObject({
        factKey: key,
        claim: "用户不喜欢咖啡。",
        validFrom: "2026-08-25T02:00:00.000Z",
        supportCount: 1,
      });
      expect(store.listFactHistory(scope, key).map((entry) => entry.operation)).toEqual(["superseded", "created"]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps polarity-changing legacy heads separate during reconciliation", () => {
    const fixture = createFixture("senera-fact-recon-polarity-sweep");
    const { kernel, store, scope } = fixture;
    try {
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-1", "用户住在上海。", "2026-08-25T01:00:00.000Z"),
      );
      recordAgentContinuityObservation(
        kernel.connection,
        fact(scope, "obs-2", "用户不住在上海。", "2026-08-25T02:00:00.000Z"),
      );

      const result = store.reconcileFacts([scope], new Date("2026-08-25T03:00:00.000Z"));
      expect(result.supersededFacts).toBe(0);
      expect(
        store
          .listFactHeads([scope])
          .map((head) => head.claim)
          .sort(),
      ).toEqual(["用户不住在上海。", "用户住在上海。"]);
    } finally {
      fixture.kernel.close();
    }
  });
});

function createFixture(prefix: string, rankingOverride?: { FactIdentityFuzzyScore: number }) {
  const workspace = createTemporaryDirectory(prefix);
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel, undefined, {
    factReconciliationPolicy: rankingOverride
      ? () => ({ ...AgentContinuityRecallRankingDefaults, ...rankingOverride })
      : undefined,
  });
  const scope = { kind: "user" as const, id: workspace };
  return { kernel, store, scope };
}

function requireFactKey(store: AgentContinuitySqliteStore, scope: { kind: "user"; id: string }, claim: string): string {
  const head = store.listFactHeads([scope]).find((entry) => entry.claim === claim);
  if (!head) throw new Error(`Active fact head not found: ${claim}`);
  return head.factKey;
}

function fact(
  scope: AgentContinuityObservation["scope"],
  id: string,
  summary: string,
  observedAt: string,
  explicitKey?: string,
): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, until: "permanent", ...(explicitKey ? { factKey: explicitKey } : {}) },
    sourceRefs: [`source-${id}`],
    watermark: `watermark-${id}`,
    scope,
    authority: "user_explicit",
    confidence: 1,
    occurredAt: observedAt,
    observedAt,
    createdAtMs: Date.parse(observedAt),
  };
}
