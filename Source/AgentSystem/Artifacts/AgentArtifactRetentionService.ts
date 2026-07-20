import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentRuntimeConfigTypes.js";
import { SeneraOutputSpoolMarkerFileName, type SeneraOutputSpoolState } from "../Execution/SeneraOutputSpool.js";
import { AgentArtifactFileNames, assertInsideRoot } from "./AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";

const OutputSpoolDirectoryName = ".spool";

export interface AgentArtifactRetentionServiceOptions {
  readonly workspaceRoot: string;
  readonly config: () => ResolvedAgentArtifactsConfig;
  readonly onError?: (error: unknown) => void;
}

export interface AgentArtifactMaintenanceReport {
  readonly dryRun: boolean;
  readonly artifactRoot: string;
  readonly scannedArtifacts: number;
  readonly scannedIncompleteDirectories: number;
  readonly scannedSpools: number;
  readonly retainedArtifacts: number;
  readonly retainedIncompleteDirectories: number;
  readonly retainedSpools: number;
  readonly retainedBytes: number;
  readonly removedArtifacts: number;
  readonly removedIncompleteDirectories: number;
  readonly removedSpools: number;
  readonly removedBytes: number;
  readonly reason: "scheduled" | "session";
}

interface ArtifactCandidate {
  readonly directory: string;
  readonly bytes: number;
  readonly modifiedAt: number;
  readonly sessionId?: string;
}

interface IncompleteArtifactCandidate extends ArtifactCandidate {
  readonly state: "writing" | "failed";
}

interface OutputSpoolCandidate {
  readonly directory: string;
  readonly bytes: number;
  readonly modifiedAt: number;
  readonly sessionId?: string;
  readonly state: SeneraOutputSpoolState;
}

export class AgentArtifactRetentionService {
  private readonly workspaceRoot: string;
  private readonly config: () => ResolvedAgentArtifactsConfig;
  private readonly onError?: (error: unknown) => void;
  private readonly boundary: SeneraWorkspaceBoundary;
  private operation?: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(options: AgentArtifactRetentionServiceOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.config = options.config;
    this.onError = options.onError;
    this.boundary = new SeneraWorkspaceBoundary({ workspaceRoot: this.workspaceRoot, linkPolicy: "deny" });
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.config().MaintenanceIntervalMinutes * 60_000;
    this.timer = setInterval(() => {
      void this.cleanup().catch((error) => this.onError?.(error));
    }, intervalMs);
    this.timer.unref();
    void this.cleanup().catch((error) => this.onError?.(error));
  }

  cleanup(): Promise<AgentArtifactMaintenanceReport> {
    return this.enqueue(() => this.cleanupInternal("scheduled", undefined, false));
  }

  inspect(): Promise<AgentArtifactMaintenanceReport> {
    return this.enqueue(() => this.cleanupInternal("scheduled", undefined, true));
  }

  removeSessionArtifacts(sessionId: string): Promise<AgentArtifactMaintenanceReport> {
    const normalized = sessionId.trim();
    if (!normalized) return Promise.reject(new Error("sessionId must be a non-empty string."));
    return this.enqueue(() => this.cleanupInternal("session", normalized, false));
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.operation?.catch(() => undefined);
  }

