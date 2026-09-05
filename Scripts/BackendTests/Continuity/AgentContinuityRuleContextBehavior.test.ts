import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { collectAgentContinuityModelingContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityRuleContext.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity modeling context", () => {
  test("projects observed and rule-required states through stable Senera URIs", () => {
    const workspace = createTemporaryDirectory("senera-continuity-rule-context");
    workspaces.add(workspace);
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const now = "2026-08-23T09:00:00.000Z";
    try {
      store.upsertSignal({
        scope: { kind: "workspace", id: workspace },
        namespace: "semantic",
        key: "用户已完成运动",
        value: true,
        valueType: "boolean",
        authority: "user_explicit",
        confidence: 1,
        observedAt: now,
        sourceRefs: ["source-state"],
      });
      const rule = store.recordRule(
        {
          title: "运动后查看天气",
          condition: {
            kind: "all",
            children: [
              {
                kind: "signal",
                namespace: "semantic",
                key: "用户已完成运动",
                label: "用户已完成运动",
                operator: "equals",
                value: true,
              },
              {
                kind: "signal",
                namespace: "semantic",
                key: "天气适合户外活动",
                label: "天气适合户外活动",
                operator: "equals",
                value: true,
              },
            ],
          },
          action: { kind: "recall", summary: "查看天气。", activation: "while_true" },
          scope: { kind: "workspace", id: workspace },
          authority: "user_explicit",
          confidence: 1,
          temporal: { kind: "until_condition", timeZone: "Asia/Shanghai" },
          sourceRefs: ["source-rule"],
        },
        now,
      );

      const context = collectAgentContinuityModelingContext({
        store,
        identity: testContinuityIdentity(workspace),
        sessionId: "session-a",
        now: new Date(now),
      });
      const states = Object.entries(context.stateCatalog);

      expect(states).toHaveLength(2);
      expect(states.every(([uri]) => /^senera:\/\/continuity-state\/state_[a-f0-9]{24}$/u.test(uri))).toBe(true);
      expect(states).toEqual(
        expect.arrayContaining([
          [expect.any(String), expect.objectContaining({ summary: "用户已完成运动", currentValue: true })],
          [expect.any(String), expect.objectContaining({ summary: "天气适合户外活动" })],
        ]),
      );
      expect(context.ruleCatalog[rule.uri]).toMatchObject({
        title: "运动后查看天气",
        effect: "查看天气。",
      });
      expect(Object.keys(context.ruleCatalog[rule.uri]?.conditions ?? {})).toEqual(
        expect.arrayContaining(states.map(([uri]) => uri)),
      );
    } finally {
      store.close();
    }
  });
});
