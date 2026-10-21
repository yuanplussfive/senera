import fuzzysort from "fuzzysort";
import { AgentWorkspaceFileDiscovery, normalizeWorkspacePath } from "./AgentWorkspaceFileDiscovery.js";
import type { AgentWorkspaceFileChange } from "./AgentWorkspaceFileChanges.js";

type WorkspacePathIndexState = "cold" | "ready" | "unverified" | "closed";

/**
 * A live, in-memory index of visible workspace files. Its only authority is the shared ripgrep
 * discovery contract; watcher events apply structural deltas without reinterpreting ignore files.
 */
export class AgentWorkspacePathIndex {
  private readonly discovery: AgentWorkspaceFileDiscovery;
  private paths: readonly string[] = [];
  private state: WorkspacePathIndexState = "cold";
  private observedRevision = 0;
  private appliedRevision = 0;
  private transition: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string, discovery = new AgentWorkspaceFileDiscovery(workspaceRoot)) {
    this.discovery = discovery;
  }

  async apply(changes: readonly AgentWorkspaceFileChange[]): Promise<void> {
    if (!changes.length || this.state === "closed") return;
    const revision = ++this.observedRevision;
    await this.serialize(async () => {
      if (this.state === "closed") return;
      if (changes.some((change) => change.type === "watch-error" || this.isRuleChange(change))) {
        this.state = "unverified";
        this.appliedRevision = revision;
        return;
      }
      if (this.state !== "ready") {
        this.appliedRevision = revision;
        return;
      }
      let next = this.paths;
      for (const change of changes) {
        if (change.type === "delete") {
          next = removePathTree(next, change.path);
          continue;
        }
        if (change.type === "create") {
          try {
            next = mergeWorkspacePaths(next, await this.discovery.discoverAt(change.path));
          } catch {
            this.state = "unverified";
            this.appliedRevision = revision;
            return;
          }
        }
      }
      this.paths = next;
      this.appliedRevision = revision;
    });
  }

  async search(query: string): Promise<readonly string[]> {
    const paths = await this.resolveSnapshot();
    return fuzzysort.go(query, paths).map((result) => result.target);
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.observedRevision += 1;
    await this.transition;
    this.paths = [];
  }

  private async resolveSnapshot(): Promise<readonly string[]> {
    while (this.state !== "closed") {
      const snapshot = await this.serialize(async () => {
        if (this.state === "ready" && this.appliedRevision === this.observedRevision) return this.paths;
        const revision = this.observedRevision;
        const discovered = await this.discovery.discoverAll();
        if (revision !== this.observedRevision) return undefined;
        this.paths = normalizeAndSortPaths(discovered);
        this.state = "ready";
        this.appliedRevision = revision;
        return this.paths;
      });
      if (snapshot && this.state === "ready" && this.appliedRevision === this.observedRevision) return snapshot;
      await this.transition;
    }
    throw new Error("Workspace path index is closed.");
  }

  private isRuleChange(change: AgentWorkspaceFileChange): boolean {
    return change.type !== "watch-error" && this.discovery.isDiscoveryRulePath(change.path);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function mergeWorkspacePaths(current: readonly string[], discovered: readonly string[]): readonly string[] {
  const additions = normalizeAndSortPaths(discovered);
  if (!additions.length) return current;
  const merged: string[] = [];
  let currentIndex = 0;
  let additionIndex = 0;
  while (currentIndex < current.length || additionIndex < additions.length) {
    const currentPath = current[currentIndex];
    const addition = additions[additionIndex];
    if (addition === undefined || (currentPath !== undefined && compareWorkspacePaths(currentPath, addition) < 0)) {
      merged.push(currentPath);
      currentIndex += 1;
      continue;
    }
    if (currentPath === undefined || compareWorkspacePaths(addition, currentPath) < 0) {
      merged.push(addition);
      additionIndex += 1;
      continue;
    }
    merged.push(currentPath);
    currentIndex += 1;
    additionIndex += 1;
  }
  return merged;
}

function removePathTree(paths: readonly string[], workspacePath: string): readonly string[] {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (normalized === ".") return [];
  const start = lowerBound(paths, normalized);
  const descendants = `${normalized}/`;
  let end = start;
  while (end < paths.length && (paths[end] === normalized || paths[end]?.startsWith(descendants))) end += 1;
  return start === end ? paths : [...paths.slice(0, start), ...paths.slice(end)];
}

function normalizeAndSortPaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map(normalizeWorkspacePath).filter((path) => path !== "."))].sort(compareWorkspacePaths);
}

function lowerBound(paths: readonly string[], target: string): number {
  let lower = 0;
  let upper = paths.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (compareWorkspacePaths(paths[middle]!, target) < 0) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function compareWorkspacePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
