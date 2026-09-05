import { describe, expect, test } from "vitest";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";

describe("POS-driven content tokenization", () => {
  const tokenizer = new AgentToolSearchTokenizer();
  const similarity = new AgentContinuityTextSimilarity();

  test("drops function words without dropping negation", () => {
    const tokens = similarity.terms("用户不喜欢喝加糖的咖啡吗");
    expect(tokens).toContain("不");
    expect(tokens).toContain("喜欢");
    expect(tokens).toContain("咖啡");
    expect(tokens).not.toContain("的");
    expect(tokens).not.toContain("吗");
  });

  test("keeps pronouns out but content words in for English", () => {
    const tokens = similarity.terms("the router password is on the label");
    expect(tokens.some((token) => token === "router")).toBe(true);
    expect(tokens.some((token) => token === "password")).toBe(true);
    expect(tokens.some((token) => token === "label")).toBe(true);
  });

  test("negation survives so opposite facts stay distinct", () => {
    const opposite = similarity.compare("用户不喜欢咖啡", "用户喜欢咖啡");
    const reverseOpposite = similarity.compare("用户喜欢咖啡", "用户不喜欢咖啡");
    const aligned = similarity.compare("用户喜欢咖啡", "用户喜欢咖啡");
    expect(opposite.score).toBeLessThan(aligned.score);
    expect(reverseOpposite.score).toBeLessThan(aligned.score);
    expect(reverseOpposite.structuralMismatch).toBeGreaterThan(0);
    expect(aligned.score).toBe(1);
  });

  test("preserves compound labels while stripping an actual subject clause", () => {
    expect(tokenizer.stripLeadingSubject("世界树")).toBe("世界树");
    expect(tokenizer.stripLeadingSubject("咖啡偏好")).toBe("咖啡偏好");
    expect(tokenizer.stripLeadingSubject("用户住在上海")).toBe("住在上海");
  });

  test("keeps ordinary single-character predicates from suppressing broad recall", () => {
    const coffee = similarity.compare("我想喝咖啡", "用户喜欢无糖咖啡");
    const residence = similarity.compare("他住在哪里", "用户住在上海");

    expect(coffee.score).toBeGreaterThan(0);
    expect(residence.score).toBeGreaterThan(0);
  });

  test("tokenize keeps legacy behavior for tool search while tokenizeContent filters", () => {
    const raw = tokenizer.tokenize("好的，我们继续吧");
    const content = tokenizer.tokenizeContent("好的，我们继续吧");
    expect(raw.length).toBeGreaterThanOrEqual(content.length);
    expect(content.some((token) => token === "继续")).toBe(true);
    expect(content).not.toContain("我们");
    expect(content).not.toContain("吧");
  });

  test("strips a leading subject only when a predicate follows", () => {
    expect(tokenizer.stripLeadingSubject("用户住在上海。")).toBe("住在上海。");
    expect(tokenizer.stripLeadingSubject("咖啡")).toBe("咖啡");
    expect(tokenizer.stripLeadingSubject("上海浦东新区")).toBe("上海浦东新区");
  });

  test("claim-body comparison ignores the conversational subject", () => {
    const same = similarity.compareClaimBodies("用户住在上海。", "居住地点: 上海");
    const different = similarity.compareClaimBodies("用户去上海出差。", "居住地点: 上海");
    expect(same.fuzzy).toBeGreaterThanOrEqual(0.9);
    expect(different.fuzzy).toBeLessThan(0.9);
  });
});
