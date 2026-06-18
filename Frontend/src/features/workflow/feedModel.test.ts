import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../store/sessionStore";
import {
  deriveFeedModel,
  statusDotClass,
  statusLabel,
  statusTextClass,
} from "./feedModel";

function buildRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    requestId: "req-1",
    revision: 0,
    startedAt: "2026-06-08T00:00:00.000Z",
    status: "running",
    input: "inspect workflow",
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
    steps: [],
    ...overrides,
  };
}

describe("deriveFeedModel", () => {
  it("summarizes tool calls, trace items, placeholder, and footer", () => {
    const model = deriveFeedModel(
      buildRun({
        visibleKind: "tool_calls",
        steps: [
          {
            id: "understand",
            kind: "understand",
            title: "理解请求",
            status: "done",
            startedAt: "2026-06-08T00:00:00.000Z",
            description: "分析输入",
          },
          {
            id: "decision",
            kind: "decision",
            title: "选择工具",
            status: "done",
            startedAt: "2026-06-08T00:00:01.000Z",
            decisionKind: "use_tools",
            detailJson: {
              tool_calls: [{ name: "shell" }, { name: "web" }],
            },
          },
          {
            id: "tool",
            kind: "tool",
            title: "调用 shell",
            status: "running",
            startedAt: "2026-06-08T00:00:02.000Z",
            toolName: "shell",
            callId: "call-1234567890abcdef",
            toolArgs: { command: "npm run check" },
          },
        ],
      }),
    );

    expect(model.headline).toMatchObject({
      id: "tool",
      kind: "tool",
      status: "running",
      title: "调用 shell",
      meta: "call call-1234567",
    });
    expect(model.groups).toHaveLength(2);
    expect(model.groups[0]).toMatchObject({
      id: "tools",
      label: "1 个工具调用",
      meta: "0/1",
      defaultExpanded: true,
    });
    expect(model.groups[1]).toMatchObject({
      id: "trace",
      label: "执行轨迹",
    });
    expect(model.placeholder).toBe("正在执行 shell");
    expect(model.footer).toBe("call call-1234567");
  });

  it("uses visible answer state for final response placeholder", () => {
    const model = deriveFeedModel(
      buildRun({
        visibleKind: "final_answer",
        steps: [
          {
            id: "decision",
            kind: "decision",
            title: "准备回复",
            status: "done",
            startedAt: "2026-06-08T00:00:00.000Z",
            decisionKind: "answer",
          },
        ],
      }),
    );

    expect(model.headline).toMatchObject({
      id: "decision",
      kind: "trace",
      status: "running",
      title: "生成回复",
    });
    expect(model.placeholder).toBe("正在生成回复");
  });

  it("uses display text as the rendered body while visible text remains the target", () => {
    const model = deriveFeedModel(
      buildRun({
        visibleKind: "final_answer",
        visibleText: "完整回复",
        displayText: "完整",
      }),
    );

    expect(model.bodyText).toBe("完整");
  });
});

describe("workflow feed status helpers", () => {
  it("keeps status labels and classes stable", () => {
    expect(statusLabel("running")).toBe("进行中");
    expect(statusLabel("failed")).toBe("失败");
    expect(statusLabel("done")).toBe("完成");
    expect(statusLabel("neutral")).toBeUndefined();

    expect(statusDotClass("running")).toContain("bg-umber-500");
    expect(statusDotClass("failed")).toBe("bg-brick-500");
    expect(statusDotClass("done")).toBe("bg-moss-500");
    expect(statusDotClass("neutral")).toBe("bg-ink-300");

    expect(statusTextClass("running")).toBe("text-umber-600");
    expect(statusTextClass("failed")).toBe("text-brick-500");
    expect(statusTextClass("done")).toBe("text-moss-600");
    expect(statusTextClass("neutral")).toBe("text-ink-400");
  });
});
