import type {
  AgentToolProcessChild,
  AgentToolProcessSpawner,
  AgentToolProcessSpawnOptions,
} from "../ToolRuntime/AgentToolProcessTypes.js";
import type { SeneraProcessExecutionBackend } from "./SeneraProcessExecutionBackend.js";

export function createSeneraProcessBackendSpawner(
  backend: SeneraProcessExecutionBackend,
): AgentToolProcessSpawner {
  return (command, args, options) =>
    new SeneraProcessBackendChild(backend, command, args, options);
}

class SeneraProcessBackendChild implements AgentToolProcessChild {
  readonly stdout = new ProcessStreamEmitter();
  readonly stderr = new ProcessStreamEmitter();
  readonly stdin = {
    end: (chunk?: string) => {
      this.start(chunk);
    },
  };
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ) => void>();
  private readonly abortController = new AbortController();
  private started = false;
  private closed = false;

  constructor(
    private readonly backend: SeneraProcessExecutionBackend,
    private readonly command: string,
    private readonly args: string[],
    private readonly options: AgentToolProcessSpawnOptions,
  ) {
    const abort = (): void => this.abortController.abort();
    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }
  }

  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): this;
  on(
    event: "error" | "close",
    listener:
      | ((error: Error) => void)
      | ((exitCode: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    if (event === "error") {
      this.errorListeners.add(listener as (error: Error) => void);
    } else {
      this.closeListeners.add(listener as (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
      ) => void);
    }
    return this;
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.abortController.abort();
    this.close(null, "SIGTERM");
    return true;
  }

  private start(stdin?: string): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.run(stdin);
  }

  private async run(stdin?: string): Promise<void> {
    try {
      const result = await this.backend.executeProcess({
        command: this.command,
        args: this.args,
        cwd: this.options.cwd,
        env: this.options.env,
        stdin,
        timeoutMs: this.options.timeoutMs,
        limits: this.options.limits,
        signal: this.abortController.signal,
        profile: this.options.profile,
      });
      this.stdout.emitData(result.stdout);
      this.stderr.emitData(result.stderr);
      this.close(result.exitCode, result.signal);
    } catch (error) {
      if (!this.closed) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private close(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener(exitCode, signal);
    }
  }

  private emitError(error: Error): void {
    if (this.errorListeners.size === 0) {
      throw error;
    }
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

class ProcessStreamEmitter {
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();

  on(event: "data", listener: (chunk: Buffer) => void): this {
    this.dataListeners.add(listener);
    return this;
  }

  emitData(value: string): void {
    if (value.length > 0) {
      const chunk = Buffer.from(value);
      for (const listener of this.dataListeners) {
        listener(chunk);
      }
    }
  }
}
