import { z } from "zod";
import type {
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
} from "../BamlClient/baml_client/types.js";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { AgentActionPlannerValidationError } from "../ActionPlanner/AgentActionPlannerSchema.js";
import { createAgentStructuredIssue, type AgentStructuredIssue } from "../Diagnostics/AgentStructuredIssue.js";
import {
  AgentMemoryTypes,
  type AgentMemoryCandidateDraft,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryType,
} from "./AgentMemorySourceRepository.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonEmptyStringSchema).transform(uniqueTrimmed);
const MemoryTypeSchema = z.enum(AgentMemoryTypes);
const OperationSchema = z.enum(["create", "reinforce", "update", "supersede", "reject"]);

const MemoryCandidateSchema = z
  .object({
    type: MemoryTypeSchema,
    subject: NonEmptyStringSchema,
    claim: NonEmptyStringSchema,
    howToApply: NonEmptyStringSchema,
    tags: StringListSchema,
    triggers: StringListSchema,
    sourceRefs: StringListSchema,
    reason: NonEmptyStringSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

const MemoryLearningResultSchema = z
  .object({
    candidates: z.array(MemoryCandidateSchema),
  })
  .strict();

const MemoryConsolidationActionSchema = z
  .object({
    operation: OperationSchema,
    type: MemoryTypeSchema,
    subject: NonEmptyStringSchema,
    claim: NonEmptyStringSchema,
    howToApply: NonEmptyStringSchema,
    tags: StringListSchema,
    triggers: StringListSchema,
    sourceRefs: StringListSchema,
    candidateUris: StringListSchema,
    targetMemoryUri: NonEmptyStringSchema.optional(),
    reason: NonEmptyStringSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

const MemoryConsolidationResultSchema = z
  .object({
    actions: z.array(MemoryConsolidationActionSchema),
  })
  .strict();

export interface ParsedMemoryLearningResult {
  candidates: AgentMemoryCandidateDraft[];
}

export interface ParsedMemoryConsolidationResult {
  actions: AgentMemoryConsolidationActionRecord[];
}

export interface ParsedMemoryWriteResolutionResult {
  decision: AgentMemoryConsolidationActionRecord;
}

export function parseMemoryLearningResult(
  result: BamlMemoryLearningResult,
  options: {
    supportingSourceRefs: readonly string[];
  },
): ParsedMemoryLearningResult {
  const parsed = parseNormalizedBamlOutput(MemoryLearningResultSchema, result);
  const supportingSourceRefs = new Set(options.supportingSourceRefs);
  const issues: AgentStructuredIssue[] = [];

  parsed.candidates.forEach((candidate, index) => {
    candidate.sourceRefs.forEach((sourceRef, sourceIndex) => {
      if (!supportingSourceRefs.has(sourceRef)) {
        issues.push(
          createAgentStructuredIssue(`sourceRef 不是可学习来源：${sourceRef}`, [
            "candidates",
            index,
            "sourceRefs",
            sourceIndex,
          ]),
        );
      }
    });
  });

  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed);
  }

  return {
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      type: candidate.type as AgentMemoryType,
    })),
  };
}

export function parseMemoryConsolidationResult(
  result: BamlMemoryConsolidationResult,
  options: {
    candidateSources: ReadonlyMap<string, readonly string[]>;
    existingMemoryUris: readonly string[];
  },
): ParsedMemoryConsolidationResult {
  const parsed = parseNormalizedBamlOutput(MemoryConsolidationResultSchema, result);
  const existingMemoryUris = new Set(options.existingMemoryUris);
  const issues: AgentStructuredIssue[] = [];

  parsed.actions.forEach((action, index) => {
    const allowedSourceRefs = new Set(
      action.candidateUris.flatMap((candidateUri, candidateIndex) => {
        const sourceRefs = options.candidateSources.get(candidateUri);
        if (!sourceRefs) {
          issues.push(
            createAgentStructuredIssue(`candidate uri 不存在：${candidateUri}`, [
              "actions",
              index,
              "candidateUris",
              candidateIndex,
            ]),
          );
          return [];
        }
        return [...sourceRefs];
      }),
    );

    action.sourceRefs.forEach((sourceRef, sourceIndex) => {
      if (!allowedSourceRefs.has(sourceRef)) {
        issues.push(
          createAgentStructuredIssue(`sourceRef 不属于所选候选：${sourceRef}`, [
            "actions",
            index,
            "sourceRefs",
            sourceIndex,
          ]),
        );
      }
    });

    if ((action.operation === "create" || action.operation === "reject") && action.targetMemoryUri) {
      issues.push(
        createAgentStructuredIssue(`${action.operation} 不应指定 targetMemoryUri。`, [
          "actions",
          index,
          "targetMemoryUri",
        ]),
      );
    }

    if (requiresTargetMemory(action.operation) && !action.targetMemoryUri) {
      issues.push(
        createAgentStructuredIssue(`${action.operation} 必须指定已有 memory uri。`, [
          "actions",
          index,
          "targetMemoryUri",
        ]),
      );
    }

    if (action.targetMemoryUri && !existingMemoryUris.has(action.targetMemoryUri)) {
      issues.push(
        createAgentStructuredIssue(`memory uri 不存在：${action.targetMemoryUri}`, [
          "actions",
          index,
          "targetMemoryUri",
        ]),
      );
    }
  });

  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed);
  }

  return {
    actions: parsed.actions.map((action) => ({
      ...action,
      type: action.type as AgentMemoryType,
    })),
  };
}

