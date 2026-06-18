import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "./runSummary";

describe("summarizeRun", () => {
  it("counts steps by status and tool usage", () => {
    const run = {
      requestId: "req-1",
      revision: 0,
      startedAt: "2026-05-29T08:00:00.000Z",
      endedAt: "2026-05-29T08:00:04.250Z",
      status: "completed",
      input: "检查项目状态",
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      displayText: "",
      visibleKind: "unknown",
      expectedOutputMode: "unknown",
      decisionMode: "none",
      pendingToolArgsByName: {},
      steps: [
        {
          id: "understand",
          kind: "understand",
          title: "理解请求",
          status: "done",
          startedAt: "2026-05-29T08:00:00.000Z",
          endedAt: "2026-05-29T08:00:00.100Z",
        },
        {
          id: "tool-1",
          kind: "tool",
          title: "调用 shell",
          status: "done",
          startedAt: "2026-05-29T08:00:01.000Z",
          endedAt: "2026-05-29T08:00:02.000Z",
          toolName: "shell",
        },
        {
          id: "tool-2",
          kind: "tool",
          title: "调用 web",
          status: "failed",
          startedAt: "2026-05-29T08:00:02.000Z",
          endedAt: "2026-05-29T08:00:03.000Z",
          toolName: "web",
        },
      ],
    } satisfies RunRecord;

    expect(summarizeRun(run)).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      running: 0,
      tools: 2,
      duration: "4.3s",
      startedAt: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
    });
  });
});
