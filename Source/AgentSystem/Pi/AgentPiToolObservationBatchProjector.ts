import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readAgentString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { allocateAgentTokenBudget } from "../Text/AgentTokenAllocation.js";
import { AgentTokenBudgetOracle, type AgentTokenBudgetInspection } from "../Text/AgentTokenBudgetOracle.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  AgentPiToolObservationStatuses,
  agentPiToolObservationIdentity,
  assertAgentPiToolObservationBounded,
  createAgentPiToolObservation,
  createAgentPiToolObservationContextView,
  isAgentPiObservationContextProjected,
  isAgentPiToolResultMessage,
  projectAgentPiToolObservationDetail,
  readAgentPiMessageTextContent,
  readAgentPiObservationBatchId,
  readAgentPiToolObservation,
  readAgentPiToolObservationStatus,
  writeAgentPiMessageTextContent,
  type AgentPiToolObservation,
} from "./AgentPiToolObservation.js";

export interface AgentPiToolObservationBatchProjectionOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

export interface AgentPiToolObservationBatchInspection {
  readonly candidateCount: number;
  readonly availableTokens: number;
  readonly minimumTokens: number;
  readonly completeTokens?: number;
  readonly completeMeasurement: AgentTokenBudgetInspection["kind"];
  readonly requiresProjection: boolean;
}

export interface AgentPiPreparedToolObservationBatch {
  readonly inspection: AgentPiToolObservationBatchInspection;
  readonly messages: AgentMessage[];
}

interface ProjectionCandidate {
  readonly index: number;
  readonly message: AgentMessage;
  readonly observation: AgentPiToolObservation;
  readonly identity: string;
  readonly minimum: AgentUnknownRecord;
  readonly minimumText: string;
  readonly minimumTokens: number;
  readonly completeText: string;
  readonly completeCost: AgentTokenBudgetInspection;
}

export class AgentPiToolObservationBatchProjector {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly tokenOracle: AgentTokenBudgetOracle;
  private readonly committedViews = new Map<string, string>();

  constructor(private readonly options: AgentPiToolObservationBatchProjectionOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.tokenOracle = new AgentTokenBudgetOracle(options.model);
  }

