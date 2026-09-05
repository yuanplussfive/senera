import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity fact ledger", () => {
  test("keeps one current head while preserving reinforcement history", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact("one", "用户住在上海。", ["source-1"], scope));
      store.recordObservation(fact("two", " 用户住在上海。 ", ["source-2"], scope));

      expect(store.listLearningObservations([scope]).map((entry) => entry.uri)).toEqual([
        "senera://continuity-learning/two",
      ]);
      expect(store.listFactHeads([scope])).toEqual([
        expect.objectContaining({
          claim: " 用户住在上海。 ",
          observationUri: "senera://continuity-learning/two",
          sourceRefs: ["source-1", "source-2"],
          status: "active",
          supportCount: 2,
          supportMass: 1,
          maturity: "active",
        }),
      ]);
      expect(store.listFactHistory(scope).map((entry) => entry.operation)).toEqual(["reinforced", "created"]);
    } finally {
      store.close();
    }
  });

  test("counts distinct episode evidence once when the same episode is retried", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact("first", "用户住在上海。", ["same-episode-source"], scope));
      store.recordObservation(fact("retry", "用户住在上海。", ["same-episode-source"], scope));

      expect(store.listFactHeads([scope])[0]).toMatchObject({
        supportCount: 1,
        supportMass: 1,
        maturity: "active",
      });
      expect(store.listFactHistory(scope).filter((entry) => entry.operation === "reinforced")).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("supports an explicit stable key for conflicting versions", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact("old", "用户居住地是上海。", ["source-old"], scope, "profile.residence"));
      store.recordObservation(fact("new", "用户居住地是杭州。", ["source-new"], scope, "profile.residence"));

      expect(store.listLearningObservations([scope]).map((entry) => entry.summary)).toEqual(["用户居住地是杭州。"]);
      expect(store.listFactHistory(scope, "profile.residence").map((entry) => entry.operation)).toEqual([
        "superseded",
        "created",
      ]);
      expect(store.listFactHistory(scope, "profile.residence").map((entry) => entry.claim)).toEqual([
        "用户居住地是杭州。",
        "用户居住地是上海。",
      ]);
    } finally {
      store.close();
    }
  });

  test("rejects a weaker conflicting value for an explicit fact head", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const scope = { kind: "user" as const, id: workspace };
    try {
      store.recordObservation(fact("old", "用户居住地是上海。", ["source-old"], scope, "profile.residence"));
      store.recordObservation({
        ...fact("new", "用户居住地是杭州。", ["source-new"], scope, "profile.residence"),
        authority: "model_inferred",
        confidence: 0.8,
      });

      expect(store.listFactHeads([scope])).toEqual([
        expect.objectContaining({ claim: "用户居住地是上海。", authority: "user_explicit" }),
      ]);
      expect(store.listFactHistory(scope, "profile.residence")[0]).toMatchObject({
        claim: "用户居住地是杭州。",
        operation: "retracted",
      });
    } finally {
      store.close();
    }
  });
});

function fact(
  id: string,
  summary: string,
  sourceRefs: readonly string[],
  scope: AgentContinuityObservation["scope"],
  factKey?: string,
): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, until: "permanent", ...(factKey ? { factKey } : {}) },
    sourceRefs,
    watermark: `watermark-${id}`,
    scope,
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-23T01:00:00.000Z",
    observedAt: id === "one" || id === "old" ? "2026-08-23T01:00:01.000Z" : "2026-08-23T01:00:02.000Z",
    createdAtMs: Date.parse(id === "one" || id === "old" ? "2026-08-23T01:00:01.000Z" : "2026-08-23T01:00:02.000Z"),
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-fact-ledger");
  workspaces.add(workspace);
  return workspace;
}
