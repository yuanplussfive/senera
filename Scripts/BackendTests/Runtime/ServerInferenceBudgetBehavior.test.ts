import { expect, test } from "vitest";
import { createSeneraServerInferenceBudget } from "../../../Apps/ServerInferenceBudget.js";

test("workspace scopes share the host inference quota and settle active requests", () => {
  const budget = createSeneraServerInferenceBudget(() => ({
    ModelProviders: [],
    InferenceBudget: {
      Enabled: true,
      MaxRequests: 10,
      MaxConcurrent: 1,
      ForegroundReserveFraction: 0,
    },
  }));
  const request = { lane: "foreground", sourceId: "model", estimatedInputTokens: 8 };
  const first = budget.reserve({ ...request, scope: "workspace-a" });
  expect(first).toMatchObject({ allowed: true, reservation: expect.any(Object) });
  expect(budget.reserve({ ...request, scope: "workspace-b" })).toMatchObject({
    allowed: false,
    reason: "concurrency_limit",
  });
  budget.settle({ reservationId: first.reservation!.id, actualInputTokens: 6 });
  expect(budget.reserve({ ...request, scope: "workspace-b" })).toMatchObject({ allowed: true });
});
