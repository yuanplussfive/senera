import assert from "node:assert/strict";
import {
  parseMemoryConsolidationResult,
  parseMemoryLearningResult,
  parseMemoryWriteResolutionResult,
} from "../Source/AgentSystem/Memory/AgentMemoryLearningSchema.js";

const learned = parseMemoryLearningResult({
  candidates: [{
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议和成熟库。",
    tags: ["工作方式"],
    triggers: ["不要硬编码"],
    sourceRefs: ["senera://memory-source/src_1"],
    reason: "用户明确表达长期偏好。",
    confidence: 0.92,
  }],
}, {
  supportingSourceRefs: ["senera://memory-source/src_1"],
});

assert.equal(learned.candidates.length, 1);
assert.equal(learned.candidates[0]?.type, "preference");

assert.throws(() => parseMemoryLearningResult({
  candidates: [{
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题。",
    howToApply: "实现时优先使用结构化协议。",
    tags: ["工作方式"],
    triggers: ["从源头解决"],
    sourceRefs: ["senera://memory-source/missing"],
    reason: "用户明确表达长期偏好。",
    confidence: 0.92,
  }],
}, {
  supportingSourceRefs: ["senera://memory-source/src_1"],
}), /sourceRef 不是可学习来源/);

assert.throws(() => parseMemoryLearningResult({
  candidates: [{
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题。",
    howToApply: "实现时优先使用结构化协议。",
    tags: ["工作方式"],
    triggers: ["从源头解决"],
    sourceRefs: ["senera://memory-source/src_assistant"],
    reason: "助手回复中提到了这个偏好。",
    confidence: 0.9,
  }],
}, {
  supportingSourceRefs: ["senera://memory-source/src_user"],
}), /sourceRef 不是可学习来源/);

const consolidated = parseMemoryConsolidationResult({
  actions: [{
    operation: "create",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议和成熟库。",
    tags: ["工作方式"],
    triggers: ["不要硬编码"],
    sourceRefs: ["senera://memory-source/src_1"],
    candidateUris: ["senera://memory-candidate/cand_1"],
    reason: "多个候选表达同一偏好。",
    confidence: 0.94,
  }],
}, {
  candidateSources: new Map([
    ["senera://memory-candidate/cand_1", ["senera://memory-source/src_1"]],
  ]),
  existingMemoryUris: [],
});

assert.equal(consolidated.actions.length, 1);
assert.equal(consolidated.actions[0]?.candidateUris[0], "senera://memory-candidate/cand_1");

const reinforced = parseMemoryWriteResolutionResult({
  decision: {
    operation: "reinforce",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题，避免硬编码。",
    howToApply: "实现时优先使用结构化协议和成熟库。",
    tags: ["工作方式"],
    triggers: ["不要硬编码"],
    sourceRefs: ["senera://memory-source/src_1"],
    candidateUris: ["senera://memory-candidate/cand_1"],
    targetMemoryUri: "senera://memory-item/mem_1",
    reason: "候选与已有长期记忆表达相同偏好。",
    confidence: 0.95,
  },
}, {
  allowedOperations: ["create", "reinforce", "update", "supersede", "reject"],
  memoryTypes: ["profile", "preference", "knowledge", "scene"],
  sourceRefs: ["senera://memory-source/src_1"],
  candidateUris: ["senera://memory-candidate/cand_1"],
  similarMemoryUris: ["senera://memory-item/mem_1"],
});

assert.equal(reinforced.decision.operation, "reinforce");
assert.equal(reinforced.decision.targetMemoryUri, "senera://memory-item/mem_1");

assert.throws(() => parseMemoryWriteResolutionResult({
  decision: {
    operation: "reinforce",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题。",
    howToApply: "实现时优先使用结构化协议。",
    tags: ["工作方式"],
    triggers: ["从源头解决"],
    sourceRefs: ["senera://memory-source/src_1"],
    candidateUris: ["senera://memory-candidate/cand_1"],
    targetMemoryUri: "senera://memory-item/missing",
    reason: "候选与已有长期记忆表达相同偏好。",
    confidence: 0.95,
  },
}, {
  allowedOperations: ["create", "reinforce", "update", "supersede", "reject"],
  memoryTypes: ["profile", "preference", "knowledge", "scene"],
  sourceRefs: ["senera://memory-source/src_1"],
  candidateUris: ["senera://memory-candidate/cand_1"],
  similarMemoryUris: ["senera://memory-item/mem_1"],
}), /不属于 similarMemories/);

assert.throws(() => parseMemoryConsolidationResult({
  actions: [{
    operation: "create",
    type: "preference",
    subject: "assistant_work_style",
    claim: "用户偏好从源头解决问题。",
    howToApply: "实现时优先使用结构化协议。",
    tags: ["工作方式"],
    triggers: ["从源头解决"],
    sourceRefs: ["senera://memory-source/other"],
    candidateUris: ["senera://memory-candidate/cand_1"],
    reason: "多个候选表达同一偏好。",
    confidence: 0.94,
  }],
}, {
  candidateSources: new Map([
    ["senera://memory-candidate/cand_1", ["senera://memory-source/src_1"]],
  ]),
  existingMemoryUris: [],
}), /sourceRef 不属于所选候选/);

console.log("Memory learning schema verification passed.");
