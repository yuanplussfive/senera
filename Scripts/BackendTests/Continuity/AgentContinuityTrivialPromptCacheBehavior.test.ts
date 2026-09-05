import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentTurnValueClassifier } from "../../../Source/AgentSystem/Continuity/AgentTurnValueClassifier.js";
import {
  hashAgentTurnValuePrompt,
  normalizeAgentTurnValuePrompt,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityTurnValueExamples.js";

describe("turn value training examples", () => {
  let workspaceRoot: string;
  let store: AgentContinuitySqliteStore;

  beforeAll(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-turn-value-"));
    store = new AgentContinuitySqliteStore(path.join(workspaceRoot, ".senera", "data", "memory.sqlite"));
  });

  afterAll(() => {
    store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("records distinct labels and accumulates evidence", () => {
    expect(store.listTurnValueTrainingExamples()).toEqual([]);
    expect(store.recordTurnValueTrainingExample("好的。", "unproductive", "2026-08-26T00:00:00.000Z")).toBe(1);
    expect(store.recordTurnValueTrainingExample("好的", "unproductive", "2026-08-26T03:00:00.000Z")).toBe(2);
    expect(store.recordTurnValueTrainingExample("我住在上海", "valuable", "2026-08-26T04:00:00.000Z")).toBe(1);

    expect(
      store.listTurnValueTrainingExamples().map((entry) => [entry.promptText, entry.label, entry.occurrences]),
    ).toEqual([
      ["我住在上海", "valuable", 1],
      ["好的", "unproductive", 2],
    ]);
  });

  test("classifies only after both labels have real examples", () => {
    const classifier = new AgentTurnValueClassifier();
    const examples = [
      ...Array.from({ length: 3 }, (_, index) => ({
        promptText: `我住在城市${index}`,
        label: "valuable" as const,
        occurrences: 1,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        promptText: `收到${index}`,
        label: "unproductive" as const,
        occurrences: 1,
      })),
    ];
    const policy = { enabled: true, confidenceThreshold: 0.8, minimumExamplesPerLabel: 3 };

    expect(classifier.classify("我住在城市", examples.slice(0, 3), policy).label).toBe("unknown");
    expect(classifier.classify("收到", examples, policy).label).toBe("unproductive");
    expect(classifier.classify("我住在城市", examples, policy).label).toBe("valuable");
  });

  test("prunes the oldest training examples", () => {
    store.recordTurnValueTrainingExample("最早的样本", "valuable", "2026-08-26T00:00:00.000Z");
    store.recordTurnValueTrainingExample("较新的样本", "valuable", "2026-08-26T01:00:00.000Z");
    expect(store.pruneTurnValueTrainingExamples(3)).toBe(1);
    expect(store.listTurnValueTrainingExamples().some((entry) => entry.promptText === "最早的样本")).toBe(false);
  });

  test("normalizes stable hashes without losing meaningful suffixes", () => {
    expect(hashAgentTurnValuePrompt("OK!")).toBe(hashAgentTurnValuePrompt(" ok？"));
    expect(hashAgentTurnValuePrompt("ＯＫ")).toBe(hashAgentTurnValuePrompt("ok"));
    expect(normalizeAgentTurnValuePrompt("好的")).not.toBe(normalizeAgentTurnValuePrompt("好的呢"));
  });
});
