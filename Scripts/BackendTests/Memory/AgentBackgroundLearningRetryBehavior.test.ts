import { describe, expect, test } from "vitest";
import { planAgentBackgroundLearningRetry } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRetry.js";

const policy = { maxAttempts: 4, retryBaseMs: 250, retryMaxDelayMs: 1_000 };

describe("background learning retry policy", () => {
  test("uses one bounded exponential schedule for each failed attempt", () => {
    expect(planAgentBackgroundLearningRetry({ attempt: 1, nowMs: 10_000, policy })).toEqual({
      kind: "retry",
      attempt: 1,
      nextAttemptAtMs: 10_250,
    });
    expect(planAgentBackgroundLearningRetry({ attempt: 3, nowMs: 10_000, policy })).toEqual({
      kind: "retry",
      attempt: 3,
      nextAttemptAtMs: 11_000,
    });
  });

  test("stops at the configured maximum attempt", () => {
    expect(planAgentBackgroundLearningRetry({ attempt: 4, nowMs: 10_000, policy })).toEqual({
      kind: "failed",
      attempt: 4,
      nextAttemptAtMs: 10_000,
    });
  });

  test("defers budget-limited work to its release time without treating it as a failed attempt", () => {
    expect(planAgentBackgroundLearningRetry({ attempt: 4, nowMs: 10_000, retryAtMs: 25_000, policy })).toEqual({
      kind: "defer",
      attempt: 4,
      nextAttemptAtMs: 25_000,
    });
  });

  test("does not retry work whose source has been permanently removed", () => {
    expect(planAgentBackgroundLearningRetry({ attempt: 1, nowMs: 10_000, policy, retryable: false })).toEqual({
      kind: "failed",
      attempt: 1,
      nextAttemptAtMs: 10_000,
    });
  });
});
