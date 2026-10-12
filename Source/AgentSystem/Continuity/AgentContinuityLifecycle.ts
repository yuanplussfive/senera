import type { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentContinuityMemoryService } from "./AgentContinuityMemoryService.js";

export interface AgentContinuityLifecyclePort {
  beforeCompaction(sessionId: string): Promise<void>;
  afterCompaction?(sessionId: string): Promise<void> | void;
  invalidateSessionContext?(sessionId: string): Promise<void> | void;
  close(): Promise<void>;
}

/** Coordinates the memory boundaries owned by the host around a Pi session. */
export class AgentContinuityLifecycleCoordinator implements AgentContinuityLifecyclePort {
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private activeCompactionBoundaries = 0;
  private compactionIdlePromise: Promise<void> | undefined;
  private resolveCompactionIdle: (() => void) | undefined;

  constructor(
    private readonly options: {
      readonly memory: {
        readonly close: AgentMemoryService["close"];
        readonly flushSemanticLearning?: () => Promise<void>;
      };
      readonly promptContext: {
        readonly invalidateSessionContext?: AgentContinuityMemoryService["invalidateSessionContext"];
      };
    },
  ) {}

  async beforeCompaction(sessionId: string): Promise<void> {
    if (this.closed) throw new Error("Continuity lifecycle is already closed.");
    void sessionId;
    this.activeCompactionBoundaries += 1;
    try {
      await this.options.memory.flushSemanticLearning?.();
      if (this.closed) throw new Error("Continuity lifecycle is already closed.");
    } finally {
      this.activeCompactionBoundaries -= 1;
      if (this.activeCompactionBoundaries === 0) this.resolveCompactionIdle?.();
    }
  }

  afterCompaction(sessionId: string): void {
    this.options.promptContext.invalidateSessionContext?.(sessionId);
  }

  invalidateSessionContext(sessionId: string): void {
    this.options.promptContext.invalidateSessionContext?.(sessionId);
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  private async closeResources(): Promise<void> {
    this.closed = true;
    await this.waitForCompactionBoundaries();
    const failures: unknown[] = [];
    try {
      await this.options.memory.flushSemanticLearning?.();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.options.memory.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Continuity lifecycle shutdown failed.");
  }

  private waitForCompactionBoundaries(): Promise<void> {
    if (this.activeCompactionBoundaries === 0) return Promise.resolve();
    return (this.compactionIdlePromise ??= new Promise<void>((resolve) => {
      this.resolveCompactionIdle = resolve;
    }));
  }
}
