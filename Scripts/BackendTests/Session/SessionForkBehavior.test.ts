import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { InteractionRunMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
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
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

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
      store.persistTurnArtifacts("session-source", "request-a", [], [
        { step: 1, seq: 0, kind: "answer", status: "done" },
      ]);
      store.persistRunSnapshot({
        sessionId: "session-source",
        requestId: "request-a",
        input: "Inspect the workspace",
        status: "completed",
        startedAt: timestamp(1),
        updatedAt: timestamp(2),
        endedAt: timestamp(2),
      });
      const preparation = createAgentTurnPreparationSnapshot({
        runtimeFingerprint: "runtime-a",
        userInput: "Inspect the workspace",
        route: {
          mode: "direct_response",
          objective: "Inspect the workspace",
          preferredTools: [],
          discoveryQueries: [],
          raw: {
            mode: InteractionRunMode.DirectResponse,
            objective: "Inspect the workspace",
            preferredTools: [],
            discoveryQueries: [],
          },
        },
        loadedToolNames: [],
        initialAction: { kind: "FinalAnswer", answerPlan: ["Answer the request."] },
        activeSkills: [],
      });
      store.persistTurnPreparation("session-source", "request-a", {
        ...preparation,
        piBranchBoundaryId: "pi-boundary-source",
      });
      store.persistRunEvent("session-source", runStartedEvent("session-source", "request-a"));

      const result = store.fork({
        sourceSessionId: "session-source",
        sessionId: "session-fork",
        throughRequestId: "request-a",
      });

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
