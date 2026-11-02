import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentSessionQueuedInput } from "../Session/AgentSessionQueuedInput.js";

export interface AgentJobOutputOptions {
  wait?: boolean;
  /** Null reserves the configured maximum for one settlement wait. */
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

/** Observes settlement; cancelling a read never cancels its producer. */
export class AgentJobWaiter {
  private readonly waits = new Set<{
    id: string;
    sessionId: string;
    changed: () => void;
    steer: () => void;
    stop: () => void;
  }>();

  constructor(
    private readonly options: {
      maximumWaitMs: () => number;
      defaultWaitMs?: () => number;
      pendingInputs?: (sessionId: string) => readonly AgentSessionQueuedInput[];
    },
  ) {}

  changed(id: string): void {
    for (const wait of this.waits) if (wait.id === id) wait.changed();
  }

  inputAccepted(input: AgentSessionQueuedInput): void {
    if (input.request.queueMode !== "steer" || input.entry.metadata?.hostInput) return;
    for (const wait of this.waits) if (wait.sessionId === input.sessionId) wait.steer();
  }

  stop(): void {
    for (const wait of this.waits) wait.stop();
  }

  timeoutMs(options: AgentJobOutputOptions): number {
    const maximum = this.options.maximumWaitMs();
    const requested =
      options.timeoutMs === null ? maximum : (options.timeoutMs ?? this.options.defaultWaitMs?.() ?? maximum);
    if (!Number.isSafeInteger(requested) || requested < 0)
      throw new Error("Job output timeout must be a non-negative safe integer.");
    return Math.min(requested, maximum);
  }

  async read<T>(
    id: string,
    sessionId: string,
    read: () => T,
    settled: (snapshot: T) => boolean,
    options: AgentJobOutputOptions = {},
  ) {
    throwIfAborted(options.signal);
    const timeout = this.timeoutMs(options);
    const snapshot = read();
    if (!options.wait || settled(snapshot)) return { snapshot };
    if (
      this.options
        .pendingInputs?.(sessionId)
        .some(
          (input) =>
            input.state === "pending" && input.request.queueMode === "steer" && !input.entry.metadata?.hostInput,
        )
    )
      return { snapshot, waitReason: "user_steered" as const };
    if (timeout === 0) return { snapshot, waitReason: "timeout" as const };
    const waitReason = await new Promise<"completed" | "timeout" | "user_steered">((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        this.waits.delete(wait);
        options.signal?.removeEventListener("abort", abort);
        return true;
      };
      const finish = (reason: "completed" | "timeout" | "user_steered") => {
        if (cleanup()) resolve(reason);
      };
      const fail = (error: unknown) => {
        if (cleanup()) reject(error);
      };
      const abort = () => fail(options.signal?.reason ?? new Error("Job output read was cancelled."));
      const wait = {
        id,
        sessionId,
        changed: () => {
          try {
            if (settled(read())) finish("completed");
          } catch (error) {
            fail(error);
          }
        },
        steer: () => finish("user_steered"),
        stop: () => fail(new Error("Job runtime is shutting down.")),
      };
      const timer = setTimeout(() => finish("timeout"), timeout);
      timer.unref();
      this.waits.add(wait);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      else wait.changed();
    });
    return { snapshot: read(), waitReason };
  }
}
