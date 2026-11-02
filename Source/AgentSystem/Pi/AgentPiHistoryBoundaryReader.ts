import { readFile, stat } from "node:fs/promises";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { findAgentPiSessionFile } from "./AgentPiSessionStorage.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import { readAgentPiCommittedInputs, readAgentPiCommittedToolCalls } from "./AgentPiInputBoundary.js";
import type { AgentSessionHistoryBoundary } from "../Session/AgentSessionHistoryWindow.js";

const BoundaryCacheCapacity = 64;

/** Resolve through native turn markers, never message text or wall-clock guesses. */
export function readAgentPiHistoryBoundary(entries: readonly SessionEntry[]): AgentSessionHistoryBoundary | undefined {
  const compaction = [...entries].reverse().find((entry) => entry.type === "compaction");
  if (!compaction || compaction.type !== "compaction" || !compaction.firstKeptEntryId) return undefined;
  const visited = new Set<string>();
  const indexes = new Map(entries.map((entry, index) => [entry.id, index]));
  let keptId = compaction.firstKeptEntryId;
  while (!visited.has(keptId)) {
    visited.add(keptId);
    const index = indexes.get(keptId);
    if (index === undefined) return undefined;
    const kept = entries[index];
    // A later compaction can retain an earlier summary as its first entry.
    if (kept?.type === "compaction") {
      keptId = kept.firstKeptEntryId;
      continue;
    }
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const entry = entries[cursor];
      if (entry?.type !== "custom" || entry.customType !== AgentPiSessionCustomEntryTypes.TurnBoundary) continue;
      const data: unknown = entry.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "requestId" in data &&
        typeof data.requestId === "string" &&
        data.requestId.length > 0
      )
        return { id: compaction.id, firstKeptRequestId: data.requestId };
      return undefined;
    }
    return undefined;
  }
  return undefined;
}

/** Reads native durable history without acquiring a model runtime or waiting for a running turn. */
export class AgentPiHistoryBoundaryReader {
  private readonly cache = new Map<
    string,
    {
      path: string;
      revision?: string;
      boundary?: AgentSessionHistoryBoundary;
    }
  >();

  constructor(private readonly options: { workspaceRoot: string; sessionsRoot: string }) {}

  async readCommittedInputs(sessionId: string): Promise<ReadonlySet<string>> {
    const manager = await this.readManager(sessionId);
    return manager ? readAgentPiCommittedInputs(manager) : new Set();
  }

  async readCommittedToolCalls(sessionId: string): Promise<ReadonlySet<string>> {
    const manager = await this.readManager(sessionId);
    return manager ? readAgentPiCommittedToolCalls(manager) : new Set();
  }

  private async readManager(sessionId: string): Promise<SessionManager | undefined> {
    const file = await findAgentPiSessionFile(this.options.workspaceRoot, this.options.sessionsRoot, sessionId);
    if (!file) return undefined;
    const manager = SessionManager.inMemory(
      this.options.workspaceRoot,
      undefined,
      parseSessionEntries(await readFile(file.path, "utf8")),
    );
    return manager;
  }

  async read(sessionId: string): Promise<AgentSessionHistoryBoundary | undefined> {
    let cached = this.cache.get(sessionId);
    if (!cached) {
      const file = await findAgentPiSessionFile(this.options.workspaceRoot, this.options.sessionsRoot, sessionId);
      if (!file) return undefined;
      cached = { path: file.path };
    }
    const info = await stat(cached.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      this.cache.delete(sessionId);
      return undefined;
    });
    if (!info) return undefined;
    const revision = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (cached.revision !== revision) {
      // Opening a persistent manager may migrate and rewrite an old session.
      // Use Pi's own parser and branch index entirely in memory for this read.
      const manager = SessionManager.inMemory(
        this.options.workspaceRoot,
        undefined,
        parseSessionEntries(await readFile(cached.path, "utf8")),
      );
      cached = { path: cached.path, revision, boundary: readAgentPiHistoryBoundary(manager.getBranch()) };
    }
    this.cache.delete(sessionId);
    this.cache.set(sessionId, cached);
    // Cache only tiny boundary receipts; the native transcript is not retained.
    for (const id of this.cache.keys()) {
      if (this.cache.size <= BoundaryCacheCapacity) break;
      this.cache.delete(id);
    }
    return cached.boundary;
  }
}
