import assert from "node:assert/strict";
import { type AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import type {
  AgentPiSessionBootstrapPort,
  AgentPiSessionBootstrapRequest,
} from "../Source/AgentSystem/Pi/AgentPiSessionBootstrapService.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";

const sessionId = "verify-pi-session-manager-bootstrap";

class RecordingPiSessionBootstrap implements AgentPiSessionBootstrapPort {
  readonly requests: AgentPiSessionBootstrapRequest[] = [];

  async bootstrap(request: AgentPiSessionBootstrapRequest): Promise<void> {
    this.requests.push({ ...request });
  }
}

const store = new AgentSessionStore();
const events: AgentDomainEvent[] = [];
const bootstrap = new RecordingPiSessionBootstrap();
const manager = new AgentSessionManager({
  store,
  piSessionBootstrap: bootstrap,
  loopFactory: () => ({}) as AgentLoop,
});

await manager.createSession({
  sessionId,
  modelProviderId: "verification-model-a",
  onEvent: (event) => {
    events.push(event);
  },
});

await manager.createSession({
  sessionId,
  modelProviderId: "verification-model-b",
  onEvent: (event) => {
    events.push(event);
  },
});

assert.deepEqual(
  bootstrap.requests.map(({ sessionId: id, modelProviderId }) => ({ sessionId: id, modelProviderId })),
  [
    { sessionId, modelProviderId: "verification-model-a" },
    { sessionId, modelProviderId: "verification-model-b" },
  ],
);
assert.deepEqual(
  events.map((event) => event.kind),
  [AgentEventKinds.SessionCreated, AgentEventKinds.SessionSnapshot],
);
assert.equal(store.loadConversation(sessionId).length, 0);

console.log("Pi session manager bootstrap verification passed.");
