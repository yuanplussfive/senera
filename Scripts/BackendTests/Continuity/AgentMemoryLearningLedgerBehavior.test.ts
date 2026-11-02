import { afterEach, describe, expect, test } from "vitest";
import path from "node:path";
import {
  AgentMemoryLearningLedger,
  agentMemorySubject,
} from "../../../Source/AgentSystem/Continuity/AgentMemoryLearningLedger.js";
import { agentMemoryWeight } from "../../../Source/AgentSystem/Continuity/AgentMemoryQuality.js";
import { AgentMemoryRecallArchiveSnapshotSchema } from "../../../Source/AgentSystem/Continuity/AgentMemoryRecallArchiveContract.js";
import { AgentMemoryRecallSnapshotSchema } from "../../../Source/AgentSystem/Continuity/AgentMemoryRecallContract.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const kernels: AgentSqliteDatabaseKernel[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const kernel of kernels.splice(0)) kernel.close();
  for (const directory of directories.splice(0)) removeDirectory(directory);
});
function fixture() {
  const directory = createTemporaryDirectory("senera-memory-learning-ledger");
  directories.push(directory);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(directory, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  kernels.push(kernel);
  return { kernel, ledger: new AgentMemoryLearningLedger(kernel) };
}
const entry = { id: "knowledge", revision: "content-v1", summary: "Prefers concise replies" };
const completedAt = "2026-10-28T00:00:00Z";
function deliver(
  ledger: AgentMemoryLearningLedger,
  requestId: string,
  topicRelation: "new_topic" | "continue" = "new_topic",
) {
  ledger.task({ sessionId: "session", requestId, topicRelation });
  ledger.stageDelivery("session", requestId, [entry], "snapshot");
  ledger.markDelivered("session", requestId);
}

describe("Agent-local task utility and delivery accounting", () => {
  test("task resumption is session- and subject-bound and cannot redirect an existing request", () => {
    const { ledger } = fixture();
    const original = ledger.task({ sessionId: "session", requestId: "original" });
    ledger.task({ sessionId: "session", requestId: "other-topic" });
    const resumed = ledger.task({ sessionId: "session", requestId: "resumed", resumeRequestId: "original" });
    expect(resumed.taskId).toBe(original.taskId);
    expect(ledger.task({ sessionId: "session", requestId: "resumed", topicRelation: "new_topic" })).toEqual(resumed);
    expect(() =>
      ledger.task({ sessionId: "another-session", requestId: "invalid", resumeRequestId: "original" }),
    ).toThrow("session and subject");
    expect(() =>
      ledger.task({
        sessionId: "session",
        requestId: "invalid",
        resumeRequestId: "original",
        subject: { id: "other", kind: "user" },
      }),
    ).toThrow("session and subject");
    expect(() =>
      ledger.task({ sessionId: "session", requestId: "resumed", subject: { id: "other", kind: "user" } }),
    ).toThrow("cannot change its subject");
  });

  test("starts at 50 and approaches 100 through diminishing helpful task gains", () => {
    const { ledger } = fixture();
    expect(ledger.quality(entry.id).weight).toBe(50);
    const weights = [50];
    for (let index = 0; index < 3; index += 1) {
      const request = `use-${index}`;
      deliver(ledger, request);
      ledger.settleUtility("session", request, entry.id, "helpful", "The answer follows this preference.");
      expect(ledger.quality(entry.id).weight).toBeCloseTo(weights.at(-1)!);
      ledger.completeRecall("session", request, completedAt);
      const settled = ledger.quality(entry.id);
      ledger.settleUtility("session", request, entry.id, "helpful", "The answer follows this preference.");
      expect(ledger.quality(entry.id)).toEqual(settled);
      expect(settled.helpfulCount).toBe(index + 1);
      weights.push(settled.weight);
    }
    expect(weights).toEqual([50, 200 / 3, 75, 80]);
    expect(weights[3]! - weights[2]!).toBeLessThan(weights[2]! - weights[1]!);
    expect(agentMemoryWeight(100000, 0)).toBeGreaterThan(99.99);
    expect(agentMemoryWeight(100000, 0)).toBeLessThan(100);
  });

  test("persists unused and uncertain separately from pending assessments", () => {
    const { kernel, ledger } = fixture();
    for (const request of ["unused", "uncertain", "pending"]) {
      deliver(ledger, request);
      ledger.completeRecall("session", request, completedAt);
    }
    ledger.settleUtility("session", "unused", entry.id, "unused", "This task did not use the preference.");
    ledger.settleUtility("session", "uncertain", entry.id, "uncertain", "The available task record is incomplete.");
    expect(new AgentMemoryLearningLedger(kernel).quality(entry.id)).toMatchObject({
      weight: 50,
      recallCount: 3,
      helpfulCount: 0,
      unusedCount: 1,
      uncertainCount: 1,
      pendingCount: 1,
    });
    expect(
      kernel.connection.prepare("SELECT outcome,reason FROM memory_utility_settlements ORDER BY request_id").all(),
    ).toHaveLength(2);
  });

  test("coalesces updates and cannot acknowledge a newer version with an old revision", () => {
    const { kernel, ledger } = fixture();
    ledger.register(entry.id);
    const old = ledger.pendingScoreUpdates()[0]!;
    deliver(ledger, "first");
    ledger.completeRecall("session", "first", completedAt);
    ledger.settleUtility("session", "first", entry.id, "helpful", "Used in the final answer.");
    ledger.acknowledgeScoreUpdate(old.nodeId, old.revision);
    const restarted = new AgentMemoryLearningLedger(kernel);
    const pending = restarted.pendingScoreUpdates();
    expect(pending).toHaveLength(1);
    expect(restarted.quality(pending[0]!.nodeId).weight).toBeCloseTo(200 / 3);
    expect(pending[0]!.revision).not.toBe(old.revision);
    restarted.acknowledgeScoreUpdate(pending[0]!.nodeId, pending[0]!.revision);
    expect(restarted.pendingScoreUpdates()).toEqual([]);
  });

  test("counts each completed task once and preserves actual use through unused follow-ups", () => {
    const { ledger } = fixture();
    deliver(ledger, "first");
    ledger.completeRecall("session", "first", completedAt);
    ledger.settleUtility("session", "first", entry.id, "helpful", "Used to tailor the response.");
    deliver(ledger, "follow-up", "continue");
    ledger.completeRecall("session", "follow-up", completedAt);
    ledger.settleUtility("session", "follow-up", entry.id, "unused", "The follow-up did not use it.");
    expect(ledger.quality(entry.id)).toMatchObject({ recallCount: 1, helpfulCount: 1, unusedCount: 0 });
    ledger.settleUtility("session", "follow-up", entry.id, "unhelpful", "Following this constraint caused an error.");
    ledger.settleUtility("session", "first", entry.id, "helpful", "Delayed retry of the earlier assessment.");
    expect(ledger.quality(entry.id)).toMatchObject({ helpfulCount: 0, unhelpfulCount: 1 });
    expect(ledger.quality(entry.id).weight).toBeCloseTo(100 / 3);
    expect(() =>
      ledger.reconcileAssessment("session", "follow-up", () => {
        throw new Error("invalid assessment");
      }),
    ).toThrow("invalid assessment");
    expect(ledger.quality(entry.id).unhelpfulCount).toBe(1);
    ledger.retractUtility("session", "follow-up");
    expect(ledger.quality(entry.id).helpfulCount).toBe(1);
  });

  test("previews and unacknowledged receipts cannot receive utility", () => {
    const { ledger } = fixture();
    ledger.task({ sessionId: "session", requestId: "request" });
    ledger.stageDelivery("session", "request", [entry], "snapshot");
    expect(ledger.quality(entry.id).recallCount).toBe(0);
    expect(() => ledger.settleUtility("session", "request", entry.id, "helpful", "Unused staged memory.")).toThrow(
      "delivered",
    );
    ledger.markDelivered("session", "request");
    ledger.stageDelivery("session", "request", [entry], "explicit");
    ledger.markDelivered("session", "request");
    expect(ledger.quality(entry.id).recallCount).toBe(1);
    expect(() => ledger.settleUtility("session", "request", entry.id, "helpful", " ")).toThrow("reason");
  });

  test("source erasure retracts completed-task weight through foreign-key cascades", () => {
    const { ledger } = fixture();
    deliver(ledger, "deleted");
    ledger.completeRecall("session", "deleted", completedAt);
    ledger.settleUtility("session", "deleted", entry.id, "helpful", "Used before the source was deleted.");
    ledger.deleteSources({
      sessionId: "session",
      scope: "from_request",
      requestIds: ["deleted"],
      episodeUris: [],
      sourceUris: [],
    });
    expect(ledger.quality(entry.id)).toMatchObject({ weight: 50, recallCount: 0, helpfulCount: 0 });
  });

  test("keeps preview identity stable and isolates channel speakers", () => {
    const { ledger } = fixture();
    const channel = agentMemorySubject({
      surface: "channel",
      platform: "onebot11",
      profileId: "qq",
      message: { senderId: "123", senderKind: "user" },
    });
    expect(channel.id).not.toBe(agentMemorySubject().id);
    const input = { sessionId: "session", requestId: "request", subject: channel };
    const preview = ledger.task(input, false);
    expect(ledger.binding("session", "request")).toBeUndefined();
    expect(ledger.task(input)).toEqual(preview);
  });

  test("archives old score contracts without dropping history or inventing task weight", () => {
    const snapshot = {
      enabled: true,
      eventCandidates: [
        {
          ...entry,
          uri: "senera://resource/abc123",
          type: "preference",
          occurredAt: completedAt,
          score: 0.437,
          matchedBy: ["memos"],
          quality: { confidence: 33.333, importance: 50, usefulness: 50, recallCount: 8, evidenceCount: 3 },
        },
      ],
      selection: { events: { available: 1, matched: 1, selected: 1 }, usedTokens: 20, maxTokens: 100 },
    };
    expect(AgentMemoryRecallSnapshotSchema.safeParse(snapshot).success).toBe(false);
    const archived = AgentMemoryRecallArchiveSnapshotSchema.parse(snapshot);
    expect(archived.eventCandidates[0]!.summary).toBe(entry.summary);
    expect(archived.eventCandidates[0]!.score).toBe(0.437);
    expect(archived.eventCandidates[0]!.quality).toBeUndefined();
  });
});
