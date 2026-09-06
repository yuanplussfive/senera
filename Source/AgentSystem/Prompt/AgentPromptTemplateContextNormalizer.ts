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
        temporal: {
          ...relation.temporal,
          startsAt: relation.temporal.startsAt ?? "",
          endsAt: relation.temporal.endsAt ?? "",
        },
      })),
    },
    graphRelations: (input.graphRelations ?? []).map((relation) => ({
      ...relation,
      temporal: {
        ...relation.temporal,
        startsAt: relation.temporal.startsAt ?? "",
        endsAt: relation.temporal.endsAt ?? "",
      },
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
    world: input.world ? normalizeWorld(input.world) : null,
  };
}

function normalizeWorld(
  world: NonNullable<AgentWorkflowPromptContext["world"]>,
): NonNullable<AgentWorkflowPromptContext["world"]> {
  return {
    ...world,
    commitments: world.commitments.map((commitment) => ({
      ...commitment,
      // Liquid strictVariables treats an absent optional member as an error,
      // even when the access is inside an `{% if %}` guard.
      dueAt: commitment.dueAt ?? null,
      startsAt: commitment.startsAt ?? null,
      endsAt: commitment.endsAt ?? null,
      detail: commitment.detail ?? null,
      intentMode: commitment.intentMode ?? null,
      priority: commitment.priority ?? null,
      progress: commitment.progress ?? null,
      successCriteria: commitment.successCriteria ?? null,
      nextReviewAt: commitment.nextReviewAt ?? null,
      blockedReason: commitment.blockedReason ?? null,
      statusReason: commitment.statusReason ?? null,
      parentGoalId: commitment.parentGoalId ?? null,
      ownerSessionId: commitment.ownerSessionId ?? null,
    })),
  } as NonNullable<AgentWorkflowPromptContext["world"]>;
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
