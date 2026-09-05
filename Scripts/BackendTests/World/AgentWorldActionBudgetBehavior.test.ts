import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test } from "vitest";
import {
  AgentWorldActionSourceIds,
  AgentWorldWakeBudget,
} from "../../../Source/AgentSystem/World/AgentWorldActionBudget.js";

const now = Temporal.Instant.from("2026-09-02T00:00:00Z");

function createBudget(overrides: Partial<ConstructorParameters<typeof AgentWorldWakeBudget>[0]> = {}) {
  return new AgentWorldWakeBudget(
    {
      maxActionsPerWake: 2,
      maxDecisionCandidatesPerWake: 1,
      retryDelayMs: 30_000,
      fairShare: false,
      sourceCaps: {},
      ...overrides,
    },
    now,
    [AgentWorldActionSourceIds.Goal, AgentWorldActionSourceIds.Autonomy],
  );
}

describe("world action budget", () => {
  test("admits deterministic action and decision units within shared limits", () => {
    const budget = createBudget();

    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Goal,
        candidateId: "goal-1",
        kind: "decision",
        priority: 100,
      }),
    ).toMatchObject({ admitted: true, reason: "admitted" });
    expect(budget.remainingActions).toBe(1);
    expect(budget.remainingDecisions).toBe(0);

    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Autonomy,
        candidateId: "routine-1",
        kind: "decision",
        priority: 90,
      }),
    ).toMatchObject({ admitted: false, reason: "decision_limit", retryAt: now.add({ seconds: 30 }) });
    expect(budget.hasDeferredWork).toBe(true);

    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Autonomy,
        candidateId: "routine-2",
        kind: "action",
        priority: 80,
      }),
    ).toMatchObject({ admitted: true, reason: "admitted" });
    expect(budget.remainingActions).toBe(0);
  });

  test("enforces source caps and rejects duplicate or conflicting claims without consuming budget", () => {
    const budget = createBudget({
      maxActionsPerWake: 3,
      maxDecisionCandidatesPerWake: 3,
      sourceCaps: { [AgentWorldActionSourceIds.Goal]: 1 },
    });
    const candidate = {
      sourceId: AgentWorldActionSourceIds.Goal,
      candidateId: "goal-1",
      kind: "action" as const,
      priority: 50,
      conflictKeys: ["entity:desk"],
    };

    expect(budget.admit(candidate)).toMatchObject({ admitted: true });
    expect(budget.admit(candidate)).toMatchObject({ admitted: false, reason: "duplicate" });
    expect(
      budget.admit({
        ...candidate,
        candidateId: "goal-2",
      }),
    ).toMatchObject({ admitted: false, reason: "conflict" });
    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Goal,
        candidateId: "goal-3",
        kind: "action",
        priority: 40,
      }),
    ).toMatchObject({ admitted: false, reason: "source_limit", retryAt: now.add({ seconds: 30 }) });
    expect(budget.remainingActions).toBe(2);
  });

  test("uses fair shares to prevent a higher-priority source from starving another source", () => {
    const budget = createBudget({
      maxActionsPerWake: 4,
      maxDecisionCandidatesPerWake: 4,
      fairShare: true,
    });
    const goal = (candidateId: string) =>
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Goal,
        candidateId,
        kind: "action",
        priority: 100,
      });
    expect(goal("goal-1")).toMatchObject({ admitted: true });
    expect(goal("goal-2")).toMatchObject({ admitted: true });
    expect(goal("goal-3")).toMatchObject({ admitted: false, reason: "source_limit" });
    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Autonomy,
        candidateId: "routine-1",
        kind: "action",
        priority: 1,
      }),
    ).toMatchObject({ admitted: true });
  });

  test("keeps low-frequency maintenance sources out of the fair-share denominator", () => {
    const budget = new AgentWorldWakeBudget(
      {
        maxActionsPerWake: 4,
        maxDecisionCandidatesPerWake: 4,
        retryDelayMs: 30_000,
        fairShare: true,
        sourceCaps: {},
      },
      now,
      [AgentWorldActionSourceIds.Goal, AgentWorldActionSourceIds.Autonomy],
    );
    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Goal,
        candidateId: "goal-1",
        kind: "action",
        priority: 1,
      }),
    ).toMatchObject({ admitted: true });
    expect(
      budget.admit({
        sourceId: AgentWorldActionSourceIds.Goal,
        candidateId: "goal-2",
        kind: "action",
        priority: 1,
      }),
    ).toMatchObject({ admitted: true });
  });

  test("rejects malformed budget configuration instead of hiding a runtime fallback", () => {
    expect(
      () =>
        new AgentWorldWakeBudget(
          {
            maxActionsPerWake: 0,
            maxDecisionCandidatesPerWake: 1,
            retryDelayMs: 30_000,
            fairShare: false,
            sourceCaps: {},
          },
          now,
          [],
        ),
    ).toThrow(/maxActionsPerWake/);
  });
});
