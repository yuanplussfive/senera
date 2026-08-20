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
  private readonly now: () => number;
  private monitorPromise?: Promise<AgentChildRunDeadlineOutcome>;

  constructor(private readonly options: AgentChildRunDeadlineControllerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  start(): Promise<AgentChildRunDeadlineOutcome> {
    return (this.monitorPromise ??= this.monitor());
  }

  stop(): void {
    this.stopped.abort();
  }

  private async monitor(): Promise<AgentChildRunDeadlineOutcome> {
    const extensionPolicy = this.options.policy.activityExtension;
    const absoluteHardDeadlineAt =
      this.options.startedAt +
      this.options.policy.softTimeoutMs +
      extensionPolicy.maximumMs +
      this.options.policy.wrapUpTimeoutMs;
    let grantedExtensionMs = 0;
    let softDeadlineAt = this.options.startedAt + this.options.policy.softTimeoutMs;

    while (await waitUntil(softDeadlineAt, this.stopped.signal, this.now)) {
      const extensionRemainingMs = extensionPolicy.maximumMs - grantedExtensionMs;
      if (!this.options.activity.hasRecentActivity(this.now()) || extensionRemainingMs <= 0) break;

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

    if (this.stopped.signal.aborted) return AgentChildRunDeadlineOutcomes.Stopped;

    const hardDeadlineAt = Math.min(this.now() + this.options.policy.wrapUpTimeoutMs, absoluteHardDeadlineAt);
    this.options.activity.enterWrapUp(hardDeadlineAt);
    await this.options.onWrapUp({ hardDeadlineAt: new Date(hardDeadlineAt).toISOString() });
    if (!(await waitUntil(hardDeadlineAt, this.stopped.signal, this.now))) {
      return AgentChildRunDeadlineOutcomes.Stopped;
    }

    await this.options.onTimedOut();
    return AgentChildRunDeadlineOutcomes.TimedOut;
  }
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
