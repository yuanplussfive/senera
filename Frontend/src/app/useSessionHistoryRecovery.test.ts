import { describe, expect, it } from "vitest";
import {
  readRecoveryPollingKey,
  shouldRequestActiveSessionHistory,
} from "./useSessionHistoryRecovery";
import type { SessionRecord } from "../store/sessionStore";

function session(
  sessionId: string,
  runs: SessionRecord["runs"],
): SessionRecord {
  return {
    sessionId,
    title: sessionId,
    status: "ready",
    createdAt: "",
    updatedAt: "",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs,
  };
}

describe("readRecoveryPollingKey", () => {
  it("includes only running history recovery runs with loading state", () => {
    const key = readRecoveryPollingKey({
      historyLoadingIds: { "session-a": true },
      sessions: {
        "session-a": session("session-a", [
          {
            requestId: "run-a",
            revision: 3,
            startedAt: "",
            status: "running",
            input: "",
            steps: [],
            streamingRaw: "",
            xmlPreview: "",
            visibleText: "",
            visibleKind: "unknown",
            expectedOutputMode: "unknown",
            decisionMode: "none",
            pendingToolArgsByName: {},
            recoverySource: "history",
          },
          {
            requestId: "run-local",
            revision: 2,
            startedAt: "",
            status: "running",
            input: "",
            steps: [],
            streamingRaw: "",
            xmlPreview: "",
            visibleText: "",
            visibleKind: "unknown",
            expectedOutputMode: "unknown",
            decisionMode: "none",
            pendingToolArgsByName: {},
          },
        ]),
        "session-b": session("session-b", [
          {
            requestId: "run-b",
            revision: 1,
            startedAt: "",
            status: "completed",
            input: "",
            steps: [],
            streamingRaw: "",
            xmlPreview: "",
            visibleText: "",
            visibleKind: "unknown",
            expectedOutputMode: "unknown",
            decisionMode: "none",
            pendingToolArgsByName: {},
            recoverySource: "history",
          },
        ]),
      },
    });

    expect(key).toBe(["session-a", "run-a", "3", "loading"].join("\u0001"));
  });

  it("sorts entries so equivalent recovery state has a stable key", () => {
    const run = (requestId: string): SessionRecord["runs"][number] => ({
      requestId,
      revision: 1,
      startedAt: "",
      status: "running",
      input: "",
      steps: [],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      visibleKind: "unknown",
      expectedOutputMode: "unknown",
      decisionMode: "none",
      pendingToolArgsByName: {},
      recoverySource: "history",
    });

    const key = readRecoveryPollingKey({
      historyLoadingIds: {},
      sessions: {
        "session-b": session("session-b", [run("run-b")]),
        "session-a": session("session-a", [run("run-a")]),
      },
    });

    expect(key).toBe([
      ["session-a", "run-a", "1", "idle"].join("\u0001"),
      ["session-b", "run-b", "1", "idle"].join("\u0001"),
    ].join("\u0000"));
  });
});

describe("shouldRequestActiveSessionHistory", () => {
  it("requests history only for an open, unloaded, idle active session that exists on the server", () => {
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: "session-a",
      historyLoadedIds: {},
      historyLoadingIds: {},
      missingOnServerIds: {},
      status: "open",
    })).toBe(true);
  });

  it("skips sessions that are unavailable, missing, loaded, loading, or disconnected", () => {
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: null,
      historyLoadedIds: {},
      historyLoadingIds: {},
      missingOnServerIds: {},
      status: "open",
    })).toBe(false);
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: "session-a",
      historyLoadedIds: {},
      historyLoadingIds: {},
      missingOnServerIds: { "session-a": true },
      status: "open",
    })).toBe(false);
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: "session-a",
      historyLoadedIds: { "session-a": true },
      historyLoadingIds: {},
      missingOnServerIds: {},
      status: "open",
    })).toBe(false);
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: "session-a",
      historyLoadedIds: {},
      historyLoadingIds: { "session-a": true },
      missingOnServerIds: {},
      status: "open",
    })).toBe(false);
    expect(shouldRequestActiveSessionHistory({
      activeSessionId: "session-a",
      historyLoadedIds: {},
      historyLoadingIds: {},
      missingOnServerIds: {},
      status: "closed",
    })).toBe(false);
  });
});
