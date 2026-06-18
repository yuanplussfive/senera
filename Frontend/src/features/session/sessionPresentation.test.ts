import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../store/sessionStore";
import { formatSessionSubtitle } from "./sessionPresentation";

function createSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "session-1",
    title: "Test session",
    status: "ready",
    createdAt: "2026-06-09T07:00:00.000Z",
    updatedAt: "2026-06-09T07:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [],
    ...overrides,
  };
}

describe("formatSessionSubtitle", () => {
  it("prioritizes running and failed run states", () => {
    expect(formatSessionSubtitle(createSession({
      messageCount: 2,
      runs: [{
        requestId: "run-1",
        revision: 0,
        startedAt: "2026-06-09T07:00:00.000Z",
        status: "running",
        input: "",
        steps: [],
        streamingRaw: "",
        xmlPreview: "",
        visibleText: "",
        displayText: "",
        visibleKind: "unknown",
        expectedOutputMode: "unknown",
        decisionMode: "none",
        pendingToolArgsByName: {},
      }],
    }), false)).toBe("正在思考…");

    expect(formatSessionSubtitle(createSession({
      messageCount: 2,
      runs: [{
        requestId: "run-2",
        revision: 0,
        startedAt: "2026-06-09T07:00:00.000Z",
        endedAt: "2026-06-09T07:00:01.000Z",
        status: "failed",
        input: "",
        steps: [],
        streamingRaw: "",
        xmlPreview: "",
        visibleText: "",
        displayText: "",
        visibleKind: "unknown",
        expectedOutputMode: "unknown",
        decisionMode: "none",
        pendingToolArgsByName: {},
      }],
    }), false)).toBe("上次运行失败");
  });

  it("formats message counts with duration, loading, and empty states", () => {
    expect(formatSessionSubtitle(createSession({
      messageCount: 3,
      runs: [{
        requestId: "run-3",
        revision: 0,
        startedAt: "2026-06-09T07:00:00.000Z",
        endedAt: "2026-06-09T07:00:02.500Z",
        status: "completed",
        input: "",
        steps: [],
        streamingRaw: "",
        xmlPreview: "",
        visibleText: "",
        displayText: "",
        visibleKind: "unknown",
        expectedOutputMode: "unknown",
        decisionMode: "none",
        pendingToolArgsByName: {},
      }],
    }), false)).toBe("3 条消息 · 2.5s");

    expect(formatSessionSubtitle(createSession({ messageCount: 3 }), true)).toBe("3 条消息 · 同步中");
    expect(formatSessionSubtitle(createSession(), true)).toBe("同步中");
    expect(formatSessionSubtitle(createSession(), false)).toBe("尚无消息");
  });
});
