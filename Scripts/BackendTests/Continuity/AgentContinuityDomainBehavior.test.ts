import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { evaluateAgentContinuityRule } from "../../../Source/AgentSystem/Continuity/AgentContinuityConditionEvaluator.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import {
  attachAgentContinuityWatermark,
  readAgentContinuityWatermarks,
  stripAgentContinuityWatermarks,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityWatermark.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity domain", () => {
  test("keeps invisible source anchors reversible without changing visible text", () => {
    const visible = "下周六运动后提醒我查看天气。";
    const tagged = attachAgentContinuityWatermark(visible, "observation-42");

    expect(tagged).not.toBe(visible);
    expect(stripAgentContinuityWatermarks(tagged)).toBe(visible);
    expect(readAgentContinuityWatermarks(tagged)).toEqual(["observation-42"]);
  });

  test("evaluates compound conditions with three-valued signal logic", () => {
    const rule = {
      id: "rule-1",
      uri: "senera://continuity-rule/rule-1",
      title: "提醒天气",
      condition: {
        kind: "all" as const,
        children: [
          { kind: "time_at_or_after" as const, at: "2026-08-29T09:00:00+08:00" },
          {
            kind: "signal" as const,
            namespace: "activity",
            key: "exercise.completed",
            operator: "equals" as const,
            value: true,
          },
        ],
      },
      action: { kind: "notify" as const, summary: "提醒用户在运动后查看天气。", activation: "once" as const },
      scope: { kind: "workspace" as const, id: "workspace" },
      authority: "user_explicit" as const,
      confidence: 1,
      temporal: { kind: "persistent" as const, timeZone: "Asia/Shanghai" },
      sourceRefs: ["senera://memory-source/source"],
      status: "armed" as const,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const now = new Date("2026-08-29T01:30:00.000Z");

    expect(evaluateAgentContinuityRule(rule, [], now)).toMatchObject({
      truth: "unknown",
      status: "partial",
      score: 0,
      threshold: 1,
      missingSignals: ["activity.exercise.completed"],
      conditions: [
        { label: "time >= 2026-08-29T09:00:00+08:00", truth: "true", score: 1 },
        { label: "activity.exercise.completed = true", truth: "unknown", score: 0 },
      ],
    });
    expect(
      evaluateAgentContinuityRule(
        rule,
        [
          {
            scope: rule.scope,
            namespace: "activity",
            key: "exercise.completed",
            value: true,
            valueType: "boolean",
            authority: "user_explicit",
            confidence: 1,
            observedAt: now.toISOString(),
            sourceRefs: rule.sourceRefs,
          },
        ],
        now,
      ),
    ).toMatchObject({ truth: "true", status: "triggered", score: 1, threshold: 1, missingSignals: [] });
  });

  test("deduplicates equivalent rules and consumes one-shot delivery only after acknowledgement", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, ".senera", "data", "memory.sqlite"));
    try {
      const draft = {
        title: "检查余额",
        condition: { kind: "time_at_or_after" as const, at: "2026-08-23T09:00:00+08:00" },
        action: { kind: "notify" as const, summary: "提醒用户充值。", activation: "once" as const },
        scope: { kind: "workspace" as const, id: workspace },
        authority: "user_explicit" as const,
        confidence: 1,
        temporal: { kind: "persistent" as const, timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/source"],
      };
      const first = store.recordRule(draft, "2026-08-22T00:00:00.000Z");
      const duplicate = store.recordRule(draft, "2026-08-22T01:00:00.000Z");

      expect(duplicate.uri).toBe(first.uri);
      expect(store.listLiveRules([draft.scope])).toHaveLength(1);
      const triggered = store.updateRuleEvaluation(first, "triggered", "2026-08-23T01:00:00.000Z");
      const stillTriggered = store.updateRuleEvaluation(triggered, "triggered", "2026-08-23T02:00:00.000Z");
      expect(stillTriggered.lastTriggeredAt).toBeUndefined();
      expect(store.acknowledgeRuleDeliveries([first.uri], "2026-08-23T03:00:00.000Z")).toBe(1);
      expect(store.acknowledgeRuleDeliveries([first.uri], "2026-08-23T04:00:00.000Z")).toBe(0);
      expect(store.listRules([draft.scope])[0]).toMatchObject({
        status: "resolved",
        lastTriggeredAt: "2026-08-23T03:00:00.000Z",
      });

      const recurring = store.recordRule(
        {
          ...draft,
          title: "持续余额上下文",
          action: { kind: "recall", summary: "保留余额上下文。", activation: "while_true" },
        },
        "2026-08-23T05:00:00.000Z",
      );
      store.updateRuleEvaluation(recurring, "triggered", "2026-08-23T05:01:00.000Z");
      expect(store.acknowledgeRuleDeliveries([recurring.uri], "2026-08-23T05:02:00.000Z")).toBe(0);
      expect(store.listRules([draft.scope]).find((rule) => rule.uri === recurring.uri)).toMatchObject({
        status: "triggered",
      });
    } finally {
      store.close();
    }
  });

  test("keeps weighted satisfaction unknown while missing signals can still cross the threshold", () => {
    const rule = {
      id: "rule-score",
      uri: "senera://continuity-rule/rule-score",
      title: "条件概率提醒",
      condition: {
        kind: "score" as const,
        threshold: 0.5,
        children: [
          {
            kind: "signal" as const,
            namespace: "activity",
            key: "exercise.completed",
            operator: "equals" as const,
            value: true,
          },
          {
            kind: "signal" as const,
            namespace: "environment",
            key: "weather.raining",
            operator: "equals" as const,
            value: true,
          },
          {
            kind: "signal" as const,
            namespace: "task",
            key: "reminder.enabled",
            operator: "equals" as const,
            value: true,
          },
        ],
      },
      action: { kind: "recall" as const, summary: "携带天气提醒上下文。", activation: "while_true" as const },
      scope: { kind: "workspace" as const, id: "workspace" },
      authority: "user_explicit" as const,
      confidence: 1,
      temporal: { kind: "persistent" as const, timeZone: "Asia/Shanghai" },
      sourceRefs: ["senera://memory-source/source"],
      status: "armed" as const,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };
    const signal = (namespace: string, key: string, value: boolean) => ({
      scope: rule.scope,
      namespace,
      key,
      value,
      valueType: "boolean" as const,
      authority: "user_explicit" as const,
      confidence: 1,
      observedAt: "2026-08-23T00:00:00.000Z",
      sourceRefs: rule.sourceRefs,
    });

    expect(
      evaluateAgentContinuityRule(
        rule,
        [signal("activity", "exercise.completed", true), signal("environment", "weather.raining", false)],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    ).toMatchObject({ truth: "unknown", status: "partial", score: 1 / 3, threshold: 0.5 });
    expect(
      evaluateAgentContinuityRule(
        rule,
        [
          signal("activity", "exercise.completed", true),
          signal("environment", "weather.raining", false),
          signal("task", "reminder.enabled", true),
        ],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    ).toMatchObject({ truth: "true", status: "triggered", score: 2 / 3, threshold: 0.5 });
  });

  test("prefers an exact session signal over a workspace signal with the same identity", () => {
    const rule = {
      id: "rule-session-scope",
      uri: "senera://continuity-rule/rule-session-scope",
      title: "会话状态",
      condition: {
        kind: "signal" as const,
        namespace: "activity",
        key: "exercise.completed",
        operator: "equals" as const,
        value: true,
      },
      action: { kind: "notify" as const, summary: "提醒。", activation: "once" as const },
      scope: { kind: "session" as const, id: "session-1" },
      authority: "user_explicit" as const,
      confidence: 1,
      temporal: { kind: "persistent" as const, timeZone: "Asia/Shanghai" },
      sourceRefs: ["senera://memory-source/scope"],
      status: "armed" as const,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };
    const signal = (scope: typeof rule.scope | { kind: "workspace"; id: string }, value: boolean) => ({
      scope,
      namespace: "activity",
      key: "exercise.completed",
      value,
      valueType: "boolean" as const,
      authority: "user_explicit" as const,
      confidence: 1,
      observedAt: "2026-08-23T00:00:00.000Z",
      sourceRefs: rule.sourceRefs,
    });

    expect(
      evaluateAgentContinuityRule(
        rule,
        [signal({ kind: "workspace", id: "workspace" }, true), signal(rule.scope, false)],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    ).toMatchObject({ truth: "false", status: "armed" });
    expect(
      evaluateAgentContinuityRule(
        rule,
        [signal({ kind: "workspace", id: "workspace" }, true)],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    ).toMatchObject({ truth: "true", status: "triggered" });
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-domain");
  workspaces.add(workspace);
  return workspace;
}
