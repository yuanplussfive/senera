import path from "node:path";
import { describe, expect, test } from "vitest";
import { InteractionRunMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { createAgentTurnPreparationSnapshot } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Turn preparation persistence", () => {
  test("round-trips snapshots and deletes them from the conversation boundary", () => {
    const directory = createTemporaryDirectory("senera-turn-preparation");
    const repository = new SqliteSessionRepository(path.join(directory, "session.db"));
    try {
      const store = new AgentSessionStore({ repository });
      store.open("session-a");
      store.persistEntries("session-a", [userEntry("request-a"), userEntry("request-b")]);
      store.persistTurnPreparation("session-a", "request-a", snapshot("A"));
      store.persistTurnPreparation("session-a", "request-b", snapshot("B"));

      expect(store.loadTurnPreparation("session-a", "request-b")).toMatchObject({
        runtimeFingerprint: "runtime-a",
        route: { objective: "B" },
      });

      store.truncateFromRequest("session-a", "request-b");

      expect(store.loadTurnPreparation("session-a", "request-a")).toBeDefined();
      expect(store.loadTurnPreparation("session-a", "request-b")).toBeUndefined();
    } finally {
      repository.close();
      removeDirectory(directory);
    }
  });
});

function snapshot(input: string) {
  return createAgentTurnPreparationSnapshot({
    runtimeFingerprint: "runtime-a",
    userInput: input,
    route: {
      mode: "direct_response",
      objective: input,
      preferredTools: [],
      discoveryQueries: [],
      raw: {
        mode: InteractionRunMode.DirectResponse,
        objective: input,
        preferredTools: [],
        discoveryQueries: [],
      },
    },
    loadedToolNames: [],
    initialAction: { kind: "FinalAnswer", answerPlan: ["Answer the request."] },
    activeSkills: [],
  });
}

function userEntry(requestId: string) {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "user.message" as const,
    content: requestId,
  };
}
