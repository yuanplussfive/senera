import { isUtf8 } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import ParcelWatcher from "@parcel/watcher";
import ignore, { type Ignore } from "ignore";
import readdirp, { type EntryInfo as ReaddirpEntry } from "readdirp";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { withAgentFileAccessRetry } from "../Core/AgentFs.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import {
  AgentWorkspaceResourceDomains,
  classifyAgentWorkspaceResource,
  listAgentWorkspaceNonContentRoots,
  resolveAgentWorkspaceLayout,
} from "../Core/AgentWorkspaceLayout.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentWorkspaceChangeSetProtocol,
  type ToolWorkspaceCaptureResult,
  type ToolWorkspaceFileContentSnapshot,
  type ToolWorkspaceFileSnapshot,
  type ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { hashWorkspaceFile, isProbablyBinary, missingWorkspaceSnapshot } from "./AgentWorkspaceSnapshotUtils.js";
import { compareWorkspaceSnapshots } from "./AgentWorkspaceSnapshotDiff.js";
import {
  AgentWorkspaceObserverSqliteStore,
  type AgentWorkspaceObserverBaselineRecord,
} from "./AgentWorkspaceObserverSqliteStore.js";

export interface AgentWorkspaceChangeObserverPort {
  beginBatch(batchId: string, callIds: readonly string[]): Promise<void>;
  completeCall(
    batchId: string,
    callId: string,
    exactPaths?: readonly string[],
  ): Promise<ToolWorkspaceCaptureResult | undefined>;
  skipCall(batchId: string, callId: string): void;
  cancelCall(batchId: string, callId: string): void;
  cancelPendingBatches(): void;
  openResourceLease?(): Promise<AgentWorkspaceObservationLease>;
  completeResourceLease?(resourceId: string): Promise<ToolWorkspaceCaptureResult | undefined>;
  hasResourceLease?(resourceId: string): boolean;
}

export interface AgentWorkspaceObservationLease {
  bind(resourceId: string): void;
  complete(): Promise<ToolWorkspaceCaptureResult | undefined>;
  cancel(): void;
}

export interface AgentWorkspaceObservationPort {
  openResourceLease?(): Promise<AgentWorkspaceObservationLease>;
  completeResourceLease?(resourceId: string): Promise<ToolWorkspaceCaptureResult | undefined>;
  hasResourceLease?(resourceId: string): boolean;
}

export interface AgentWorkspaceChangeObserverOptions {
  readonly workspaceRoot: string;
  readonly runtimeStateRoot?: string;
  readonly config: () => ResolvedAgentArtifactsConfig;
  readonly logger?: AgentLogger;
}

interface IndexedSnapshot {
  readonly snapshot: ToolWorkspaceFileSnapshot;
  readonly textBytes: number;
  readonly contentRef?: string;
}

interface ObservationBatch {
  readonly id: string;
  readonly callIds: ReadonlySet<string>;
  readonly completedCallIds: Set<string>;
  readonly executedCallIds: Set<string>;
  readonly exactPathKeys: Set<string>;
  readonly beforeByPath: Map<string, IndexedSnapshot | null>;
  readonly warnings: Set<string>;
  readonly waiters: Map<string, (capture: ToolWorkspaceCaptureResult | undefined) => void>;
  finalizing: boolean;
}

interface ObservationLeaseState {
  readonly id: string;
  resourceId?: string;
  readonly beforeByPath: Map<string, IndexedSnapshot | null>;
  readonly warnings: Set<string>;
  completion?: Promise<ToolWorkspaceCaptureResult | undefined>;
}

interface ScanDirectoryResult {
  readonly errors: readonly { readonly path: string; readonly error: unknown }[];
}

interface ContentBudget {
  bytes: number;
}

export class AgentWorkspaceChangeObserver implements AgentWorkspaceChangeObserverPort {
  private readonly workspaceRoot: string;
  private baseline?: AgentWorkspaceObserverSqliteStore;
  private readonly batches = new Map<string, ObservationBatch>();
  private readonly resourceLeases = new Map<string, ObservationLeaseState>();
  private readonly resourceLeasesByResourceId = new Map<string, ObservationLeaseState>();
  private readonly loggedFailures = new Set<string>();
  private readonly pendingWarnings = new Set<string>();
  private subscription?: Awaited<ReturnType<typeof ParcelWatcher.subscribe>>;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private eventQueue: Promise<void> = Promise.resolve();
  private pendingEvents = new Map<string, ParcelWatcher.Event>();
  private eventDrainQueued = false;
  private initialEvents = new Map<string, ParcelWatcher.Event>();
  private initialScanInProgress = false;
  private unavailable = false;
  private closed = false;
  private retainedTextBytes = 0;
  private ignoredPathKeys = new Set<string>();
  private workspaceIgnore: Ignore = ignore();

