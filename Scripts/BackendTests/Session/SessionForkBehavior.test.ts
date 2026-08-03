import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../../../Source/AgentSystem/Events/AgentEventBase.js";
import { createAgentTurnPreparationSnapshot } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import {
  AgentPiSessionLifecycleStates,
  resolveAgentPiSessionLifecycle,
  withAgentPiSessionLifecycle,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionLifecycleMetadata.js";
import {
  InMemorySessionRepository,
  SqliteSessionRepository,
  type AgentSessionRepository,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionForkPiMutationKinds } from "../../../Source/AgentSystem/Session/AgentSessionForkMutation.js";
import type { AgentSessionArtifactLifecycle } from "../../../Source/AgentSystem/Session/AgentSessionArtifactLifecycle.js";
import { createTemporaryDirectory, removeDirectory, toolRootCommand } from "../Support/AgentTestFixtures.js";
import { createDeferred } from "../Support/AsyncTestFixtures.js";

describe.each(["memory", "sqlite"] as const)("Session fork behavior (%s)", (repositoryKind) => {
  test("creates an independent replayable prefix without carrying Pi branch identity", () => {
    const fixture = createRepositoryFixture(repositoryKind);
    try {
      const store = new AgentSessionStore({ repository: fixture.repository });
      const source = store.open("session-source").session;
      source.metadata = withAgentPiSessionLifecycle(
        source.metadata,
        AgentPiSessionLifecycleStates.Initialized,
        "provider-a",
      );
      store.persistMetadata(source);

      const projector = new AgentConversationProjector();
      store.persistEntries("session-source", [
        projector.projectUserInput("request-a", "Inspect the workspace", timestamp(1)),
        projector.projectAssistantDecision("request-a", "<final_answer>A</final_answer>", timestamp(2)),
        projector.projectUserInput("request-b", "Then change it", timestamp(3)),
        projector.projectAssistantDecision("request-b", "<final_answer>B</final_answer>", timestamp(4)),
      ]);
      store.persistTurnArtifacts(
        "session-source",
        "request-a",
        [],
        [{ step: 1, seq: 0, kind: "answer", status: "done" }],
      );
      store.persistRunSnapshot({
        sessionId: "session-source",
        requestId: "request-a",
        input: "Inspect the workspace",
        status: "completed",
        startedAt: timestamp(1),
        updatedAt: timestamp(2),
        endedAt: timestamp(2),
      });
      const rootCommand = toolRootCommand();
      const preparation = createAgentTurnPreparationSnapshot({
        runtimeFingerprint: "runtime-a",
        userInput: "Inspect the workspace",
        loadedToolNames: [],
        toolAccessGrant: rootCommand.toolAccessGrant,
        rootCommand,
        activeSkills: [],
      });
      store.persistTurnPreparation("session-source", "request-a", {
        ...preparation,
        piBranchBoundaryId: "pi-boundary-source",
      });
      store.persistRunEvent("session-source", runStartedEvent("session-source", "request-a"));

      const fullHistoryLoaders = [
        vi.spyOn(fixture.repository, "loadEntries"),
        vi.spyOn(fixture.repository, "loadStepTraces"),
        vi.spyOn(fixture.repository, "loadRunSnapshots"),
        vi.spyOn(fixture.repository, "loadRunEvents"),
      ];

      const forkPreparation = store.prepareFork({
        sourceSessionId: "session-source",
        sessionId: "session-fork",
        throughRequestId: "request-a",
      });
      expect(forkPreparation.kind).toBe("prepared");
      for (const loader of fullHistoryLoaders) expect(loader).not.toHaveBeenCalled();
      for (const loader of fullHistoryLoaders) loader.mockRestore();
      if (forkPreparation.kind !== "prepared") throw new Error("Expected a prepared session fork.");
      const mutation = {
        mutationId: "fork-mutation-a",
        sourceSessionId: "session-source",
        targetSessionId: "session-fork",
        throughRequestId: "request-a",
        pi: { kind: AgentSessionForkPiMutationKinds.None },
        createdAt: timestamp(5),
      } as const;
      store.stageForkMutation(mutation);
      const result = store.commitForkMutation(mutation, forkPreparation);

      expect(result).toEqual(expect.objectContaining({ kind: "forked", sourceSessionId: "session-source" }));
      expect(store.loadConversation("session-source").map((entry) => entry.requestId)).toEqual([
        "request-a",
        "request-a",
        "request-b",
        "request-b",
      ]);
      const forkConversation = store.loadConversation("session-fork");
      expect(forkConversation.map((entry) => entry.requestId)).toEqual(["request-a", "request-a"]);
      expect(forkConversation.every((entry) => entry.id.startsWith("session-fork:"))).toBe(true);
      expect(store.loadStepTraces("session-fork")).toEqual([
        expect.objectContaining({ requestId: "request-a", traces: [expect.objectContaining({ kind: "answer" })] }),
      ]);
      expect(store.loadRunSnapshots("session-fork")).toEqual([
        expect.objectContaining({ sessionId: "session-fork", requestId: "request-a", status: "completed" }),
      ]);
      expect(store.loadTurnPreparation("session-fork", "request-a")).toEqual({
        ...preparation,
      });
      expect(store.loadRunEvents("session-fork")).toEqual([
        expect.objectContaining({ sessionId: "session-fork", requestId: "request-a" }),
      ]);
      const forkLookup = store.get("session-fork");
      expect(forkLookup.kind).toBe("found");
      if (forkLookup.kind === "found") {
        expect(resolveAgentPiSessionLifecycle(forkLookup.session.metadata)).toEqual({
          initialized: false,
          modelProviderId: "provider-a",
        });
      }
    } finally {
      fixture.close();
    }
  });
});

test("session manager emits the fork identity before replaying authoritative history", async () => {
  const store = new AgentSessionStore();
  store.open("session-source");
  const projector = new AgentConversationProjector();
  store.persistEntries("session-source", [
    projector.projectUserInput("request-a", "Inspect the workspace", timestamp(1)),
    projector.projectAssistantDecision("request-a", "<final_answer>A</final_answer>", timestamp(2)),
  ]);
  const manager = new AgentSessionManager({
    store,
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Forking must not start a model turn.");
      },
    }),
  });
  const events: Array<{ kind: string; data: unknown }> = [];

  await manager.forkSession({
    sourceSessionId: "session-source",
    sessionId: "session-fork",
    throughRequestId: "request-a",
    onEvent: (event) => {
      events.push(event);
    },
  });

  expect(events.slice(0, 3)).toEqual([
    expect.objectContaining({ kind: AgentEventKinds.SessionCreated }),
    expect.objectContaining({
      kind: AgentEventKinds.SessionForked,
      data: expect.objectContaining({
        sessionId: "session-fork",
        sourceSessionId: "session-source",
        throughRequestId: "request-a",
        title: "Inspect the workspace",
      }),
    }),
    expect.objectContaining({ kind: AgentEventKinds.SessionHistoryStarted }),
  ]);
  expect(events.at(-1)).toEqual(expect.objectContaining({ kind: AgentEventKinds.SessionHistoryCompleted }));
});

