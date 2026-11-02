import { readAgentTransportRetryDelayMs } from "./agentTransportRetry";

/** Both workspace and protocol connections follow the document and native app lifecycle. */
export class ClientConnectionLifecycle {
  private active = false;
  private suspended = false;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly callbacks: { suspend: () => void; resume: () => void }) {}

  get paused() {
    return this.suspended || document.visibilityState === "hidden";
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", this.suspend);
    window.addEventListener("pageshow", this.resume);
    window.addEventListener("senera:pause", this.suspend);
    window.addEventListener("senera:resume", this.resume);
    if (document.visibilityState === "hidden") this.suspend();
  }

  cancelRetry() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  connected() {
    this.attempt = 0;
    this.cancelRetry();
  }

  reconnect(connect: () => void) {
    this.cancelRetry();
    if (!this.active || this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.active && !this.paused) connect();
    }, readAgentTransportRetryDelayMs(this.attempt++));
  }

  stop() {
    this.active = false;
    this.suspended = false;
    this.connected();
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pagehide", this.suspend);
    window.removeEventListener("pageshow", this.resume);
    window.removeEventListener("senera:pause", this.suspend);
    window.removeEventListener("senera:resume", this.resume);
  }

  private readonly suspend = () => {
    if (!this.active || this.suspended) return;
    this.suspended = true;
    this.cancelRetry();
    this.callbacks.suspend();
  };

  private readonly resume = () => {
    if (!this.active || !this.suspended || document.visibilityState === "hidden") return;
    this.suspended = false;
    this.callbacks.resume();
  };

  private readonly visibility = () => {
    if (document.visibilityState === "hidden") this.suspend();
    else this.resume();
  };
}
