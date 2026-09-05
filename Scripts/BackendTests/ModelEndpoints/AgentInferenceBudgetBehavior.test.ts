import { describe, expect, test } from "vitest";
import {
  AgentInferenceBudgetExceededError,
  AgentSlidingWindowInferenceBudget,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";

describe("background inference budget", () => {
  test("limits requests and provides a deterministic retry boundary", () => {
    let now = 1_000;
    const budget = new AgentSlidingWindowInferenceBudget(
      () => ({ windowMs: 1_000, maxRequests: 1, maxEstimatedInputTokens: 100 }),
      () => now,
    );

    expect(budget.acquire({ scope: "world-1", estimatedInputTokens: 50 })).toEqual({ allowed: true });
    const denied = budget.acquire({ scope: "world-1", estimatedInputTokens: 1 });
    expect(denied).toEqual({ allowed: false, retryAtMs: 2_000, reason: "request_limit" });

    now = 2_000;
    expect(budget.acquire({ scope: "world-1", estimatedInputTokens: 100 })).toEqual({ allowed: true });
  });

  test("rejects invalid policy and denial metadata instead of falling back", () => {
    expect(() =>
      new AgentSlidingWindowInferenceBudget(() => ({
        windowMs: 0,
        maxRequests: 1,
        maxEstimatedInputTokens: 1,
      })).acquire({
        scope: "world-1",
        estimatedInputTokens: 1,
      }),
    ).toThrow("windowMs must be a positive safe integer");
    expect(new AgentInferenceBudgetExceededError(2_000, "input_token_limit")).toBeInstanceOf(Error);
  });

  test("keeps reservations active until the caller settles them", () => {
    const budget = new AgentSlidingWindowInferenceBudget(
      () => ({ windowMs: 1_000, maxRequests: 2, maxEstimatedInputTokens: 100, maxConcurrent: 1 }),
      () => 1_000,
    );

    const reservation = budget.reserve({
      scope: "world-1",
      lane: "goal",
      sourceId: "goal-micro-loop",
      estimatedInputTokens: 10,
    });
    expect(reservation.allowed).toBe(true);
    expect(
      budget.reserve({
        scope: "world-1",
        lane: "resident",
        sourceId: "resident-idle",
        estimatedInputTokens: 10,
      }),
    ).toMatchObject({ allowed: false, reason: "concurrency_limit" });

    if (!reservation.reservation) throw new Error("Expected a reservation for the admitted request.");
    budget.settle({ reservationId: reservation.reservation.id, actualInputTokens: 8 });
    expect(
      budget.reserve({
        scope: "world-1",
        lane: "resident",
        sourceId: "resident-idle",
        estimatedInputTokens: 10,
      }).allowed,
    ).toBe(true);
  });

  test("returns a structured retry when the policy is disabled", () => {
    const budget = new AgentSlidingWindowInferenceBudget(
      () => ({
        enabled: false,
        windowMs: 1_000,
        maxRequests: 2,
        maxEstimatedInputTokens: 100,
      }),
      () => 1_000,
    );

    expect(
      budget.reserve({
        scope: "world-1",
        lane: "continuity",
        sourceId: "continuity.learning",
        estimatedInputTokens: 10,
      }),
    ).toEqual({ allowed: false, retryAtMs: 2_000, reason: "disabled" });
  });

  test("uses configured lane weights for concurrent fairness", () => {
    const budget = new AgentSlidingWindowInferenceBudget(
      () => ({
        windowMs: 1_000,
        maxRequests: 8,
        maxEstimatedInputTokens: 1_000,
        maxConcurrent: 2,
        laneWeights: { goal: 4, resident: 1 },
      }),
      () => 1_000,
    );
    const resident = budget.reserve({
      scope: "world-1",
      lane: "resident",
      sourceId: "resident-idle",
      estimatedInputTokens: 1,
    });
    expect(resident.allowed).toBe(true);
    expect(
      budget.reserve({
        scope: "world-1",
        lane: "resident",
        sourceId: "resident-idle",
        estimatedInputTokens: 1,
      }),
    ).toMatchObject({ allowed: false, reason: "concurrency_limit" });
    expect(
      budget.reserve({
        scope: "world-1",
        lane: "goal",
        sourceId: "goal-micro-loop",
        estimatedInputTokens: 1,
      }).allowed,
    ).toBe(true);
  });
});
