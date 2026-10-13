import { describe, expect, test } from "vitest";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import {
  AgentToolSearchQueryShapeKinds,
  projectToolSearchRetrievalQuery,
  queryShapes,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchQueryShape.js";

describe("ToolSearch tokenizer and query shapes", () => {
  test("normalizes query text into unique searchable tokens and keywords", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.tokenize("Read READ workspace 文件")).toEqual(
      expect.arrayContaining(["read", "workspace", "文件"]),
    );
    expect(new Set(tokenizer.tokenize("Read READ")).size).toBe(tokenizer.tokenize("Read READ").length);
    expect(tokenizer.keywords("读取 workspace 文件 并 总结")).toEqual(expect.arrayContaining(["workspace"]));
  });

  test("splits producer identifiers before tokenization without depending on a vocabulary", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.tokenize("artifactUri evidenceJSON")).toEqual(
      expect.arrayContaining(["artifact", "uri", "evidence", "json"]),
    );
    expect(tokenizer.matchesExactPhrase("node --version", "node version")).toBe(true);
  });

  test("requires declared identity phrases to occur contiguously in the request", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.containsDeclaredPhrase("首次运行检查", "检查当前工作区的插件协议并运行验证")).toBe(false);
    expect(tokenizer.containsDeclaredPhrase("首次运行检查", "请先执行首次运行检查")).toBe(true);
    expect(tokenizer.containsDeclaredPhrase("git", "查一下当前 git 状态")).toBe(true);
    expect(tokenizer.containsDeclaredPhrase("git", "digital workspace inspection")).toBe(false);
  });

  test("keeps quantity and classifier terms out of capability intent", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.tokenizeContent("画一张赛博朋克城市夜景图")).not.toContain("一张");
    expect(tokenizer.tokenizeContent("画一张赛博朋克城市夜景图")).toEqual(
      expect.arrayContaining(["画", "赛博", "朋克", "城市", "夜景", "图"]),
    );
  });

  test("keeps Han search fragments out of lexical-intent anchors", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.tokenize("恢复检查点")).toContain("检查");
    expect(tokenizer.tokenizeContent("恢复检查点")).not.toContain("检查");
    expect(tokenizer.isIndependentContentToken("检查")).toBe(true);
    expect(tokenizer.isIndependentContentToken("区")).toBe(false);
  });

  test("recognizes file syntax without treating decimal values as paths", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(queryShapes("读取 package.json", tokenizer)).toEqual([AgentToolSearchQueryShapeKinds.Path]);
    expect(queryShapes("将温度设为 1.2", tokenizer)).toEqual([]);
  });

  test("keeps URL values out of intent tokens without classifying them as workspace paths", () => {
    const tokenizer = new AgentToolSearchTokenizer();
    const query = "打开 https://example.com/docs 并截图";

    expect(queryShapes(query, tokenizer)).toEqual([AgentToolSearchQueryShapeKinds.Url]);
    expect(tokenizer.tokenizeContent(projectToolSearchRetrievalQuery(query))).toEqual(
      expect.arrayContaining(["打开", "截图"]),
    );
    expect(tokenizer.tokenizeContent(projectToolSearchRetrievalQuery(query))).not.toEqual(
      expect.arrayContaining(["https", "example", "com"]),
    );
  });

  test("keeps workspace path literals out of capability-intent tokens", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(queryShapes("修改 Source/AgentSystem 文件", tokenizer)).toEqual([AgentToolSearchQueryShapeKinds.Path]);
    expect(tokenizer.tokenizeContent(projectToolSearchRetrievalQuery("修改 Source/AgentSystem 文件"))).toEqual(
      expect.arrayContaining(["修改", "文件"]),
    );
    expect(tokenizer.tokenizeContent(projectToolSearchRetrievalQuery("修改 Source/AgentSystem 文件"))).not.toEqual(
      expect.arrayContaining(["source", "agentsystem"]),
    );
  });
});
