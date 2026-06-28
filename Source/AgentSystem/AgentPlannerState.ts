import type {
  PlannerEvidenceMemoryItem,
  PlannerToolCallStateItem,
  TaskFrame,
} from "./BamlClient/baml_client/types.js";
import type { AgentActionDecision } from "./ActionPlanner/AgentActionPlannerTypes.js";
import type {
  AgentActionPlannerLedger,
  PlannerEvidenceRecord,
} from "./ActionPlanner/AgentActionPlannerLedger.js";
import { uniqueStrings } from "./ActionPlanner/AgentActionPlannerProjectionUtils.js";

export interface AgentPlannerStateSnapshotRecord {
  taskId: string;
  requestId: string;
  step: number;
  status: AgentPlannerTaskStatus;
  userGoal: string;
  currentIntent: string;
  intentTags: string[];
  taskTags: string[];
  targetRefs: AgentPlannerStateTargetRef[];
  requiredEffects: AgentPlannerStateEffect[];
  evidenceNeeds: AgentPlannerStateEvidenceNeed[];
  completedEvidence: AgentPlannerStateEvidence[];
  completedEffects: AgentPlannerStateEffect[];
  openQuestions: AgentPlannerStateOpenQuestion[];
  candidateTools: AgentPlannerStateCandidateTool[];
  discoveryQueries: string[];
  nextStepPurpose: string;
  completionCriteria: string[];
  lastAction: AgentActionDecision["action"];
  loadedTools: string[];
  recentCalls: PlannerToolCallStateItem[];
  updatedAt: string;
}

export type AgentPlannerTaskStatus =
  | "running"
  | "waiting_for_user"
  | "ready_to_answer";

export interface AgentPlannerStateTargetRef {
  kind: string;
  value: string;
  status: string;
}

export interface AgentPlannerStateEffect {
  id: string;
  effect: string;
  target: string;
  reason: string;
}

export interface AgentPlannerStateEvidenceNeed {
  id: string;
  need: string;
  scope: string;
  minimum: number;
  reason: string;
}

export interface AgentPlannerStateEvidence {
  evidenceUri: string;
  kind: string;
  toolName: string;
  artifactUri: string;
  locator: string;
  display: string;
  label: string;
}

export interface AgentPlannerStateOpenQuestion {
  question: string;
  reason: string;
}

export interface AgentPlannerStateCandidateTool {
  name: string;
  purpose: string;
  supports: string[];
}

export function createPlannerStateSnapshot(options: {
  requestId: string;
  step: number;
  taskFrame: TaskFrame;
  decision: AgentActionDecision;
  ledger: AgentActionPlannerLedger;
  loadedToolNames: "all" | readonly string[];
  evidenceMemory: readonly PlannerEvidenceMemoryItem[];
  timestamp?: string;
}): AgentPlannerStateSnapshotRecord {
  const updatedAt = options.timestamp ?? new Date().toISOString();
  return {
    taskId: createPlannerTaskId(options.requestId),
    requestId: options.requestId,
    step: options.step,
    status: projectPlannerTaskStatus(options.decision),
    userGoal: options.taskFrame.answerGoal,
    currentIntent: options.taskFrame.taskType,
    intentTags: options.taskFrame.intentTags,
    taskTags: options.taskFrame.taskTags,
    targetRefs: options.taskFrame.targetRefs.map((target) => ({
      kind: target.kind,
      value: target.value,
      status: target.status,
    })),
    requiredEffects: options.taskFrame.requiredEffects.map((effect) => ({
      id: effect.id,
      effect: effect.effect,
      target: effect.target,
      reason: effect.reason,
    })),
    evidenceNeeds: options.taskFrame.requiredEvidence.map((need) => ({
      id: need.id,
      need: need.need,
      scope: need.scope,
      minimum: need.minimum,
      reason: need.reason,
    })),
    completedEvidence: projectCompletedEvidence(options.ledger.evidence),
    completedEffects: [],
    openQuestions: options.taskFrame.userInputNeeds.map((need) => ({
      question: need.question,
      reason: need.reason,
    })),
    candidateTools: options.taskFrame.candidateTools.map((tool) => ({
      name: tool.name,
      purpose: tool.purpose,
      supports: tool.supports,
    })),
    discoveryQueries: options.taskFrame.discoveryQueries,
    nextStepPurpose: options.taskFrame.nextStepPurpose,
    completionCriteria: options.taskFrame.completionCriteria,
    lastAction: options.decision.action,
    loadedTools: options.loadedToolNames === "all"
      ? ["all"]
      : uniqueStrings([...options.loadedToolNames]),
    recentCalls: projectRecentCalls(options.ledger),
    updatedAt,
  };
}

export function latestPlannerStateSnapshot(
  snapshots: readonly AgentPlannerStateSnapshotRecord[],
): AgentPlannerStateSnapshotRecord | undefined {
  return snapshots.at(-1);
}

function createPlannerTaskId(requestId: string): string {
  return requestId;
}

function projectPlannerTaskStatus(decision: AgentActionDecision): AgentPlannerTaskStatus {
  if (decision.action === "ask_user") {
    return "waiting_for_user";
  }
  if (decision.action === "answer") {
    return "ready_to_answer";
  }
  return "running";
}

function projectCompletedEvidence(
  evidence: readonly PlannerEvidenceRecord[],
): AgentPlannerStateEvidence[] {
  return evidence.map((entry) => ({
    evidenceUri: entry.evidenceUri,
    kind: entry.kind,
    toolName: "",
    artifactUri: entry.artifactUri,
    locator: entry.locator,
    display: entry.display,
    label: entry.label,
  }));
}

function projectRecentCalls(
  ledger: AgentActionPlannerLedger,
): PlannerToolCallStateItem[] {
  return ledger.calls.map((call) => ({
    step: call.step,
    toolName: call.toolName,
    status: call.status,
    artifactUri: call.artifactUri,
    evidenceUris: call.evidenceUris,
    resultKind: call.resultKind,
    argumentsPreview: call.argumentsPreview,
    error: call.error,
  }));
}
