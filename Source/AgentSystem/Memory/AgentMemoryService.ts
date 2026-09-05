import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryCompletedTurnInput,
  type AgentMemoryDeletionImpact,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import type { AgentContinuityLearningDecision } from "../Continuity/AgentContinuityLearningGate.js";

export type { AgentMemoryCompletedTurnInput } from "./AgentMemorySourceRepository.js";

export interface AgentContinuityLearningEnqueueOptions {
  readonly nextAttemptAtMs?: number;
}

export interface AgentContinuityLearningSink {
  enqueue(recordedTurn: AgentMemoryRecordedTurn, options?: AgentContinuityLearningEnqueueOptions): void;
  /** Indexes physical sources independently from the extraction gate. */
  indexPhysicalTurn?(recordedTurn: AgentMemoryRecordedTurn): void;
  flush?(): Promise<void>;
  stop?(): void | Promise<void>;
}

export interface AgentMemoryDeletionSink {
  deleteSession?(sessionId: string): void;
  deleteSources?(impact: AgentMemoryDeletionImpact): void;
}

/** Receives a persisted turn after its physical sources have been committed. */
export interface AgentMemoryCompletedTurnSink {
  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): void;
}

export interface AgentTemporalMemorySink extends AgentMemoryDeletionSink {
  recordTurn(recordedTurn: AgentMemoryRecordedTurn): void;
  flush(): Promise<void>;
  stop(): void | Promise<void>;
}

export interface AgentContinuityDeliverySink {
  acknowledgeRuleDeliveries(ruleUris: readonly string[], deliveredAt: string): number;
}

export interface AgentMemoryServiceOptions {
  continuityLearning?: AgentContinuityLearningSink;
  temporalMemory?: AgentTemporalMemorySink;
  completedTurnSinks?: readonly AgentMemoryCompletedTurnSink[];
  completedTurnSinkFailure?: (input: { readonly sink: AgentMemoryCompletedTurnSink; readonly error: unknown }) => void;
  continuityLearningGate?: (turn: AgentMemoryRecordedTurn) => AgentContinuityLearningDecision;
  continuityDelivery?: AgentContinuityDeliverySink;
  continuityPrefetch?: (sessionId: string) => void;
  continuityPrefetchFailure?: (input: { readonly sessionId: string; readonly error: unknown }) => void;
  sourceRepository?: AgentMemorySourceRepository;
  deletionSinks?: readonly AgentMemoryDeletionSink[];
}

export class AgentMemoryService {
  private readonly learning?: AgentContinuityLearningSink;
  private readonly temporalMemory?: AgentTemporalMemorySink;
  private readonly completedTurnSinks: AgentMemoryCompletedTurnSink[];
  private readonly completedTurnSinkFailure?: AgentMemoryServiceOptions["completedTurnSinkFailure"];
  private readonly learningGate?: (turn: AgentMemoryRecordedTurn) => AgentContinuityLearningDecision;
  private readonly delivery?: AgentContinuityDeliverySink;
  private readonly prefetch?: (sessionId: string) => void;
  private readonly prefetchFailure?: AgentMemoryServiceOptions["continuityPrefetchFailure"];
  private readonly sourceRepository: AgentMemorySourceRepository;
  private readonly deletionSinks: AgentMemoryDeletionSink[];
  private lifecycleState: AgentMemoryLifecycleState = "open";
  private closePromise: Promise<void> | undefined;

  constructor(options: AgentMemoryServiceOptions = {}) {
    this.learning = options.continuityLearning;
    this.temporalMemory = options.temporalMemory;
    this.completedTurnSinks = [...(options.completedTurnSinks ?? [])];
    this.completedTurnSinkFailure = options.completedTurnSinkFailure;
    this.learningGate = options.continuityLearningGate;
    this.delivery = options.continuityDelivery;
    this.prefetch = options.continuityPrefetch;
    this.prefetchFailure = options.continuityPrefetchFailure;
    this.sourceRepository = options.sourceRepository ?? new InMemoryAgentMemorySourceRepository();
    this.deletionSinks = [...(options.deletionSinks ?? [])];
  }

  registerDeletionSink(sink: AgentMemoryDeletionSink): void {
    this.assertOpen();
    if (!this.deletionSinks.includes(sink)) this.deletionSinks.push(sink);
  }

  registerCompletedTurnSink(sink: AgentMemoryCompletedTurnSink): void {
    this.assertOpen();
    if (!this.completedTurnSinks.includes(sink)) this.completedTurnSinks.push(sink);
  }

  deleteSession(sessionId: string): void {
    const impact = this.sourceRepository.deleteSession(sessionId);
    this.notifyDeletionSinks(impact, true);
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): void {
    const impact = this.sourceRepository.deleteFromSessionRequest(sessionId, requestId);
    this.notifyDeletionSinks(impact, false);
  }

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    this.assertOpen();
    const recordedTurn = this.sourceRepository.recordCompletedTurn(input);
    this.notifyCompletedTurnSinks(recordedTurn);
    this.temporalMemory?.recordTurn(recordedTurn);
    this.learning?.indexPhysicalTurn?.(recordedTurn);
    if (this.learning) {
      const decision = this.learningGate?.(recordedTurn) ?? { mode: "immediate", reason: "disabled" as const };
      if (decision.mode !== "skip") {
        this.learning.enqueue(recordedTurn, {
          nextAttemptAtMs: decision.deferredUntilMs,
        });
      }
    }
    if (this.prefetch) {
      queueMicrotask(() => {
        if (this.lifecycleState !== "open") return;
        try {
          this.prefetch?.(recordedTurn.episode.sessionId);
        } catch (error) {
          try {
            this.prefetchFailure?.({ sessionId: recordedTurn.episode.sessionId, error });
          } catch {
            // Error observers must not turn background prefetch into a process failure.
          }
        }
      });
    }
    return recordedTurn;
  }

  acknowledgeRuleDeliveries(ruleUris: readonly string[], deliveredAt: string): number {
    return this.delivery?.acknowledgeRuleDeliveries(ruleUris, deliveredAt) ?? 0;
  }

  flushContinuityLearning(): Promise<void> {
    if (this.lifecycleState === "closed") return Promise.resolve();
    return Promise.all([this.learning?.flush?.(), this.temporalMemory?.flush()]).then(() => undefined);
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  private async closeResources(): Promise<void> {
    this.lifecycleState = "closing";
    const failures: unknown[] = [];
    try {
      for (const operation of [
        () => this.learning?.flush?.(),
        () => this.temporalMemory?.flush(),
        () => this.learning?.stop?.(),
        () => this.temporalMemory?.stop(),
        () => this.sourceRepository.close(),
      ]) {
        try {
          await operation();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Agent memory shutdown failed.");
    } finally {
      this.lifecycleState = "closed";
    }
  }

  private notifyDeletionSinks(impact: AgentMemoryDeletionImpact, deleteSessionState: boolean): void {
    for (const sink of this.deletionSinks) {
      sink.deleteSources?.(impact);
      if (deleteSessionState) sink.deleteSession?.(impact.sessionId);
    }
  }

  private notifyCompletedTurnSinks(recordedTurn: AgentMemoryRecordedTurn): void {
    for (const sink of this.completedTurnSinks) {
      try {
        sink.recordCompletedTurn(recordedTurn);
      } catch (error) {
        this.completedTurnSinkFailure?.({ sink, error });
      }
    }
  }

  private assertOpen(): void {
    if (this.lifecycleState !== "open") throw new Error("Agent memory service is closing or closed.");
  }
}

type AgentMemoryLifecycleState = "open" | "closing" | "closed";