  pendingObservationIdentities(messages: readonly AgentMessage[]): string[] {
    this.reconcileCommittedViews(messages);
    return messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!observation) return [];
      assertAgentPiToolObservationBounded(observation);
      if (isAgentPiObservationContextProjected(observation)) return [];
      const identity = agentPiToolObservationIdentity(observation);
      return this.committedViews.has(identity) ? [] : [identity];
    });
  }

  observationIdentities(messages: readonly AgentMessage[]): string[] {
    this.reconcileCommittedViews(messages);
    return messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (observation) assertAgentPiToolObservationBounded(observation);
      return observation ? [agentPiToolObservationIdentity(observation)] : [];
    });
  }

  commitCondensedBatch(messages: readonly AgentMessage[], sourceIdentities: readonly string[]): boolean {
    this.reconcileCommittedViews(messages);
    const selectedIdentities = new Set(sourceIdentities);
    const observations = messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (observation) assertAgentPiToolObservationBounded(observation);
      return observation && selectedIdentities.has(agentPiToolObservationIdentity(observation)) ? [observation] : [];
    });
    if (
      !observations.some((observation) =>
        readAgentString(projectAgentPiToolObservationDetail(observation).semantic_digest),
      )
    ) {
      return false;
    }

    for (const observation of observations) {
      const detail = projectAgentPiToolObservationDetail(observation);
      this.committedViews.set(
        agentPiToolObservationIdentity(observation),
        JSON.stringify({
          ...incompleteObservationEnvelope(observation, "grounded_digest"),
          detail: compactRecord({
            semantic_digest: detail.semantic_digest,
            retrieval: detail.retrieval,
            continuation: detail.continuation,
            delta: detail.delta,
          }),
        }),
      );
    }
    return true;
  }

  prepare(messages: readonly AgentMessage[]): AgentPiPreparedToolObservationBatch {
    this.reconcileCommittedViews(messages);
    const committedMessages = this.applyCommittedViews(messages);
    const candidates = this.collectCandidates(committedMessages);
    const availableTokens = this.availableBatchTokens(committedMessages, candidates);
    const inspection = inspectBatch(candidates, availableTokens);
    if (candidates.length === 0) return { inspection, messages: committedMessages };

    const allocations = allocateAgentTokenBudget(
      candidates.map((candidate) => ({
        identity: candidate.identity,
        minimumTokens: candidate.minimumTokens,
        desiredTokens: desiredCandidateTokens(candidate.completeCost, this.maximumCandidateTokens()),
      })),
      availableTokens,
    );
    const replacements = new Map<number, AgentMessage>(
      candidates.map((candidate) => {
        const content = this.projectObservation(
          candidate,
          allocations.get(candidate.identity) ?? candidate.minimumTokens,
        );
        return [candidate.index, writeAgentPiMessageTextContent(candidate.message, content)];
      }),
    );
    return {
      inspection,
      messages: committedMessages.map((message, index) => replacements.get(index) ?? message),
    };
  }

  project(messages: readonly AgentMessage[]): AgentMessage[] {
    return this.prepare(messages).messages;
  }

  private applyCommittedViews(messages: readonly AgentMessage[]): AgentMessage[] {
    return messages.map((message) => {
      if (!isAgentPiToolResultMessage(message)) return message;
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!observation) return message;
      const content = this.committedViews.get(agentPiToolObservationIdentity(observation));
      return content ? writeAgentPiMessageTextContent(message, content) : message;
    });
  }

  private reconcileCommittedViews(messages: readonly AgentMessage[]): void {
    if (this.committedViews.size === 0) return;
    const activeIdentities = new Set(
      messages.flatMap((message) => {
        if (!isAgentPiToolResultMessage(message)) return [];
        const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
        return observation ? [agentPiToolObservationIdentity(observation)] : [];
      }),
    );
    for (const identity of this.committedViews.keys()) {
      if (!activeIdentities.has(identity)) this.committedViews.delete(identity);
    }
  }

  private collectCandidates(messages: readonly AgentMessage[]): ProjectionCandidate[] {
    return messages.flatMap((message, index) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const sourceObservation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!sourceObservation) return [];
      assertAgentPiToolObservationBounded(sourceObservation);
      if (isAgentPiObservationContextProjected(sourceObservation)) return [];

      const observation = sourceObservation;
      const minimum = incompleteObservation(observation, {});
      const minimumText = JSON.stringify(minimum);
      const complete = completeObservation(observation);
      const completeText = JSON.stringify(complete);
      return [
        {
          index,
          message,
          observation,
          identity: agentPiToolObservationIdentity(observation),
          minimum,
          minimumText,
          minimumTokens: this.tokenProjector.countJson(minimum),
          completeText,
          completeCost: this.tokenOracle.inspectJson(complete, this.maximumCandidateTokens()),
        },
      ];
    });
  }

  private maximumCandidateTokens(): number {
    return Math.max(1, Math.floor(this.options.contextWindowTokens) - Math.floor(this.options.outputReserveTokens));
  }

  private availableBatchTokens(messages: readonly AgentMessage[], candidates: readonly ProjectionCandidate[]): number {
    const candidateIndexes = new Set(candidates.map((candidate) => candidate.index));
    const fixedTokens = messages.reduce(
      (total, message, index) => total + (candidateIndexes.has(index) ? 0 : this.tokenProjector.countJson(message)),
      0,
    );
    const available = Math.max(
      0,
      Math.floor(this.options.contextWindowTokens) - Math.floor(this.options.outputReserveTokens) - fixedTokens,
    );
    const minimumRequired = candidates.reduce((total, candidate) => total + candidate.minimumTokens, 0);
    return Math.max(available, minimumRequired);
  }

  private projectObservation(candidate: ProjectionCandidate, tokenLimit: number): string {
    if (candidate.completeCost.kind === "exact" && candidate.completeCost.tokens <= tokenLimit) {
      return candidate.completeText;
    }

    const envelope = incompleteObservationEnvelope(candidate.observation);
    const detailOverhead = this.tokenProjector.countJson({ ...envelope, detail: {} });
    const detailBudget = Math.max(1, tokenLimit - detailOverhead);
    const detail = this.tokenProjector.projectJson(
      projectAgentPiToolObservationDetail(candidate.observation),
      detailBudget,
    );
    const projectedText = JSON.stringify({ ...envelope, detail: detail.value });
    return this.tokenProjector.previewText(projectedText, tokenLimit).truncated ? candidate.minimumText : projectedText;
  }
}

