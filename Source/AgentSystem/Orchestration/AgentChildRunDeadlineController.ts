import type { AgentChildRunActivityTracker } from "./AgentChildRunActivityTracker.js";
import type { AgentChildRunDeadlinePolicy } from "./AgentChildRunTypes.js";

export const AgentChildRunDeadlineOutcomes = {
  Stopped: "stopped",
  TimedOut: "timed_out",
} as const;

export type AgentChildRunDeadlineOutcome =
  (typeof AgentChildRunDeadlineOutcomes)[keyof typeof AgentChildRunDeadlineOutcomes];

export interface AgentChildRunDeadlineControllerOptions {
  readonly startedAt: number;
  readonly policy: AgentChildRunDeadlinePolicy;
  readonly activity: AgentChildRunActivityTracker;
  readonly onExtended: (event: {
    readonly extensionMs: number;
    readonly grantedExtensionMs: number;
    readonly softDeadlineAt: string;
  }) => void | Promise<void>;
  readonly onWrapUp: (event: { readonly hardDeadlineAt: string }) => void | Promise<void>;
  readonly onTimedOut: () => void | Promise<void>;
  readonly now?: () => number;
}

/** Enforces a soft deadline, bounded activity extensions, and a final wrap-up window. */
export class AgentChildRunDeadlineController {
  private readonly stopped = new AbortController();
  private readonly wake = new AbortController();
  private readonly now: () => number;
  private readonly absoluteHardDeadlineAt: number;
  private monitorPromise?: Promise<AgentChildRunDeadlineOutcome>;
  private wrapUpStarted?: Promise<void>;
  private hardDeadlineAt?: number;

  constructor(private readonly options: AgentChildRunDeadlineControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.absoluteHardDeadlineAt =
      options.startedAt +
      options.policy.softTimeoutMs +
      options.policy.activityExtension.maximumMs +
      options.policy.wrapUpTimeoutMs;
  }

  start(): Promise<AgentChildRunDeadlineOutcome> {
    return (this.monitorPromise ??= this.monitor());
  }

  stop(): void {
    this.stopped.abort();
    this.wake.abort();
  }

  /** Requests bounded evidence wrap-up immediately when a control budget fires. */
  requestWrapUp(): Promise<void> {
    if (this.stopped.signal.aborted) return Promise.resolve();
    this.wake.abort();
    return this.beginWrapUp();
  }

  private async monitor(): Promise<AgentChildRunDeadlineOutcome> {
    const extensionPolicy = this.options.policy.activityExtension;
    const initialDeadline = this.options.activity.deadlineState();
    let grantedExtensionMs = initialDeadline.grantedExtensionMs;
    let softDeadlineAt = initialDeadline.softDeadlineAt;

    while (true) {
      const waitResult = await waitUntilOrSignal(softDeadlineAt, this.stopped.signal, this.wake.signal, this.now);
      if (waitResult === "stopped") return AgentChildRunDeadlineOutcomes.Stopped;
      if (waitResult === "woken") return this.finishWrapUp();
      const extensionRemainingMs = extensionPolicy.maximumMs - grantedExtensionMs;
      if (!this.options.activity.hasRecentMeaningfulProgress(this.now()) || extensionRemainingMs <= 0) {
        return this.finishWrapUp();
      }

      const extensionMs = Math.min(extensionPolicy.stepMs, extensionRemainingMs);
      grantedExtensionMs += extensionMs;
      softDeadlineAt += extensionMs;
      this.options.activity.extendDeadline(extensionMs);
      await this.options.onExtended({
        extensionMs,
        grantedExtensionMs,
        softDeadlineAt: new Date(softDeadlineAt).toISOString(),
      });
    }
  }

  private async finishWrapUp(): Promise<AgentChildRunDeadlineOutcome> {
    await this.beginWrapUp();
    if (this.hardDeadlineAt === undefined || !(await waitUntil(this.hardDeadlineAt, this.stopped.signal, this.now))) {
      return AgentChildRunDeadlineOutcomes.Stopped;
    }

    await this.options.onTimedOut();
    return AgentChildRunDeadlineOutcomes.TimedOut;
  }

  private beginWrapUp(): Promise<void> {
    if (this.wrapUpStarted) return this.wrapUpStarted;
    this.hardDeadlineAt = Math.min(this.now() + this.options.policy.wrapUpTimeoutMs, this.absoluteHardDeadlineAt);
    this.options.activity.enterWrapUp(this.hardDeadlineAt);
    this.wrapUpStarted = Promise.resolve(
      this.options.onWrapUp({ hardDeadlineAt: new Date(this.hardDeadlineAt).toISOString() }),
    );
    return this.wrapUpStarted;
  }
}

type DeadlineWaitResult = "deadline" | "woken" | "stopped";

function waitUntilOrSignal(
  deadline: number,
  stopped: AbortSignal,
  wake: AbortSignal,
  now: () => number,
): Promise<DeadlineWaitResult> {
  if (stopped.aborted) return Promise.resolve("stopped");
  if (wake.aborted) return Promise.resolve("woken");
  return new Promise<DeadlineWaitResult>((resolve) => {
    const timer = setTimeout(() => finish("deadline"), Math.max(0, deadline - now()));
    timer.unref();
    const onStopped = (): void => finish("stopped");
    const onWake = (): void => finish("woken");
    const cleanup = (): void => {
      clearTimeout(timer);
      stopped.removeEventListener("abort", onStopped);
      wake.removeEventListener("abort", onWake);
    };
    const finish = (result: DeadlineWaitResult): void => {
      cleanup();
      resolve(result);
    };
    stopped.addEventListener("abort", onStopped, { once: true });
    wake.addEventListener("abort", onWake, { once: true });
  });
}

function waitUntil(deadline: number, signal: AbortSignal, now: () => number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const delayMs = Math.max(0, deadline - now());
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    timer.unref();
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
