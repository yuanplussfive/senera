import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentConversationPolicy } from "../../../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentDefaults } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import type { AgentCompletedRunResult } from "../../../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionHistoryMutationCoordinator } from "../../../Source/AgentSystem/Session/AgentSessionHistoryMutationCoordinator.js";
import { AgentSessionRunCoordinator } from "../../../Source/AgentSystem/Session/AgentSessionRunCoordinator.js";
import { createAgentRequestCancellationResource } from "../../../Source/AgentSystem/Session/AgentSessionRunResource.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";

export function createCoordinatorFixture(options: {
  loop: AgentLoopRunner;
  piSessions?: AgentPiActiveSessionRegistry;
  interactionInput?: AgentInteractionInputRuntime;
  runResources?: ConstructorParameters<typeof AgentSessionRunCoordinator>[0]["runResources"];
}) {
  const sessionRepository = new InMemorySessionRepository();
  const store = new AgentSessionStore({ repository: sessionRepository });
  const session = store.open("session-test").session;
  const memoryRepository = new InMemoryAgentMemorySourceRepository();
  const memory = new AgentMemoryService({ sourceRepository: memoryRepository });
  const historyMutations = new AgentSessionHistoryMutationCoordinator({ store, memory });
  const coordinator = new AgentSessionRunCoordinator({
    store,
    conversationProjector: new AgentConversationProjector(),
    conversationPolicy: new AgentConversationPolicy(),
    memory,
    historyMutations,
    piSessions: options.piSessions,
    runResources: [
      ...(options.runResources ?? []),
      ...(options.interactionInput
        ? [createAgentRequestCancellationResource("interaction_input", options.interactionInput)]
        : []),
    ],
    runControl: {
      settlementTimeoutMs: AgentDefaults.AgentLoop.RunSettlementTimeoutMs,
    },
    loopFactory: () => options.loop,
  });
  return { coordinator, memoryRepository, session, sessionRepository, store };
}

export function requestInteractionInput(runtime: AgentInteractionInputRuntime, requestId: string): Promise<unknown> {
  return runtime.request({
    owner: {
      sessionId: "session-test",
      requestId,
      step: 1,
      toolCallId: "tool-call-interaction",
      toolName: "InteractiveTool",
    },
    mode: "form",
    message: "Choose a value",
    schema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  });
}

export function completedRun(_requestId: string): AgentCompletedRunResult {
  return {
    terminal: { kind: "FinalAnswer", content: "Inspection complete." },
    decisionXml: "<agent_result><final_answer>Inspection complete.</final_answer></agent_result>",
    modelProvider: {
      id: "test-model",
      kind: "OpenAICompatible",
      endpoint: "ChatCompletions",
      baseUrl: "https://model.example/v1",
      model: "test-model",
    },
    usage: { source: "local_estimate", inputTokens: 10, outputTokens: 4 },
    conversationEntries: [],
    executedTools: [],
    stepTraces: [{ step: 1, seq: 0, kind: "answer", status: "done" }],
  };
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
        return new Promise<AgentCompletedRunResult>((_resolve, reject) => {
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

export class RecordingPiQueueSession {
  readonly steered: string[] = [];
  readonly followUps: string[] = [];

  async steer(input: string): Promise<void> {
    this.steered.push(input);
  }

  async followUp(input: string): Promise<void> {
    this.followUps.push(input);
  }
}
