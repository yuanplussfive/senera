import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryCompletedTurnInput,
  type AgentMemoryDeletionImpact,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";

export type { AgentMemoryCompletedTurnInput } from "./AgentMemorySourceRepository.js";

export interface AgentMemoryDeletionSink {
  deleteSession?(sessionId: string): void;
  deleteSources?(impact: AgentMemoryDeletionImpact): void;
}

/** Receives a persisted turn after its physical sources have been committed. */
export interface AgentMemoryCompletedTurnSink {
  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): void;
}

export interface AgentMemoryServiceOptions {
  completedTurnSinks?: readonly AgentMemoryCompletedTurnSink[];
  completedTurnSinkFailure?: (input: { readonly sink: AgentMemoryCompletedTurnSink; readonly error: unknown }) => void;
  sourceRepository?: AgentMemorySourceRepository;
  deletionSinks?: readonly AgentMemoryDeletionSink[];
}

export class AgentMemoryService {
  private readonly completedTurnSinks: AgentMemoryCompletedTurnSink[];
  private readonly completedTurnSinkFailure?: AgentMemoryServiceOptions["completedTurnSinkFailure"];
  private readonly sourceRepository: AgentMemorySourceRepository;
  private readonly deletionSinks: AgentMemoryDeletionSink[];
  private lifecycleState: AgentMemoryLifecycleState = "open";
  private closePromise: Promise<void> | undefined;

  constructor(options: AgentMemoryServiceOptions = {}) {
    this.completedTurnSinks = [...(options.completedTurnSinks ?? [])];
    this.completedTurnSinkFailure = options.completedTurnSinkFailure;
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
    return recordedTurn;
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  private async closeResources(): Promise<void> {
    this.lifecycleState = "closing";
    const failures: unknown[] = [];
    try {
      for (const operation of [() => this.sourceRepository.close()]) {
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
