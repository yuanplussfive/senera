import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveAgentWorkspaceLayout, type AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import { AgentPiCodingAgentSession } from "./AgentPiCodingAgentSession.js";
import { AgentPiCodingAgentSessionFactory } from "./AgentPiCodingAgentSessionFactory.js";
import { AgentPiCodingAgentSessionLifecycle } from "./AgentPiCodingAgentSessionLifecycle.js";
import type {
  AgentPiCodingAgentLeaseInput,
  AgentPiCodingAgentLeaseResult,
  AgentPiCodingAgentSessionPoolOptions,
  AgentPiPooledCodingSession,
} from "./AgentPiCodingAgentSessionPoolContracts.js";
import { resolveAgentPiSessionCacheCapacity } from "./AgentPiSessionCachePolicy.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import { findAgentPiSessionFile, resolveAgentPiSessionsRoot } from "./AgentPiSessionStorage.js";
import {
  hasIncompatibleAgentPiToolObservationHistory,
  isAgentPiSessionRuntimeContractCurrent,
  stampAgentPiSessionRuntimeContract,
} from "./AgentPiSessionHistoryPolicy.js";
import {
  AgentPiSessionExportFormats,
  type AgentPiSessionCompactionResult,
  type AgentPiSessionExportFormat,
  type AgentPiSessionExportResult,
  type AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";

const AgentPiSessionLeasePhases = {
  Queue: "queue",
  OpenOrCreate: "open_or_create",
  RuntimeRebuild: "runtime_rebuild",
  Configure: "configure",
  RefreshContext: "refresh_context",
} as const;

type AgentPiSessionLeasePhase = (typeof AgentPiSessionLeasePhases)[keyof typeof AgentPiSessionLeasePhases];

export type { AgentPiCodingAgentSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
export type {
  AgentPiCodingAgentLeaseInput,
  AgentPiCodingAgentLeaseResult,
  AgentPiCodingAgentSessionPoolOptions,
} from "./AgentPiCodingAgentSessionPoolContracts.js";

/**
 * Coordinates public Pi session operations. Session construction and pool
 * lifecycle policy live in dedicated collaborators.
 */
export class AgentPiCodingAgentSessionPool {
  // Kept as direct fields because they are the pool's observable ownership boundary.
  private readonly sessions = new Map<string, AgentPiPooledCodingSession>();
  private readonly leases = new AgentKeyedLeaseQueue<string>();
  private readonly workspaceLayout: AgentWorkspaceLayout;
  private readonly factory: AgentPiCodingAgentSessionFactory;
  private readonly lifecycle: AgentPiCodingAgentSessionLifecycle;

  constructor(private readonly options: AgentPiCodingAgentSessionPoolOptions) {
    this.workspaceLayout = options.workspaceLayout ?? resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.factory = new AgentPiCodingAgentSessionFactory(options);
    this.lifecycle = new AgentPiCodingAgentSessionLifecycle(
      this.sessions,
      resolveAgentPiSessionCacheCapacity(options.maxIdleSessions),
      options.diagnostics,
    );
  }

  async lease(input: AgentPiCodingAgentLeaseInput): Promise<AgentPiCodingAgentLeaseResult> {
    const finishOperation = this.lifecycle.beginOperation();
    let releaseLease: (() => void) | undefined;
    let pooled: AgentPiPooledCodingSession | undefined;
    let phase: AgentPiSessionLeasePhase = AgentPiSessionLeasePhases.Queue;
    const startedAt = performance.now();
    try {
      releaseLease = await this.trackLeasePhase(input, phase, () => this.leases.acquire(input.sessionId, input.signal));
      this.lifecycle.assertOpen();
      phase = AgentPiSessionLeasePhases.OpenOrCreate;
      let opened = await this.trackLeasePhase(input, phase, () => this.openOrCreate(input));
      if (this.requiresDeferredRuntimeRebuild(opened.value, input)) {
        phase = AgentPiSessionLeasePhases.RuntimeRebuild;
        opened = {
          ...opened,
          value: await this.trackLeasePhase(input, phase, () => this.rebuildRuntimeForNextLease(opened.value, input)),
        };
      }
      const leasedPooled = opened.value;
      pooled = leasedPooled;
      const leasedSession = leasedPooled;
      const leasedRelease = releaseLease;
      leasedPooled.activeLeases += 1;
      leasedPooled.lastAccess = this.lifecycle.nextAccessSequence();
      phase = AgentPiSessionLeasePhases.Configure;
      await this.trackLeasePhase(input, phase, () => this.factory.configure(leasedPooled, input));
      // SessionManager is the durable source of truth for compaction, rewind,
      // and branch mutations. Refresh the SDK's public transcript before a
      // lease exposes it to the next Pi turn; otherwise a pooled AgentSession
      // can retain the pre-compaction message snapshot indefinitely.
      phase = AgentPiSessionLeasePhases.RefreshContext;
      await this.trackLeasePhase(input, phase, () => leasedPooled.session.refreshContext());
      return {
        storage: opened.storage,
        session: new AgentPiCodingAgentSession(pooled.session, pooled.sessionManager, pooled.frame, () =>
          this.lifecycle.release(leasedSession, leasedRelease, finishOperation),
        ),
      };
    } catch (error) {
      if (pooled && releaseLease) {
        this.lifecycle.release(pooled, releaseLease, finishOperation);
      } else {
        releaseLease?.();
        finishOperation();
      }
      this.emitLeaseDiagnostic(input, "session.lease.failed", {
        phase,
        durationMs: elapsedMilliseconds(startedAt),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private async trackLeasePhase<T>(
    input: AgentPiCodingAgentLeaseInput,
    phase: AgentPiSessionLeasePhase,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const startedAt = performance.now();
    this.emitLeaseDiagnostic(input, "session.lease.phase.started", { phase });
    try {
      const value = await operation();
      this.emitLeaseDiagnostic(input, "session.lease.phase.completed", {
        phase,
        durationMs: elapsedMilliseconds(startedAt),
      });
      return value;
    } catch (error) {
      this.emitLeaseDiagnostic(input, "session.lease.phase.failed", {
        phase,
        durationMs: elapsedMilliseconds(startedAt),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private emitLeaseDiagnostic(
    input: AgentPiCodingAgentLeaseInput,
    name: string,
    details: Record<string, unknown>,
  ): void {
    const frame = input.frame;
    if (!frame) return;
    void emitAgentPiDiagnostic(frame.diagnostics ?? this.options.diagnostics, {
      context: {
        sessionId: frame.sessionId,
        requestId: frame.requestId,
        step: frame.step,
      },
      source: AgentPiDiagnosticSources.Substrate,
      name,
      details,
    });
  }

  async rewind(sessionId: string, entryId: string): Promise<boolean> {
    const finishOperation = this.lifecycle.beginOperation();
    let release: (() => void) | undefined;
    try {
      release = await this.leases.acquire(sessionId);
      this.lifecycle.assertOpen();
      const sessionManager =
        this.sessions.get(sessionId)?.sessionManager ?? (await this.openExistingSession(sessionId));
      if (!sessionManager?.getEntry(entryId)) return false;
      sessionManager.branch(entryId);
      const pooled = this.sessions.get(sessionId);
      if (pooled) {
        pooled.session.agent.state.messages = sessionManager.buildSessionContext().messages;
      }
      return true;
    } finally {
      release?.();
      finishOperation();
    }
  }

  async fork(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean> {
    const finishOperation = this.lifecycle.beginOperation();
    let release: (() => void) | undefined;
    let borrowedSource: AgentPiPooledCodingSession | undefined;
    let targetFile: string | undefined;
    try {
      if (sourceSessionId === targetSessionId) return false;
      const forkLease = await this.acquireForkLeases(sourceSessionId, targetSessionId);
      release = forkLease.release;
      borrowedSource = forkLease.borrowedSource;
      this.lifecycle.assertOpen();
      if (this.sessions.has(targetSessionId) || (await this.findSession(targetSessionId))) return false;
      if (borrowedSource && !this.isActiveBorrowedSource(sourceSessionId, borrowedSource)) {
        release();
        release = undefined;
        borrowedSource = undefined;
        release = await this.acquireSessionPair(sourceSessionId, targetSessionId);
        this.lifecycle.assertOpen();
        if (this.sessions.has(targetSessionId) || (await this.findSession(targetSessionId))) return false;
      }
      const sourceManager =
        this.sessions.get(sourceSessionId)?.sessionManager ?? (await this.openExistingSession(sourceSessionId));
      if (!sourceManager) return false;
      const sourceFile = sourceManager.getSessionFile();
      if (!sourceFile || !sourceManager.getEntry(entryId)) return false;

      const targetManager = SessionManager.forkFrom(sourceFile, this.options.workspaceRoot, this.sessionsRoot(), {
        id: targetSessionId,
      });
      targetFile = targetManager.getSessionFile();
      if (!targetManager.getEntry(entryId)) {
        if (targetFile) await removeAgentPathWithRetry(targetFile, { deferOnBusy: true });
        return false;
      }
      targetManager.branch(entryId);
      targetManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.ForkBoundary, {
        sourceSessionId,
        entryId,
      });
      return true;
    } catch (error) {
      if (targetFile) await removeAgentPathWithRetry(targetFile, { deferOnBusy: true });
      throw error;
    } finally {
      release?.();
      finishOperation();
    }
  }

  async reset(sessionId: string): Promise<boolean> {
    const finishOperation = this.lifecycle.beginOperation();
    let release: (() => void) | undefined;
    try {
      release = await this.leases.acquire(sessionId);
      this.lifecycle.assertOpen();
      const pooled = this.sessions.get(sessionId);
      if (pooled) {
        this.sessions.delete(sessionId);
        await this.lifecycle.shutdown(pooled);
      }
      const info = await this.findSession(sessionId);
      if (!info) return false;
      await removeAgentPathWithRetry(info.path, { deferOnBusy: true });
      return true;
    } finally {
      release?.();
      finishOperation();
    }
  }

  compact(sessionId: string, customInstructions?: string): Promise<AgentPiSessionCompactionResult | undefined> {
    return this.withExistingSession(sessionId, async (pooled) => {
      const result = await pooled.session.compact(customInstructions);
      return {
        summary: result.summary,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter,
      };
    });
  }

  async status(sessionId: string): Promise<AgentPiSessionRuntimeStatus | undefined> {
    const cached = this.sessions.get(sessionId);
    if (cached) {
      const finishOperation = this.lifecycle.beginOperation();
      try {
        return this.readRuntimeStatus(sessionId, cached);
      } finally {
        finishOperation();
      }
    }

    return this.withExistingSession(sessionId, (pooled) => this.readRuntimeStatus(sessionId, pooled));
  }

  export(sessionId: string, format: AgentPiSessionExportFormat): Promise<AgentPiSessionExportResult | undefined> {
    return this.withExistingSession(sessionId, async (pooled) => {
      const exportRoot = this.workspaceLayout.sessionExportsRoot;
      await fs.mkdir(exportRoot, { recursive: true });
      const outputPath = path.join(exportRoot, `${createOpaqueId("session_export")}.${format}`);
      const exportedPath =
        format === AgentPiSessionExportFormats.Html
          ? await pooled.session.exportToHtml(outputPath)
          : pooled.session.exportToJsonl(outputPath);
      if (relativePathWithin(exportRoot, exportedPath) === undefined) {
        throw new Error("Pi session export escaped its managed root.");
      }
      return {
        sessionId,
        format,
        path: path.relative(this.options.workspaceRoot, exportedPath),
      };
    });
  }

  close(): Promise<void> {
    return this.lifecycle.close();
  }

  private readRuntimeStatus(sessionId: string, pooled: AgentPiPooledCodingSession): AgentPiSessionRuntimeStatus {
    const {
      sessionFile: _sessionFile,
      sessionId: _piSessionId,
      contextUsage: _statsContextUsage,
      ...stats
    } = pooled.session.getSessionStats();
    return {
      sessionId,
      cached: this.sessions.get(sessionId) === pooled,
      stats,
      contextUsage: pooled.session.getContextUsage(),
    };
  }

  private async withExistingSession<TValue>(
    sessionId: string,
    operation: (session: AgentPiPooledCodingSession) => TValue | Promise<TValue>,
  ): Promise<TValue | undefined> {
    const finishOperation = this.lifecycle.beginOperation();
    let release: (() => void) | undefined;
    let ephemeral: AgentPiPooledCodingSession | undefined;
    try {
      release = await this.leases.acquire(sessionId);
      this.lifecycle.assertOpen();
      const cached = this.sessions.get(sessionId);
      if (cached) {
        await cached.session.waitForIdle();
        return await operation(cached);
      }
      const sessionManager = await this.openExistingSession(sessionId);
      if (!sessionManager) return undefined;
      ephemeral = await this.factory.createManagement(sessionId, sessionManager, this.lifecycle.nextAccessSequence());
      return await operation(ephemeral);
    } finally {
      try {
        if (ephemeral) await this.lifecycle.shutdown(ephemeral);
      } finally {
        release?.();
        finishOperation();
      }
    }
  }

  private async acquireSessionPair(leftSessionId: string, rightSessionId: string): Promise<() => void> {
    const releases: Array<() => void> = [];
    try {
      for (const sessionId of [...new Set([leftSessionId, rightSessionId])].sort()) {
        releases.push(await this.leases.acquire(sessionId));
      }
      return () => {
        for (const release of releases.reverse()) release();
      };
    } catch (error) {
      for (const release of releases.reverse()) release();
      throw error;
    }
  }

  /**
   * A parent turn may fork its own active session. In that case the source
   * lease is already held by the caller, so acquiring it again would wait for
   * the parent to finish while the parent waits for the fork to finish.
   *
   * The target is still serialized through the keyed queue. Once it is held,
   * the active source lease protects the synchronous session-file snapshot
   * taken by SessionManager.forkFrom(). If the source became idle while the
   * target was queued, fall back to the normal ordered pair acquisition.
   */
  private async acquireForkLeases(
    sourceSessionId: string,
    targetSessionId: string,
  ): Promise<{ release: () => void; borrowedSource?: AgentPiPooledCodingSession }> {
    const source = this.sessions.get(sourceSessionId);
    if (source && source.activeLeases > 0) {
      const releaseTarget = await this.leases.acquire(targetSessionId);
      const activeSource = this.sessions.get(sourceSessionId);
      if (activeSource === source && activeSource.activeLeases > 0) {
        return { release: releaseTarget, borrowedSource: source };
      }
      releaseTarget();
    }
    return { release: await this.acquireSessionPair(sourceSessionId, targetSessionId) };
  }

  private isActiveBorrowedSource(sourceSessionId: string, source: AgentPiPooledCodingSession): boolean {
    return this.sessions.get(sourceSessionId) === source && source.activeLeases > 0;
  }

  private async openOrCreate(input: AgentPiCodingAgentLeaseInput): Promise<{
    value: AgentPiPooledCodingSession;
    storage: "created" | "existing";
  }> {
    const current = this.sessions.get(input.sessionId);
    if (current) {
      return {
        value: current,
        storage: "existing",
      };
    }
    let existing = await this.openExistingSession(input.sessionId);
    if (existing && hasIncompatibleAgentPiToolObservationHistory(existing)) {
      const sessionFile = existing.getSessionFile();
      if (!sessionFile || relativePathWithin(this.sessionsRoot(), sessionFile) === undefined) {
        throw new Error("Incompatible Pi session escaped its managed storage root.");
      }
      await removeAgentPathWithRetry(sessionFile, { deferOnBusy: true });
      existing = undefined;
    }
    const sessionManager =
      existing ??
      SessionManager.create(this.options.workspaceRoot, this.sessionsRoot(), {
        id: input.sessionId,
      });
    if (!isAgentPiSessionRuntimeContractCurrent(sessionManager)) {
      stampAgentPiSessionRuntimeContract(sessionManager);
    }
    const pooled = await this.factory.create(input, sessionManager, this.lifecycle.nextAccessSequence());
    this.sessions.set(input.sessionId, pooled);
    return {
      value: pooled,
      storage: existing ? "existing" : "created",
    };
  }

  /**
   * Runtime contracts are immutable for an active coding session. A changed
   * tool registry or project-context mode is therefore applied at the next
   * lease boundary, while the durable SessionManager and logical cache scope
   * stay intact. This is the same deferred-invalidation shape used by the
   * surrounding runtime cache: no active turn is interrupted and no history
   * cold-start is manufactured just because the host reloaded configuration.
   */
  private requiresDeferredRuntimeRebuild(
    pooled: AgentPiPooledCodingSession,
    input: AgentPiCodingAgentLeaseInput,
  ): boolean {
    return (
      pooled.toolFingerprint !== input.allTools.fingerprint ||
      pooled.inheritProjectContext !== input.inheritProjectContext
    );
  }

  private async rebuildRuntimeForNextLease(
    current: AgentPiPooledCodingSession,
    input: AgentPiCodingAgentLeaseInput,
  ): Promise<AgentPiPooledCodingSession> {
    if (current.activeLeases !== 0) {
      throw new Error("Pi runtime invalidation reached an active lease.");
    }
    const previousFrame = current.frame.snapshot();
    const replacement = await this.factory.create(input, current.sessionManager, this.lifecycle.nextAccessSequence());
    this.sessions.set(input.sessionId, replacement);
    try {
      await this.lifecycle.shutdown(current);
    } catch (error) {
      await emitAgentPiDiagnostic(this.options.diagnostics, {
        context: {
          sessionId: input.sessionId,
          requestId: input.frame.requestId,
          step: input.frame.step,
        },
        source: AgentPiDiagnosticSources.Substrate,
        name: "session.deferred_invalidation_cleanup.failed",
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
    await emitAgentPiDiagnostic(this.options.diagnostics, {
      context: {
        sessionId: input.sessionId,
        requestId: input.frame.requestId,
        step: input.frame.step,
      },
      source: AgentPiDiagnosticSources.Substrate,
      name: "session.deferred_invalidation.applied",
      details: {
        reason:
          current.toolFingerprint !== input.allTools.fingerprint &&
          current.inheritProjectContext !== input.inheritProjectContext
            ? "tool_registry_and_project_context"
            : current.toolFingerprint !== input.allTools.fingerprint
              ? "tool_registry"
              : "project_context",
        previousToolFingerprint: current.toolFingerprint,
        nextToolFingerprint: input.allTools.fingerprint,
        previousInheritProjectContext: current.inheritProjectContext,
        nextInheritProjectContext: input.inheritProjectContext,
        logicalCacheScope: input.frame.logicalCacheScope,
        preservedSessionId: previousFrame.sessionId,
      },
    });
    return replacement;
  }

  private async openExistingSession(sessionId: string): Promise<SessionManager | undefined> {
    const info = await this.findSession(sessionId);
    return info ? SessionManager.open(info.path, this.sessionsRoot(), this.options.workspaceRoot) : undefined;
  }

  private findSession(sessionId: string) {
    return findAgentPiSessionFile(this.options.workspaceRoot, this.options.sessionsRoot, sessionId);
  }

  private sessionsRoot(): string {
    return resolveAgentPiSessionsRoot(this.options.workspaceRoot, this.options.sessionsRoot);
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