test("session manager commits a fork only after Pi history branches at the stored turn boundary", async () => {
  const store = new AgentSessionStore();
  prepareInitializedPiForkSource(store);
  const fork = vi.fn(async () => true);
  const reset = vi.fn(async () => true);
  const manager = new AgentSessionManager({
    store,
    piSessionMutations: { reset, rewind: vi.fn(async () => true) },
    piSessionManagement: {
      fork,
      compact: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      export: vi.fn(async () => undefined),
    },
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Forking must not start a model turn.");
      },
    }),
  });

  await manager.forkSession({
    sourceSessionId: "session-source",
    sessionId: "session-target",
    throughRequestId: "request-a",
  });

  expect(fork).toHaveBeenCalledWith({
    sourceSessionId: "session-source",
    sessionId: "session-target",
    modelProviderId: "provider-a",
    entryId: "pi-boundary-a",
  });
  expect(store.loadTurnPreparation("session-target", "request-a")?.piBranchBoundaryId).toBe("pi-boundary-a");
  const target = store.get("session-target");
  expect(target.kind).toBe("found");
  if (target.kind === "found") {
    expect(resolveAgentPiSessionLifecycle(target.session.metadata).initialized).toBe(true);
  }

  fork.mockResolvedValueOnce(false);
  await manager.forkSession({
    sourceSessionId: "session-source",
    sessionId: "session-failed-target",
    throughRequestId: "request-a",
  });
  expect(store.get("session-failed-target")).toEqual({
    kind: "missing",
    sessionId: "session-failed-target",
  });
});

