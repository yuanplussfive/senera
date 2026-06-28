import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentEventChannels,
  AgentEventKinds,
  getAgentEventSpec,
} from "../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../Source/AgentSystem/Events/AgentEventBase.js";
import { AgentConversationEntryKinds } from "../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  projectAgentRunEventForHistory,
} from "../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { SqliteSessionRepository } from "../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";

const workspaceRoot = path.resolve(process.cwd());
const databasePath = path.join(workspaceRoot, ".senera", "run-event-history-verification.sqlite");
fs.rmSync(databasePath, { force: true });

const repository = new SqliteSessionRepository(databasePath);
const store = new AgentSessionStore({ repository });
const sessionId = "session-run-history";
const requestId = "request-run-history";

const opened = store.open(sessionId);
assert.equal(opened.kind, "created");
store.persistEntries(sessionId, [{
  id: `${requestId}:user`,
  requestId,
  timestamp: "2026-06-13T00:00:00.000Z",
  kind: AgentConversationEntryKinds.UserMessage,
  content: "测试执行轨迹持久化",
}]);

const persisted = [
  runEvent(AgentEventKinds.RunStarted, "2026-06-13T00:00:00.000Z", { input: "测试执行轨迹持久化" }),
  runEvent(AgentEventKinds.PromptSummary, "2026-06-13T00:00:00.100Z", {
    chars: 120,
    lines: 8,
    tokenCount: 30,
  }, 1),
  runEvent(AgentEventKinds.ModelDelta, "2026-06-13T00:00:00.150Z", {
    text: "streaming text should not persist",
  }, 1),
  runEvent(AgentEventKinds.ModelCompleted, "2026-06-13T00:00:00.300Z", {
    text: "large model output should be stripped",
  }, 1),
  runEvent(AgentEventKinds.ToolCallStarted, "2026-06-13T00:00:00.400Z", {
    index: 1,
    toolName: "WeatherTool",
    callId: "call-1",
  }, 1),
].flatMap((event) => {
  const projected = projectAgentRunEventForHistory(event);
  return projected ? [projected] : [];
});

for (const event of persisted) {
  store.persistRunEvent(sessionId, event);
}

const loaded = store.loadRunEvents(sessionId);
assert.deepEqual(loaded.map((event) => event.kind), [
  AgentEventKinds.RunStarted,
  AgentEventKinds.PromptSummary,
  AgentEventKinds.ModelCompleted,
  AgentEventKinds.ToolCallStarted,
]);
assert.equal(loaded[0]?.timestamp, "2026-06-13T00:00:00.000Z");
assert.equal((loaded[2]?.data as { text?: string } | undefined)?.text, "");
assert.equal(JSON.stringify(loaded).includes("streaming text should not persist"), false);
assert.equal(JSON.stringify(loaded).includes("large model output should be stripped"), false);

const secondRequestId = "request-run-history-2";
store.persistEntries(sessionId, [{
  id: `${secondRequestId}:user`,
  requestId: secondRequestId,
  timestamp: "2026-06-13T00:01:00.000Z",
  kind: AgentConversationEntryKinds.UserMessage,
  content: "第二轮",
}]);
const secondRunEvent = projectAgentRunEventForHistory(
  runEvent(AgentEventKinds.RunStarted, "2026-06-13T00:01:00.000Z", { input: "第二轮" }, undefined, secondRequestId),
);
assert.ok(secondRunEvent);
store.persistRunEvent(sessionId, secondRunEvent);
assert.equal(store.loadRunEvents(sessionId).some((event) => event.requestId === secondRequestId), true);

store.truncateFromRequest(sessionId, secondRequestId);
assert.equal(store.loadRunEvents(sessionId).some((event) => event.requestId === secondRequestId), false);
assert.equal(store.loadRunEvents(sessionId).some((event) => event.requestId === requestId), true);

repository.close();
fs.rmSync(databasePath, { force: true });
console.log("Run event history persistence verification passed.");

function runEvent(
  kind: AgentEventEnvelope["kind"],
  timestamp: string,
  data: unknown,
  step?: number,
  eventRequestId = requestId,
): AgentEventEnvelope {
  const spec = getAgentEventSpec(kind);
  return {
    channel: AgentEventChannels.AgentEvent,
    kind,
    layer: spec.layer,
    phase: spec.phase,
    sequence: Math.floor(Date.parse(timestamp) / 100),
    timestamp,
    sessionId,
    requestId: eventRequestId,
    step,
    data,
  };
}
