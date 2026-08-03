import { describe, expect, test, vi } from "vitest";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import {
  AgentPiSessionLifecycleStates,
  withAgentPiSessionLifecycle,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentPiSessionRuntimeStatus } from "../../../Source/AgentSystem/Pi/AgentPiSessionManagement.js";
import { collect, createManagerFixture } from "./SessionManagerTestFixtures.js";

describe("Pi session management behavior", () => {
  test("projects compact, status, and export results from the initialized Pi session", async () => {
    const runtimeStatus = createRuntimeStatus("session-a");
    const compact = vi.fn(async () => ({
      summary: "Earlier context was compacted.",
      tokensBefore: 8_000,
      estimatedTokensAfter: 2_000,
    }));
    const status = vi.fn(async () => runtimeStatus);
    const exportSession = vi.fn(async () => ({
      sessionId: "session-a",
      format: "html" as const,
      path: ".senera/exports/sessions/export.html",
    }));
    const { manager, repository, store } = createManagerFixture({
      piSessionManagement: {
        fork: vi.fn(async () => true),
        compact,
        status,
        export: exportSession,
      },
    });
    const session = store.open("session-a").session;
    session.metadata = withAgentPiSessionLifecycle(
      session.metadata,
      AgentPiSessionLifecycleStates.Initialized,
      "provider-a",
    );
    store.persistMetadata(session);
    const events: AgentDomainEvent[] = [];

    try {
      await manager.compactSession({
        sessionId: session.id,
        customInstructions: "Preserve decisions.",
        onEvent: collect(events),
      });
      await manager.emitPiSessionRuntimeStatus({ sessionId: session.id, onEvent: collect(events) });
      await manager.exportPiSession({ sessionId: session.id, format: "html", onEvent: collect(events) });

      expect(compact).toHaveBeenCalledWith({
        sessionId: session.id,
        modelProviderId: "provider-a",
        customInstructions: "Preserve decisions.",
      });
      expect(status).toHaveBeenCalledWith({ sessionId: session.id, modelProviderId: "provider-a" });
      expect(exportSession).toHaveBeenCalledWith({
        sessionId: session.id,
        modelProviderId: "provider-a",
        format: "html",
      });
      expect(events).toEqual([
        expect.objectContaining({
          kind: AgentEventKinds.SessionCompacted,
          data: {
            sessionId: session.id,
            tokensBefore: 8_000,
            estimatedTokensAfter: 2_000,
          },
        }),
        expect.objectContaining({
          kind: AgentEventKinds.SessionRuntimeStatus,
          data: { sessionId: session.id, available: true, runtime: runtimeStatus },
        }),
        expect.objectContaining({
          kind: AgentEventKinds.SessionExported,
          data: {
            sessionId: session.id,
            format: "html",
            path: ".senera/exports/sessions/export.html",
          },
        }),
      ]);
    } finally {
      repository.close();
    }
  });

  test("reports unavailable Pi history without invoking management services", async () => {
    const service = {
      fork: vi.fn(async () => true),
      compact: vi.fn(async () => undefined),
      status: vi.fn(async () => undefined),
      export: vi.fn(async () => undefined),
    };
    const { manager, repository, store } = createManagerFixture({ piSessionManagement: service });
    const session = store.open("session-without-pi-history").session;
    const events: AgentDomainEvent[] = [];

    try {
      await manager.compactSession({ sessionId: session.id, onEvent: collect(events) });
      await manager.emitPiSessionRuntimeStatus({ sessionId: session.id, onEvent: collect(events) });
      await manager.exportPiSession({ sessionId: session.id, format: "jsonl", onEvent: collect(events) });

      expect(service.compact).not.toHaveBeenCalled();
      expect(service.status).not.toHaveBeenCalled();
      expect(service.export).not.toHaveBeenCalled();
      expect(events.map((event) => event.kind)).toEqual([
        AgentEventKinds.RequestInvalid,
        AgentEventKinds.SessionRuntimeStatus,
        AgentEventKinds.RequestInvalid,
      ]);
      expect(events[1]).toEqual(
        expect.objectContaining({
          data: { sessionId: session.id, available: false, runtime: undefined },
        }),
      );
    } finally {
      repository.close();
    }
  });
});

function createRuntimeStatus(sessionId: string): AgentPiSessionRuntimeStatus {
  return {
    sessionId,
    cached: true,
    stats: {
      userMessages: 2,
      assistantMessages: 2,
      toolCalls: 1,
      toolResults: 1,
      totalMessages: 6,
      tokens: {
        input: 1_000,
        output: 200,
        cacheRead: 100,
        cacheWrite: 50,
        total: 1_350,
      },
      cost: 0,
    },
    contextUsage: {
      tokens: 1_350,
      contextWindow: 128_000,
      percent: 1.0546875,
    },
  };
}