  private enqueue(task: () => Promise<AgentArtifactMaintenanceReport>): Promise<AgentArtifactMaintenanceReport> {
    const operation = (this.operation ?? Promise.resolve()).then(task);
    this.operation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async cleanupInternal(
    reason: AgentArtifactMaintenanceReport["reason"],
    sessionId?: string,
    dryRun = false,
  ): Promise<AgentArtifactMaintenanceReport> {
    const config = this.config();
    const lexicalRoot = assertInsideRoot(
      this.workspaceRoot,
      path.resolve(this.workspaceRoot, config.RootDir),
      `artifact 根目录超出工作区：${config.RootDir}`,
    );
    const artifactRoot = (await this.boundary.resolve(lexicalRoot, AgentResourceAccessIntents.Read)).absolutePath;
    const candidates = await scanArtifactDirectories(artifactRoot, config.MaintenanceMaxConcurrency);
    const now = Date.now();
    const removed = new Set<string>();
    let removedBytes = 0;
    let removedArtifacts = 0;
    let removedIncompleteDirectories = 0;
    let removedSpools = 0;

    const remove = async (candidate: ArtifactCandidate, incomplete: boolean): Promise<void> => {
      if (removed.has(candidate.directory)) return;
      if (!dryRun) await removeArtifactDirectory(this.boundary, artifactRoot, candidate.directory);
      removed.add(candidate.directory);
      removedBytes += candidate.bytes;
      if (incomplete) removedIncompleteDirectories += 1;
      else removedArtifacts += 1;
    };

    const removeSpool = async (candidate: OutputSpoolCandidate): Promise<void> => {
      if (removed.has(candidate.directory)) return;
      if (!dryRun) await removeArtifactDirectory(this.boundary, artifactRoot, candidate.directory);
      removed.add(candidate.directory);
      removedBytes += candidate.bytes;
      removedSpools += 1;
    };

    if (sessionId) {
      for (const candidate of candidates.complete) {
        if (candidate.sessionId === sessionId) await remove(candidate, false);
      }
      for (const candidate of candidates.incomplete) {
        if (candidate.sessionId === sessionId) await remove(candidate, true);
      }
      for (const candidate of candidates.spools) {
        if (candidate.sessionId === sessionId) await removeSpool(candidate);
      }
    } else {
      const incompleteRetentionMs = config.IncompleteRetentionHours * 3_600_000;
      for (const candidate of candidates.incomplete) {
        if (now - candidate.modifiedAt >= incompleteRetentionMs) await remove(candidate, true);
      }
      for (const candidate of candidates.spools) {
        if (candidate.state === "committed" || now - candidate.modifiedAt >= incompleteRetentionMs) {
          await removeSpool(candidate);
        }
      }
      const retentionMs = config.RetentionHours * 3_600_000;
      for (const candidate of candidates.complete) {
        if (now - candidate.modifiedAt >= retentionMs) await remove(candidate, false);
      }

      const retained = [...candidates.complete, ...candidates.incomplete, ...candidates.spools]
        .filter((candidate) => !removed.has(candidate.directory))
        .sort((left, right) => left.modifiedAt - right.modifiedAt);
      let retainedBytes = retained.reduce((total, candidate) => total + candidate.bytes, 0);
      let retainedCount = retained.length;
      for (const candidate of quotaCandidates(candidates, removed)) {
        if (retainedBytes <= config.MaxStoredBytes && retainedCount <= config.MaxArtifacts) break;
        if (candidate.kind === "spool") await removeSpool(candidate.value);
        else await remove(candidate.value, candidate.kind === "incomplete");
        retainedBytes -= candidate.bytes;
        retainedCount -= 1;
      }
    }

    const retainedCandidates = candidates.complete.filter((candidate) => !removed.has(candidate.directory));
    const retainedIncomplete = candidates.incomplete.filter((candidate) => !removed.has(candidate.directory));
    const retainedSpools = candidates.spools.filter((candidate) => !removed.has(candidate.directory));
    return {
      dryRun,
      artifactRoot,
      scannedArtifacts: candidates.complete.length,
      scannedIncompleteDirectories: candidates.incomplete.length,
      scannedSpools: candidates.spools.length,
      retainedArtifacts: retainedCandidates.length,
      retainedIncompleteDirectories: retainedIncomplete.length,
      retainedSpools: retainedSpools.length,
      retainedBytes: [...retainedCandidates, ...retainedIncomplete, ...retainedSpools].reduce(
        (total, candidate) => total + candidate.bytes,
        0,
      ),
      removedArtifacts,
      removedIncompleteDirectories,
      removedSpools,
      removedBytes,
      reason,
    };
  }
}

async function scanArtifactDirectories(
  root: string,
  concurrency: number,
): Promise<{
  complete: ArtifactCandidate[];
  incomplete: IncompleteArtifactCandidate[];
  spools: OutputSpoolCandidate[];
}> {
  const complete: ArtifactCandidate[] = [];
  const incomplete: IncompleteArtifactCandidate[] = [];
  const [spools] = await Promise.all([
    scanOutputSpoolDirectories(path.join(root, OutputSpoolDirectoryName), concurrency),
    scanDirectory(root, complete, incomplete, concurrency),
  ]);
  return { complete, incomplete, spools };
}

async function scanDirectory(
  directory: string,
  complete: ArtifactCandidate[],
  incomplete: IncompleteArtifactCandidate[],
  concurrency: number,
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name === AgentArtifactFileNames.manifest)) {
    const candidate = await readCompleteCandidate(directory, concurrency);
    if (candidate) complete.push(candidate);
    return;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === ".artifact-writing")) {
    incomplete.push(await readIncompleteCandidate(directory, concurrency));
  }
  await runWithConcurrency(
    entries.filter(
      (entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== OutputSpoolDirectoryName,
    ),
    concurrency,
    (entry) => scanDirectory(path.join(directory, entry.name), complete, incomplete, concurrency),
  );
}

