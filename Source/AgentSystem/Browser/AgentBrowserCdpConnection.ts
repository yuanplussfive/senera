import WebSocket from "ws";

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly sessionId?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

/** A host-only CDP connection, bounded by the operation signal. */
export class AgentBrowserCdpConnection {
  private readonly socket: WebSocket;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 0;
  private failure: Error | undefined;
  private readonly opened: Promise<void>;
  private rejectOpening!: (reason: Error) => void;
  private readonly abort = (): void => this.fail(this.signal.reason);

  constructor(
    url: string,
    private readonly signal: AbortSignal,
    private readonly onEvent: (message: CdpMessage) => void,
    private readonly onFailure: (error: Error) => void,
  ) {
    signal.throwIfAborted();
    this.socket = new WebSocket(url);
    this.opened = new Promise<void>((resolve, reject) => {
      this.rejectOpening = reject;
      this.socket.once("open", resolve);
      this.socket.once("error", () => reject(new Error("Could not connect to the controlled browser.")));
      this.socket.once("close", () => reject(this.failure ?? new Error("The browser CDP connection closed.")));
    });
    void this.opened.catch(() => undefined);
    this.socket.on("message", (raw) => {
      let message: CdpMessage;
      try {
        message = JSON.parse(raw.toString()) as CdpMessage;
      } catch {
        this.fail(new Error("The controlled browser returned invalid CDP JSON."));
        return;
      }
      if (message.id === undefined) {
        this.onEvent(message);
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
    });
    this.socket.on("error", () => this.fail(new Error("The controlled browser CDP connection failed.")));
    this.socket.on("close", () => this.fail(new Error("The controlled browser CDP connection closed.")));
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.abort();
  }

  async send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    await this.opened;
    if (this.failure) throw this.failure;
    this.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), (error) => {
        if (error) this.fail(error);
      });
    });
  }

  close(): void {
    this.signal.removeEventListener("abort", this.abort);
    this.socket.removeAllListeners("message");
    this.fail(new Error("The browser CDP operation ended."), false);
  }

  private fail(reason: unknown, notify = true): void {
    if (this.failure) return;
    this.failure = reason instanceof Error ? reason : new Error(String(reason));
    this.signal.removeEventListener("abort", this.abort);
    this.rejectOpening(this.failure);
    for (const request of this.pending.values()) request.reject(this.failure);
    this.pending.clear();
    if (notify) this.onFailure(this.failure);
    this.socket.terminate();
  }
}
