import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { registerAgentContinuityConcept } from "../../../Source/AgentSystem/Continuity/AgentContinuityConceptCatalog.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity property graph", () => {
  test("records typed relations and accumulates independent physical evidence", () => {
    const fixture = createFixture("senera-continuity-graph-evidence");
    const person = registerEntity(fixture, "user", "用户", "person");
    const event = registerEntity(fixture, "event", "周末球赛", "event");
    const time = registerEntity(fixture, "time", "下周六", "time");
    try {
      const first = fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: event,
        relationId: "scheduled_for",
        objectUri: time,
        temporal: { kind: "interval", timeZone: "Asia/Shanghai", startsAt: "2026-08-29T00:00:00+08:00" },
        authority: "model_inferred",
        confidence: 0.8,
        sourceRefs: ["source-a"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      const repeated = fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, time),
        sourceRefs: ["source-a"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });
      const reinforced = fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, time),
        sourceRefs: ["source-b"],
        observedAt: "2026-08-27T03:00:00.000Z",
      });

      expect(first).toMatchObject({
        relationId: "scheduled_for",
        subjectUri: event,
        objectUri: time,
        supportCount: 1,
        maturity: "candidate",
      });
      expect(repeated.supportCount).toBe(1);
      expect(reinforced).toMatchObject({ supportCount: 2, maturity: "active" });
      expect(fixture.store.listGraphNeighbors([fixture.scope], [event])).toHaveLength(1);
      expect(fixture.store.graphSnapshot([fixture.scope]).entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uri: event, kind: "event" }),
          expect.objectContaining({ uri: time, kind: "time" }),
        ]),
      );
      expect(person).not.toBe(event);
    } finally {
      fixture.kernel.close();
    }
  });

  test("rebuilds a cached snapshot after a relation write", () => {
    const fixture = createFixture("senera-continuity-graph-cache");
    const subject = registerEntity(fixture, "cache-subject", "连续性主题", "concept");
    const firstObject = registerEntity(fixture, "cache-object-a", "第一份资料", "artifact");
    const secondObject = registerEntity(fixture, "cache-object-b", "第二份资料", "artifact");
    try {
      fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: subject,
        relationId: "about",
        objectUri: firstObject,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "model_inferred",
        confidence: 0.8,
        sourceRefs: ["source-cache-a"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      const firstSnapshot = fixture.store.graphSnapshot([fixture.scope]);
      expect(fixture.store.graphSnapshot([fixture.scope])).toBe(firstSnapshot);

      fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: subject,
        relationId: "about",
        objectUri: secondObject,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "model_inferred",
        confidence: 0.8,
        sourceRefs: ["source-cache-b"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });
      const secondSnapshot = fixture.store.graphSnapshot([fixture.scope]);

      expect(secondSnapshot).not.toBe(firstSnapshot);
      expect(secondSnapshot.relations).toHaveLength(2);
      expect(secondSnapshot.entities).toEqual(expect.arrayContaining([expect.objectContaining({ uri: secondObject })]));
    } finally {
      fixture.kernel.close();
    }
  });

  test("refreshes a cached snapshot after another repository changes an entity", () => {
    const fixture = createFixture("senera-continuity-graph-shared-cache");
    const subject = registerEntity(fixture, "shared-subject", "连续性主题", "concept");
    const object = registerEntity(fixture, "shared-object", "关联资料", "artifact");
    try {
      fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: subject,
        relationId: "about",
        objectUri: object,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "model_inferred",
        confidence: 0.8,
        sourceRefs: ["source-shared-cache"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      const firstSnapshot = fixture.store.graphSnapshot([fixture.scope]);

      registerAgentContinuityConcept(fixture.kernel.connection, {
        recordUri: "senera://continuity-profile/shared-cache",
        recordKind: "profile",
        scope: fixture.scope,
        label: "连续性主题",
        aliases: ["连续性主题别名"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });

      const secondSnapshot = fixture.store.graphSnapshot([fixture.scope]);
      expect(secondSnapshot).not.toBe(firstSnapshot);
      expect(secondSnapshot.entities.find((entity) => entity.uri === subject)?.aliases).toContain("连续性主题别名");
    } finally {
      fixture.kernel.close();
    }
  });

  test("removes only unsupported relations when physical evidence is deleted", () => {
    const fixture = createFixture("senera-continuity-graph-deletion");
    const subject = registerEntity(fixture, "subject", "球赛", "event");
    const object = registerEntity(fixture, "object", "天气", "topic");
    try {
      fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: subject,
        relationId: "depends_on",
        objectUri: object,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "model_inferred",
        confidence: 0.9,
        sourceRefs: ["source-a", "source-b"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });

      fixture.store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-a"] });
      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([
        expect.objectContaining({ sourceRefs: ["source-b"], supportCount: 1 }),
      ]);

      fixture.store.deleteSources({ sessionId: "session-1", episodeUris: [], sourceUris: ["source-b"] });
      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps a stronger single-subject relation when a lower-authority candidate disagrees", () => {
    const fixture = createFixture("senera-continuity-graph-authority");
    const event = registerEntity(fixture, "authority-event", "周末球赛", "event");
    const saturday = registerEntity(fixture, "authority-saturday", "下周六", "time");
    const sunday = registerEntity(fixture, "authority-sunday", "下周日", "time");
    try {
      fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, saturday),
        authority: "user_explicit",
        sourceRefs: ["source-user"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      const weaker = fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, sunday),
        authority: "model_inferred",
        sourceRefs: ["source-model"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });

      expect(weaker.status).toBe("superseded");
      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([
        expect.objectContaining({ subjectUri: event, objectUri: saturday, authority: "user_explicit" }),
      ]);

      fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, sunday),
        authority: "user_explicit",
        sourceRefs: ["source-user-correction"],
        observedAt: "2026-08-27T03:00:00.000Z",
      });
      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([
        expect.objectContaining({ subjectUri: event, objectUri: sunday, authority: "user_explicit" }),
      ]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps an activated inferred relation ahead of a newer inferred candidate", () => {
    const fixture = createFixture("senera-continuity-graph-maturity");
    const event = registerEntity(fixture, "maturity-event", "周末球赛", "event");
    const saturday = registerEntity(fixture, "maturity-saturday", "下周六", "time");
    const sunday = registerEntity(fixture, "maturity-sunday", "下周日", "time");
    try {
      fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, saturday),
        authority: "model_inferred",
        sourceRefs: ["source-inferred-a"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, saturday),
        authority: "model_inferred",
        sourceRefs: ["source-inferred-b"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });
      const weaker = fixture.store.recordGraphRelation({
        ...firstInput(fixture, event, sunday),
        authority: "model_inferred",
        sourceRefs: ["source-inferred-c"],
        observedAt: "2026-08-27T03:00:00.000Z",
      });

      expect(weaker.status).toBe("superseded");
      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([
        expect.objectContaining({ objectUri: saturday, maturity: "active", supportCount: 2 }),
      ]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps multiple entity links for one record", () => {
    const fixture = createFixture("senera-continuity-graph-record-links");
    try {
      const recordUri = "senera://continuity-learning/shared-record";
      registerAgentContinuityConcept(fixture.kernel.connection, {
        recordUri,
        recordKind: "fact",
        scope: fixture.scope,
        label: "球赛",
        entityKind: "event",
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      registerAgentContinuityConcept(fixture.kernel.connection, {
        recordUri,
        recordKind: "fact",
        scope: fixture.scope,
        label: "天气",
        entityKind: "topic",
        observedAt: "2026-08-27T02:00:00.000Z",
      });

      expect(
        fixture.kernel.connection
          .prepare<[string, string], { count: number }>(
            "SELECT COUNT(*) AS count FROM continuity_record_concepts WHERE record_uri = ? AND record_kind = ?",
          )
          .get(recordUri, "fact"),
      ).toEqual({ count: 2 });
    } finally {
      fixture.kernel.close();
    }
  });

  test("links a unique identifier-bearing alias without merging generic labels", () => {
    const fixture = createFixture("senera-continuity-graph-aliases");
    try {
      const first = fixture.store.recordGraphRelationCandidate({
        scope: fixture.scope,
        subjectLabel: "Senera",
        relationId: "about",
        objectLabel: "连续性设计",
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "user_explicit",
        confidence: 1,
        sourceRefs: ["source-alias-a"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });
      const linked = fixture.store.recordGraphRelationCandidate({
        scope: fixture.scope,
        subjectLabel: "Senera 项目",
        relationId: "about",
        objectLabel: "图谱设计",
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "user_explicit",
        confidence: 1,
        sourceRefs: ["source-alias-b"],
        observedAt: "2026-08-27T02:00:00.000Z",
      });
      const generic = fixture.store.recordGraphRelationCandidate({
        scope: fixture.scope,
        subjectLabel: "项目",
        relationId: "about",
        objectLabel: "独立需求",
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "user_explicit",
        confidence: 1,
        sourceRefs: ["source-alias-c"],
        observedAt: "2026-08-27T03:00:00.000Z",
      });

      expect(linked.subjectUri).toBe(first.subjectUri);
      expect(generic.subjectUri).not.toBe(first.subjectUri);
      const canonical = fixture.store
        .graphSnapshot([fixture.scope])
        .entities.find((entity) => entity.uri === first.subjectUri);
      expect(canonical?.aliases).toEqual(expect.arrayContaining(["Senera", "Senera 项目"]));
    } finally {
      fixture.kernel.close();
    }
  });

  test("repoints active edges when two concepts are merged", () => {
    const fixture = createFixture("senera-continuity-graph-merge");
    const source = registerEntity(fixture, "source", "旧项目名", "concept");
    const target = registerEntity(fixture, "target", "新项目名", "concept");
    const object = registerEntity(fixture, "object", "项目文档", "artifact");
    try {
      fixture.store.recordGraphRelation({
        scope: fixture.scope,
        subjectUri: source,
        relationId: "about",
        objectUri: object,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        authority: "model_inferred",
        confidence: 0.9,
        sourceRefs: ["source-merge"],
        observedAt: "2026-08-27T01:00:00.000Z",
      });

      fixture.store.mergeConcepts({
        scope: fixture.scope,
        sourceUris: [source],
        targetUri: target,
        observedAt: "2026-08-27T02:00:00.000Z",
      });

      expect(fixture.store.listGraphRelations([fixture.scope])).toEqual([
        expect.objectContaining({ subjectUri: target, objectUri: object, relationId: "about" }),
      ]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps relation-only entities when the store is reopened", () => {
    const fixture = createFixture("senera-continuity-graph-reopen");
    const subject = registerEntity(fixture, "reopen-subject", "周末球赛", "event");
    const object = registerEntity(fixture, "reopen-object", "下周六", "time");
    fixture.store.recordGraphRelation({
      scope: fixture.scope,
      subjectUri: subject,
      relationId: "scheduled_for",
      objectUri: object,
      temporal: { kind: "interval", timeZone: "Asia/Shanghai", startsAt: "2026-08-29T00:00:00+08:00" },
      authority: "model_inferred",
      confidence: 0.9,
      sourceRefs: ["source-reopen"],
      observedAt: "2026-08-27T01:00:00.000Z",
    });
    fixture.kernel.close();

    const reopenedKernel = new AgentSqliteDatabaseKernel({
      databasePath: path.join(fixture.workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const reopenedStore = new AgentContinuitySqliteStore(reopenedKernel);
      expect(reopenedStore.listGraphRelations([fixture.scope])).toHaveLength(1);
      expect(reopenedStore.graphSnapshot([fixture.scope]).entities).toEqual(
        expect.arrayContaining([expect.objectContaining({ uri: subject }), expect.objectContaining({ uri: object })]),
      );
    } finally {
      reopenedKernel.close();
    }
  });
});

function createFixture(prefix: string) {
  const workspace = createTemporaryDirectory(prefix);
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  return {
    kernel,
    store: new AgentContinuitySqliteStore(kernel),
    scope: { kind: "workspace" as const, id: workspace },
    workspace,
  };
}

function registerEntity(
  fixture: ReturnType<typeof createFixture>,
  id: string,
  label: string,
  entityKind: "artifact" | "concept" | "event" | "person" | "time" | "topic",
): string {
  return registerAgentContinuityConcept(fixture.kernel.connection, {
    recordUri: `senera://continuity-learning/${id}`,
    recordKind: "fact",
    scope: fixture.scope,
    label,
    entityKind,
    observedAt: "2026-08-27T00:00:00.000Z",
  });
}

function firstInput(fixture: ReturnType<typeof createFixture>, subjectUri: string, objectUri: string) {
  return {
    scope: fixture.scope,
    subjectUri,
    relationId: "scheduled_for" as const,
    objectUri,
    temporal: { kind: "interval" as const, timeZone: "Asia/Shanghai", startsAt: "2026-08-29T00:00:00+08:00" },
    authority: "model_inferred" as const,
    confidence: 0.8,
  };
}
