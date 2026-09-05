import { describe, expect, test, vi } from "vitest";
import {
  AgentMemoryService,
  type AgentMemoryCompletedTurnInput,
} from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import type {
  AgentMemoryRecordedTurn,
  AgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

describe("memory service lifecycle", () => {
  test("does not run a queued prefetch after shutdown begins", async () => {
    const prefetch = vi.fn();
    const service = new AgentMemoryService({
      sourceRepository: new StubSourceRepository(recordedTurn()),
      continuityPrefetch: prefetch,
    });

    service.recordCompletedTurn({} as AgentMemoryCompletedTurnInput);
    await service.close();
    await Promise.resolve();

    expect(prefetch).not.toHaveBeenCalled();
  });

  test("reports prefetch failures without creating an uncaught microtask error", async () => {
    const error = new Error("index unavailable");
    const report = vi.fn();
    const service = new AgentMemoryService({
      sourceRepository: new StubSourceRepository(recordedTurn()),
      continuityPrefetch: () => {
        throw error;
      },
      continuityPrefetchFailure: report,
    });

    service.recordCompletedTurn({} as AgentMemoryCompletedTurnInput);
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith({ sessionId: "session-1", error });
    await service.close();
  });
});

function recordedTurn(): AgentMemoryRecordedTurn {
  return {
    episode: { sessionId: "session-1" } as AgentMemoryRecordedTurn["episode"],
    sources: [],
  };
}

class StubSourceRepository implements AgentMemorySourceRepository {
  constructor(private readonly turn: AgentMemoryRecordedTurn) {}

  catalogRevision(): string {
    return "0";
  }

  recordCompletedTurn(): AgentMemoryRecordedTurn {
    return this.turn;
  }

  deleteSession(): never {
    throw new Error("not used");
  }

  deleteFromSessionRequest(): never {
    throw new Error("not used");
  }

  listEpisodes(): never {
    throw new Error("not used");
  }

  listCompletedEpisodes(): never {
    throw new Error("not used");
  }

  listCompletedEpisodesInRange(): never {
    throw new Error("not used");
  }

  findEpisodesByUris(): never {
    throw new Error("not used");
  }

  listSources(): never {
    throw new Error("not used");
  }

  listSourcesForEpisodes(): never {
    throw new Error("not used");
  }

  findMemorySourcesByRefs(): never {
    throw new Error("not used");
  }

  close(): void {}
}