  constructor(private readonly options: AgentWorkspaceChangeObserverOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  private observerStore(): AgentWorkspaceObserverSqliteStore {
    return (this.baseline ??= (() => {
      const layout = resolveAgentWorkspaceLayout(this.workspaceRoot, this.options.runtimeStateRoot);
      return new AgentWorkspaceObserverSqliteStore(
        layout.databases.workspaceObserver,
        layout.caches.workspaceObserverContents,
      );
    })());
  }

  async beginBatch(batchId: string, callIds: readonly string[]): Promise<void> {
    if (this.closed || callIds.length === 0 || this.batches.has(batchId)) return;
    await this.ensureStarted();
    if (this.closed || this.unavailable) return;
    await this.eventQueue;

    this.batches.set(batchId, {
      id: batchId,
      callIds: new Set(callIds),
      completedCallIds: new Set(),
      executedCallIds: new Set(),
      exactPathKeys: new Set(),
      beforeByPath: new Map(),
      warnings: new Set(this.pendingWarnings),
      waiters: new Map(),
      finalizing: false,
    });
    this.pendingWarnings.clear();
  }

  async openResourceLease(): Promise<AgentWorkspaceObservationLease> {
    await this.ensureStarted();
    await this.eventQueue;
    const lease: ObservationLeaseState = {
      id: createOpaqueId("workspacelease"),
      beforeByPath: new Map(),
      warnings: new Set(this.pendingWarnings),
    };
    this.resourceLeases.set(lease.id, lease);
    this.pendingWarnings.clear();
    return {
      bind: (resourceId) => this.bindResourceLease(lease, resourceId),
      complete: () => this.completeLease(lease),
      cancel: () => this.cancelLease(lease),
    };
  }

  async completeResourceLease(resourceId: string): Promise<ToolWorkspaceCaptureResult | undefined> {
    return this.completeLease(this.resourceLeasesByResourceId.get(resourceId));
  }

  hasResourceLease(resourceId: string): boolean {
    return this.resourceLeasesByResourceId.has(resourceId);
  }

  async completeCall(
    batchId: string,
    callId: string,
    exactPaths: readonly string[] = [],
  ): Promise<ToolWorkspaceCaptureResult | undefined> {
    const batch = this.batches.get(batchId);
    if (!batch || !batch.callIds.has(callId) || batch.completedCallIds.has(callId)) return undefined;

    for (const value of exactPaths) {
      const relative = this.normalizeWorkspacePath(value);
      if (relative) batch.exactPathKeys.add(this.pathKey(relative));
    }
    batch.completedCallIds.add(callId);
    batch.executedCallIds.add(callId);
    return new Promise((resolve) => {
      batch.waiters.set(callId, resolve);
      this.finalizeIfReady(batch);
    });
  }

  skipCall(batchId: string, callId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch || !batch.callIds.has(callId) || batch.completedCallIds.has(callId)) return;
    batch.completedCallIds.add(callId);
    this.finalizeIfReady(batch);
  }

