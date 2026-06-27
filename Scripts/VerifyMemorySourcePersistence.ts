import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import { TurnContextMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const workspaceRoot = process.cwd();
const databasePath = resolveAgentMemoryDatabasePath(
  workspaceRoot,
  ".senera/test-memory-sources/Memory.sqlite",
);
const databaseDir = path.dirname(databasePath);

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

const repository = new SqliteAgentMemorySourceRepository(databasePath);
const projector = new AgentConversationProjector();
const sessionId = "session_memory_sources";
const requestId = "req_memory_1";
const startedAt = "2026-06-24T00:00:00.000Z";
const completedAt = "2026-06-24T00:00:02.000Z";
const userEntry = projector.projectUserInput(
  requestId,
  "这个也不要硬编码啊",
  startedAt,
);
const assistantEntry = projector.projectAssistantDecision(
  requestId,
  "<final>已从源头处理。</final>",
  completedAt,
);
const evidenceEntry = projector.projectToolEvidenceMemory(
  requestId,
  {
    requestId,
    step: 1,
    toolName: "FastContextScoutTool",
    artifactId: "art_memory_source",
    artifactUri: "senera://artifact/art_memory_source",
    artifactPath: ".senera/artifacts/runs/req_memory_1/step_001",
    evidence: [{
      evidenceUri: "senera://evidence/ev_memorysource0000000001",
      kind: "workspace_scout_file",
      locator: "Source/AgentSystem/AgentSessionManager.ts:1-80",
      display: "workspace context: AgentSessionManager",
      label: "AgentSessionManager.ts",
      toolName: "FastContextScoutTool",
      artifactUri: "senera://artifact/art_memory_source",
      facts: [
        { name: "path", value: "Source/AgentSystem/AgentSessionManager.ts" },
      ],
      artifactRefs: ["projection"],
    }],
    createdAt: completedAt,
  },
  completedAt,
  undefined,
  1,
);

repository.recordCompletedTurn({
  sessionId,
  requestId,
  startedAt,
  completedAt,
  userEntry,
  assistantEntry,
  terminal: {
    kind: "FinalAnswer",
    content: "已从源头处理。",
  },
  turnUnderstanding: {
    rawUserTurn: userEntry.content,
    standaloneRequest: "用户要求当前实现避免硬编码，从源头处理。",
    contextMode: TurnContextMode.Used,
    contextBasis: "当前正在实现 memory_sources 持久化。",
    missingContext: "",
  },
  conversationEntries: [evidenceEntry, assistantEntry],
});

let episodes = repository.listEpisodes(sessionId);
assert.equal(episodes.length, 1);
assert.equal(episodes[0]?.standaloneRequest, "用户要求当前实现避免硬编码，从源头处理。");
assert.equal(episodes[0]?.timeZone, "Asia/Shanghai");
assert.equal(episodes[0]?.localDate, "2026-06-24");
assert.equal(episodes[0]?.localHour, "2026-06-24T08");
assert.equal(episodes[0]?.startedAtMs, Date.parse(startedAt));
let sources = repository.listSources(episodes[0]?.uri ?? "");
assert.deepEqual(
  sources.map((source) => source.sourceKind).sort(),
  ["artifact", "assistant_final", "tool_evidence", "user_message"],
);
assert.equal(sources.some((source) => source.evidenceUri === "senera://evidence/ev_memorysource0000000001"), true);
const toolEvidenceSource = sources.find((source) => source.sourceKind === "tool_evidence");
assert.ok(toolEvidenceSource);
assert.equal(toolEvidenceSource.textContent, null);
assert.equal(toolEvidenceSource.summary, "workspace context: AgentSessionManager");
assert.equal(toolEvidenceSource.artifactUri, "senera://artifact/art_memory_source");
assert.deepEqual(toolEvidenceSource.metadata.evidence, {
  evidenceUri: "senera://evidence/ev_memorysource0000000001",
  kind: "workspace_scout_file",
  locator: "Source/AgentSystem/AgentSessionManager.ts:1-80",
  display: "workspace context: AgentSessionManager",
  label: "AgentSessionManager.ts",
  toolName: "FastContextScoutTool",
  artifactUri: "senera://artifact/art_memory_source",
  facts: [
    { name: "path", value: "Source/AgentSystem/AgentSessionManager.ts" },
  ],
  artifactRefs: ["projection"],
});
assert.equal(toolEvidenceSource.timeZone, "Asia/Shanghai");
assert.equal(toolEvidenceSource.localDate, "2026-06-24");
assert.equal(toolEvidenceSource.localHour, "2026-06-24T08");

repository.recordCompletedTurn({
  sessionId,
  requestId,
  startedAt,
  completedAt: "2026-06-24T00:00:03.000Z",
  userEntry,
  assistantEntry,
  terminal: {
    kind: "FinalAnswer",
    content: "已替换为新的最终回复。",
  },
  conversationEntries: [assistantEntry],
});

episodes = repository.listEpisodes(sessionId);
assert.equal(episodes.length, 1);
sources = repository.listSources(episodes[0]?.uri ?? "");
assert.deepEqual(
  sources.map((source) => source.sourceKind).sort(),
  ["assistant_final", "user_message"],
);
assert.equal(sources.some((source) => source.textContent === "已替换为新的最终回复。"), true);

const secondRequestId = "req_memory_2";
const secondUser = projector.projectUserInput(
  secondRequestId,
  "继续看看",
  "2026-06-24T00:01:00.000Z",
);
const secondAssistant = projector.projectAssistantDecision(
  secondRequestId,
  "<final>继续分析。</final>",
  "2026-06-24T00:01:02.000Z",
);
repository.recordCompletedTurn({
  sessionId,
  requestId: secondRequestId,
  startedAt: secondUser.timestamp,
  completedAt: secondAssistant.timestamp,
  userEntry: secondUser,
  assistantEntry: secondAssistant,
  terminal: {
    kind: "FinalAnswer",
    content: "继续分析。",
  },
  conversationEntries: [secondAssistant],
});
assert.equal(repository.listEpisodes(sessionId).length, 2);
repository.deleteFromSessionRequest(sessionId, requestId);
assert.equal(repository.listEpisodes(sessionId).length, 0);

repository.close();
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.rmSync(databaseDir, { recursive: true, force: true });

console.log("Memory source persistence verification passed.");
