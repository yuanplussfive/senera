export type IdleTaskPriority = "user-visible" | "background";

export interface IdleTaskScheduleOptions {
  priority?: IdleTaskPriority;
}

const IdleTaskPolicies = {
  "user-visible": {
    fallbackDelayMs: 0,
    timeoutMs: 250,
  },
  background: {
    fallbackDelayMs: 1_000,
    timeoutMs: 2_000,
  },
} as const satisfies Record<IdleTaskPriority, { fallbackDelayMs: number; timeoutMs: number }>;

export function scheduleIdleTask(
  task: () => void,
  { priority = "background" }: IdleTaskScheduleOptions = {},
): () => void {
  if (typeof window === "undefined") return noop;
  const policy = IdleTaskPolicies[priority];

  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: policy.timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(task, policy.fallbackDelayMs);
  return () => window.clearTimeout(handle);
}

function noop(): void {}
