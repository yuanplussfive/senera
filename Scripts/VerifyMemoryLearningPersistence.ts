import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { TurnContextMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const workspaceRoot = process.cwd();
const databasePath = resolveAgentMemoryDatabasePath(
  workspaceRoot,
  ".senera/test-memory-learning/Memory.sqlite",
);
const databaseDir = path.dirname(databasePath);

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

const repository = new SqliteAgentMemorySourceRepository(databasePath);
const projector = new AgentConversationProjector();
const sessionId = "session_memory_learning";
const requestId = "req_memory_learning_1";
const startedAt = "2026-06-24T01:00:00.000Z";
const completedAt = "2026-06-24T01:00:03.000Z";
const userEntry = projector.projectUserInput(
  requestId,
  "以后不要硬编码，要从源头解决。",
  startedAt,
);
const assistantEntry = projector.projectAssistantDecision(
  requestId,
  "<final>收到，后续按这个偏好处理。</final>",
  completedAt,
);

const recordedTurn = repository.recordCompletedTurn({
  sessionId,
  requestId,
  startedAt,
  completedAt,
  userEntry,
  assistantEntry,
  terminal: {
    kind: "FinalAnswer",
    content: "收到，后续按这个偏好处理。",
  },
  turnUnderstanding: {
    rawUserTurn: userEntry.content,
    standaloneRequest: "用户要求后续实现避免硬编码，并从源头解决问题。",
    contextMode: TurnContextMode.None,
    contextBasis: "",
    missingContext: "",
  },
  conversationEntries: [assistantEntry],
});

const userSource = recordedTurn.sources.find((source) => source.sourceKind === "user_message");
const assistantSource = recordedTurn.sources.find((source) => source.sourceKind === "assistant_final");
assert.ok(userSource);
assert.ok(assistantSource);

const candidates = repository.recordMemoryCandidates({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:04.000Z",
  candidates: [
    {
      type: "preference",
      subject: "assistant_work_style",
      claim: "用户偏好从源头解决问题，避免硬编码。",
      howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
      tags: ["工作方式", "代码质量"],
      triggers: ["不要硬编码", "从源头解决"],
      sourceRefs: [userSource.uri],
      reason: "用户明确提出长期工作偏好。",
      confidence: 0.92,
      embedding: [1, 0, 0],
    },
    {
      type: "preference",
      subject: "assistant_work_style",
      claim: "用户偏好避免粗糙兜底。",
      howToApply: "实现时优先复用 schema、统一 runner、成熟库和已有框架能力。",
      tags: ["工作方式"],
      triggers: ["不要兜底"],
      sourceRefs: [assistantSource.uri],
      reason: "助手确认该工作偏好，并补充适用方式。",
      confidence: 0.9,
      embedding: [0.98, 0.02, 0],
    },
  ],
});
assert.equal(candidates.length, 2);
assert.equal(candidates[0]?.status, "pending");
assert.deepEqual(candidates[0]?.embedding, [1, 0, 0]);
assert.equal(repository.listPendingMemoryCandidates(sessionId, "preference").length, 2);

let written = repository.applyMemoryLearning({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:05.000Z",
  actions: [{
    operation: "create",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议、统一模块和成熟库，而不是堆局部规则。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决"],
    sourceRefs: [userSource.uri],
    candidateUris: [candidates[0]?.uri ?? ""],
    reason: "用户明确提出长期工作偏好。",
    confidence: 0.92,
  }],
});
assert.equal(written.length, 1);
assert.equal(written[0]?.type, "preference");
assert.equal(written[0]?.status, "active");
assert.equal(written[0]?.localDate, "2026-06-24");
assert.equal(written[0]?.localHour, "2026-06-24T09");
assert.equal(repository.listPendingMemoryCandidates(sessionId, "preference").length, 1);

let active = repository.listActiveMemoryItems();
assert.equal(active.length, 1);
assert.equal(active[0]?.sourceRefs[0], userSource.uri);
assert.equal(repository.listMemoryObservations(active[0]?.uri ?? "").length, 1);

const reinforceCandidate = repository.recordMemoryCandidates({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:05.500Z",
  candidates: [{
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好不要硬编码，要从源头解决问题。",
    howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决"],
    sourceRefs: [userSource.uri],
    reason: "用户再次表达同一长期偏好。",
    confidence: 0.93,
    embedding: [1, 0, 0],
  }],
});

written = repository.applyMemoryLearning({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:05.750Z",
  actions: [{
    operation: "reinforce",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决"],
    sourceRefs: [userSource.uri],
    candidateUris: [reinforceCandidate[0]?.uri ?? ""],
    targetMemoryUri: active[0]?.uri,
    reason: "同一偏好被再次确认。",
    confidence: 0.93,
  }],
});
assert.equal(written.length, 1);
assert.equal(written[0]?.uri, active[0]?.uri);
assert.equal(repository.listActiveMemoryItems().length, 1);
assert.equal(repository.listPendingMemoryCandidates(sessionId, "preference").length, 1);
assert.equal(repository.listMemoryObservations(active[0]?.uri ?? "").length, 2);

written = repository.applyMemoryLearning({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:06.000Z",
  actions: [{
    operation: "update",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码和粗糙兜底。",
    howToApply: "实现时优先复用 schema、统一 runner、成熟库和已有框架能力。",
    tags: ["工作方式"],
    triggers: ["不要硬编码", "不要兜底"],
    sourceRefs: [assistantSource.uri],
    candidateUris: [candidates[1]?.uri ?? ""],
    targetMemoryUri: active[0]?.uri,
    reason: "助手确认该工作偏好，并补充适用方式。",
    confidence: 0.94,
  }],
});
assert.equal(written.length, 1);
assert.equal(written[0]?.uri, active[0]?.uri);
assert.equal(written[0]?.sourceRefs.includes(userSource.uri), true);
assert.equal(written[0]?.sourceRefs.includes(assistantSource.uri), true);
assert.match(written[0]?.claim ?? "", /粗糙兜底/);
assert.equal(repository.listMemoryObservations(active[0]?.uri ?? "").length, 3);
assert.equal(repository.listPendingMemoryCandidates(sessionId, "preference").length, 0);

const rejectedCandidate = repository.recordMemoryCandidates({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:06.500Z",
  candidates: [{
    type: "preference",
    subject: "temporary_task",
    claim: "用户这次要求查看当前实现。",
    howToApply: "不应作为长期偏好使用。",
    tags: ["临时任务"],
    triggers: ["这次看看"],
    sourceRefs: [userSource.uri],
    reason: "这是临时请求。",
    confidence: 0.4,
    embedding: [0, 1, 0],
  }],
});
written = repository.applyMemoryLearning({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:06.750Z",
  actions: [{
    operation: "reject",
    type: "preference",
    subject: "temporary_task",
    claim: "用户这次要求查看当前实现。",
    howToApply: "不应作为长期偏好使用。",
    tags: ["临时任务"],
    triggers: ["这次看看"],
    sourceRefs: [userSource.uri],
    candidateUris: [rejectedCandidate[0]?.uri ?? ""],
    reason: "临时请求不进入长期记忆。",
    confidence: 0.4,
  }],
});
assert.equal(written.length, 0);
assert.equal(repository.listPendingMemoryCandidates(sessionId, "preference").length, 0);
assert.equal(repository.listActiveMemoryItems().length, 1);

const supersedeCandidate = repository.recordMemoryCandidates({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:07.000Z",
  candidates: [{
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户要求实现从源头解决，避免硬编码、粗糙兜底和低级字符串规则。",
    howToApply: "优先设计结构化数据流、schema 校验和可维护模块边界。",
    tags: ["工作方式", "代码质量"],
    triggers: ["低级字符串规则"],
    sourceRefs: [userSource.uri, assistantSource.uri],
    reason: "新候选替代旧的较窄表述。",
    confidence: 0.96,
    embedding: [0.99, 0.01, 0],
  }],
});

written = repository.applyMemoryLearning({
  episode: recordedTurn.episode,
  learnedAt: "2026-06-24T01:00:08.000Z",
  actions: [{
    operation: "supersede",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户要求实现从源头解决，避免硬编码、粗糙兜底和低级字符串规则。",
    howToApply: "优先设计结构化数据流、schema 校验和可维护模块边界。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决", "低级字符串规则"],
    sourceRefs: [userSource.uri, assistantSource.uri],
    candidateUris: [supersedeCandidate[0]?.uri ?? ""],
    targetMemoryUri: active[0]?.uri,
    reason: "新记忆替代旧的较窄表述。",
    confidence: 0.96,
  }],
});
assert.equal(written.length, 1);
active = repository.listActiveMemoryItems();
assert.equal(active.length, 1);
assert.equal(active[0]?.uri, written[0]?.uri);
assert.match(active[0]?.claim ?? "", /低级字符串规则/);

repository.deleteFromSessionRequest(sessionId, requestId);
assert.equal(repository.listEpisodes(sessionId).length, 0);
assert.equal(repository.listActiveMemoryItems().length, 0);

repository.close();
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.rmSync(databaseDir, { recursive: true, force: true });

console.log("Memory learning persistence verification passed.");
