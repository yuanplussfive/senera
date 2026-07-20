import assert from "node:assert/strict";
import { type AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import type {
  AgentPiSessionMutationPort,
  AgentPiSessionMutationRequest,
} from "../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";

const sessionId = "verify-pi-session-lazy-lifecycle";

class RecordingPiSessionMutations implements AgentPiSessionMutationPort {
  readonly rewinds: Array<AgentPiSessionMutationRequest & { entryId: string }> = [];
  readonly resets: AgentPiSessionMutationRequest[] = [];

  async rewind(request: AgentPiSessionMutationRequest & { entryId: string }): Promise<boolean> {
    this.rewinds.push({ ...request });
    return true;
  }

  async reset(request: AgentPiSessionMutationRequest): Promise<boolean> {
    this.resets.push({ ...request });
    return true;
  }
}

const store = new AgentSessionStore();
const events: AgentDomainEvent[] = [];
const mutations = new RecordingPiSessionMutations();
const manager = new AgentSessionManager({
  store,
  piSessionMutations: mutations,
  runControl: {
    settlementTimeoutMs: AgentDefaults.AgentLoop.RunSettlementTimeoutMs,
  },
  loopFactory: () => ({}) as AgentLoop,
});

await manager.createSession({
  sessionId,
  onEvent: (event) => {
    events.push(event);
  },
});

await manager.createSession({
  sessionId,
  onEvent: (event) => {
    events.push(event);
  },
});

assert.deepEqual(mutations.rewinds, []);
assert.deepEqual(mutations.resets, []);
assert.deepEqual(
  events.map((event) => event.kind),
  [AgentEventKinds.SessionCreated, AgentEventKinds.SessionSnapshot],
);
assert.equal(store.loadConversation(sessionId).length, 0);

console.log("Pi session lazy lifecycle verification passed.");
