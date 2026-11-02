import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import type { AgentSessionQueuedInput } from "../../../Source/AgentSystem/Session/AgentSessionQueuedInput.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { collect, completedRun, createManagerFixture, userEntry } from "./SessionManagerTestFixtures.js";

const roots: string[] = [];
const repositories: SqliteSessionRepository[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const root of roots.splice(0)) removeDirectory(root);
});

function openRepository(file?: string) {
  if (!file) {
    const root = createTemporaryDirectory("senera-queued-recovery");
    roots.push(root);
    file = path.join(root, "sessions.db");
  }
  const repository = new SqliteSessionRepository(file);
  repositories.push(repository);
  return { repository, file };
}

function queuedInput(parentRequestId = "old-run"): AgentSessionQueuedInput {
  const request = {
    sessionId: "recovered-session",
    requestId: "supplement",
    input: "Use the attached file",
    approvalMode: "agent",
    queueMode: "steer",
    attachments: [
      { resourceUri: "senera://resource/a1b2c3", name: "notes.txt", mime: "text/plain", size: 12, status: "uploaded" },
    ],
  } as const;
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    parentRequestId,
    payloadHash: "saved-payload",
    state: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    request: { ...request, attachments: [...request.attachments] },
    entry: { ...userEntry(request.requestId, request.input), attachments: [...request.attachments] },
    wireInput: "unconsumed native supplement",
  };
}

test("reopens SQLite and runs an unconsumed supplement once with its original attachment and history", async () => {
  const initial = openRepository();
  const fixture = createManagerFixture({ repository: initial.repository });
  const input = queuedInput();
  await fixture.manager.createSession({ sessionId: input.sessionId });
  fixture.store.saveQueuedInput(input);
  await fixture.manager.shutdown();
  initial.repository.close();
  repositories.splice(repositories.indexOf(initial.repository), 1);

  const { repository } = openRepository(initial.file);
  const piSessions = new AgentPiActiveSessionRegistry();
  const run = vi.fn<AgentLoopRunner["run"]>(async (request) => {
    if (!request.sessionId || !request.requestId)
      throw new Error("Queued recovery must preserve the session and request identity.");
    const release = piSessions.register({
      sessionId: request.sessionId,
      requestId: request.requestId,
      step: 1,
      session: {} as AgentPiSession,
    });
    try {
      if (!request.inputBoundary) throw new Error("Queued recovery must install its input boundary.");
      await request.inputBoundary({ phase: "observe", committedInputs: new Set() });
      return completedRun(request.requestId);
    } finally {
      release();
    }
  });
  const recovered = createManagerFixture({
    repository,
    piSessions,
    readCommittedInputs: async () => new Set(),
    loopFactory: () => ({ run }),
  });
  const events: AgentDomainEvent[] = [];
  recovered.manager.setQueuedInputSink(() => collect(events));
  await vi.waitFor(() => expect(repository.loadQueuedInput(input.sessionId, input.requestId)?.state).toBe("completed"));
  await recovered.manager.resumeQueuedMessages();
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toMatchObject({ input: input.request.input, attachments: input.request.attachments });
  expect(repository.loadEntries(input.sessionId).filter((entry) => entry.kind === "user.message")).toEqual([
    expect.objectContaining({ requestId: input.requestId, attachments: input.request.attachments }),
  ]);
  expect(repository.loadEntries(input.sessionId)[0]?.metadata?.queue).toBeUndefined();
  await recovered.manager.shutdown();
});

test.each(["pending", "delivered"] as const)(
  "reconciles a %s input from native receipts without rerunning tools",
  async (state) => {
    const { repository } = openRepository();
    const run = vi.fn(async () => completedRun("unexpected"));
    const input = { ...queuedInput(), state };
    const fixture = createManagerFixture({
      repository,
      readCommittedInputs: async () => new Set([input.wireInput!]),
      loopFactory: () => ({ run }),
    });
    await fixture.manager.createSession({ sessionId: input.sessionId });
    fixture.store.saveQueuedInput(input);
    fixture.store.persistRunSnapshot({
      sessionId: input.sessionId,
      requestId: input.parentRequestId,
      input: "previous task",
      status: "completed",
      startedAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
    fixture.manager.setQueuedInputSink(() => () => undefined);
    await vi.waitFor(() =>
      expect(repository.loadQueuedInput(input.sessionId, input.requestId)?.state).toBe("completed"),
    );
    expect(run).not.toHaveBeenCalled();
    await fixture.manager.shutdown();
  },
);

test("does not replay a recovery turn that already started before its input receipt was saved", async () => {
  const { repository } = openRepository();
  const run = vi.fn(async () => completedRun("supplement"));
  const input = queuedInput("supplement");
  const fixture = createManagerFixture({ repository, loopFactory: () => ({ run }) });
  await fixture.manager.createSession({ sessionId: input.sessionId });
  fixture.store.saveQueuedInput(input);
  await fixture.manager.submitMessage({ ...input.request, queueMode: undefined });
  await fixture.manager.shutdown();
  expect(run).toHaveBeenCalledTimes(1);

  const recovered = createManagerFixture({
    repository,
    readCommittedInputs: async () => new Set(),
    loopFactory: () => ({ run }),
  });
  recovered.manager.setQueuedInputSink(() => () => undefined);
  await vi.waitFor(() => expect(repository.loadQueuedInput(input.sessionId, input.requestId)?.state).toBe("failed"));
  expect(run).toHaveBeenCalledTimes(1);
  expect(repository.loadQueuedInput(input.sessionId, input.requestId)?.errorMessage).toContain(
    "before model input was committed",
  );
  await recovered.manager.shutdown();
});