test("failed Pi branching removes the candidate fork from SQLite", async () => {
  const fixture = createRepositoryFixture("sqlite");
  const store = new AgentSessionStore({ repository: fixture.repository });
  prepareInitializedPiForkSource(store);
  const reset = vi.fn(async () => true);
  const manager = new AgentSessionManager({
    store,
    piSessionMutations: { reset, rewind: vi.fn(async () => true) },
    piSessionManagement: {
      fork: vi.fn(async () => false),
      compact: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      export: vi.fn(async () => undefined),
    },
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Forking must not start a model turn.");
      },
    }),
  });

  try {
    await manager.forkSession({
      sourceSessionId: "session-source",
      sessionId: "session-rejected",
      throughRequestId: "request-a",
    });

    expect(store.get("session-rejected")).toEqual({
      kind: "missing",
      sessionId: "session-rejected",
    });
    expect(fixture.repository.loadSession("session-rejected")).toBeUndefined();
  } finally {
    fixture.close();
  }
});

test("keeps source and target admissions closed until a fork is fully published", async () => {
  const store = new AgentSessionStore();
  prepareInitializedPiForkSource(store);
  const forkStarted = createDeferred<void>();
  const allowFork = createDeferred<boolean>();
  const manager = new AgentSessionManager({
    store,
    piSessionMutations: { reset: vi.fn(async () => true), rewind: vi.fn(async () => true) },
    piSessionManagement: {
      fork: vi.fn(async () => {
        forkStarted.resolve();
        return allowFork.promise;
      }),
      compact: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      export: vi.fn(async () => undefined),
    },
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Unexpected model turn.");
      },
    }),
  });

  const forking = manager.forkSession({
    sourceSessionId: "session-source",
    sessionId: "session-target",
    throughRequestId: "request-a",
  });
  await forkStarted.promise;
  let sourceOperationCompleted = false;
  let targetOperationCompleted = false;
  const sourceOperation = manager.renameSession({ sessionId: "session-source", title: "Renamed" }).then(() => {
    sourceOperationCompleted = true;
  });
  const targetOperation = manager.createSession({ sessionId: "session-target" }).then(() => {
    targetOperationCompleted = true;
  });
  await Promise.resolve();

  expect(store.get("session-target")).toEqual({ kind: "missing", sessionId: "session-target" });
  expect(sourceOperationCompleted).toBe(false);
  expect(targetOperationCompleted).toBe(false);

  allowFork.resolve(true);
  await Promise.all([forking, sourceOperation, targetOperation]);
  expect(store.get("session-target").kind).toBe("found");
});

test("rolls back Pi and artifact ownership when fork publication fails", async () => {
  const store = new AgentSessionStore();
  prepareInitializedPiForkSource(store);
  const reset = vi.fn(async () => true);
  const artifacts = artifactLifecycle({
    retainForkArtifacts: vi.fn(async () => {
      throw new Error("artifact owner update failed");
    }),
  });
  const manager = new AgentSessionManager({
    store,
    artifactSessionCleanup: artifacts,
    piSessionMutations: { reset, rewind: vi.fn(async () => true) },
    piSessionManagement: {
      fork: vi.fn(async () => true),
      compact: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      export: vi.fn(async () => undefined),
    },
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Unexpected model turn.");
      },
    }),
  });

  await expect(
    manager.forkSession({
      sourceSessionId: "session-source",
      sessionId: "session-target",
      throughRequestId: "request-a",
    }),
  ).rejects.toThrow("artifact owner update failed");

  expect(reset).toHaveBeenCalledWith({ sessionId: "session-target", modelProviderId: "provider-a" });
  expect(artifacts.removeSessionArtifacts).toHaveBeenCalledWith("session-target");
  expect(store.get("session-target")).toEqual({ kind: "missing", sessionId: "session-target" });
  expect(store.listPendingForkMutations()).toEqual([]);
});

