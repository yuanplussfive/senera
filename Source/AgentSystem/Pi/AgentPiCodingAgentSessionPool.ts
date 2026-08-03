import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveAgentWorkspaceLayout, type AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { relativePathWithin } from "../Core/AgentPath.js";
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
import {
  hasIncompatibleAgentPiToolObservationHistory,
  isAgentPiConversationHistoryEmpty,
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
    this.workspaceLayout = resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.factory = new AgentPiCodingAgentSessionFactory(options);
    this.lifecycle = new AgentPiCodingAgentSessionLifecycle(
      this.sessions,
      this.leases,
      resolveAgentPiSessionCacheCapacity(options.maxIdleSessions),
      options.diagnostics,
    );
  }

  async lease(input: AgentPiCodingAgentLeaseInput): Promise<AgentPiCodingAgentLeaseResult> {
    const finishOperation = this.lifecycle.beginOperation();
    let releaseLease: (() => void) | undefined;
    let pooled: AgentPiPooledCodingSession | undefined;
    try {
      releaseLease = await this.leases.acquire(input.sessionId, input.signal);
      this.lifecycle.assertOpen();
      const opened = await this.openOrCreate(input);
      pooled = opened.value;
      const leasedSession = pooled;
      const leasedRelease = releaseLease;
      pooled.activeLeases += 1;
      pooled.lastAccess = this.lifecycle.nextAccessSequence();
      await this.factory.configure(pooled, input);
      return {
        storage: opened.storage,
        historyMigrationRequired: opened.historyMigrationRequired,
        session: new AgentPiCodingAgentSession(pooled.session, pooled.sessionManager, () =>
          this.lifecycle.release(input.sessionId, leasedSession, leasedRelease, finishOperation),
        ),
      };
    } catch (error) {
      if (pooled && releaseLease) {
        this.lifecycle.release(input.sessionId, pooled, releaseLease, finishOperation);
      } else {
        releaseLease?.();
        finishOperation();
      }
      throw error;
    }
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
      if (pooled) pooled.session.agent.state.messages = sessionManager.buildSessionContext().messages;
      return true;
    } finally {
      release?.();
      finishOperation();
    }
  }

  async fork(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean> {
    const finishOperation = this.lifecycle.beginOperation();
    let release: (() => void) | undefined;
    let targetFile: string | undefined;
    try {
      release = await this.acquireSessionPair(sourceSessionId, targetSessionId);
      this.lifecycle.assertOpen();
      if (this.sessions.has(targetSessionId) || (await this.findSession(targetSessionId))) return false;
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
        if (targetFile) await fs.rm(targetFile, { force: true });
        return false;
      }
      targetManager.branch(entryId);
      targetManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.ForkBoundary, {
        sourceSessionId,
        entryId,
      });
      return true;
    } catch (error) {
      if (targetFile) await fs.rm(targetFile, { force: true });
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
      await fs.rm(info.path, { force: true });
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

  status(sessionId: string): Promise<AgentPiSessionRuntimeStatus | undefined> {
    return this.withExistingSession(sessionId, (pooled) => {
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
    });
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

  private async openOrCreate(input: AgentPiCodingAgentLeaseInput): Promise<{
    value: AgentPiPooledCodingSession;
    storage: "created" | "existing";
    historyMigrationRequired: boolean;
  }> {
    const current = this.sessions.get(input.sessionId);
    if (current) {
      return {
        value: current,
        storage: "existing",
        historyMigrationRequired: isAgentPiConversationHistoryEmpty(current.sessionManager),
      };
    }
    let existing = await this.openExistingSession(input.sessionId);
    if (existing && hasIncompatibleAgentPiToolObservationHistory(existing)) {
      const sessionFile = existing.getSessionFile();
      if (!sessionFile || relativePathWithin(this.sessionsRoot(), sessionFile) === undefined) {
        throw new Error("Incompatible Pi session escaped its managed storage root.");
      }
      await fs.rm(sessionFile, { force: true });
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
      historyMigrationRequired: isAgentPiConversationHistoryEmpty(sessionManager),
    };
  }

  private async openExistingSession(sessionId: string): Promise<SessionManager | undefined> {
    const info = await this.findSession(sessionId);
    return info ? SessionManager.open(info.path, this.sessionsRoot(), this.options.workspaceRoot) : undefined;
  }

  private async findSession(sessionId: string) {
    const sessions = await SessionManager.list(this.options.workspaceRoot, this.sessionsRoot());
    return sessions.find((session) => session.id === sessionId);
  }

  private sessionsRoot(): string {
    return path.resolve(this.options.workspaceRoot, this.options.sessionsRoot);
  }
}
