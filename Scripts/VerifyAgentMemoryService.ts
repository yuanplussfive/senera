import assert from "node:assert/strict";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import { AgentMemoryService } from "../Source/AgentSystem/AgentMemoryService.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryRecordedTurn,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const repository = new InMemoryAgentMemorySourceRepository();
const projector = new AgentConversationProjector();
const sessionId = "session_memory_service";
const requestId = "req_memory_service_1";
const startedAt = "2026-06-25T00:00:00.000Z";
const completedAt = "2026-06-25T00:00:02.000Z";
const userEntry = projector.projectUserInput(
  requestId,
  "记住我喜欢从源头解决问题",
  startedAt,
);
const assistantEntry = projector.projectAssistantDecision(
  requestId,
  "<final>已记录这个偏好。</final>",
  completedAt,
);

let learnedTurn: AgentMemoryRecordedTurn | undefined;
const service = new AgentMemoryService({
  sourceRepository: repository,
  learning: {
    enqueue: (recordedTurn) => {
      learnedTurn = recordedTurn;
    },
  },
});

const recordedTurn = service.recordCompletedTurn({
  sessionId,
  requestId,
  startedAt,
  completedAt,
  userEntry,
  assistantEntry,
  terminal: {
    kind: "FinalAnswer",
    content: "已记录这个偏好。",
  },
  conversationEntries: [assistantEntry],
});

assert.equal(learnedTurn, recordedTurn);
assert.equal(repository.listEpisodes(sessionId).length, 1);
assert.equal(repository.listSources(recordedTurn.episode.uri).length, 2);

service.deleteFromSessionRequest(sessionId, requestId);
assert.equal(repository.listEpisodes(sessionId).length, 0);

console.log("Agent memory service verification passed.");
