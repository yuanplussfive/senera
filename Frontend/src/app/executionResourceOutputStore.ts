import type { ExecutionResourceSnapshotData } from "../api/eventTypes";

export interface ExecutionResourceOutputChunk {
  readonly cursor: number;
  readonly text: string;
}

export interface ExecutionResourceOutputBuffer {
  readonly cursor: number;
  readonly generation: number;
  readonly chunks: readonly ExecutionResourceOutputChunk[];
  readonly characterCount: number;
  readonly text: string;
  readonly truncated: boolean;
}

export type ExecutionResourceOutputUpdate =
  | { kind: "append"; cursor: number; generation: number; text: string }
  | { kind: "replay"; output: ExecutionResourceOutputBuffer }
  | { kind: "removed" };

const OutputRetention = {
  targetCharacters: 256 * 1024,
  marker: "\r\n... earlier terminal output omitted ...\r\n",
} as const;

type OutputListener = (update: ExecutionResourceOutputUpdate) => void;

/** Live deltas bypass React; bounded replay snapshots are built only on demand. */
export class ExecutionResourceOutputStore {
  private readonly journals = new Map<string, OutputJournal>();
  private readonly listeners = new Map<string, Set<OutputListener>>();

  read(resourceId: string): ExecutionResourceOutputBuffer | undefined {
    return this.journals.get(resourceId)?.snapshot();
  }

  cursorOf(resourceId: string): number {
    return this.journals.get(resourceId)?.cursor ?? 0;
  }

  subscribe(resourceId: string, listener: OutputListener): () => void {
    const listeners = this.listeners.get(resourceId) ?? new Set<OutputListener>();
    listeners.add(listener);
    this.listeners.set(resourceId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(resourceId);
    };
  }

  append(resourceId: string, cursor: number, text: string, truncated = false): void {
    const journal = this.journal(resourceId);
    if (cursor <= journal.cursor) return;
    journal.append(cursor, text, truncated);
    this.notify(resourceId, { kind: "append", cursor, generation: journal.generation, text });
  }

  merge(snapshot: ExecutionResourceSnapshotData): void {
    const current = this.journals.get(snapshot.resourceId);
    if (current && snapshot.cursor <= current.cursor) return;
    const requiresReplay = snapshot.truncated && (!current || current.cursor < snapshot.oldestCursor - 1);
    const journal = requiresReplay
      ? new OutputJournal(snapshot.oldestCursor - 1, (current?.generation ?? 0) + 1, true)
      : (current ?? new OutputJournal());
    this.journals.set(snapshot.resourceId, journal);
    const appended: string[] = [];
    for (const event of snapshot.events) {
      if (event.cursor <= journal.cursor) continue;
      if (event.kind === "output" && event.text) {
        journal.append(event.cursor, event.text, event.truncated === true);
        appended.push(event.text);
      } else journal.advance(event.cursor);
    }
    if (requiresReplay || !current) {
      this.notify(snapshot.resourceId, { kind: "replay", output: journal.snapshot() });
    } else if (appended.length > 0) {
      this.notify(snapshot.resourceId, {
        kind: "append",
        cursor: journal.cursor,
        generation: journal.generation,
        text: appended.join(""),
      });
    }
  }

  advance(resourceId: string, cursor: number): void {
    this.journal(resourceId).advance(cursor);
  }

  retain(resourceIds: ReadonlySet<string>): void {
    for (const resourceId of this.journals.keys()) {
      if (!resourceIds.has(resourceId)) this.remove(resourceId);
    }
  }

  clear(): void {
    for (const resourceId of this.journals.keys()) this.remove(resourceId);
  }

  remove(resourceId: string): void {
    if (this.journals.delete(resourceId)) this.notify(resourceId, { kind: "removed" });
  }

  private journal(resourceId: string): OutputJournal {
    const journal = this.journals.get(resourceId) ?? new OutputJournal();
    this.journals.set(resourceId, journal);
    return journal;
  }

  private notify(resourceId: string, update: ExecutionResourceOutputUpdate): void {
    for (const listener of this.listeners.get(resourceId) ?? []) listener(update);
  }
}

class OutputJournal {
  private chunks: ExecutionResourceOutputChunk[] = [];
  private head = 0;
  private characterCount = 0;
  private cachedSnapshot?: ExecutionResourceOutputBuffer;

  constructor(
    public cursor = 0,
    readonly generation = 0,
    private truncated = false,
  ) {}

  append(cursor: number, text: string, truncated: boolean): void {
    this.cursor = cursor;
    this.chunks.push({ cursor, text });
    this.characterCount += text.length;
    this.truncated ||= truncated;
    // Retain whole transport strings. Replay remains a bounded text tail,
    // not a serialized terminal-state snapshot. Keep at least the latest chunk.
    while (this.characterCount > OutputRetention.targetCharacters && this.head < this.chunks.length - 1) {
      this.characterCount -= this.chunks[this.head++].text.length;
      this.truncated = true;
    }
    if (this.head > 0 && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
    this.cachedSnapshot = undefined;
  }

  advance(cursor: number): void {
    if (cursor <= this.cursor) return;
    this.cursor = cursor;
    this.cachedSnapshot = undefined;
  }

  snapshot(): ExecutionResourceOutputBuffer {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const chunks = this.chunks.slice(this.head);
    let text: string | undefined;
    const truncated = this.truncated;
    return (this.cachedSnapshot = {
      cursor: this.cursor,
      generation: this.generation,
      chunks,
      characterCount: this.characterCount,
      truncated,
      get text() {
        return (text ??= `${truncated ? OutputRetention.marker : ""}${chunks.map((chunk) => chunk.text).join("")}`);
      },
    });
  }
}
