import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity rule consolidation", () => {
  test("reinforces a targeted paraphrase and counts independent evidence once", () => {
    const { store, scope } = createStore();
    try {
      const first = store.recordRule(ruleDraft(scope, "保持简短", "后续回复尽量简短自然。", ["source-a"]));
      const duplicateSource = store.recordRule(
        {
          ...ruleDraft(scope, "自然表达", "之后回复少用符号并贴近用户说话风格。", ["source-a"]),
          targetRuleUri: first.uri,
          authority: "model_inferred",
        },
        "2026-08-25T01:00:00.000Z",
      );
      const independent = store.recordRule(
        {
          ...ruleDraft(scope, "今后回复风格", "回复保持简洁自然。", ["source-b"]),
          targetRuleUri: first.uri,
        },
        "2026-08-25T02:00:00.000Z",
      );

      expect(duplicateSource.uri).toBe(first.uri);
      expect(independent).toMatchObject({
        uri: first.uri,
        supportCount: 2,
        maturity: "active",
        authority: "user_explicit",
      });
      expect(independent.sourceRefs).toEqual(["source-a", "source-b"]);
      expect(store.listRules([scope])).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("canonicalizes commutative conditions but keeps different condition families separate", () => {
    const { store, scope } = createStore();
    try {
      const time = { kind: "time_at_or_after" as const, at: "2026-08-29T09:00:00+08:00" };
      const activity = {
        kind: "signal" as const,
        namespace: "activity",
        key: "exercise.completed",
        operator: "equals" as const,
        value: true,
      };
      const first = store.recordRule({
        ...ruleDraft(scope, "运动提醒", "运动后提醒查看天气。", ["source-a"]),
        condition: { kind: "all", children: [time, activity] },
        action: { kind: "notify", summary: "运动后提醒查看天气。", activation: "once" },
      });
      const reordered = store.recordRule({
        ...ruleDraft(scope, "查看天气", "运动后提醒查看天气。", ["source-b"]),
        condition: { kind: "all", children: [activity, time, activity] },
        action: { kind: "notify", summary: "运动后提醒查看天气。", activation: "once" },
      });
      const always = store.recordRule(ruleDraft(scope, "天气偏好", "运动后提醒查看天气。", ["source-c"]));

      expect(reordered.uri).toBe(first.uri);
      expect(always.uri).not.toBe(first.uri);
      expect(store.listRules([scope])).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("supersedes an explicitly replaced rule without losing the old head", () => {
    const { store, scope } = createStore();
    try {
      const previous = store.recordRule(ruleDraft(scope, "简短回复", "后续回复保持简短。", ["source-a"]));
      const replacement = store.recordRule({
        ...ruleDraft(scope, "详细回复", "后续回复提供完整细节。", ["source-b"]),
        targetRuleUri: previous.uri,
        replaceTarget: true,
      });

      expect(replacement.uri).not.toBe(previous.uri);
      expect(store.listRules([scope])).toEqual([expect.objectContaining({ uri: replacement.uri })]);
      expect(store.listLiveRules([scope])).toEqual([expect.objectContaining({ uri: replacement.uri })]);
    } finally {
      store.close();
    }
  });

  test("reconciles equivalent heads created before canonical rule identities", () => {
    const workspace = createTemporaryDirectory("senera-legacy-rule-consolidation");
    workspaces.add(workspace);
    const databasePath = path.join(workspace, ".senera", "data", "memory.sqlite");
    const scope = { kind: "workspace" as const, id: workspace };
    const initial = new AgentContinuitySqliteStore(databasePath);
    initial.recordRule(ruleDraft(scope, "简短回复", "后续回复尽量简短自然。", ["source-a"]));
    const second = initial.recordRule(ruleDraft(scope, "项目记录", "记住当前项目名称。", ["source-b"]));
    initial.close();

    const database = new Database(databasePath);
    database
      .prepare(
        "UPDATE continuity_rules SET action_json = ?, semantic_key = '', condition_key = '', effect_key = '' WHERE uri = ?",
      )
      .run(JSON.stringify({ kind: "recall", summary: "后续回复尽量简短自然。", activation: "while_true" }), second.uri);
    database.prepare("UPDATE continuity_rules SET semantic_key = '', condition_key = '', effect_key = ''").run();
    database.close();

    const reconciled = new AgentContinuitySqliteStore(databasePath);
    try {
      expect(reconciled.listRules([scope])).toHaveLength(1);
      expect(reconciled.listRules([scope])[0]).toMatchObject({ supportCount: 2, maturity: "active" });
    } finally {
      reconciled.close();
    }
  });
});

function ruleDraft(scope: { kind: "workspace"; id: string }, title: string, summary: string, sourceRefs: string[]) {
  return {
    title,
    condition: { kind: "always" as const },
    action: { kind: "recall" as const, summary, activation: "while_true" as const },
    scope,
    authority: "user_explicit" as const,
    confidence: 1,
    temporal: { kind: "persistent" as const, timeZone: "Asia/Shanghai" },
    sourceRefs,
  };
}

function createStore() {
  const workspace = createTemporaryDirectory("senera-rule-consolidation");
  workspaces.add(workspace);
  return {
    store: new AgentContinuitySqliteStore(path.join(workspace, ".senera", "data", "memory.sqlite")),
    scope: { kind: "workspace" as const, id: workspace },
  };
}