test("recovers an interrupted durable fork before accepting requests", async () => {
  const fixture = createRepositoryFixture("sqlite");
  const store = new AgentSessionStore({ repository: fixture.repository });
  prepareInitializedPiForkSource(store);
  store.stageForkMutation({
    mutationId: "fork-mutation-recovery",
    sourceSessionId: "session-source",
    targetSessionId: "session-interrupted",
    throughRequestId: "request-a",
    pi: {
      kind: AgentSessionForkPiMutationKinds.Fork,
      entryId: "pi-boundary-a",
      modelProviderId: "provider-a",
    },
    createdAt: timestamp(6),
  });
  const reset = vi.fn(async () => true);
  const artifacts = artifactLifecycle();
  const manager = new AgentSessionManager({
    store,
    artifactSessionCleanup: artifacts,
    piSessionMutations: { reset, rewind: vi.fn(async () => true) },
    runControl: { settlementTimeoutMs: 1_000 },
    loopFactory: () => ({
      run: async () => {
        throw new Error("Unexpected model turn.");
      },
    }),
  });

  try {
    await manager.ready();

    expect(reset).toHaveBeenCalledWith({
      sessionId: "session-interrupted",
      modelProviderId: "provider-a",
    });
    expect(artifacts.removeSessionArtifacts).toHaveBeenCalledWith("session-interrupted");
    expect(store.listPendingForkMutations()).toEqual([]);
    expect(fixture.repository.loadSession("session-interrupted")).toBeUndefined();
  } finally {
    fixture.close();
  }
});

function prepareInitializedPiForkSource(store: AgentSessionStore): void {
  const source = store.open("session-source").session;
  source.metadata = withAgentPiSessionLifecycle(
    source.metadata,
    AgentPiSessionLifecycleStates.Initialized,
    "provider-a",
  );
  store.persistMetadata(source);
  const projector = new AgentConversationProjector();
  store.persistEntries("session-source", [
    projector.projectUserInput("request-a", "Inspect the workspace", timestamp(1)),
    projector.projectAssistantDecision("request-a", "<final_answer>A</final_answer>", timestamp(2)),
  ]);
  const rootCommand = toolRootCommand();
  const preparation = createAgentTurnPreparationSnapshot({
    runtimeFingerprint: "runtime-a",
    userInput: "Inspect the workspace",
    loadedToolNames: [],
    toolAccessGrant: rootCommand.toolAccessGrant,
    rootCommand,
    activeSkills: [],
  });
  store.persistTurnPreparation("session-source", "request-a", {
    ...preparation,
    piBranchBoundaryId: "pi-boundary-a",
  });
}

function createRepositoryFixture(kind: "memory" | "sqlite"): {
  repository: AgentSessionRepository;
  close(): void;
} {
  if (kind === "memory") {
    const repository = new InMemorySessionRepository();
    return { repository, close: () => repository.close() };
  }
  const directory = createTemporaryDirectory("senera-session-fork");
  const repository = new SqliteSessionRepository(path.join(directory, "sessions.db"));
  return {
    repository,
    close: () => {
      repository.close();
      removeDirectory(directory);
    },
  };
}

function runStartedEvent(sessionId: string, requestId: string): AgentEventEnvelope {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    sequence: 1,
    timestamp: timestamp(1),
    sessionId,
    requestId,
    data: { input: "Inspect the workspace" },
  };
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 6, 17, 0, 0, offset)).toISOString();
}

function artifactLifecycle(overrides: Partial<AgentSessionArtifactLifecycle> = {}): AgentSessionArtifactLifecycle {
  return {
    retainForkArtifacts: vi.fn(async () => undefined),
    removeSessionArtifacts: vi.fn(async () => undefined),
    removeSessionArtifactsFromRequests: vi.fn(async () => undefined),
    ...overrides,
  };
}
