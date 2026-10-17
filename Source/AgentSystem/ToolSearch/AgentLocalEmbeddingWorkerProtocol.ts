import type { AgentEmbeddingPriority } from "../Vector/AgentEmbeddingContract.js";

export const AgentLocalEmbeddingWorkerRequestTypes = {
  Warmup: "warmup",
  Embed: "embed",
  Cancel: "cancel",
} as const;

export const AgentLocalEmbeddingWorkerResponseTypes = {
  Completed: "completed",
  Failed: "failed",
} as const;

interface AgentLocalEmbeddingWorkerOperation {
  readonly requestId: number;
  readonly priority: AgentEmbeddingPriority;
}

export interface AgentLocalEmbeddingWorkerWarmupRequest extends AgentLocalEmbeddingWorkerOperation {
  readonly type: typeof AgentLocalEmbeddingWorkerRequestTypes.Warmup;
}

export interface AgentLocalEmbeddingWorkerEmbedRequest extends AgentLocalEmbeddingWorkerOperation {
  readonly type: typeof AgentLocalEmbeddingWorkerRequestTypes.Embed;
  readonly input: readonly string[];
  readonly role: "query" | "document";
}

export interface AgentLocalEmbeddingWorkerCancelRequest {
  readonly type: typeof AgentLocalEmbeddingWorkerRequestTypes.Cancel;
  readonly requestId: number;
}

export type AgentLocalEmbeddingWorkerRequest =
  | AgentLocalEmbeddingWorkerWarmupRequest
  | AgentLocalEmbeddingWorkerEmbedRequest
  | AgentLocalEmbeddingWorkerCancelRequest;

export interface AgentLocalEmbeddingWorkerCompletedResponse {
  readonly type: typeof AgentLocalEmbeddingWorkerResponseTypes.Completed;
  readonly requestId: number;
  readonly vectors?: number[][];
}

export interface AgentLocalEmbeddingWorkerFailedResponse {
  readonly type: typeof AgentLocalEmbeddingWorkerResponseTypes.Failed;
  readonly requestId: number;
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
}

export type AgentLocalEmbeddingWorkerResponse =
  AgentLocalEmbeddingWorkerCompletedResponse | AgentLocalEmbeddingWorkerFailedResponse;
