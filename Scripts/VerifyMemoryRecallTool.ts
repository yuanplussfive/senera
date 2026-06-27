import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { recallAgentMemories } from "../Source/AgentSystem/AgentMemoryRecallRuntime.js";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../Source/AgentSystem/AgentConversation.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const workspaceRoot = fs.mkdtempSync(path.join(process.cwd(), ".senera", "verify-memory-recall-"));
const repository = new SqliteAgentMemorySourceRepository(
  resolveAgentMemoryDatabasePath(workspaceRoot),
);

const config = {
  ModelProviders: [],
  VectorModels: {
    Embedding: {
      Enabled: false,
    },
    Rerank: {
      Enabled: false,
    },
  },
} as unknown as AgentSystemConfig;

const sessionId = "session_memory_recall";
const requestId = "req_memory_recall_1";
const fallbackRequestId = "req_memory_recall_2";
const startedAt = "2026-06-24T02:00:00.000Z";
const completedAt = "2026-06-24T02:00:03.000Z";
const userEntry: Extract<AgentConversationEntry, { kind: "user.message" }> = {
  kind: AgentConversationEntryKinds.UserMessage,
  id: `${requestId}:user`,
  requestId,
  timestamp: startedAt,
  content: "以后给我推荐饮料时优先无糖咖啡，别主动推荐奶茶。",
};
const assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }> = {
  kind: AgentConversationEntryKinds.AssistantDecision,
  id: `${requestId}:assistant`,
  requestId,
  timestamp: completedAt,
  xml: "",
};

async function main(): Promise<void> {
  const recordedTurn = repository.recordCompletedTurn({
    sessionId,
    requestId,
    startedAt,
    completedAt,
    userEntry,
    assistantEntry,
    terminal: {
      kind: "FinalAnswer",
      content: "已记录这个饮料偏好。",
    },
    conversationEntries: [assistantEntry],
  });
  const userSource = recordedTurn.sources.find((source) => source.sourceKind === "user_message");
  assert.ok(userSource);

  const [memory] = repository.applyMemoryLearning({
    episode: recordedTurn.episode,
    learnedAt: "2026-06-24T02:00:05.000Z",
    actions: [{
      operation: "create",
      type: "preference",
      subject: "用户饮料偏好",
      claim: "用户在饮料选择中偏好无糖咖啡，并希望减少奶茶等甜饮料推荐。",
      howToApply: "饮料推荐时优先提供无糖咖啡选项，不主动推荐奶茶或高糖饮品。",
      tags: ["饮料", "偏好"],
      triggers: ["推荐饮料", "喝什么", "无糖咖啡"],
      sourceRefs: [userSource.uri],
      candidateUris: [],
      reason: "用户明确提出长期饮料偏好。",
      confidence: 0.97,
    }],
  });
  assert.ok(memory);

  repository.upsertMemoryItemVectors([{
    memoryUri: memory.uri,
    model: "verify-embedding",
    embedding: [1, 0, 0],
    updatedAt: memory.updatedAt,
  }]);
  assert.equal(repository.listMemoryItemVectors("verify-embedding")[0]?.memoryUri, memory.uri);

  repository.recordCompletedTurn({
    sessionId,
    requestId: fallbackRequestId,
    startedAt: "2026-06-24T02:01:00.000Z",
    completedAt: "2026-06-24T02:01:03.000Z",
    userEntry: {
      kind: AgentConversationEntryKinds.UserMessage,
      id: `${fallbackRequestId}:user`,
      requestId: fallbackRequestId,
      timestamp: "2026-06-24T02:01:00.000Z",
      content: "临时口令是蓝色月亮，只在这次对话里用一下。",
    },
    assistantEntry: {
      kind: AgentConversationEntryKinds.AssistantDecision,
      id: `${fallbackRequestId}:assistant`,
      requestId: fallbackRequestId,
      timestamp: "2026-06-24T02:01:03.000Z",
      xml: "",
    },
    terminal: {
      kind: "FinalAnswer",
      content: "已了解这个临时口令。",
    },
    conversationEntries: [],
  });

  const lexical = await recallAgentMemories({
    query: "用户无糖咖啡饮料偏好",
    scope: "preference",
  }, {
    repository,
    config,
  });
  assert.equal(lexical.memories.item[0]?.memoryUri, memory.uri);
  assert.equal(lexical.memories.item[0]?.type, "preference");
  assert.equal(lexical.memories.item[0]?.matchedBy.item.includes("keyword"), true);
  assert.equal(lexical.sources.item[0]?.sourceRef, userSource.uri);

  const byMemoryRef = await recallAgentMemories({
    query: "追溯这条记忆",
    refs: [memory.uri],
    limit: 1,
  }, {
    repository,
    config,
  });
  assert.equal(byMemoryRef.memories.item[0]?.memoryUri, memory.uri);
  assert.equal(byMemoryRef.memories.item[0]?.matchedBy.item.includes("exact_ref"), true);

  const bySourceRef = await recallAgentMemories({
    query: "追溯这个来源",
    refs: [userSource.uri],
    limit: 1,
  }, {
    repository,
    config,
  });
  assert.equal(bySourceRef.memories.item[0]?.memoryUri, memory.uri);
  assert.equal(bySourceRef.memories.item[0]?.matchedBy.item.includes("exact_ref"), true);

  const fallback = await recallAgentMemories({
    query: "临时口令 蓝色月亮",
    limit: 1,
  }, {
    repository,
    config,
  });
  assert.equal(fallback.memories.item.length, 0);
  assert.equal(fallback.fallback.used, true);
  assert.equal(fallback.turns.item[0]?.requestId, fallbackRequestId);
  assert.match(fallback.turns.item[0]?.userMessage.text ?? "", /蓝色月亮/);
  assert.match(fallback.turns.item[0]?.assistantMessage.text ?? "", /临时口令/);
  assert.equal(fallback.turns.item[0]?.matchedBy.item.includes("keyword"), true);

  console.log("Memory recall tool verification passed.");
}

main().finally(() => {
  repository.close();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
