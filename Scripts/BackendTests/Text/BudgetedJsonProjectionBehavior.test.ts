import { describe, expect, test } from "vitest";
import {
  AgentBudgetedJsonProjector,
  AgentJsonProjectionProtocol,
} from "../../../Source/AgentSystem/Text/AgentBudgetedJsonProjection.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";

describe("budgeted JSON projection", () => {
  test("keeps partial JSON structurally valid and inside the exact model token budget", () => {
    const projector = new AgentBudgetedJsonProjector("gpt-4o");
    const estimator = new AgentModelTokenEstimator({ model: "gpt-4o" });
    const tokenLimit = 180;
    const source = {
      status: "ok",
      items: Array.from({ length: 100 }, (_, index) => ({ index, value: `value-${index}-${"x".repeat(40)}` })),
    };

    const projection = projector.project(source, tokenLimit);
    const parsed = JSON.parse(projection.text) as Record<string, unknown>;

    expect(projection.complete).toBe(false);
    expect(projection.tokenCount).toBeLessThanOrEqual(tokenLimit);
    expect(estimator.estimate(projection.text).tokenCount).toBe(projection.tokenCount);
    expect(parsed).toMatchObject({ type: AgentJsonProjectionProtocol.type, complete: false });
    expect(projection.projectedValue).toEqual(parsed.value);
    expect(projection.text).not.toContain("senera.token_preview.v1");
  });

  test("returns the original JSON shape when it already fits", () => {
    const projector = new AgentBudgetedJsonProjector("gpt-4o");
    const source = { ok: true, values: [1, 2, 3] };
    const projection = projector.project(source, 1_000);

    expect(projection.complete).toBe(true);
    expect(JSON.parse(projection.text)).toEqual(source);
    expect(projection.value).toEqual(source);
  });

  test("uses a non-null JSON value when even the projection envelope exceeds the budget", () => {
    const projection = new AgentBudgetedJsonProjector("gpt-4o").project({ payload: "x".repeat(1_000) }, 1);

    expect(projection.text).toBe("{}");
    expect(projection.tokenCount).toBeLessThanOrEqual(projection.tokenLimit);
  });
});

describe("turn token budget", () => {
  test("derives a stable staging budget from the latest provider payload", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 10_000,
      outputReserveTokens: 1_000,
    });
    budget.observeModelInput({ messages: [{ role: "user", content: "inspect data" }] });
    const available = budget.availableTokens();

    expect(budget.availableTokens()).toBe(available);
    expect(budget.availableTokens(available - 1)).toBe(available - 1);

    budget.observeModelInput({ messages: [{ role: "user", content: "inspect more data".repeat(100) }] });
    expect(budget.availableTokens()).toBeLessThan(available);
  });
});
