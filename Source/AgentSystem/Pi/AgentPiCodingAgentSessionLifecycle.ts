import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { AgentPiBackgroundShutdownTracker } from "./AgentPiBackgroundShutdownTracker.js";
import type {
  AgentPiCodingAgentSessionPoolOptions,
  AgentPiPooledCodingSession,
} from "./AgentPiCodingAgentSessionPoolContracts.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";

/** Owns pool state, operation draining, idle eviction, and deterministic shutdown. */
export class AgentPiCodingAgentSessionLifecycle {
  private closePromise: Promise<void> | undefined;
  private state: "open" | "draining" | "closed" = "open";
  private activeOperations = 0;
  private readonly drainWaiters: Array<() => void> = [];
  private readonly backgroundShutdowns = new AgentPiBackgroundShutdownTracker();
  private accessSequence = 0;

  constructor(
    private readonly sessions: Map<string, AgentPiPooledCodingSession>,
    private readonly leases: AgentKeyedLeaseQueue<string>,
    private readonly maxIdleSessions: number,
    private readonly diagnostics: AgentPiCodingAgentSessionPoolOptions["diagnostics"],
  ) {}

  beginOperation(): () => void {
    this.assertOpen();
    this.activeOperations += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        for (const resolve of this.drainWaiters.splice(0)) resolve();
      }
    };
  }

  assertOpen(): void {
    if (this.state !== "open") throw new Error(`Pi session pool is ${this.state}.`);
  }

  nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }

  release(
    sessionId: string,
    pooled: AgentPiPooledCodingSession,
    releaseLease: () => void,
    finishOperation: () => void,
  ): void {
    pooled.activeLeases = Math.max(0, pooled.activeLeases - 1);
    pooled.lastAccess = this.nextAccessSequence();
    releaseLease();
    finishOperation();
    if (this.state === "open") queueMicrotask(() => this.trimIdleSessions());
  }

  shutdown(pooled: AgentPiPooledCodingSession): Promise<void> {
    return (pooled.shutdownPromise ??= (async () => {
      pooled.disposeDiagnostics();
      await pooled.session.abort();
      await pooled.session.waitForIdle();
      pooled.session.dispose();
    })());
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.state = "draining";
      this.closePromise = this.closeSessions();
    }
    return this.closePromise;
  }

  private async closeSessions(): Promise<void> {
    await this.waitForOperationsToDrain();
    await this.backgroundShutdowns.drain();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const settlements = await Promise.allSettled(sessions.map((session) => this.shutdown(session)));
    this.state = "closed";
    const failures = [
      ...this.backgroundShutdowns.failureSnapshot(),
      ...settlements.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    ];
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Pi session pool shutdown failed.");
  }

  private trimIdleSessions(): void {
    if (this.state !== "open") return;
    const idle = [...this.sessions.entries()]
      .filter(([, session]) => session.activeLeases === 0)
      .sort(([, left], [, right]) => right.lastAccess - left.lastAccess);
    for (const [sessionId, session] of idle.slice(this.maxIdleSessions)) {
      this.sessions.delete(sessionId);
      this.trackBackgroundShutdown(session);
    }
  }

  private trackBackgroundShutdown(session: AgentPiPooledCodingSession): void {
    const frame = session.frame.snapshot();
    this.backgroundShutdowns.track(this.shutdown(session), (error) =>
      emitAgentPiDiagnostic(this.diagnostics, {
        context: {
          sessionId: frame.sessionId,
          requestId: frame.requestId,
          step: frame.step,
        },
        source: AgentPiDiagnosticSources.Substrate,
        name: "session.background_shutdown.failed",
        details: { error: errorMessage(error) },
      }),
    );
  }

  private waitForOperationsToDrain(): Promise<void> {
    if (this.activeOperations === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }
}
