import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeAgentMemory } from "../Source/AgentSystem/AgentMemoryWriteRuntime.js";
import { recallAgentMemories } from "../Source/AgentSystem/AgentMemoryRecallRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const workspaceRoot = fs.mkdtempSync(path.join(process.cwd(), ".senera", "verify-memory-write-"));
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

async function main(): Promise<void> {
  const created = await writeAgentMemory({
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议、统一模块和成熟库。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决"],
    confidence: 0.95,
    reason: "用户明确要求记录偏好。",
  }, {
    repository,
    config,
    requestId: "req_memory_write_create",
  });

  const createdMemory = created.memories.item[0];
  assert.ok(createdMemory);
  assert.equal(createdMemory.operation, "create");
  assert.equal(createdMemory.status, "active");
  assert.deepEqual(createdMemory.sourceRefs.item, []);
  assert.equal(createdMemory.confidence, 0.95);
  assert.equal(repository.listCompletedEpisodes().length, 0);

  const recalled = await recallAgentMemories({
    query: "不要硬编码 从源头解决",
    scope: "preference",
  }, {
    repository,
    config,
  });
  assert.equal(recalled.memories.item[0]?.memoryUri, createdMemory.memoryUri);
  assert.match(recalled.memories.item[0]?.claim ?? "", /避免硬编码/);

  const updated = await writeAgentMemory({
    operation: "update",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码和粗糙兜底。",
    howToApply: "实现时优先使用结构化协议、统一模块、schema 和成熟库。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决", "不要兜底"],
    confidence: 0.97,
    targetMemoryUri: createdMemory.memoryUri,
    reason: "用户补充长期偏好。",
  }, {
    repository,
    config,
    requestId: "req_memory_write_update",
  });
  assert.equal(updated.memories.item[0]?.memoryUri, createdMemory.memoryUri);
  assert.match(updated.memories.item[0]?.claim ?? "", /粗糙兜底/);
  assert.equal(repository.listMemoryObservations(createdMemory.memoryUri).length, 2);

  const reinforced = await writeAgentMemory({
    operation: "reinforce",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码和粗糙兜底。",
    howToApply: "实现时优先使用结构化协议、统一模块、schema 和成熟库。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决"],
    confidence: 0.98,
    targetMemoryUri: createdMemory.memoryUri,
    reason: "用户再次确认该偏好。",
  }, {
    repository,
    config,
    requestId: "req_memory_write_reinforce",
  });
  assert.equal(reinforced.memories.item[0]?.operation, "reinforce");
  assert.equal(reinforced.memories.item[0]?.memoryUri, createdMemory.memoryUri);
  assert.equal(repository.listActiveMemoryItems().length, 1);
  assert.equal(repository.listMemoryObservations(createdMemory.memoryUri).length, 3);

  const superseded = await writeAgentMemory({
    operation: "supersede",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码、粗糙兜底和低级字符串规则。",
    howToApply: "实现时优先设计结构化数据流、schema 校验和可维护模块边界。",
    tags: ["工作方式", "代码质量"],
    triggers: ["不要硬编码", "从源头解决", "低级字符串规则"],
    confidence: 0.98,
    targetMemoryUri: createdMemory.memoryUri,
    reason: "用户要求替换为更完整表述。",
  }, {
    repository,
    config,
    requestId: "req_memory_write_supersede",
  });
  const active = repository.listActiveMemoryItems();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.uri, superseded.memories.item[0]?.memoryUri);
  assert.notEqual(active[0]?.uri, createdMemory.memoryUri);
  assert.match(active[0]?.claim ?? "", /低级字符串规则/);

  console.log("Memory write tool verification passed.");
}

main().finally(() => {
  repository.close();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
