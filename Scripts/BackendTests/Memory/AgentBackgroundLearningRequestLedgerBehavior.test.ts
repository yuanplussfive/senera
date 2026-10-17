import { afterEach, describe, expect, test } from "vitest";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { ModelProviderHttpError } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";
import { AgentModelResponseBudgetError } from "../../../Source/AgentSystem/ModelEndpoints/ModelResponseBudget.js";
import { recordActiveAgentModelUsage } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("background learning request ledger", () => {
  test("resumes a remaining attempt and refuses to reset exhausted attempts after restart", async () => {
    const fixture = createFixture();
    try {
      const ledger = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      const input = {
        operationKey: "durable-operation",
        board: "semantic_memory" as const,
        stage: "extract",
        sourceRevision: "revision-1",
      };
      const policy = { maxAttempts: 2, retryBaseMs: 1, retryMaxDelayMs: 1 };
      ledger.begin({ ...input, attempt: 1 }).fail({ error: new Error("first attempt failed") });
      const resumed = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      await expect(
        resumed.runRetried(input, policy, async (attempt) => {
          expect(attempt).toBe(2);
          recordActiveAgentModelUsage({
            stage: "model",
            usage: { source: "provider_reported", inputTokens: 7, outputTokens: 2, totalTokens: 9 },
          });
          throw new Error("last attempt failed");
        }),
      ).rejects.toThrow("last attempt failed");
      const records = ledger.list();
      expect(records).toHaveLength(2);
      expect(records.find((record) => record.attempt === 2)?.status).toBe("exhausted");
      expect(
        ledger.isRecoverable(
          records.find((record) => record.attempt === 2)!,
          policy,
        ),
      ).toBe(false);
      expect(records.find((record) => record.attempt === 2)?.usage).toMatchObject({ inputTokens: 7, totalTokens: 9 });
      let invoked = false;
      await expect(
        new AgentBackgroundLearningRequestLedger(fixture.kernel).runRetried(input, policy, async () => {
          invoked = true;
        }),
      ).rejects.toThrow("exhausted");
      expect(invoked).toBe(false);
      expect(ledger.list()).toHaveLength(2);
      await expect(
        resumed.runRetried({ ...input, sourceRevision: "revision-2" }, policy, async (attempt) => attempt),
      ).resolves.toBe(1);
    } finally {
      fixture.kernel.close();
    }
  });
  test("classifies typed causes without interpreting words in generic error messages", () => {
    const fixture = createFixture();
    try {
      const ledger = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      const input = { operationKey: "typed-failure", board: "semantic_memory" as const, stage: "extract", attempt: 1 };
      ledger.begin(input).fail({ error: new Error("JSON HTTP database timeout") });
      ledger.begin(input).fail({
        error: new Error("Wrapped provider failure", {
          cause: new ModelProviderHttpError(429, "Rate limit", "retry"),
        }),
      });
      ledger.begin(input).fail({
        error: new Error("Wrapped response budget failure", {
          cause: new AgentModelResponseBudgetError("response_bytes", 10, 11),
        }),
      });
      expect(ledger.list().map((row) => row.errorCode)).toEqual(
        expect.arrayContaining(["provider_http", "unknown", "budget"]),
      );
    } finally {
      fixture.kernel.close();
    }
  });

  test("rejects invalid persisted metadata instead of returning an empty object", () => {
    const fixture = createFixture();
    try {
      const ledger = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      const handle = ledger.begin({ operationKey: "metadata", board: "semantic_memory", stage: "extract", attempt: 1 });
      fixture.kernel.connection
        .prepare("UPDATE memory_background_learning_requests SET metadata_json = '[]' WHERE request_id = ?")
        .run(handle.requestId);
      expect(() => ledger.list()).toThrow();
    } finally {
      fixture.kernel.close();
    }
  });

  test("records each invocation even when the scheduler attempt number is unchanged", () => {
    const fixture = createFixture();
    try {
      const ledger = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      const input = {
        operationKey: "semantic_memory:digest_summary:senera://memos/daily/2026-10-07:rev-1",
        board: "semantic_memory" as const,
        stage: "day:summary",
        entityUri: "senera://memory-digest/day-1",
        sourceRevision: "rev-1",
        attempt: 1,
        providerId: "provider-1",
        model: "model-1",
        startedAtMs: 1_000,
      };
      ledger.begin(input).fail({ error: new SyntaxError("invalid JSON response") });
      ledger.begin(input).complete();

      const rows = ledger.list({ board: "semantic_memory" });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.requestId)).size).toBe(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationKey: input.operationKey,
            attempt: 1,
            status: "failed",
            errorCode: "schema_validation",
            entityUri: input.entityUri,
            sourceRevision: input.sourceRevision,
          }),
          expect.objectContaining({ operationKey: input.operationKey, attempt: 1, status: "completed" }),
        ]),
      );
    } finally {
      fixture.kernel.close();
    }
  });

  test("keeps each retry visible and preserves usage metadata", () => {
    const fixture = createFixture();
    try {
      const ledger = new AgentBackgroundLearningRequestLedger(fixture.kernel);
      const first = ledger.begin({
        operationKey: "state_card:rewrite:episode-1:revision-1",
        board: "state_card",
        stage: "rewrite",
        entityUri: "senera://memory-episode/episode-1",
        sourceRevision: "revision-1",
        attempt: 1,
        startedAtMs: 2_000,
      });
      first.fail({ error: new Error("provider unavailable"), code: "transport", retryAtMs: 4_000 });
      const second = ledger.begin({
        operationKey: "state_card:rewrite:episode-1:revision-1",
        board: "state_card",
        stage: "rewrite",
        entityUri: "senera://memory-episode/episode-1",
        sourceRevision: "revision-1",
        attempt: 2,
        startedAtMs: 4_000,
      });
      second.complete({
        usage: { source: "provider_reported", inputTokens: 12, outputTokens: 3 },
        metadata: { cacheHit: false },
      });

      expect(ledger.list({ board: "state_card" }).map((row) => row.status)).toEqual(["completed", "failed"]);
      expect(ledger.list({ status: "completed" })[0]?.usage).toEqual(
        expect.objectContaining({ inputTokens: 12, outputTokens: 3 }),
      );
    } finally {
      fixture.kernel.close();
    }
  });
});

function createFixture(): { readonly workspace: string; readonly kernel: AgentSqliteDatabaseKernel } {
  const workspace = createTemporaryDirectory("senera-learning-request-ledger");
  workspaces.add(workspace);
  return {
    workspace,
    kernel: new AgentSqliteDatabaseKernel({
      databasePath: resolveAgentWorkspaceLayout(workspace).databases.memory,
      contract: AgentMemoryDatabaseContract,
    }),
  };
}
