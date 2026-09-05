import { describe, expect, test } from "vitest";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";
import {
  createAgentContinuityFactIdentity,
  isAgentContinuityEquivalentClaim,
  resolveAgentContinuityFactIdentity,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityFactIdentity.js";

describe("continuity fact identity", () => {
  test("reuses the existing identity for a conservative paraphrase", () => {
    const existing = createAgentContinuityFactIdentity("用户住在上海。");
    const resolved = resolveAgentContinuityFactIdentity(
      "用户居住在上海。",
      { kind: "user", id: "workspace" },
      [
        {
          factKey: existing.factKey,
          claim: "用户住在上海。",
          scope: { kind: "user", id: "workspace" },
        },
      ],
      new AgentContinuityTextSimilarity(),
      0.9,
    );

    expect(resolved.factKey).toBe(existing.factKey);
  });

  test("does not merge a similar sentence from another scope", () => {
    const existing = createAgentContinuityFactIdentity("用户住在上海。");
    const resolved = resolveAgentContinuityFactIdentity(
      "用户居住在上海。",
      { kind: "session", id: "session-2" },
      [
        {
          factKey: existing.factKey,
          claim: "用户住在上海。",
          scope: { kind: "user", id: "workspace" },
        },
      ],
      new AgentContinuityTextSimilarity(),
      0.9,
    );

    expect(resolved.factKey).not.toBe(existing.factKey);
  });

  test("does not merge a different claim that shares an entity", () => {
    const existing = createAgentContinuityFactIdentity("用户住在上海。");
    const resolved = resolveAgentContinuityFactIdentity(
      "用户在上海工作。",
      { kind: "user", id: "workspace" },
      [
        {
          factKey: existing.factKey,
          claim: "用户住在上海。",
          scope: { kind: "user", id: "workspace" },
        },
      ],
      new AgentContinuityTextSimilarity(),
      0.9,
    );

    expect(resolved.factKey).not.toBe(existing.factKey);
  });

  test.each(["用户不住在上海。", "用户没有喜欢咖啡。"])(
    "does not treat a polarity-changing claim as a paraphrase: %s",
    (incoming) => {
      const existing = createAgentContinuityFactIdentity("用户住在上海。");
      const resolved = resolveAgentContinuityFactIdentity(
        incoming,
        { kind: "user", id: "workspace" },
        [
          {
            factKey: existing.factKey,
            claim: "用户住在上海。",
            scope: { kind: "user", id: "workspace" },
          },
        ],
        new AgentContinuityTextSimilarity(),
        0.9,
      );

      expect(resolved.factKey).not.toBe(existing.factKey);
    },
  );

  test("ignores an omitted conversational subject but preserves explicit subject identity", () => {
    const existing = createAgentContinuityFactIdentity("用户住在上海。");
    const omitted = resolveAgentContinuityFactIdentity(
      "住在上海。",
      { kind: "user", id: "workspace" },
      [{ factKey: existing.factKey, claim: "用户住在上海。", scope: { kind: "user", id: "workspace" } }],
      new AgentContinuityTextSimilarity(),
      0.9,
    );
    const otherSubject = resolveAgentContinuityFactIdentity(
      "李四住在上海。",
      { kind: "user", id: "workspace" },
      [{ factKey: existing.factKey, claim: "用户住在上海。", scope: { kind: "user", id: "workspace" } }],
      new AgentContinuityTextSimilarity(),
      0.9,
    );

    expect(omitted.factKey).toBe(existing.factKey);
    expect(otherSubject.factKey).not.toBe(existing.factKey);
  });

  test.each([
    ["张三住在上海。", "李四住在上海。"],
    ["John lives in Shanghai.", "Alice lives in Shanghai."],
    ["李四住在上海。", "张三在上海居住。"],
  ])("does not merge distinct entities when segmentation is asymmetric: %s / %s", (left, right) => {
    const similarity = new AgentContinuityTextSimilarity();
    expect(isAgentContinuityEquivalentClaim(similarity, left, right, 0.9)).toBe(false);
  });

  test("still merges an omitted subject and a same-subject paraphrase", () => {
    const similarity = new AgentContinuityTextSimilarity();
    expect(isAgentContinuityEquivalentClaim(similarity, "张三住在上海。", "住在上海。", 0.9)).toBe(true);
    expect(isAgentContinuityEquivalentClaim(similarity, "用户住在上海。", "用户在上海居住。", 0.9)).toBe(true);
  });

  test.each([
    ["用户从上海搬到北京。", "用户从北京搬到上海。"],
    ["用户把 A 发给 B。", "用户把 B 发给 A。"],
    ["用户喜欢咖啡而不是茶。", "用户喜欢茶而不是咖啡。"],
    ["用户喜欢咖啡而不是张三。", "用户喜欢张三而不是咖啡。"],
    ["用户有 3 只猫。", "用户有 4 只猫。"],
    ["项目截止日期是 2026-09-01。", "项目截止日期是 2026-09-02。"],
  ])("keeps ordered arguments and quantities distinct: %s / %s", (left, right) => {
    const similarity = new AgentContinuityTextSimilarity();
    expect(isAgentContinuityEquivalentClaim(similarity, left, right, 0.9)).toBe(false);
  });
});