async function scanOutputSpoolDirectories(root: string, concurrency: number): Promise<OutputSpoolCandidate[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return runWithConcurrency(
    entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()),
    concurrency,
    (entry) => readOutputSpoolCandidate(path.join(root, entry.name), concurrency),
  );
}

async function readOutputSpoolCandidate(directory: string, concurrency: number): Promise<OutputSpoolCandidate> {
  const markerPath = path.join(directory, SeneraOutputSpoolMarkerFileName);
  const [directoryStat, markerStat, rawMarker] = await Promise.all([
    fs.stat(directory),
    fs.stat(markerPath).catch(() => undefined),
    fs.readFile(markerPath, "utf8").catch(() => ""),
  ]);
  let marker: Record<string, unknown> = {};
  try {
    marker = JSON.parse(rawMarker) as Record<string, unknown>;
  } catch {
    // A directory without a readable marker is still stale output and is retained only for the grace period.
  }
  const state = readSpoolState(marker.state);
  return {
    directory,
    bytes: await measureDirectoryBytes(directory, concurrency),
    modifiedAt: markerStat?.mtimeMs ?? directoryStat.mtimeMs,
    sessionId: typeof marker.sessionId === "string" ? marker.sessionId : undefined,
    state,
  };
}

async function readCompleteCandidate(directory: string, concurrency: number): Promise<ArtifactCandidate | undefined> {
  const manifestPath = path.join(directory, AgentArtifactFileNames.manifest);
  const [stat, bytes, rawManifest] = await Promise.all([
    fs.stat(manifestPath),
    measureDirectoryBytes(directory, concurrency),
    fs.readFile(manifestPath, "utf8"),
  ]);
  let manifest: { sessionId?: unknown; createdAt?: unknown } = {};
  try {
    manifest = JSON.parse(rawManifest) as typeof manifest;
  } catch {
    // An invalid manifest is still retained until the normal age/quota policy removes it.
  }
  const createdAt = typeof manifest.createdAt === "string" ? Date.parse(manifest.createdAt) : Number.NaN;
  return {
    directory,
    bytes,
    modifiedAt: Number.isFinite(createdAt) ? createdAt : stat.mtimeMs,
    sessionId: typeof manifest.sessionId === "string" ? manifest.sessionId : undefined,
  };
}

async function readIncompleteCandidate(directory: string, concurrency: number): Promise<IncompleteArtifactCandidate> {
  const markerPath = path.join(directory, ".artifact-writing");
  const [stat, rawMarker] = await Promise.all([fs.stat(markerPath), fs.readFile(markerPath, "utf8").catch(() => "")]);
  let sessionId: string | undefined;
  let state: IncompleteArtifactCandidate["state"] = "failed";
  try {
    const marker = JSON.parse(rawMarker) as { sessionId?: unknown; state?: unknown };
    sessionId = typeof marker.sessionId === "string" ? marker.sessionId : undefined;
    state = marker.state === "writing" ? "writing" : "failed";
  } catch {
    // Markers written by older versions only contain an ISO timestamp.
  }
  return {
    directory,
    bytes: await measureDirectoryBytes(directory, concurrency),
    modifiedAt: stat.mtimeMs,
    sessionId,
    state,
  };
}

async function measureDirectoryBytes(directory: string, concurrency: number): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const sizes = await runWithConcurrency(entries, concurrency, async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return 0;
    if (entry.isDirectory()) return measureDirectoryBytes(entryPath, concurrency);
    return fs
      .stat(entryPath)
      .then((stat) => stat.size)
      .catch(() => 0);
  });
  return sizes.reduce((total, size) => total + size, 0);
}

