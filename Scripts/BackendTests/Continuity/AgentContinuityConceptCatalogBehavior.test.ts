import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import {
  registerAgentContinuityConcept,
  type AgentContinuityConceptRecord,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityConceptCatalog.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentResidentProfileSqliteStore } from "../../../Source/AgentSystem/Profile/AgentResidentProfileSqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity concept catalog", () => {
  test("links records from different domains through an exact host-normalized alias", () => {
    const workspace = createTemporaryDirectory("senera-continuity-concepts");
    workspaces.add(workspace);
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    const continuity = new AgentContinuitySqliteStore(kernel);
    const profiles = new AgentResidentProfileSqliteStore(kernel);
    const scope = { kind: "user" as const, id: workspace };
    try {
      continuity.recordObservation(fact(scope, "用户偏好简短回复"));
      profiles.upsert({
        subject: "user",
        key: "用户偏好简短回复",
        value: true,
        scope,
        authority: "user_explicit",
        confidence: 1,
        temporal: { until: "permanent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["source-profile"],
      });

      expect(continuity.listConcepts([scope])).toEqual([
        expect.objectContaining({
          label: "用户偏好简短回复",
          recordKinds: ["fact", "profile"],
          recordCount: 2,
        }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("keeps unrelated labels as separate concepts", () => {
    const workspace = createTemporaryDirectory("senera-continuity-distinct-concepts");
    workspaces.add(workspace);
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact(scope, "用户住在上海", "fact-a"));
      store.recordObservation(fact(scope, "用户偏好简短回复", "fact-b"));

      expect(
        store
          .listConcepts([scope])
          .map(({ label }) => label)
          .sort(),
      ).toEqual(["用户住在上海", "用户偏好简短回复"]);
    } finally {
      store.close();
    }
  });

  test("auto-merges ambiguous concepts into the oldest identity instead of failing the write", () => {
    const fixture = createConceptFixture("senera-continuity-concept-auto-merge");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "沪上书房", [], "2026-08-25T01:00:00.000Z");
      registerConcept(fixture, "record-b", "Studio 沪上", [], "2026-08-25T02:00:00.000Z");
      const before = store.listConcepts([scope]);
      expect(before).toHaveLength(2);
      const older = findByLabel(before, "沪上书房");
      const younger = findByLabel(before, "Studio 沪上");

      registerConcept(fixture, "record-c", "沪上书房", ["Studio 沪上"], "2026-08-25T03:00:00.000Z");

      const concepts = store.listConcepts([scope]);
      expect(concepts).toHaveLength(1);
      expect(concepts[0]).toMatchObject({
        uri: older.uri,
        label: "沪上书房",
        recordCount: 3,
        mergedIntoUri: null,
      });
      expect(concepts[0].aliases).toEqual(expect.arrayContaining(["沪上书房", "Studio 沪上"]));
      const stub = fixture.kernel.connection
        .prepare<[string], { status: string; merged_into_uri: string | null }>(
          "SELECT status, merged_into_uri FROM continuity_concepts WHERE uri = ?",
        )
        .get(younger.uri);
      expect(stub).toEqual({ status: "merged", merged_into_uri: older.uri });
    } finally {
      fixture.kernel.close();
    }
  });

  test("merges explicit sources into a target concept and keeps lineage", () => {
    const fixture = createConceptFixture("senera-continuity-concept-merge");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "晨跑计划", [], "2026-08-25T01:00:00.000Z");
      registerConcept(fixture, "record-b", "跑步目标", [], "2026-08-25T02:00:00.000Z");
      const source = findByLabel(store.listConcepts([scope]), "晨跑计划");
      const target = findByLabel(store.listConcepts([scope]), "跑步目标");

      const merged = store.mergeConcepts({
        scope,
        sourceUris: [source.uri],
        targetUri: target.uri,
        observedAt: "2026-08-25T03:00:00.000Z",
      });

      expect(merged).toMatchObject({ uri: target.uri, label: "跑步目标", recordCount: 2, mergedIntoUri: null });
      expect(merged.aliases).toEqual(expect.arrayContaining(["晨跑计划", "跑步目标"]));
      expect(store.listConcepts([scope]).map(({ uri }) => uri)).toEqual([target.uri]);
      expect(() =>
        store.mergeConcepts({ scope, sourceUris: [target.uri], targetUri: target.uri, observedAt: "" }),
      ).toThrow(/must not be a source/u);
      expect(() =>
        store.mergeConcepts({
          scope,
          sourceUris: ["senera://continuity-concept/missing"],
          targetUri: target.uri,
          observedAt: "",
        }),
      ).toThrow(/not found in scope/u);
    } finally {
      fixture.kernel.close();
    }
  });

  test("splits records and aliases into a new concept", () => {
    const fixture = createConceptFixture("senera-continuity-concept-split");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "用户喜欢猫", [], "2026-08-25T01:00:00.000Z");
      registerConcept(fixture, "record-b", "用户喜欢猫", [], "2026-08-25T02:00:00.000Z");
      const source = store.listConcepts([scope])[0];
      const corrected = store.correctConcept({
        scope,
        uri: source.uri,
        addAliases: ["爱猫人士"],
        observedAt: "2026-08-25T02:30:00.000Z",
      });
      expect(corrected.aliases).toEqual(expect.arrayContaining(["用户喜欢猫", "爱猫人士"]));

      const target = store.splitConcept({
        scope,
        sourceUri: source.uri,
        targetLabel: "爱猫人士",
        moveAliases: ["爱猫人士"],
        moveRecordUris: ["senera://continuity-learning/record-b"],
        observedAt: "2026-08-25T03:00:00.000Z",
      });

      expect(target).toMatchObject({ label: "爱猫人士", recordCount: 1 });
      expect(target.aliases).toContain("爱猫人士");
      const remaining = store.listConcepts([scope]).find(({ uri }) => uri === source.uri);
      expect(remaining).toMatchObject({ label: "用户喜欢猫", recordCount: 1 });
      expect(remaining?.aliases).not.toContain("爱猫人士");
      expect(() =>
        store.splitConcept({
          scope,
          sourceUri: source.uri,
          targetLabel: "用户喜欢猫",
          moveAliases: [],
          moveRecordUris: ["senera://continuity-learning/record-a"],
          observedAt: "",
        }),
      ).toThrow(/remains linked to the source concept/u);
    } finally {
      fixture.kernel.close();
    }
  });

  test("renames a concept and rejects labels owned by other active concepts", () => {
    const fixture = createConceptFixture("senera-continuity-concept-rename");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "沪上书房", [], "2026-08-25T01:00:00.000Z");
      registerConcept(fixture, "record-b", "静安书房", [], "2026-08-25T02:00:00.000Z");
      const target = findByLabel(store.listConcepts([scope]), "沪上书房");
      const other = findByLabel(store.listConcepts([scope]), "静安书房");

      const renamed = store.renameConcept({
        scope,
        uri: target.uri,
        label: "沪上书房·静安店",
        observedAt: "2026-08-25T03:00:00.000Z",
      });

      expect(renamed).toMatchObject({ uri: target.uri, label: "沪上书房·静安店" });
      expect(renamed.aliases).toContain("沪上书房·静安店");
      expect(() => store.renameConcept({ scope, uri: target.uri, label: other.label, observedAt: "" })).toThrow(
        /already linked to another active concept/u,
      );
    } finally {
      fixture.kernel.close();
    }
  });

  test("corrects aliases while protecting the canonical label", () => {
    const fixture = createConceptFixture("senera-continuity-concept-correct");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "用户喜欢猫", [], "2026-08-25T01:00:00.000Z");
      registerConcept(fixture, "record-b", "用户喜欢狗", [], "2026-08-25T02:00:00.000Z");
      const cats = findByLabel(store.listConcepts([scope]), "用户喜欢猫");
      const dogs = findByLabel(store.listConcepts([scope]), "用户喜欢狗");

      expect(() =>
        store.correctConcept({ scope, uri: cats.uri, removeAliases: ["用户喜欢猫"], observedAt: "" }),
      ).toThrow(/rename the concept instead/u);
      expect(() =>
        store.correctConcept({ scope, uri: cats.uri, removeAliases: ["不存在的别名"], observedAt: "" }),
      ).toThrow(/not linked to this concept/u);
      expect(() => store.correctConcept({ scope, uri: cats.uri, addAliases: ["用户喜欢狗"], observedAt: "" })).toThrow(
        /merge them instead/u,
      );

      const corrected = store.correctConcept({
        scope,
        uri: cats.uri,
        addAliases: ["爱猫人士"],
        observedAt: "2026-08-25T03:00:00.000Z",
      });
      expect(corrected.aliases).toContain("爱猫人士");
      const removed = store.correctConcept({
        scope,
        uri: cats.uri,
        removeAliases: ["爱猫人士"],
        observedAt: "2026-08-25T04:00:00.000Z",
      });
      expect(removed.aliases).not.toContain("爱猫人士");
      expect(removed.aliases).toContain("用户喜欢猫");
      expect(dogs.uri).not.toBe(cats.uri);
    } finally {
      fixture.kernel.close();
    }
  });

  test("signals never register concepts; legacy signal concepts are purged at store init", () => {
    const fixture = createConceptFixture("senera-continuity-concept-signal");
    const { store, scope } = fixture;
    try {
      registerConcept(fixture, "record-a", "用户喜欢猫", [], "2026-08-25T01:00:00.000Z");
      store.upsertSignal({
        scope,
        namespace: "runtime.tool",
        key: "ShellCommandTool",
        value: "completed",
        valueType: "string",
        authority: "system_observed",
        confidence: 1,
        observedAt: "2026-08-25T02:00:00.000Z",
        sourceRefs: ["source-runtime"],
      });

      // Signal writes do not engineer concepts any more.
      const labels = store.listConcepts([scope]).map((entry) => entry.label);
      expect(labels).toContain("用户喜欢猫");
      expect(labels).not.toContain(/ShellCommandTool/u);

      // A brand-new store purges legacy signal concept links on init.
      const freshStore = new AgentContinuitySqliteStore(
        new AgentSqliteDatabaseKernel({
          databasePath: path.join(createTemporaryDirectory("senera-continuity-concept-signal-legacy"), "memory.sqlite"),
          contract: AgentMemoryDatabaseContract,
        }),
      );
      expect(freshStore.listConcepts([scope])).toEqual([]);
      freshStore.close();
    } finally {
      fixture.kernel.close();
    }
  });
});

function findByLabel(concepts: readonly AgentContinuityConceptRecord[], label: string): AgentContinuityConceptRecord {
  const concept = concepts.find((entry) => entry.label === label);
  if (!concept) throw new Error(`Concept not found: ${label}`);
  return concept;
}

function createConceptFixture(prefix: string) {
  const workspace = createTemporaryDirectory(prefix);
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel);
  const scope = { kind: "user" as const, id: workspace };
  return { kernel, store, scope };
}

function registerConcept(
  fixture: ReturnType<typeof createConceptFixture>,
  recordId: string,
  label: string,
  aliases: readonly string[],
  observedAt: string,
): string {
  return registerAgentContinuityConcept(fixture.kernel.connection, {
    recordUri: `senera://continuity-learning/${recordId}`,
    recordKind: "fact",
    scope: fixture.scope,
    label,
    aliases,
    observedAt,
  });
}

function fact(scope: AgentContinuityObservation["scope"], summary: string, id = "fact"): AgentContinuityObservation {
  const observedAt = "2026-08-25T01:00:00.000Z";
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, until: "permanent" },
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
