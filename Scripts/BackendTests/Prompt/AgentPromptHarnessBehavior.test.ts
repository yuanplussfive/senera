import { describe, expect, test } from "vitest";
import { composeAgentPromptHarness } from "../../../Source/AgentSystem/Prompt/AgentPromptHarness.js";

const estimate = {
  estimateTokens: (text: string) => (text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))),
};

describe("prompt harness composition", () => {
  test("joins the three tiers in order and reports per-tier statistics", () => {
    const composition = composeAgentPromptHarness(
      {
        frozen: { text: "frozen head", revision: "static" },
        stable: { text: "stable body", revision: "r-stable" },
        volatile: { text: "volatile tail", revision: "r-volatile" },
      },
      estimate,
    );
    expect(composition.text).toBe("frozen head\n\nstable body\n\nvolatile tail");
    expect(composition.sections.frozen.revision).toBe("static");
    expect(composition.sections.frozen.bytes).toBeGreaterThan(0);
    expect(composition.sections.stable.revision).toBe("r-stable");
    expect(composition.sections.volatile.tokens).toBeGreaterThan(0);
    expect(composition.merged.tokens).toBeGreaterThan(composition.sections.frozen.tokens);
  });

  test("collapses empty tiers without producing stray separators", () => {
    const composition = composeAgentPromptHarness(
      {
        frozen: { text: "only frozen", revision: "static" },
        stable: { text: "", revision: "r-stable" },
        volatile: { text: "\n\n", revision: "r-volatile" },
      },
      estimate,
    );
    expect(composition.text).toBe("only frozen");
    expect(composition.sections.stable.bytes).toBe(0);
    expect(composition.sections.volatile.tokens).toBe(0);
  });

  test("zero-length input produces an empty merged composition", () => {
    const composition = composeAgentPromptHarness(
      {
        frozen: { text: "", revision: "static" },
        stable: { text: "", revision: "r-stable" },
        volatile: { text: "", revision: "r-volatile" },
      },
      estimate,
    );
    expect(composition.text).toBe("");
    expect(composition.merged.bytes).toBe(0);
    expect(composition.merged.tokens).toBe(0);
  });

  test("frozen revision stays static regardless of payload revisions", () => {
    const a = composeAgentPromptHarness(
      {
        frozen: { text: "truth", revision: "static" },
        stable: { text: "s1", revision: "a" },
        volatile: { text: "v1", revision: "a" },
      },
      estimate,
    );
    const b = composeAgentPromptHarness(
      {
        frozen: { text: "truth", revision: "static" },
        stable: { text: "s2", revision: "b" },
        volatile: { text: "v2", revision: "b" },
      },
      estimate,
    );
    expect(a.sections.frozen.revision).toBe(b.sections.frozen.revision);
    expect(a.sections.volatile.revision).not.toBe(b.sections.volatile.revision);
    expect(a.text.split("\n\n")[0]).toBe(b.text.split("\n\n")[0]);
  });
});