async function runWithConcurrency<TValue, TResult>(
  values: readonly TValue[],
  concurrency: number,
  worker: (value: TValue) => Promise<TResult>,
): Promise<TResult[]> {
  if (values.length === 0) return [];
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Artifact maintenance concurrency must be a positive safe integer.");
  }
  const limit = concurrency;
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => runWorker()));
  return results;
}

function readSpoolState(value: unknown): SeneraOutputSpoolState {
  return value === "sealed" || value === "failed" || value === "committed" ? value : "open";
}

async function removeArtifactDirectory(
  boundary: SeneraWorkspaceBoundary,
  root: string,
  directory: string,
): Promise<void> {
  const lexicalDirectory = assertInsideRoot(root, path.resolve(directory), `artifact 目录超出根目录：${directory}`);
  const resolved = await boundary.resolve(lexicalDirectory, AgentResourceAccessIntents.Remove);
  const safeDirectory = assertInsideRoot(
    root,
    resolved.absolutePath,
    `artifact 目录的真实路径超出根目录：${directory}`,
  );
  if (safeDirectory === path.resolve(root)) throw new Error("Refusing to remove the artifact root directory.");
  const rootCheck = await boundary.resolve(root, AgentResourceAccessIntents.Read);
  if (rootCheck.absolutePath !== path.resolve(root)) {
    throw new Error(`artifact 根目录在删除期间发生变化：${root}`);
  }
  await removeDirectoryTree(safeDirectory, path.resolve(root));
}

async function removeDirectoryTree(directory: string, canonicalRoot: string): Promise<void> {
  const canonicalDirectory = await fs.realpath(directory).catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined;
    throw error;
  });
  if (!canonicalDirectory) return;
  if (!isInsideCanonicalRoot(canonicalRoot, canonicalDirectory)) {
    throw new Error(`artifact 目录的真实路径超出根目录：${directory}`);
  }

  const entries = await fs.readdir(canonicalDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(canonicalDirectory, entry.name);
    const stat = await fs.lstat(child);
    if (stat.isSymbolicLink()) {
      throw new Error(`拒绝删除包含链接的 artifact 目录：${child}`);
    }
    if (stat.isDirectory()) {
      await removeDirectoryTree(child, canonicalRoot);
      continue;
    }
    await fs.rm(child, { force: true, recursive: false });
  }
  await fs.rmdir(canonicalDirectory);
}

function isInsideCanonicalRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

type QuotaCandidate =
  | {
      readonly kind: "spool";
      readonly value: OutputSpoolCandidate;
      readonly bytes: number;
      readonly modifiedAt: number;
    }
  | {
      readonly kind: "incomplete";
      readonly value: IncompleteArtifactCandidate;
      readonly bytes: number;
      readonly modifiedAt: number;
    }
  | {
      readonly kind: "complete";
      readonly value: ArtifactCandidate;
      readonly bytes: number;
      readonly modifiedAt: number;
    };

function quotaCandidates(
  candidates: {
    complete: readonly ArtifactCandidate[];
    incomplete: readonly IncompleteArtifactCandidate[];
    spools: readonly OutputSpoolCandidate[];
  },
  removed: ReadonlySet<string>,
): QuotaCandidate[] {
  const reclaimable: QuotaCandidate[] = [
    ...candidates.spools
      .filter((candidate) => candidate.state !== "open" && !removed.has(candidate.directory))
      .map((value) => ({ kind: "spool" as const, value, bytes: value.bytes, modifiedAt: value.modifiedAt })),
    ...candidates.incomplete
      .filter((candidate) => candidate.state !== "writing" && !removed.has(candidate.directory))
      .map((value) => ({ kind: "incomplete" as const, value, bytes: value.bytes, modifiedAt: value.modifiedAt })),
    ...candidates.complete
      .filter((candidate) => !removed.has(candidate.directory))
      .map((value) => ({ kind: "complete" as const, value, bytes: value.bytes, modifiedAt: value.modifiedAt })),
  ];
  const priority = { spool: 0, incomplete: 1, complete: 2 } as const satisfies Record<QuotaCandidate["kind"], number>;
  return reclaimable.sort(
    (left, right) => priority[left.kind] - priority[right.kind] || left.modifiedAt - right.modifiedAt,
  );
}
