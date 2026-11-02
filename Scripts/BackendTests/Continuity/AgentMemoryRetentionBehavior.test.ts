import { MemOS } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  agentMemoryIsActive,
  agentMemoryRetention,
  AgentMemoryRetentionDecisionSchema,
  AgentMemoryRetentionDefaults,
} from "../../../Source/AgentSystem/Continuity/AgentMemoryRetention.js";
import { AgentMemoryRetentionModel } from "../../../Source/AgentSystem/Continuity/AgentMemoryRetentionModel.js";
import { AgentStructuredModelClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentStructuredModelClient.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

const stores: MemOS[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
});

async function fixture() {
  const store = new MemOS({ dbPath: ":memory:" });
  stores.push(store);
  await store.init();
  return store;
}
const confirmedAt = "2026-10-01T00:00:00.000Z";
const day = 86_400_000;
const start = Date.parse(confirmedAt);

describe("memory lifetime independent of retrieval weight", () => {
  test("expires legacy facts from their original content time, never from a read or trust update", async () => {
    const store = await fixture();
    const { node } = await store.store("A version-specific project fact", { type: "fact", validFrom: start });
    expect(agentMemoryRetention(node, AgentMemoryRetentionDefaults)).toEqual({ days: 7, confirmedAt });
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now: start + 7 * day - 1 })).toBe(true);
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now: start + 7 * day })).toBe(false);
    await store.update(node.id, { trustScore: 1 });
    const updated = (await store.retrieve(node.id))!;
    expect(agentMemoryRetention(updated, AgentMemoryRetentionDefaults)).toEqual({ days: 7, confirmedAt });
    expect(agentMemoryIsActive(updated, AgentMemoryRetentionDefaults, { now: start + 8 * day })).toBe(false);
    expect(await store.retrieve(node.id)).toBeDefined();
  });

  test.each(["preference", "relationship"] as const)(
    "%s has no default time expiry but respects supersession",
    async (type) => {
      const store = await fixture();
      const { node } = await store.store("Durable source-backed knowledge", { type, validFrom: start });
      expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now: start + 365 * day })).toBe(true);
      expect(
        agentMemoryIsActive({ ...node, validTo: start + day }, AgentMemoryRetentionDefaults, { now: start + 2 * day }),
      ).toBe(false);
    },
  );

  test("task context expires globally after one day but remains available only to its exact session task", async () => {
    const store = await fixture();
    const { node } = await store.store("Pending work and failed attempts", {
      type: "context",
      validFrom: start,
      metadata: { senera_task_id: "task", senera_source_session_ids: ["session"] },
    });
    const now = start + 2 * day;
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now })).toBe(false);
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now, sessionId: "session", taskId: "task" })).toBe(
      true,
    );
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now, sessionId: "other", taskId: "task" })).toBe(
      false,
    );
    expect(
      agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now, sessionId: "session", taskId: "other" }),
    ).toBe(false);
    expect(
      agentMemoryIsActive({ ...node, validTo: start + day }, AgentMemoryRetentionDefaults, {
        now,
        sessionId: "session",
        taskId: "task",
      }),
    ).toBe(false);
  });

  test("model-selected days override the default and zero still respects source validity", async () => {
    const store = await fixture();
    const { node } = await store.store("Explicitly durable project agreement", {
      type: "fact",
      validFrom: start,
      metadata: { senera_retention: { days: 0, confirmedAt } },
    });
    expect(agentMemoryIsActive(node, AgentMemoryRetentionDefaults, { now: start + 365 * day })).toBe(true);
    expect(
      agentMemoryIsActive({ ...node, validTo: start + day }, AgentMemoryRetentionDefaults, { now: start + 2 * day }),
    ).toBe(false);
    expect(AgentMemoryRetentionDecisionSchema.safeParse({ days: 7, reason: "extra output" }).success).toBe(false);
    for (const days of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(AgentMemoryRetentionDecisionSchema.safeParse({ days }).success).toBe(false);
  });

  test.each(["native", "baml"] as const)(
    "%s retention uses the shared structured client and bounds the entire input",
    async (mode) => {
      const execute = vi.spyOn(AgentStructuredModelClient.prototype, "execute").mockResolvedValue({ days: 7 });
      const model = createModelProvider({
        Model: "gpt-4o",
        ToolPlanningMode: mode,
        ContextWindowTokens: 8192,
        MaxOutputTokens: 512,
      });
      await new AgentMemoryRetentionModel(model, "agent").assess(
        {
          fact: { topic: "storage", summary: "Project currently uses SQLite" },
          user: "Check the storage implementation",
          memoryIntents: [],
          sources: [{ kind: "tool", text: "Long source material ".repeat(2000) }],
          history: [{ request: "Earlier question", assistant: "Earlier answer ".repeat(1000) }],
          confirmedAt,
          defaultDays: 7,
          inputTokenBudget: 1024,
        },
        "retention-request",
      );
      const request = execute.mock.calls[0]![0];
      expect(request.contract.bamlFunction).toBe("AssessMemoryRetention");
      const tokens = new AgentModelTokenEstimator({ model: model.Model }).estimate(
        request.systemPrompt +
          JSON.stringify(request.contract.schema.toJSONSchema({ target: "draft-7" })) +
          request.userPrompt,
      ).tokenCount;
      expect(tokens).toBeLessThanOrEqual(1024);
      expect(JSON.parse(request.userPrompt)).toMatchObject({
        fact: { summary: "Project currently uses SQLite" },
        defaultDays: 7,
      });
    },
  );
});
