import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentDomainEvent,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { InteractionRunMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { createAgentTurnPreparationSnapshot } from "../../../Source/AgentSystem/Loop/AgentTurnPreparationSnapshot.js";
import { AgentDefaults } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import {
  InMemorySessionRepository,
  type SqliteSessionRepository,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";

export function createManagerFixture(
  options: Partial<ConstructorParameters<typeof AgentSessionManager>[0]> & {
    repository?: InMemorySessionRepository | SqliteSessionRepository;
  } = {},
) {
  const repository = options.repository ?? new InMemorySessionRepository();
  const store = new AgentSessionStore({ repository });
  store.hydrate();
  const { repository: _repository, ...managerOptions } = options;
  const manager = new AgentSessionManager({
    loopFactory: () => ({ run: async () => completedRun("generated-request") }),
    store,
    piSessionMutations: {
      rewind: async () => false,
      reset: async () => false,
    },
    runControl: {
      settlementTimeoutMs: AgentDefaults.AgentLoop.RunSettlementTimeoutMs,
    },
    ...managerOptions,
  });
  return { manager, repository, store };
}

export function collect(events: AgentDomainEvent[]) {
  return (event: AgentDomainEvent) => {
    events.push(event);
  };
}

export function userEntry(requestId: string, content: string) {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "user.message" as const,
    content,
  };
}

export function assistantEntry(requestId: string, xml: string) {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "assistant.decision" as const,
    xml,
  };
}

export function runEvent(sessionId: string, requestId: string, sequence: number) {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    context: { sessionId, requestId },
    sessionId,
    requestId,
    sequence,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: { input: requestId },
  } as const;
}

export function completedRun(requestId: string) {
  return {
    terminal: { kind: "FinalAnswer" as const, content: "done" },
    decisionXml: "<agent_result><final_answer>done</final_answer></agent_result>",
    usage: { source: "local_estimate" as const, inputTokens: 1, outputTokens: 1 },
    conversationEntries: [assistantEntry(requestId, "done")],
    stepTraces: [],
  };
}

export function turnPreparation(input: string) {
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

export function createPendingLoop(): { loop: AgentLoopRunner; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    started,
    loop: {
      run: async (request) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          const rejectCancellation = () =>
            reject(request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError());
          if (request.signal?.aborted) {
            rejectCancellation();
            return;
          }
          request.signal?.addEventListener("abort", rejectCancellation, { once: true });
        });
      },
    },
  };
}
