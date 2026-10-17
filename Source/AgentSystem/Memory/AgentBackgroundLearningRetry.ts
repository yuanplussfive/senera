export interface AgentBackgroundLearningRetryPolicy {
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxDelayMs: number;
}

export type AgentBackgroundLearningRetryPlan =
  | { readonly kind: "retry"; readonly attempt: number; readonly nextAttemptAtMs: number }
  | { readonly kind: "defer"; readonly attempt: number; readonly nextAttemptAtMs: number }
  | { readonly kind: "failed"; readonly attempt: number; readonly nextAttemptAtMs: number };

export function planAgentBackgroundLearningRetry(input: {
  readonly attempt: number;
  readonly nowMs: number;
  readonly policy: AgentBackgroundLearningRetryPolicy;
  readonly retryAtMs?: number;
  readonly retryable?: boolean;
}): AgentBackgroundLearningRetryPlan {
  const { attempt, nowMs, policy } = input;
  requireSafeInteger(attempt, "learning attempt", 1);
  requireSafeInteger(nowMs, "learning retry time", Number.MIN_SAFE_INTEGER);
  requireSafeInteger(policy.maxAttempts, "maximum learning attempts", 1);
  requireSafeInteger(policy.retryBaseMs, "learning retry base delay", 1);
  requireSafeInteger(policy.retryMaxDelayMs, "maximum learning retry delay", 1);
  if (policy.retryBaseMs > policy.retryMaxDelayMs) {
    throw new Error("Learning retry base delay must not exceed the maximum retry delay.");
  }

  if (input.retryable === false) return { kind: "failed", attempt, nextAttemptAtMs: nowMs };
  if (input.retryAtMs !== undefined) {
    requireSafeInteger(input.retryAtMs, "learning retry deadline", Number.MIN_SAFE_INTEGER);
    return { kind: "defer", attempt, nextAttemptAtMs: Math.max(nowMs, input.retryAtMs) };
  }
  if (attempt >= policy.maxAttempts) return { kind: "failed", attempt, nextAttemptAtMs: nowMs };

  const saturationExponent = Math.ceil(Math.log2(policy.retryMaxDelayMs / policy.retryBaseMs));
  const exponent = Math.min(attempt - 1, saturationExponent);
  const delay = Math.min(policy.retryMaxDelayMs, policy.retryBaseMs * 2 ** exponent);
  const scheduledAt = nowMs + delay;
  const nextAttemptAtMs = Number.isSafeInteger(scheduledAt) ? scheduledAt : Number.MAX_SAFE_INTEGER;
  return { kind: "retry", attempt, nextAttemptAtMs };
}

function requireSafeInteger(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label} must be a safe integer >= ${minimum}.`);
}
