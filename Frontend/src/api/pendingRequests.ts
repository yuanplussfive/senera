/** Register before sending: even a synchronous reply belongs to the right caller. */
export class PendingRequests<T> {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: T) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private readonly timeoutError: (id: string) => Error) {}

  request(id: string, timeoutMs: number, send: () => void): Promise<T> {
    if (this.pending.has(id)) return Promise.reject(new Error(`Request already pending: ${id}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reject(id, this.timeoutError(id)), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        send();
      } catch (error) {
        this.reject(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  resolve(id: string, value: T): void {
    const request = this.take(id);
    request?.resolve(value);
  }

  reject(id: string, error: Error): void {
    this.take(id)?.reject(error);
  }

  rejectAll(error: Error): void {
    for (const id of this.pending.keys()) this.reject(id, error);
  }

  private take(id: string) {
    const request = this.pending.get(id);
    if (request) {
      clearTimeout(request.timer);
      this.pending.delete(id);
    }
    return request;
  }
}
