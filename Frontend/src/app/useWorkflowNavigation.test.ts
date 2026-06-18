import { describe, expect, it } from "vitest";
import {
  findMessageWorkflowRun,
} from "./useWorkflowNavigation";
import type { ChatMessage, SessionRecord } from "../store/sessionStore";

function message(requestId?: string): Pick<ChatMessage, "requestId"> {
  return { requestId };
}

function session(sessionId: string, runIds: string[]): SessionRecord {
  return {
    sessionId,
    title: sessionId,
    status: "ready",
    createdAt: "",
    updatedAt: "",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: runIds.map((requestId) => ({
      requestId,
      revision: 1,
      startedAt: "",
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
    })),
  };
}

describe("findMessageWorkflowRun", () => {
  it("finds the run for a message in the active session", () => {
    expect(findMessageWorkflowRun({
      activeSessionId: "session-a",
      message: message("run-b"),
      sessions: {
        "session-a": session("session-a", ["run-a", "run-b"]),
      },
    })).toEqual({ kind: "found", requestId: "run-b", sessionId: "session-a" });
  });

  it("reports missing message request data before reading sessions", () => {
    expect(findMessageWorkflowRun({
      activeSessionId: "session-a",
      message: message(),
      sessions: {
        "session-a": session("session-a", ["run-a"]),
      },
    })).toEqual({ kind: "missing_message_request" });
    expect(findMessageWorkflowRun({
      activeSessionId: null,
      message: message("run-a"),
      sessions: {
        "session-a": session("session-a", ["run-a"]),
      },
    })).toEqual({ kind: "missing_message_request" });
  });

  it("reports when the message run is not available in the current session", () => {
    expect(findMessageWorkflowRun({
      activeSessionId: "session-a",
      message: message("run-missing"),
      sessions: {
        "session-a": session("session-a", ["run-a"]),
      },
    })).toEqual({ kind: "run_not_found" });
  });
});
