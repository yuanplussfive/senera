import { describe, expect, test } from "vitest";
import { AgentBudgetedJsonProjector } from "../../../Source/AgentSystem/Text/AgentBudgetedJsonProjection.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";

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
    expect(parsed).toEqual(projection.projectedValue);
    expect(projection.omissionCount).toBeGreaterThan(0);
  });

  test("returns the original JSON shape when it already fits", () => {
    const projector = new AgentBudgetedJsonProjector("gpt-4o");
    const source = { ok: true, values: [1, 2, 3] };
    const projection = projector.project(source, 1_000);

    expect(projection.complete).toBe(true);
    expect(JSON.parse(projection.text)).toEqual(source);
    expect(projection.projectedValue).toEqual(source);
  });

  test("keeps the projected value valid at the smallest JSON budget", () => {
    const projection = new AgentBudgetedJsonProjector("gpt-4o").project({ payload: "x".repeat(1_000) }, 1);

    expect(projection.projectedValue).toEqual({});
    expect(projection.text).toBe("{}");
    expect(projection.complete).toBe(false);
  });

  test("keeps a token-bounded prefix for an oversized nested string", () => {
    const projection = new AgentBudgetedJsonProjector("gpt-4o").project(
      {
        result: {
          content: "important diagnostic content ".repeat(2_000),
          range: { startByte: 0, endByte: 8_200, totalBytes: 37_729 },
        },
      },
      220,
    );
    const parsed = JSON.parse(projection.text) as {
      result?: { content?: string; range?: Record<string, number> };
    };

    expect(projection.complete).toBe(false);
    expect(projection.tokenCount).toBeLessThanOrEqual(projection.tokenLimit);
    expect(parsed.result?.content).toEqual(expect.stringContaining("important diagnostic content"));
    expect(parsed.result?.content?.endsWith("...")).toBe(true);
    expect(parsed.result?.range).toEqual({ startByte: 0, endByte: 8_200, totalBytes: 37_729 });
    expect(projection.omissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/result/content", reason: "token_limit" })]),
    );
  });

  test("projects sibling string leaves independently instead of dropping the first overflow branch", () => {
    const projection = new AgentBudgetedJsonProjector("gpt-4o").project(
      {
        first: "first field ".repeat(1_000),
        second: "second field ".repeat(1_000),
      },
      220,
    );
    const parsed = JSON.parse(projection.text) as Record<string, string>;

    expect(projection.tokenCount).toBeLessThanOrEqual(projection.tokenLimit);
    expect(parsed.first).toEqual(expect.stringContaining("first field"));
    expect(parsed.second).toEqual(expect.stringContaining("second field"));
    expect(parsed.first.endsWith("...")).toBe(true);
    expect(parsed.second.endsWith("...")).toBe(true);
  });

  test("bounds long unbroken tokenization segments before exact BPE work", () => {
    const source = { payload: "x".repeat(300_000) };
    const projection = new AgentBudgetedJsonProjector("test-model").project(source, 64_000);

    expect(projection.complete).toBe(false);
    expect(projection.tokenCount).toBeLessThanOrEqual(projection.tokenLimit);
    expect(JSON.stringify(projection.projectedValue)).not.toContain(source.payload);
    expect(JSON.stringify(projection.projectedValue)).toContain("...");
  });

  test("returns a token-fitting text preview without encoding the unbounded source", () => {
    const limit = 128;
    const preview = new AgentTokenProjector("test-model").previewText("x".repeat(300_000), limit);

    expect(preview.truncated).toBe(true);
    expect(new AgentModelTokenEstimator({ model: "test-model" }).estimate(preview.text).tokenCount).toBeLessThanOrEqual(
      limit,
    );
  });
});

