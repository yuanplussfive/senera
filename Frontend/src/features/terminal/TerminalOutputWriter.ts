import type { Terminal } from "@xterm/xterm";
import type {
  ExecutionResourceOutputBuffer,
  ExecutionResourceOutputUpdate,
} from "../../app/executionResourceOutputStore";

const MaxWriteCharacters = 32 * 1024;

/** At most one bounded xterm write is in flight; its callback releases the next. */
export class TerminalOutputWriter {
  private pending: string[] = [];
  private head = 0;
  private offset = 0;
  private writing = false;
  private resetPending = false;
  private disposed = false;
  private accepted?: { cursor: number; generation: number };

  constructor(private readonly terminal: Pick<Terminal, "write" | "reset">) {}

  restore(output: ExecutionResourceOutputBuffer | undefined): void {
    if (!output || this.disposed) return;
    this.pending = output.text ? [output.text] : [];
    this.head = this.offset = 0;
    this.resetPending = this.accepted !== undefined;
    this.accepted = { cursor: output.cursor, generation: output.generation };
    this.drain();
  }

  accept(update: ExecutionResourceOutputUpdate): void {
    if (this.disposed) return;
    if (update.kind === "replay") {
      this.restore(update.output);
      return;
    }
    if (update.kind === "removed") {
      this.pending = [];
      this.head = this.offset = 0;
      this.resetPending = true;
      this.accepted = undefined;
      this.drain();
      return;
    }
    if (this.accepted?.generation === update.generation && update.cursor <= this.accepted.cursor) return;
    if (this.accepted && this.accepted.generation !== update.generation) {
      this.pending = [];
      this.head = this.offset = 0;
      this.resetPending = true;
    }
    if (update.text) this.pending.push(update.text);
    this.accepted = { cursor: update.cursor, generation: update.generation };
    this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.accepted = undefined;
  }

  private drain(): void {
    if (this.disposed || this.writing) return;
    if (this.resetPending) {
      this.terminal.reset();
      this.resetPending = false;
    }
    const batch: string[] = [];
    let remaining = MaxWriteCharacters;
    while (remaining > 0 && this.head < this.pending.length) {
      const text = this.pending[this.head];
      let end = Math.min(text.length, this.offset + remaining);
      // Leave a high surrogate with its low surrogate in the next write.
      const lastCodeUnit = text.charCodeAt(end - 1);
      if (end < text.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end--;
      if (end === this.offset) break;
      const part = text.slice(this.offset, end);
      batch.push(part);
      remaining -= part.length;
      this.offset = end;
      if (end === text.length) {
        this.head++;
        this.offset = 0;
      }
    }
    if (this.head === this.pending.length) {
      this.pending = [];
      this.head = 0;
    } else if (this.head > 0) {
      this.pending = this.pending.slice(this.head);
      this.head = 0;
    }
    if (batch.length === 0) return;
    this.writing = true;
    this.terminal.write(batch.join(""), () => {
      this.writing = false;
      this.drain();
    });
  }
}
