import { describe, expect, test } from "vitest";
import {
  AgentMemoryLearningJobStatuses,
  AgentMemoryLearningJobStatusValues,
  failedAgentMemoryLearningJobStatus,
  isRunnableAgentMemoryLearningJobStatus,
  memoryLearningJobFromStorageRow,
} from "../../../Source/AgentSystem/Memory/AgentMemoryLearningJob.js";

describe("memory learning job status codec", () => {
  test("keeps the public status catalog and runnable states centralized", () => {
    expect(AgentMemoryLearningJobStatusValues).toEqual(["pending", "running", "retry", "completed", "failed"]);
    expect(isRunnableAgentMemoryLearningJobStatus(AgentMemoryLearningJobStatuses.Pending)).toBe(true);
    expect(isRunnableAgentMemoryLearningJobStatus(AgentMemoryLearningJobStatuses.Retry)).toBe(true);
    expect(isRunnableAgentMemoryLearningJobStatus(AgentMemoryLearningJobStatuses.Running)).toBe(false);
  });

  test("maps storage rows without leaking database field names", () => {
    expect(
      memoryLearningJobFromStorageRow({
        episode_uri: "memory://episode/1",
        status: "running",
        attempts: 2,
        next_attempt_at_ms: 1_000,
        last_error: "",
        updated_at_ms: 900,
      }),
    ).toEqual({
      episodeUri: "memory://episode/1",
      status: AgentMemoryLearningJobStatuses.Running,
      attempts: 2,
      nextAttemptAtMs: 1_000,
      lastError: "",
      updatedAtMs: 900,
    });
  });

  test("rejects corrupt storage states and selects retry terminal states", () => {
    expect(() =>
      memoryLearningJobFromStorageRow({
        episode_uri: "memory://episode/1",
        status: "unknown",
        attempts: 1,
        next_attempt_at_ms: 0,
        last_error: "",
        updated_at_ms: 0,
      }),
    ).toThrow(/Unknown memory learning job status/);
    expect(failedAgentMemoryLearningJobStatus(false)).toBe(AgentMemoryLearningJobStatuses.Retry);
    expect(failedAgentMemoryLearningJobStatus(true)).toBe(AgentMemoryLearningJobStatuses.Failed);
  });
});