const MemoryWriteDecisionSchema = MemoryConsolidationActionSchema.omit({
  candidateUris: true,
}).extend({
  candidateUris: z.array(z.string().trim()).transform(uniqueTrimmed),
});

const MemoryWriteResolutionResultSchema = z
  .object({
    decision: MemoryWriteDecisionSchema,
  })
  .strict();

export function parseMemoryWriteResolutionResult(
  result: BamlMemoryWriteResolutionResult,
  options: {
    allowedOperations: readonly string[];
    memoryTypes: readonly string[];
    sourceRefs: readonly string[];
    candidateUris: readonly string[];
    similarMemoryUris: readonly string[];
  },
): ParsedMemoryWriteResolutionResult {
  const parsed = parseNormalizedBamlOutput(MemoryWriteResolutionResultSchema, result);
  const decision = parsed.decision;
  const issues: AgentStructuredIssue[] = [];
  const allowedOperations = new Set(options.allowedOperations);
  const memoryTypes = new Set(options.memoryTypes);
  const sourceRefs = new Set(options.sourceRefs);
  const candidateUris = new Set(options.candidateUris);
  const similarMemoryUris = new Set(options.similarMemoryUris);

  if (!allowedOperations.has(decision.operation)) {
    issues.push(createAgentStructuredIssue(`不在允许操作集合中：${decision.operation}`, ["decision", "operation"]));
  }

  if (!memoryTypes.has(decision.type)) {
    issues.push(createAgentStructuredIssue(`不在允许记忆类型集合中：${decision.type}`, ["decision", "type"]));
  }

  decision.sourceRefs.forEach((sourceRef, index) => {
    if (!sourceRefs.has(sourceRef)) {
      issues.push(
        createAgentStructuredIssue(`sourceRef 不属于 proposed：${sourceRef}`, ["decision", "sourceRefs", index]),
      );
    }
  });

  decision.candidateUris.forEach((candidateUri, index) => {
    if (!candidateUris.has(candidateUri)) {
      issues.push(
        createAgentStructuredIssue(`candidate uri 不属于 proposed：${candidateUri}`, [
          "decision",
          "candidateUris",
          index,
        ]),
      );
    }
  });

  if ((decision.operation === "create" || decision.operation === "reject") && decision.targetMemoryUri) {
    issues.push(
      createAgentStructuredIssue(`${decision.operation} 不应指定 targetMemoryUri。`, ["decision", "targetMemoryUri"]),
    );
  }

  if (requiresTargetMemory(decision.operation) && !decision.targetMemoryUri) {
    issues.push(
      createAgentStructuredIssue(`${decision.operation} 必须指定已有 memory uri。`, ["decision", "targetMemoryUri"]),
    );
  }

  if (decision.targetMemoryUri && !similarMemoryUris.has(decision.targetMemoryUri)) {
    issues.push(
      createAgentStructuredIssue(`memory uri 不属于 similarMemories：${decision.targetMemoryUri}`, [
        "decision",
        "targetMemoryUri",
      ]),
    );
  }

  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed);
  }

  return {
    decision: {
      ...decision,
      type: decision.type as AgentMemoryType,
    },
  };
}

function requiresTargetMemory(operation: string): boolean {
  return operation === "reinforce" || operation === "update" || operation === "supersede";
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