function inspectBatch(
  candidates: readonly ProjectionCandidate[],
  availableTokens: number,
): AgentPiToolObservationBatchInspection {
  const minimumTokens = candidates.reduce((total, candidate) => total + candidate.minimumTokens, 0);
  const costs = candidates.map((candidate) => candidate.completeCost);
  const completeMeasurement = costs.some((cost) => cost.kind === "unknown")
    ? "unknown"
    : costs.some((cost) => cost.kind === "overBudget")
      ? "overBudget"
      : "exact";
  const completeTokens =
    completeMeasurement === "exact"
      ? costs.reduce((total, cost) => total + (cost.kind === "exact" ? cost.tokens : 0), 0)
      : undefined;
  return {
    candidateCount: candidates.length,
    availableTokens,
    minimumTokens,
    completeTokens,
    completeMeasurement,
    requiresProjection: completeTokens === undefined || completeTokens > availableTokens,
  };
}

function desiredCandidateTokens(cost: AgentTokenBudgetInspection, maximumTokens: number): number {
  return cost.kind === "exact" ? cost.tokens : maximumTokens;
}

function completeObservation(observation: AgentPiToolObservation): AgentUnknownRecord {
  const batchId = readAgentPiObservationBatchId(observation);
  return {
    ...observation,
    batch_id: batchId,
    context_view: createAgentPiToolObservationContextView({ complete: true, batch_id: batchId }),
  };
}

function incompleteObservation(observation: AgentPiToolObservation, detail: unknown): AgentUnknownRecord {
  return { ...incompleteObservationEnvelope(observation), detail };
}

function incompleteObservationEnvelope(
  observation: AgentPiToolObservation,
  mode = "deterministic_summary",
): AgentUnknownRecord {
  const batchId = readAgentPiObservationBatchId(observation);
  return {
    ...requiredObservationEnvelope(observation),
    context_view: createAgentPiToolObservationContextView({ complete: false, mode, batch_id: batchId }),
  };
}

function requiredObservationEnvelope(observation: AgentPiToolObservation): AgentUnknownRecord {
  const status = readAgentPiToolObservationStatus(observation.status);
  const error = readAgentUnknownRecord(observation.error);
  const detail = projectAgentPiToolObservationDetail(observation);
  return createAgentPiToolObservation(
    compactRecord({
      tool_name: readAgentString(observation.tool_name) ?? "",
      call_id: readAgentString(observation.call_id) ?? "",
      batch_id: readAgentPiObservationBatchId(observation),
      status,
      execution_status: observation.execution_status,
      output_availability: observation.output_availability,
      artifact_uri: readAgentString(observation.artifact_uri),
      error:
        status === AgentPiToolObservationStatuses.Failure
          ? compactRecord({
              code: readAgentString(error?.code),
              kind: readAgentString(error?.kind),
              source: readAgentString(error?.source),
              retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
              message: readAgentString(error?.message),
            })
          : undefined,
      continuation: detail.continuation,
    }),
  );
}

function compactRecord(value: Record<string, unknown>): AgentUnknownRecord {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => (entry === undefined ? [] : [[key, entry]])),
  );
}
