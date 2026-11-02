/** Application-level liveness for WebViews that suspend timers and networking in the background. */
export class ConnectionLiveness {
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private active = false;
  private suspended = false;
  private timeoutMs = 10_000;
  private probingRevision?: number;

  constructor(
    private readonly probe: (timeoutMs: number) => Promise<unknown>,
    private readonly disconnected: () => void,
    private readonly monitorIdle = true,
  ) {}

  start(suspended = false): void {
    this.active = true;
    this.suspended = suspended;
    this.receive();
  }

  receive(intervalMs?: number): void {
    if (intervalMs !== undefined && Number.isFinite(intervalMs) && intervalMs > 0) {
      this.timeoutMs = Math.max(intervalMs * 2, intervalMs + 5_000);
    }
    this.revision++;
    clearTimeout(this.timer);
    if (this.active && !this.suspended && this.monitorIdle)
      this.timer = setTimeout(() => void this.check(), this.timeoutMs);
  }

  suspend(): void {
    this.suspended = true;
    this.revision++;
    clearTimeout(this.timer);
  }

  resume(): void {
    this.suspended = false;
    if (this.active) void this.check();
  }

  stop(): void {
    this.active = false;
    this.revision++;
    clearTimeout(this.timer);
  }

  private async check(): Promise<void> {
    if (!this.active || this.suspended) return;
    if (this.probingRevision === this.revision) return;
    clearTimeout(this.timer);
    const revision = ++this.revision;
    this.probingRevision = revision;
    try {
      await this.probe(this.timeoutMs);
      if (revision === this.revision) this.receive();
    } catch {
      if (revision !== this.revision || !this.active || this.suspended) return;
      this.stop();
      this.disconnected();
    }
  }
}
