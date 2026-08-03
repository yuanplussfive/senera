import assert from "node:assert/strict";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentPiConversationProjector } from "../Source/AgentSystem/Pi/AgentPiConversationProjector.js";

const conversation = new AgentConversationProjector();
const projection = new AgentPiConversationProjector().project({
  requestId: "current",
  userInput: "Current request",
  conversationEntries: [
    conversation.projectUserInput("previous", "Previous request", "2026-01-01T00:00:00.000Z"),
    conversation.projectAssistantDecision("previous", "Previous answer", "2026-01-01T00:00:01.000Z"),
    conversation.projectUserInput("current", "Current request", "2026-01-01T00:01:00.000Z"),
  ],
  model: {
    id: "test-model",
    name: "test-model",
    api: "openai-completions",
    provider: "senera-pi-proxy",
    baseUrl: "http://127.0.0.1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
});

assert.equal(projection.input, "Current request");
assert.deepEqual(
  projection.history.map((message) => message.role),
  ["user", "assistant"],
);
const historicalUser = projection.history[0];
const historicalUserText =
  historicalUser?.role === "user" && Array.isArray(historicalUser.content) && historicalUser.content[0]?.type === "text"
    ? historicalUser.content[0].text
    : undefined;
assert.ok(historicalUserText?.includes("<historical_user_turn>"));
assert.ok(historicalUserText?.includes("<request_id>previous</request_id>"));
assert.ok(historicalUserText?.includes("<content>Previous request</content>"));
assert.equal(
  projection.history[1]?.role === "assistant" && projection.history[1].content[0]?.type === "text"
    ? projection.history[1].content[0].text
    : undefined,
  "Previous answer",
);

console.log("Pi conversation projection verified.");