  cancelCall(batchId: string, callId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch || !batch.callIds.has(callId)) return;
    const resolve = batch.waiters.get(callId);
    batch.waiters.delete(callId);
    resolve?.(undefined);
    batch.completedCallIds.add(callId);
    batch.executedCallIds.add(callId);
    this.finalizeIfReady(batch);
  }

  cancelPendingBatches(): void {
    for (const batch of this.batches.values()) this.cancelBatch(batch);
    this.batches.clear();
  }

  private bindResourceLease(lease: ObservationLeaseState, resourceId: string): void {
    if (!this.resourceLeases.has(lease.id) || !resourceId.trim()) return;
    const previous = this.resourceLeasesByResourceId.get(resourceId);
    if (previous && previous !== lease) this.cancelLease(previous);
    lease.resourceId = resourceId;
    this.resourceLeasesByResourceId.set(resourceId, lease);
  }

  private completeLease(lease: ObservationLeaseState | undefined): Promise<ToolWorkspaceCaptureResult | undefined> {
    if (!lease) return Promise.resolve(undefined);
    if (lease.completion) return lease.completion;
    lease.completion = this.finalizeLease(lease);
    return lease.completion;
  }

  private async finalizeLease(lease: ObservationLeaseState): Promise<ToolWorkspaceCaptureResult | undefined> {
    try {
      await this.settleEvents();
      return await this.materializeTrackedChanges({
        scope: { kind: "resource", id: lease.resourceId ?? lease.id },
        beforeByPath: lease.beforeByPath,
        warnings: lease.warnings,
      });
    } catch (error) {
      this.recordFailure(this.workspaceRoot, error);
      return undefined;
    } finally {
      this.removeResourceLease(lease);
      this.releaseSnapshots(lease.beforeByPath);
    }
  }

  private cancelLease(lease: ObservationLeaseState): void {
    if (!this.resourceLeases.has(lease.id)) return;
    this.removeResourceLease(lease);
    this.releaseSnapshots(lease.beforeByPath);
  }

  private removeResourceLease(lease: ObservationLeaseState): void {
    this.resourceLeases.delete(lease.id);
    if (lease.resourceId && this.resourceLeasesByResourceId.get(lease.resourceId) === lease) {
      this.resourceLeasesByResourceId.delete(lease.resourceId);
    }
  }

  private releaseSnapshots(snapshots: Map<string, IndexedSnapshot | null>): void {
    for (const entry of snapshots.values()) if (entry) this.release(entry);
    snapshots.clear();
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeOwnedResources());
  }

  private async ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    return this.startPromise;
  }

  private async start(): Promise<void> {
    this.initialScanInProgress = true;
    try {
      const ignoredPaths = this.resolveIgnoredPaths();
      this.ignoredPathKeys = new Set(ignoredPaths.map((value) => this.pathKey(value)));
      this.workspaceIgnore = await this.loadWorkspaceIgnore();
      this.subscription = await ParcelWatcher.subscribe(
        this.workspaceRoot,
        (error, events) => this.receiveEvents(error, events),
        {
          ignore: [
            ...new Set([
              ...listAgentWorkspaceNonContentRoots(this.workspaceRoot),
              ...ignoredPaths.map((value) => path.resolve(this.workspaceRoot, value)),
            ]),
          ],
        },
      );
      const scanGeneration = this.observerStore().beginReconciliation();
      let initial: ScanDirectoryResult;
      let complete = false;
      try {
        initial = await this.scanDirectory(this.workspaceRoot, "", 0, (key, entry) => this.setCurrent(key, entry));
        complete = initial.errors.length === 0;
      } finally {
        this.observerStore().finishReconciliation(scanGeneration, complete);
      }
      initial.errors.forEach((failure) => this.recordFailure(failure.path, failure.error));
      this.initialScanInProgress = false;
      if (this.initialEvents.size > 0) {
        const events = [...this.initialEvents.values()];
        this.initialEvents.clear();
        this.enqueueEvents(events);
      }
      await this.eventQueue;
    } catch (error) {
      this.initialScanInProgress = false;
      this.unavailable = true;
      this.initialEvents.clear();
      await this.subscription?.unsubscribe().catch(() => undefined);
      this.subscription = undefined;
      this.reportUnavailable(error);
    }
  }

  private receiveEvents(error: Error | null, events: ParcelWatcher.Event[]): void {
    if (this.closed) return;
    if (error) this.recordFailure(this.workspaceRoot, error);
    if (this.initialScanInProgress) {
      for (const event of events) this.initialEvents.set(this.initialEventKey(event), event);
      return;
    }
    this.enqueueEvents(events);
  }

  private enqueueEvents(events: readonly ParcelWatcher.Event[]): void {
    if (this.closed || this.unavailable) return;
    for (const event of events) this.pendingEvents.set(this.initialEventKey(event), event);
    this.scheduleEventDrain();
  }

  private scheduleEventDrain(): void {
    if (this.eventDrainQueued || this.pendingEvents.size === 0 || this.closed || this.unavailable) return;
    this.eventDrainQueued = true;
    const work = this.eventQueue.then(() => this.drainPendingEvents());
    this.eventQueue = work
      .catch((error: unknown) => {
        this.recordFailure(this.workspaceRoot, error);
      })
      .finally(() => {
        this.eventDrainQueued = false;
        this.scheduleEventDrain();
      });
  }

  private async drainPendingEvents(): Promise<void> {
    while (this.pendingEvents.size > 0 && !this.closed && !this.unavailable) {
      const events = [...this.pendingEvents.values()];
      this.pendingEvents.clear();
      await this.applyEvents(events);
    }
  }

  private async applyEvents(events: readonly ParcelWatcher.Event[]): Promise<void> {
    const allowGitignoredPaths = this.hasActiveResourceObservation();
    const affected = collapseEventPaths(events, this.workspaceRoot)
      .map((relativePath) => ({
        absolutePath: path.resolve(this.workspaceRoot, ...relativePath.split("/")),
        relativePath,
      }))
      .filter((entry) => this.isObservablePath(entry.absolutePath, entry.relativePath, allowGitignoredPaths));

    for (const entry of affected) {
      await this.refreshPath(entry.absolutePath, entry.relativePath, allowGitignoredPaths);
    }
  }

  private async refreshPath(absolutePath: string, relativePath: string, allowGitignoredPaths = false): Promise<void> {
    const key = this.pathKey(relativePath);
    let stats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      stats = await withAgentFileAccessRetry(() => fs.lstat(absolutePath));
    } catch (error) {
      if (!isMissingPathError(error)) {
        this.recordFailure(relativePath, error);
        return;
      }
    }

    if (!stats || stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
      for (const [oldKey, record] of this.observerStore().iterateSubtree(key)) {
        this.rememberBefore(oldKey, this.fromBaselineRecord(record));
      }
      this.observerStore().removeSubtree(key);
      return;
    }

    if (!stats.isDirectory()) {
      try {
        this.rememberBefore(key);
        const budget = { bytes: 0 };
        const next = await this.createFileSnapshot(
          absolutePath,
          relativePath,
          stats,
          this.textBytesAlreadyRetainedFor(key),
          budget,
        );
        const previous = this.getCurrent(key);
        if (previous) this.deleteCurrent(key);
        if (next) this.setCurrent(key, next);
      } catch (error) {
        if (isMissingPathError(error)) {
          const previous = this.getCurrent(key);
          if (previous) this.deleteCurrent(key);
          return;
        }
        this.recordFailure(relativePath, error);
      }
      return;
    }

    for (const [oldKey, record] of this.observerStore().iterateSubtree(key)) {
      this.rememberBefore(oldKey, this.fromBaselineRecord(record));
    }
    const stagedEntries: Array<readonly [string, IndexedSnapshot]> = [];
    const staged = await this.scanDirectory(
      absolutePath,
      relativePath,
      this.textBytesAlreadyRetainedForSubtree(key),
      (nextKey, nextEntry) => stagedEntries.push([nextKey, nextEntry]),
      allowGitignoredPaths,
    );
    if (staged.errors.length > 0) {
      staged.errors.forEach((failure) => this.recordFailure(failure.path, failure.error));
      return;
    }

    for (const [nextKey] of stagedEntries) this.rememberBefore(nextKey);
    this.observerStore().replaceSubtree(
      key,
      stagedEntries.map(([nextKey, nextEntry]) => [nextKey, this.toBaselineRecord(nextEntry)] as const),
    );
  }

  private async scanDirectory(
    absoluteDirectory: string,
    relativeDirectory: string,
    retainedTextBytes: number,
    acceptEntry: (key: string, entry: IndexedSnapshot) => void,
    allowGitignoredPaths = false,
  ): Promise<ScanDirectoryResult> {
    const errors: { path: string; error: unknown }[] = [];
    const budget: ContentBudget = { bytes: 0 };

    const storeSnapshot = (relativePath: string, entry: IndexedSnapshot): void => {
      const key = this.pathKey(relativePath);
      acceptEntry(key, entry);
    };

    const toRelativePath = (absolutePath: string): string | undefined => {
      const relative = relativePathWithin(this.workspaceRoot, path.resolve(absolutePath));
      return relative === undefined ? undefined : normalizeRelative(relative);
    };

    const scanErrorPath = (error: Error): string => {
      if (typeof error === "object" && error !== null && "path" in error) {
        const errorPath = (error as Error & { path?: unknown }).path;
        if (typeof errorPath === "string") {
          const relative = toRelativePath(errorPath);
          if (relative) return relative;
        }
      }
      return relativeDirectory || absoluteDirectory;
    };

    const shouldDescend = (entry: ReaddirpEntry): boolean => {
      const stats = entry.stats;
      if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) return false;
      const relativePath = toRelativePath(entry.fullPath);
      return relativePath !== undefined && this.isObservablePath(entry.fullPath, relativePath, allowGitignoredPaths);
    };

    const shouldInclude = (entry: ReaddirpEntry): boolean => {
      const stats = entry.stats;
      if (!stats || stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) return false;
      const relativePath = toRelativePath(entry.fullPath);
      return relativePath !== undefined && this.isObservablePath(entry.fullPath, relativePath, allowGitignoredPaths);
    };

    try {
      const stats = await withAgentFileAccessRetry(() => fs.lstat(absoluteDirectory));
      if (stats.isDirectory()) {
        if (relativeDirectory) {
          storeSnapshot(
            relativeDirectory,
            this.createDirectorySnapshot(absoluteDirectory, relativeDirectory, Number(stats.mtimeMs)),
          );
        }
        const stream = readdirp(absoluteDirectory, {
          type: "files_directories",
          alwaysStat: true,
          lstat: true,
          directoryFilter: shouldDescend,
          fileFilter: shouldInclude,
        });
        await consumeReaddirpStream(
          stream,
          async (entry) => {
            const relativePath = toRelativePath(entry.fullPath);
            if (!relativePath || !shouldInclude(entry)) return;
            const stats = entry.stats;
            if (!stats) throw new Error("Directory walker did not return file metadata.");
            if (stats.isSymbolicLink()) return;
            if (stats.isDirectory()) {
              storeSnapshot(
                relativePath,
                this.createDirectorySnapshot(entry.fullPath, relativePath, Number(stats.mtimeMs)),
              );
              return;
            }
            if (!stats.isFile()) return;
            const file = await this.createFileSnapshot(
              entry.fullPath,
              relativePath,
              stats,
              retainedTextBytes + budget.bytes,
              budget,
            );
            if (file) storeSnapshot(relativePath, file);
          },
          (error) => errors.push({ path: scanErrorPath(error), error }),
        );
      } else {
        if (relativeDirectory && this.isObservablePath(absoluteDirectory, relativeDirectory, allowGitignoredPaths)) {
          const file = await this.createFileSnapshot(
            absoluteDirectory,
            relativeDirectory,
            stats,
            retainedTextBytes,
            budget,
          );
          if (file) storeSnapshot(relativeDirectory, file);
        }
      }
    } catch (error) {
      if (!isMissingPathError(error) || !relativeDirectory) {
        errors.push({ path: scanErrorPath(error as Error), error });
      }
    }

    return { errors };
  }

  private async createFileSnapshot(
    absolutePath: string,
    relativePath: string,
    stats: Awaited<ReturnType<typeof fs.lstat>>,
    textBudgetBytes: number,
    budget: ContentBudget,
  ): Promise<IndexedSnapshot> {
    const config = this.options.config();
    const sizeLimit = config.TextFileMaxBytes;
    const cacheLimit = config.WorkspaceObserverMemoryMaxBytes;
    const byteLength = Number(stats.size);
    const mtimeMs = Number(stats.mtimeMs);
    const mayReadText = byteLength <= sizeLimit && textBudgetBytes + byteLength <= cacheLimit;
    let hash: string;
    let content: ToolWorkspaceFileContentSnapshot;
    let contentRef: string | undefined;
    let size = byteLength;

    if (mayReadText) {
      const bytes = await withAgentFileAccessRetry(() => fs.readFile(absolutePath));
      size = bytes.byteLength;
      hash = `sha256:${sha256Hex(bytes)}`;
      if (size > sizeLimit) {
        content = { state: "omitted", reason: "size_limit", byteLength: size };
      } else if (!isUtf8(bytes) || isProbablyBinary(bytes)) {
        content = { state: "omitted", reason: "binary", byteLength: size };
      } else {
        const text = bytes.toString("utf8");
        contentRef = sha256Hex(bytes);
        await this.observerStore().saveText(contentRef, text);
        content = {
          state: "captured",
          encoding: "utf8",
          byteLength: size,
          lineCount: countLines(text),
        };
        budget.bytes += size;
      }
    } else {
      hash = await withAgentFileAccessRetry(() => hashWorkspaceFile(absolutePath));
      content = {
        state: "omitted",
        reason: byteLength > sizeLimit ? "size_limit" : "cache_limit",
        byteLength,
      };
    }

    return {
      snapshot: {
        path: relativePath,
        absolutePath,
        exists: true,
        kind: "file",
        size,
        mtimeMs,
        hash,
        content,
      },
      textBytes: content.state === "captured" ? size : 0,
      contentRef,
    };
  }

  private createDirectorySnapshot(absolutePath: string, relativePath: string, mtimeMs: number): IndexedSnapshot {
    return {
      snapshot: {
        path: relativePath,
        absolutePath,
        exists: true,
        kind: "directory",
        size: 0,
        mtimeMs,
        hash: `sha256:${sha256Hex("directory")}`,
        content: { state: "omitted", reason: "directory", byteLength: 0 },
      },
      textBytes: 0,
    };
  }

  private async materializeBatch(batch: ObservationBatch): Promise<ToolWorkspaceCaptureResult | undefined> {
    return this.materializeTrackedChanges({
      scope: { kind: "tool_batch", id: batch.id },
      beforeByPath: batch.beforeByPath,
      warnings: batch.warnings,
      exactPathKeys: batch.exactPathKeys,
    });
  }

  private async materializeTrackedChanges(input: {
    readonly scope: NonNullable<ToolWorkspaceCaptureResult["scope"]>;
    readonly beforeByPath: ReadonlyMap<string, IndexedSnapshot | null>;
    readonly warnings: ReadonlySet<string>;
    readonly exactPathKeys?: ReadonlySet<string>;
  }): Promise<ToolWorkspaceCaptureResult | undefined> {
    const keys = [...input.beforeByPath.keys()]
      .filter((key) => !input.exactPathKeys?.has(key))
      .sort((left, right) => left.localeCompare(right));
    const beforeFiles: ToolWorkspaceFileSnapshot[] = [];
    const afterFiles: ToolWorkspaceFileSnapshot[] = [];

    for (const key of keys) {
      const before = input.beforeByPath.get(key) ?? null;
      const after = this.getCurrent(key);
      const relativePath = before?.snapshot.path ?? after?.snapshot.path;
      if (!relativePath) continue;
      const absolutePath =
        after?.snapshot.absolutePath ?? before?.snapshot.absolutePath ?? path.join(this.workspaceRoot, relativePath);
      beforeFiles.push(
        before ? await this.hydrateSnapshot(before) : missingWorkspaceSnapshot(relativePath, absolutePath),
      );
      afterFiles.push(after ? await this.hydrateSnapshot(after) : missingWorkspaceSnapshot(relativePath, absolutePath));
    }

    const capturedAt = new Date().toISOString();
    const quality =
      input.warnings.size > 0
        ? "degraded"
        : [...beforeFiles, ...afterFiles].some(
              (entry) =>
                entry.content?.state === "omitted" &&
                (entry.content.reason === "size_limit" || entry.content.reason === "cache_limit"),
            )
          ? "bounded"
          : "complete";
    const warnings = [...input.warnings].sort();
    const before: ToolWorkspaceSnapshot = {
      files: beforeFiles,
      capturedAt,
      status: quality,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    const after: ToolWorkspaceSnapshot = {
      files: afterFiles,
      capturedAt,
      status: quality,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    const changes = compareWorkspaceSnapshots(before, after).filter((change) => change.status !== "unchanged");
    if (changes.length === 0 && warnings.length === 0) return undefined;

    return {
      type: AgentWorkspaceChangeSetProtocol.type,
      version: AgentWorkspaceChangeSetProtocol.version,
      source: "filesystem-observer",
      coverage: "observed",
      status: quality,
      scope: input.scope,
      before,
      after,
      changes,
    };
  }

  private rememberBefore(key: string, current?: IndexedSnapshot): void {
    if (this.batches.size === 0 && this.resourceLeases.size === 0) return;
    const entry = current ?? this.getCurrent(key);
    for (const batch of this.batches.values()) {
      if (batch.beforeByPath.has(key)) continue;
      batch.beforeByPath.set(key, entry ? this.retain(entry) : null);
    }
    for (const lease of this.resourceLeases.values()) {
      if (lease.beforeByPath.has(key)) continue;
      lease.beforeByPath.set(key, entry ? this.retain(entry) : null);
    }
  }

  private setCurrent(key: string, entry: IndexedSnapshot): void {
    this.rememberBefore(key);
    this.observerStore().upsert(key, this.toBaselineRecord(entry));
  }

  private deleteCurrent(key: string): void {
    this.observerStore().remove(key);
  }

  private retain(entry: IndexedSnapshot): IndexedSnapshot {
    this.retainedTextBytes += entry.textBytes;
    return entry;
  }

  private release(entry: IndexedSnapshot): void {
    this.retainedTextBytes = Math.max(0, this.retainedTextBytes - entry.textBytes);
  }

  private textBytesAlreadyRetainedFor(_key: string): number {
    return this.retainedTextBytesForCapture();
  }

  private textBytesAlreadyRetainedForSubtree(_prefix: string): number {
    return this.retainedTextBytesForCapture();
  }

  private retainedTextBytesForCapture(): number {
    return this.retainedTextBytes;
  }

  private getCurrent(key: string): IndexedSnapshot | undefined {
    const record = this.observerStore().get(key);
    return record ? this.fromBaselineRecord(record) : undefined;
  }

  private fromBaselineRecord(record: AgentWorkspaceObserverBaselineRecord): IndexedSnapshot {
    return {
      snapshot: {
        path: record.path,
        absolutePath: path.join(this.workspaceRoot, ...record.path.split("/")),
        exists: true,
        kind: record.kind,
        size: record.size,
        mtimeMs: record.mtimeMs,
        hash: record.hash,
        content: record.content,
      },
      textBytes: record.content.state === "captured" ? record.content.byteLength : 0,
      contentRef: record.contentRef,
    };
  }

  private toBaselineRecord(entry: IndexedSnapshot): AgentWorkspaceObserverBaselineRecord {
    if (entry.snapshot.kind !== "file" && entry.snapshot.kind !== "directory") {
      throw new Error(`Workspace observer cannot persist unsupported entry kind: ${entry.snapshot.kind}.`);
    }
    if (!entry.snapshot.content) {
      throw new Error(`Workspace observer snapshot ${entry.snapshot.path} is missing content metadata.`);
    }
    return {
      path: entry.snapshot.path,
      kind: entry.snapshot.kind,
      size: entry.snapshot.size,
      mtimeMs: entry.snapshot.mtimeMs,
      hash: entry.snapshot.hash,
      content: entry.snapshot.content,
      contentRef: entry.contentRef,
    };
  }

  private async hydrateSnapshot(entry: IndexedSnapshot): Promise<ToolWorkspaceFileSnapshot> {
    if (entry.snapshot.content?.state !== "captured") return entry.snapshot;
    if (!entry.contentRef) throw new Error(`Captured workspace file ${entry.snapshot.path} has no content reference.`);
    const text = await this.observerStore().readText(entry.contentRef);
    return {
      ...entry.snapshot,
      content: { ...entry.snapshot.content, text },
    };
  }

  private releaseBatchSnapshots(batch: ObservationBatch): void {
    this.releaseSnapshots(batch.beforeByPath);
  }

  private cancelBatch(batch: ObservationBatch): void {
    this.batches.delete(batch.id);
    this.releaseBatchSnapshots(batch);
    for (const resolve of batch.waiters.values()) resolve(undefined);
    batch.waiters.clear();
  }

  private async settleEvents(): Promise<void> {
    await this.eventQueue;
    const settleMs = this.options.config().WorkspaceObserverSettleMs;
    if (settleMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
    await this.eventQueue;
  }

  private finalizeIfReady(batch: ObservationBatch): void {
    if (batch.finalizing || batch.completedCallIds.size !== batch.callIds.size) return;
    batch.finalizing = true;
    void this.finalizeBatch(batch);
  }

  private async finalizeBatch(batch: ObservationBatch): Promise<void> {
    let capture: ToolWorkspaceCaptureResult | undefined;
    try {
      await this.settleEvents();
      if (this.batches.get(batch.id) === batch) capture = await this.materializeBatch(batch);
    } catch (error) {
      this.recordFailure(this.workspaceRoot, error);
    } finally {
      if (this.batches.get(batch.id) === batch) this.batches.delete(batch.id);
      this.releaseBatchSnapshots(batch);
      const recipient = [...batch.callIds].find(
        (callId) => batch.executedCallIds.has(callId) && batch.waiters.has(callId),
      );
      for (const [callId, resolve] of batch.waiters) resolve(callId === recipient ? capture : undefined);
      batch.waiters.clear();
    }
  }

  private resolveIgnoredPaths(): string[] {
    return this.options.config().WorkspaceObserverIgnoredPaths.flatMap((value) => {
      const absolutePath = path.resolve(this.workspaceRoot, value);
      const relativePath = relativePathWithin(this.workspaceRoot, absolutePath);
      const normalized = relativePath === undefined ? "" : normalizeRelative(relativePath);
      if (!normalized) {
        this.recordFailure(value, new Error("Ignored workspace paths must resolve inside the workspace root."));
        return [];
      }
      return [normalized];
    });
  }

  private async loadWorkspaceIgnore(): Promise<Ignore> {
    const matcher = ignore({ ignorecase: process.platform === "win32" });
    try {
      const content = await withAgentFileAccessRetry(() =>
        fs.readFile(path.join(this.workspaceRoot, ".gitignore"), "utf8"),
      );
      matcher.add(content.split(/\r?\n/gu));
    } catch (error) {
      if (!isMissingPathError(error)) this.recordFailure(".gitignore", error);
    }
    return matcher;
  }

  private isObservablePath(absolutePath: string, relativePath: string, allowGitignoredPaths = false): boolean {
    if (this.ignoredPathKeys.has(this.pathKey(relativePath))) return false;
    const key = this.pathKey(relativePath);
    for (const ignored of this.ignoredPathKeys) {
      if (key.startsWith(`${ignored}/`)) return false;
    }
    if (
      !allowGitignoredPaths &&
      (this.workspaceIgnore.ignores(relativePath) || this.workspaceIgnore.ignores(`${relativePath}/`))
    ) {
      return false;
    }
    return (
      classifyAgentWorkspaceResource(this.workspaceRoot, absolutePath).domain ===
      AgentWorkspaceResourceDomains.WorkspaceContent
    );
  }

  /**
   * A resource lease represents a running mutating process whose side effects
   * must be attributed to the owning tool. Repository ignore rules still
   * control idle indexing and ordinary batches, but cannot hide a path created
   * during that active resource observation.
   */
  private hasActiveResourceObservation(): boolean {
    return this.resourceLeases.size > 0;
  }

  private normalizeWorkspacePath(value: string): string | undefined {
    const normalized = normalizeRelative(value);
    if (!normalized || normalized === ".") return undefined;
    const absolutePath = path.resolve(this.workspaceRoot, normalized);
    const relative = relativePathWithin(this.workspaceRoot, absolutePath);
    return relative && normalizeRelative(relative) === normalized ? normalized : undefined;
  }

  private initialEventKey(event: ParcelWatcher.Event): string {
    const relative = relativePathWithin(this.workspaceRoot, path.resolve(event.path));
    return relative === undefined ? path.resolve(event.path) : this.pathKey(normalizeRelative(relative));
  }

  private pathKey(relativePath: string): string {
    const normalized = normalizeRelative(relativePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  private recordFailure(target: string, error: unknown): void {
    const message = `${target}: ${errorMessage(error)}`;
    this.pendingWarnings.add(message);
    for (const batch of this.batches.values()) batch.warnings.add(message);
    for (const lease of this.resourceLeases.values()) lease.warnings.add(message);
    if (this.loggedFailures.has(message)) return;
    this.loggedFailures.add(message);
    this.options.logger?.warn("workspace.change_observer.degraded", { path: target, message: errorMessage(error) });
  }

  private reportUnavailable(error: unknown): void {
    this.options.logger?.warn("workspace.change_observer.unavailable", {
      workspaceRoot: this.workspaceRoot,
      message: errorMessage(error),
    });
  }

  private async closeOwnedResources(): Promise<void> {
    this.closed = true;
    this.pendingEvents.clear();
    this.initialEvents.clear();
    await this.startPromise;
    this.cancelPendingBatches();
    await this.subscription?.unsubscribe();
    this.subscription = undefined;
    await this.eventQueue;
    await Promise.allSettled(
      [...this.resourceLeases.values()].map((lease) => {
        if (lease.completion) return lease.completion;
        this.cancelLease(lease);
        return Promise.resolve();
      }),
    );
    this.resourceLeases.clear();
    this.resourceLeasesByResourceId.clear();
    this.baseline?.close();
  }
}

function collapseEventPaths(events: readonly ParcelWatcher.Event[], root: string): string[] {
  const candidates = new Map<string, string>();
  for (const event of events) {
    const relativePath = relativePathWithin(root, path.resolve(event.path));
    if (relativePath === undefined || relativePath === "") continue;
    const normalized = normalizeRelative(relativePath);
    candidates.set(workspacePathKey(normalized), normalized);
  }

  const ordered = [...candidates.values()].sort(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
  const roots: string[] = [];
  const selected = new Set<string>();
  for (const candidate of ordered) {
    let parent = path.posix.dirname(candidate);
    let covered = false;
    while (parent !== ".") {
      if (selected.has(workspacePathKey(parent))) {
        covered = true;
        break;
      }
      parent = path.posix.dirname(parent);
    }
    if (covered) continue;
    roots.push(candidate);
    selected.add(workspacePathKey(candidate));
  }
  return roots;
}

function workspacePathKey(relativePath: string): string {
  return process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
}

async function consumeReaddirpStream(
  stream: ReturnType<typeof readdirp>,
  consume: (entry: ReaddirpEntry) => Promise<void>,
  onWarning: (error: Error) => void,
): Promise<void> {
  stream.on("warn", onWarning);
  try {
    for await (const entry of stream) await consume(entry);
  } finally {
    stream.off("warn", onWarning);
  }
}

function normalizeRelative(value: string): string {
  return path.posix.normalize(value.replace(/\\/gu, "/")).replace(/^\.\//u, "");
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  return value.endsWith("\n") ? value.slice(0, -1).split("\n").length : value.split("\n").length;
}
