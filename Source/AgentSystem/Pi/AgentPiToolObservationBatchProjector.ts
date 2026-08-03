import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readAgentString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { allocateAgentTokenBudget } from "../Text/AgentTokenAllocation.js";
import {
  AgentPiToolObservationStatuses,
  agentPiToolObservationIdentity,
  createAgentPiToolObservation,
  createAgentPiToolObservationContextView,
  isAgentPiObservationContextProjected,
  isAgentPiToolResultMessage,
  readAgentPiMessageTextContent,
  readAgentPiObservationBatchId,
  readAgentPiToolObservation,
  readAgentPiToolObservationStatus,
  projectAgentPiToolObservationFallback,
  writeAgentPiMessageTextContent,
  type AgentPiToolObservation,
} from "./AgentPiToolObservation.js";

const MaximumExactProjectionBytesPerToken = 32;

export interface AgentPiToolObservationBatchProjectionOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

export interface AgentPiToolObservationBatchInspection {
  readonly candidateCount: number;
  readonly availableTokens: number;
  readonly minimumTokens: number;
  readonly completeTokens: number;
  readonly requiresProjection: boolean;
}

interface ProjectionCandidate {
  readonly index: number;
  readonly message: AgentMessage;
  readonly observation: AgentPiToolObservation;
  readonly identity: string;
  readonly minimum: AgentUnknownRecord;
  readonly minimumText: string;
  readonly minimumTokens: number;
  readonly completeTokens: number;
  readonly requiresProjection: boolean;
}

export class AgentPiToolObservationBatchProjector {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly committedViews = new Map<string, string>();

  constructor(private readonly options: AgentPiToolObservationBatchProjectionOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
  }

  pendingObservationIdentities(messages: readonly AgentMessage[]): string[] {
    this.reconcileCommittedViews(messages);
    return messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!observation) return [];
      const identity = agentPiToolObservationIdentity(observation);
      return this.committedViews.has(identity) ? [] : [identity];
    });
  }

  observationIdentities(messages: readonly AgentMessage[]): string[] {
    this.reconcileCommittedViews(messages);
    return messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      return observation ? [agentPiToolObservationIdentity(observation)] : [];
    });
  }

  commitCondensedBatch(messages: readonly AgentMessage[], sourceIdentities: readonly string[]): boolean {
    this.reconcileCommittedViews(messages);
    const selectedIdentities = new Set(sourceIdentities);
    const observations = messages.flatMap((message) => {
      if (!isAgentPiToolResultMessage(message)) return [];
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      return observation && selectedIdentities.has(agentPiToolObservationIdentity(observation)) ? [observation] : [];
    });
    if (!observations.some((observation) => readAgentString(observation.semantic_digest))) return false;

    for (const observation of observations) {
      this.committedViews.set(
        agentPiToolObservationIdentity(observation),
        JSON.stringify({
          ...incompleteObservationEnvelope(observation, "grounded_digest"),
          detail: compactRecord({
            semantic_digest: observation.semantic_digest,
            retrieval: observation.retrieval,
            continuation: observation.continuation,
            delta: observation.delta,
          }),
        }),
      );
    }
    return true;
  }

  inspect(messages: readonly AgentMessage[]): AgentPiToolObservationBatchInspection {
    this.reconcileCommittedViews(messages);
    const projectedMessages = this.applyCommittedViews(messages);
    const candidates = this.collectCandidates(projectedMessages);
    const availableTokens = this.availableBatchTokens(projectedMessages, candidates);
    const minimumTokens = candidates.reduce((total, candidate) => total + candidate.minimumTokens, 0);
    const completeTokens = candidates.reduce((total, candidate) => total + candidate.completeTokens, 0);
    return {
      candidateCount: candidates.length,
      availableTokens,
      minimumTokens,
      completeTokens,
      requiresProjection: completeTokens > availableTokens,
    };
  }

  project(messages: readonly AgentMessage[]): AgentMessage[] {
    this.reconcileCommittedViews(messages);
    const projectedMessages = this.applyCommittedViews(messages);
    const candidates = this.collectCandidates(projectedMessages);
    if (candidates.length === 0) return projectedMessages;

    const allocations = allocateAgentTokenBudget(
      candidates.map((candidate) => ({
        identity: candidate.identity,
        minimumTokens: candidate.minimumTokens,
        desiredTokens: candidate.completeTokens,
      })),
      this.availableBatchTokens(projectedMessages, candidates),
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
    return projectedMessages.map((message, index) => replacements.get(index) ?? message);
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
      const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
      if (!observation || isAgentPiObservationContextProjected(observation)) return [];

      const minimum = incompleteObservation(observation, {});
      const minimumText = JSON.stringify(minimum);
      const complete = completeObservation(observation);
      const maximumCompleteTokens = this.maximumCandidateTokens();
      const requiresProjection =
        Buffer.byteLength(JSON.stringify(complete), "utf8") >
        maximumCompleteTokens * MaximumExactProjectionBytesPerToken;
      const completeTokens = requiresProjection ? maximumCompleteTokens : this.tokenProjector.countJson(complete);
      return [
        {
          index,
          message,
          observation,
          identity: agentPiToolObservationIdentity(observation),
          minimum,
          minimumText,
          minimumTokens: this.tokenProjector.countJson(minimum),
          completeTokens,
          requiresProjection,
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
    if (!candidate.requiresProjection && candidate.completeTokens <= tokenLimit) {
      return JSON.stringify(completeObservation(candidate.observation));
    }

    const envelope = incompleteObservationEnvelope(candidate.observation);
    const detailOverhead = this.tokenProjector.countJson({ ...envelope, detail: {} });
    const detailBudget = Math.max(1, tokenLimit - detailOverhead);
    const detail = this.tokenProjector.projectJson(
      projectAgentPiToolObservationFallback(candidate.observation),
      detailBudget,
    );
    const projectedText = JSON.stringify({ ...envelope, detail: detail.projectedValue });
    return this.tokenProjector.previewText(projectedText, tokenLimit).truncated ? candidate.minimumText : projectedText;
  }
}

function completeObservation(observation: AgentPiToolObservation): AgentUnknownRecord {
  const batchId = readAgentPiObservationBatchId(observation);
  return {
    ...observation,
    batch_id: batchId,
    context_view: createAgentPiToolObservationContextView({
      complete: true,
      batch_id: batchId,
    }),
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
    context_view: createAgentPiToolObservationContextView({
      complete: false,
      mode,
      batch_id: batchId,
    }),
  };
}

function requiredObservationEnvelope(observation: AgentPiToolObservation): AgentUnknownRecord {
  const status = readAgentPiToolObservationStatus(observation.status);
  const error = readAgentUnknownRecord(observation.error);
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
      continuation: observation.continuation,
    }),
  );
}

function compactRecord(value: Record<string, unknown>): AgentUnknownRecord {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => (entry === undefined ? [] : [[key, entry]])),
  );
}
