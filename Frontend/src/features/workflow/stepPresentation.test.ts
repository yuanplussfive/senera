import { describe, expect, it } from "vitest";
import {
  readRunStatusLabel,
  readStepAccent,
  readStepKindLabel,
  readStepStatusLabel,
  readStepStatusTone,
} from "./stepPresentation";

describe("stepPresentation", () => {
  it("maps workflow step kinds and statuses to display labels", () => {
    expect(readStepKindLabel("tool")).toBe("工具");
    expect(readStepKindLabel("answer")).toBe("回复");
    expect(readStepStatusLabel("pending")).toBe("等待");
    expect(readStepStatusLabel("running")).toBe("进行中");
    expect(readStepStatusLabel("done")).toBe("已完成");
    expect(readStepStatusLabel("failed")).toBe("失败");
  });

  it("maps run statuses to summary labels", () => {
    expect(readRunStatusLabel("running")).toBe("进行中");
    expect(readRunStatusLabel("completed")).toBe("已完成");
    expect(readRunStatusLabel("failed")).toBe("失败");
    expect(readRunStatusLabel("cancelled")).toBe("已取消");
  });

  it("keeps status tone and accent decisions consistent", () => {
    expect(readStepStatusTone("pending")).toBe("default");
    expect(readStepStatusTone("running")).toBe("live");
    expect(readStepStatusTone("done")).toBe("ok");
    expect(readStepStatusTone("failed")).toBe("warn");

    expect(readStepAccent({ kind: "tool", status: "running" })).toMatchObject({
      border: "border-umber-200/60",
      iconBg: "bg-umber-50",
      iconFg: "text-umber-500",
    });
    expect(readStepAccent({ kind: "error", status: "done" })).toMatchObject({
      border: "border-brick-100",
      iconBg: "bg-brick-50",
      iconFg: "text-brick-500",
    });
    expect(readStepAccent({ kind: "answer", status: "done" })).toMatchObject({
      border: "border-moss-100",
      iconBg: "bg-moss-500",
      iconFg: "text-paper-50",
    });
  });
});
