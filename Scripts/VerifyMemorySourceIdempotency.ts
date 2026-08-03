import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
} from "../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  SqliteAgentMemorySourceRepository,
  type AgentMemoryCompletedTurnInput,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentToolSuccessOutcome } from "../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

const timestamp = "2026-07-08T10:00:00.000Z";
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-memory-source-"));
const repository = new SqliteAgentMemorySourceRepository(path.join(temporaryRoot, "Memory.sqlite"));

try {
  const input = completedTurnInput();
  const first = repository.recordCompletedTurn(input);
  const second = repository.recordCompletedTurn(input);
  const persisted = repository.listSources(second.episode.uri);

  assert.equal(first.sources.length, 4);
  assert.equal(second.sources.length, 4);
  assert.equal(persisted.length, 4);
  assert.equal(persisted.filter((source) => source.evidenceUri === "senera://evidence/duplicate").length, 1);
  assert.equal(persisted.filter((source) => source.artifactUri === "senera://artifact/duplicate").length, 2);
  console.log("Memory source idempotency verified.");
} finally {
  repository.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function completedTurnInput(): AgentMemoryCompletedTurnInput {
  const requestId = "verify-memory-request";
  const userEntry = {
    id: createConversationEntryId(requestId, "user"),
    requestId,
    timestamp,
    kind: AgentConversationEntryKinds.UserMessage,
    content: "Remember this duplicate evidence once.",
  } as const;
  const assistantEntry = {
    id: createConversationEntryId(requestId, "assistant"),
    requestId,
    timestamp,
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: "Done.",
  } as const;
  return {
    sessionId: "verify-memory-session",
    requestId,
    startedAt: timestamp,
    completedAt: timestamp,
    userEntry,
    assistantEntry,
    terminal: { kind: "FinalAnswer", content: "Done." },
    conversationEntries: [userEntry, assistantEntry],
    executedTools: [toolResult("call-a"), toolResult("call-b")],
  };
}

function toolResult(callId: string): ExecutedToolCallResult {
  return {
    callId,
    name: "WorkspaceReadFile",
    arguments: { path: "Source/example.ts" },
    process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    result: { content: "example" },
    outcome: AgentToolSuccessOutcome,
    artifact: {
      artifactId: "duplicate",
      artifactUri: "senera://artifact/duplicate",
      artifactPath: ".senera/artifacts/duplicate",
      relativePath: "duplicate",
      manifestPath: ".senera/artifacts/duplicate/manifest.json",
      files: {},
      summary: "Example source file.",
      evidence: [
        {
          key: "duplicate",
          evidenceUri: "senera://evidence/duplicate",
          kind: "file",
          locator: "Source/example.ts",
          display: "Source/example.ts",
          label: "Source/example.ts",
          source: "WorkspaceReadFile",
          confidence: 1,
          modelSlots: [],
          plannerMemory: {
            facts: [],
            artifactRefs: ["raw"],
            artifactUri: "senera://artifact/duplicate",
          },
        },
      ],
      delta: [],
    },
  };
}
