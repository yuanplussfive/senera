import { describe, expect, test } from "vitest";
import {
  collectFreshConversationEntries,
  mergeSessionConversationEntries,
  stampSessionStepTraces,
} from "../../../Source/AgentSystem/Session/AgentSessionRunProjection.js";
import {
  deriveAgentSessionTitle,
  rowToAgentSession,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionMapper.js";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import type { AgentSession } from "../../../Source/AgentSystem/Session/AgentSession.js";
import type { SessionRow } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlRows.js";
import type { StepTrace } from "../../../Source/AgentSystem/Runtime/AgentStepTrace.js";

describe("Session projection behavior", () => {
  test("collects only fresh conversation entries and removes duplicate ids while preserving latest order", () => {
    const existing = userEntry("request-1", "old");
    const duplicateOld = userEntry("request-1", "old duplicate");
    const fresh = userEntry("request-2", "new");

    expect(collectFreshConversationEntries([existing], [duplicateOld, fresh])).toEqual([fresh]);
    expect(mergeSessionConversationEntries(createSession([existing, duplicateOld, fresh]).conversation)).toEqual([
      duplicateOld,
      fresh,
    ]);
  });

  test("stamps step traces with turn timestamps and keeps explicit trace timestamps", () => {
    const traces = [
      { step: 1, seq: 1, kind: "tool", status: "done" },
      { step: 1, seq: 2, kind: "answer", status: "done" },
      { step: 1, seq: 3, kind: "tool", status: "failed", startedAt: "explicit-start" },
    ] satisfies StepTrace[];

    expect(stampSessionStepTraces(traces, "turn-start", "turn-end")).toEqual([
      { step: 1, seq: 1, kind: "tool", status: "done", startedAt: "turn-start", endedAt: "turn-start" },
      { step: 1, seq: 2, kind: "answer", status: "done", startedAt: "turn-start", endedAt: "turn-end" },
      { step: 1, seq: 3, kind: "tool", status: "failed", startedAt: "explicit-start", endedAt: "turn-start" },
    ]);
  });

  test("derives readable session titles and resets persisted running sessions to idle", () => {
    expect(deriveAgentSessionTitle(createSession([
      userEntry("request-1", "  这是一个很长的用户请求，需要被压缩成标题  "),
    ]))).toBe("这是一个很长的用户请求，需要被压缩成标题");
    expect(deriveAgentSessionTitle(createSession([]))).toBe("新对话");

    expect(rowToAgentSession(createSessionRow({ status: "running" })).status).toBe("idle");
    expect(rowToAgentSession(createSessionRow({ metadata: "{\"source\":\"sqlite\"}" })).metadata).toEqual({
      source: "sqlite",
    });
  });
});

function createSession(conversation: AgentConversationEntry[]): AgentSession {
  return {
    id: "session-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "idle",
    conversation,
  };
}

function userEntry(requestId: string, content: string): Extract<AgentConversationEntry, { kind: "user.message" }> {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: AgentConversationEntryKinds.UserMessage,
    content,
  };
}

function createSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    title: "Session",
    status: "idle",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    active_request_id: null,
    metadata: "{}",
    ...overrides,
  };
}
