import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import type { AgentExecutionLedger, AgentExecutionPromptContext } from "../Goals/AgentExecutionLedgerTypes.js";
import type { AgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";

/**
 * Converts optional domain fields into stable values before Liquid rendering.
 * Strict templates should validate their own shape, not depend on every
 * persistence record having every optional database column populated.
 */
export function normalizeAgentContinuityTemplateContext(
  input: AgentContinuityMemoryPromptContext,
): AgentContinuityMemoryPromptContext {
  const graph = input.graph ?? { scope: [], entities: [], relations: [] };
  return {
    ...input,
    residentProfile: input.residentProfile.map((entry) => ({
      ...entry,
      validUntil: entry.validUntil ?? "",
    })),
    factCatalog: input.factCatalog.map((entry) => ({
      ...entry,
      validUntil: entry.validUntil ?? "",
    })),
    graph: {
      ...graph,
      entities: graph.entities.map((entity) => ({
        ...entity,
        aliases: [...entity.aliases],
      })),
      relations: graph.relations.map((relation) => ({
        ...relation,
        sourceRefs: [...relation.sourceRefs],
        temporal: { ...relation.temporal },
      })),
    },
    graphRelations: (input.graphRelations ?? []).map((relation) => ({
      ...relation,
      temporal: { ...relation.temporal },
    })),
    evidenceCandidates: input.evidenceCandidates,
    eventCandidates: input.eventCandidates,
    styleExamples: input.styleExamples ?? [],
    activeRules: input.activeRules,
    ruleCatalog: input.ruleCatalog.map((entry) => ({
      ...entry,
      validUntil: entry.validUntil ?? "",
    })),
    signals: input.signals,
    selection: input.selection,
  };
}

export function normalizeAgentWorkflowTemplateContext(input: AgentWorkflowPromptContext): AgentWorkflowPromptContext {
  return {
    execution: normalizeExecution(input.execution),
    todos: input.todos,
    world: input.world ?? null,
  };
}

function normalizeExecution(input: AgentExecutionPromptContext): AgentExecutionPromptContext {
  return {
    active: input.active ? normalizeExecutionLedger(input.active) : null,
    executions: input.executions.map(normalizeExecutionLedger),
  };
}

function normalizeExecutionLedger(execution: AgentExecutionLedger): AgentExecutionLedger {
  return {
    ...execution,
    reason: execution.reason ?? "",
    steps: execution.steps.map((step) => ({
      ...step,
      failure: step.failure ?? "",
    })),
  };
}
