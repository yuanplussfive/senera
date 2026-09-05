import type { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentContinuityMemoryService } from "./AgentContinuityMemoryService.js";

export interface AgentContinuityLifecyclePort {
  beforeCompaction(sessionId: string): Promise<void>;
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
      readonly memory: Pick<AgentMemoryService, "flushContinuityLearning" | "close">;
      readonly promptContext: Pick<AgentContinuityMemoryService, "prefetch">;
    },
  ) {}

  async beforeCompaction(sessionId: string): Promise<void> {
    if (this.closed) throw new Error("Continuity lifecycle is already closed.");
    this.activeCompactionBoundaries += 1;
    try {
      await this.options.memory.flushContinuityLearning();
      if (this.closed) throw new Error("Continuity lifecycle is already closed.");
      this.options.promptContext.prefetch({ sessionId });
    } finally {
      this.activeCompactionBoundaries -= 1;
      if (this.activeCompactionBoundaries === 0) this.resolveCompactionIdle?.();
    }
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  private async closeResources(): Promise<void> {
    this.closed = true;
    await this.waitForCompactionBoundaries();
    await this.options.memory.close();
  }

  private waitForCompactionBoundaries(): Promise<void> {
    if (this.activeCompactionBoundaries === 0) return Promise.resolve();
    return (this.compactionIdlePromise ??= new Promise<void>((resolve) => {
      this.resolveCompactionIdle = resolve;
    }));
  }
}
