import assert from "node:assert/strict";
import type { AgentState } from "@earendil-works/pi-agent-core";
import { type AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentConversationEntryKinds } from "../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  AgentEventKinds,
  AgentEventSequencer,
  toEventEnvelope,
  type AgentDomainEvent,
} from "../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentSessionStatuses } from "../Source/AgentSystem/Session/AgentSession.js";
import { AgentSessionMessageQueueModes } from "../Source/AgentSystem/Session/AgentSessionMessageQueueMode.js";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentRunRequest } from "../Source/AgentSystem/Loop/AgentLoop.js";
import type { AgentCompletedRunResult } from "../Source/AgentSystem/Runtime/AgentExecutionProjector.js";

const sessionId = "verify-pi-runtime-queue-session";
const requestId = "verify-pi-runtime-queue-run";
const steeringRequestId = "verify-pi-runtime-queue-steer";

async function main(): Promise<void> {
  const piSessions = new AgentPiActiveSessionRegistry();
  const store = new AgentSessionStore();
  const fakeLoop = new QueueAwareFakeLoop(piSessions);
  const sequencer = new AgentEventSequencer();
  const events: AgentDomainEvent[] = [];
  const collectEvent = (event: AgentDomainEvent): void => {
    events.push(event);
    const envelope = toEventEnvelope(event, sequencer.next());
    if (envelope.sessionId && envelope.requestId) {
      store.persistRunEvent(envelope.sessionId, envelope);
    }
  };
  const manager = new AgentSessionManager({
    store,
    piSessions,
    runControl: {
      settlementTimeoutMs: AgentDefaults.AgentLoop.RunSettlementTimeoutMs,
    },
    loopFactory: () => fakeLoop as unknown as AgentLoop,
  });

  await manager.createSession({
    sessionId,
    onEvent: collectEvent,
  });
  const runPromise = manager.submitMessage({
    sessionId,
    requestId,
    input: "整理当前实现状态",
    onEvent: collectEvent,
  });

  await fakeLoop.started;
  await manager.submitMessage({
    sessionId,
    requestId: steeringRequestId,
    input: "补充说明 Pi 是否真正接管运行中消息",
    queueMode: AgentSessionMessageQueueModes.Steer,
    onEvent: collectEvent,
  });
  fakeLoop.complete();
  await runPromise;

  const lookup = store.get(sessionId);
  assert.equal(lookup.kind, "found");
  assert.equal(lookup.kind === "found" ? lookup.session.status : undefined, AgentSessionStatuses.Idle);
  assert.deepEqual(fakeLoop.session.steers, ["补充说明 Pi 是否真正接管运行中消息"]);
  assert.equal(piSessions.get(sessionId), undefined);
  assert.equal(
    events.some((event) => event.kind === AgentEventKinds.SessionBusy),
    false,
  );
  assert.equal(hasPiTrace(events, "runtime_queue.steer.accepted"), true);
  assert.equal(
    store.loadConversation(sessionId).filter((entry) => entry.kind === AgentConversationEntryKinds.UserMessage).length,
    2,
  );

  console.log("Pi runtime queue steering verification passed.");
}

function hasPiTrace(events: readonly AgentDomainEvent[], eventType: string): boolean {
  return events.some(
    (event) => event.kind === AgentEventKinds.PiTrace && readRecord(event.data)?.eventType === eventType,
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const VerificationPiModel = {
  id: "verification-model",
  name: "verification-model",
  api: "openai-completions" as const,
  provider: "senera-pi-proxy",
  baseUrl: "http://127.0.0.1:8787/v1",
  reasoning: false,
  input: ["text" as const],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

class QueueAwareFakeLoop {
  readonly session = new QueueAwareFakePiSession();
  private readonly startedPromise: Promise<void>;
  private resolveStarted!: () => void;
  private readonly finishPromise: Promise<void>;
  private resolveFinish!: () => void;

  constructor(private readonly registry: AgentPiActiveSessionRegistry) {
    this.startedPromise = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.finishPromise = new Promise((resolve) => {
      this.resolveFinish = resolve;
    });
  }

  get started(): Promise<void> {
    return this.startedPromise;
  }

  complete(): void {
    this.resolveFinish();
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    assert.equal(request.sessionId, sessionId);
    const unregister = this.registry.register({
      sessionId,
      requestId: request.requestId,
      step: 1,
      session: this.session,
    });
    this.resolveStarted();
    try {
      await this.finishPromise;
      return {
        terminal: {
          kind: "FinalAnswer",
          content: "已整理。",
        },
        decisionXml: "已整理。",
        conversationEntries: [],
        stepTraces: [],
      };
    } finally {
      unregister();
    }
  }
}

class QueueAwareFakePiSession implements AgentPiSession {
  readonly state = {
    systemPrompt: "",
    model: VerificationPiModel,
    thinkingLevel: "off" as const,
    tools: [],
    messages: [],
    isStreaming: false,
    pendingToolCalls: new Set<string>(),
  } satisfies AgentState;
  readonly model = VerificationPiModel;
  readonly steers: string[] = [];
  readonly followUps: string[] = [];

  setHistory(): void {}

  async prompt(): Promise<void> {}

  async steer(text: string): Promise<void> {
    this.steers.push(text);
  }

  async followUp(text: string): Promise<void> {
    this.followUps.push(text);
  }

  async nextTurn(): Promise<void> {}

  async markTurnBoundary(requestId: string): Promise<string> {
    return `boundary:${requestId}`;
  }

  async setResources(): Promise<void> {}

  subscribe(): () => void {
    return () => undefined;
  }

  async abort(): Promise<void> {}

  dispose(): void {}

  getLastAssistantText(): string | undefined {
    return undefined;
  }

  getActiveToolNames(): string[] {
    return [];
  }
}

await main();
