import { describe, expect, it } from "vitest";
import { parseEmptySuggestions } from "./emptySuggestions";

describe("parseEmptySuggestions", () => {
  it("uses pipe-delimited env suggestions and removes blank entries", () => {
    expect(parseEmptySuggestions("  规划本周任务 | | 总结这段日志 | 写一个发布说明  ")).toEqual([
      "规划本周任务",
      "总结这段日志",
      "写一个发布说明",
    ]);
  });

  it("falls back to product-ready defaults when env is empty", () => {
    expect(parseEmptySuggestions("   ")).toEqual([
      "整理今天的工作优先级",
      "分析一段错误日志",
      "把需求拆成可执行步骤",
    ]);
  });
});