describe("turn token budget", () => {
  test("derives a stable staging budget from the latest provider payload", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 10_000,
      outputReserveTokens: 1_000,
    });
    budget.validateModelInput({ messages: [{ role: "user", content: "inspect data" }] });
    const available = budget.availableTokens();

    expect(budget.availableTokens()).toBe(available);
    expect(budget.availableTokens(available - 1)).toBe(available - 1);

    budget.validateModelInput({ messages: [{ role: "user", content: "inspect more data".repeat(100) }] });
    expect(budget.availableTokens()).toBeLessThan(available);
  });

  test("partitions parallel tool observations into exclusive reservations", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 1_000,
      outputReserveTokens: 200,
    });
    budget.validateModelInput({ messages: [{ role: "user", content: "inspect both sources" }] });
    const available = budget.availableTokens();
    budget.reserveToolBatch({ callIds: ["call-a", "call-b", "call-c"] });

    const reservations = [
      budget.claimToolObservation("call-a", 10_000),
      budget.claimToolObservation("call-b", 10_000),
      budget.claimToolObservation("call-c", 10_000),
    ];

    expect(reservations.reduce((total, reservation) => total + reservation.limit, 0)).toBe(available);
    expect(Math.max(...reservations.map((reservation) => reservation.limit))).toBeLessThanOrEqual(
      Math.min(...reservations.map((reservation) => reservation.limit)) + 1,
    );
    reservations.forEach((reservation) => reservation.release());
  });

  test("deducts the assistant turn and Tool-result envelopes before allocating observation content", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 4_000,
      outputReserveTokens: 1_000,
    });
    budget.validateModelInput({ messages: [{ role: "user", content: "inspect both sources" }] });
    const available = budget.availableTokens();
    budget.reserveToolBatch({
      callIds: ["call-a", "call-b"],
      fixedPayload: {
        assistant: {
          role: "assistant",
          content: "Preparing two tool calls. ".repeat(20),
        },
        toolResults: [
          { role: "toolResult", toolCallId: "call-a", toolName: "ReadA", content: "" },
          { role: "toolResult", toolCallId: "call-b", toolName: "ReadB", content: "" },
        ],
      },
    });

    const reservations = [budget.claimToolObservation("call-a", 10_000), budget.claimToolObservation("call-b", 10_000)];
    expect(reservations.reduce((total, reservation) => total + reservation.limit, 0)).toBeLessThan(available);
    reservations.forEach((reservation) => reservation.release());
  });

  test("blocks the next model input until every observation reservation is finalized", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 2_000,
      outputReserveTokens: 200,
    });
    budget.validateModelInput({ messages: [] });
    budget.reserveToolBatch({ callIds: ["call-a", "call-b"] });
    const first = budget.claimToolObservation("call-a", 100);
    const second = budget.claimToolObservation("call-b", 100);
    first.commit({ ok: true });

    expect(() => budget.validateModelInput({ messages: [] })).toThrow("call-b");
    second.release();
    expect(() => budget.validateModelInput({ messages: [] })).not.toThrow();
  });

  test("settles an unclaimed reservation for a terminal pre-execution failure", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 2_000,
      outputReserveTokens: 200,
    });
    budget.validateModelInput({ messages: [] });
    budget.reserveToolBatch({ callIds: ["call-validation"] });

    expect(budget.settleToolObservation("call-validation", { error: "invalid arguments" })).toBe(true);
    expect(budget.settleToolObservation("call-validation", { error: "duplicate terminal event" })).toBe(false);
    expect(() => budget.validateModelInput({ messages: [] })).not.toThrow();
  });

  test("rejects a planning input that already exceeds model capacity", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 128,
      outputReserveTokens: 64,
    });

    expect(() => budget.validateModelInput({ content: "large ".repeat(1_000) })).toThrow("planning input uses");
  });

  test("does not count inline image base64 as text tokens", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-5.6-luna",
      contextWindowTokens: 211_616,
      outputReserveTokens: 0,
    });
    const image = {
      type: "image",
      mimeType: "image/png",
      data: "a".repeat(1_800_000),
    };

    expect(() =>
      budget.validateModelInput({
        messages: [{ role: "user", content: [{ type: "text", text: "Describe this." }, image] }],
      }),
    ).not.toThrow();
    expect(budget.snapshot().occupiedTokens).toBeLessThan(2_000);
  });

  test("records over-capacity provider usage without invalidating a completed response", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 128,
      outputReserveTokens: 64,
    });

    expect(() => budget.recordProviderInputTokens(96)).not.toThrow();
    expect(budget.availableTokens()).toBe(0);
  });

  test("projects only the completed turn and rebases after compaction", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 4_000,
      outputReserveTokens: 1_000,
    });
    budget.recordProviderInputTokens(2_400);
    const before = budget.snapshot();
    const projected = budget.projectNextProviderInput({
      assistant: { role: "assistant", content: "working" },
      toolResults: [{ role: "toolResult", content: "evidence ".repeat(100) }],
    });

    expect(projected.previousTokenCount).toBe(2_400);
    expect(projected.appendedTokenCount).toBeGreaterThan(0);
    expect(projected.tokenCount).toBe(2_400 + projected.appendedTokenCount);
    expect(budget.snapshot()).toEqual(before);

    const rebased = budget.rebaseModelInput({ messages: [{ role: "user", content: "compacted" }] });
    expect(rebased.tokenCount).toBeLessThan(projected.tokenCount);
    expect(budget.snapshot().occupiedTokens).toBe(rebased.tokenCount);
    expect(budget.availableTokens()).toBeGreaterThan(before.availableTokens);
  });

  test("requires completed observation reservations before an incremental projection", () => {
    const budget = new AgentTurnTokenBudget({
      model: "gpt-4o",
      contextWindowTokens: 2_000,
      outputReserveTokens: 200,
    });
    budget.validateModelInput({ messages: [] });
    budget.reserveToolBatch({ callIds: ["call-pending"] });
    const reservation = budget.claimToolObservation("call-pending", 100);

    expect(() => budget.projectNextProviderInput({ messages: [] })).toThrow("call-pending");
    reservation.commit({ ok: true });
    expect(() => budget.projectNextProviderInput({ messages: [] })).not.toThrow();
  });
});
