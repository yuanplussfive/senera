import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

const temporaryRoots = new Set<string>();

afterEach(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

describe("Memory executed tool sources", () => {
  test("indexes artifact and evidence sources directly from the completed turn", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-memory-tool-sources-"));
    temporaryRoots.add(root);
    const repository = new SqliteAgentMemorySourceRepository(path.join(root, "Memory.sqlite"));

    try {
      const requestId = "request-tool-source";
      const timestamp = "2026-08-01T00:00:00.000Z";
      const userEntry = {
        kind: AgentConversationEntryKinds.UserMessage,
        id: createConversationEntryId(requestId, "user"),
        requestId,
        timestamp,
        content: "Inspect the source file.",
      } as const;
      const assistantEntry = {
        kind: AgentConversationEntryKinds.AssistantDecision,
        id: createConversationEntryId(requestId, "assistant"),
        requestId,
        timestamp,
        xml: "Inspection complete.",
      } as const;

      const recorded = repository.recordCompletedTurn({
        sessionId: "session-tool-source",
        requestId,
        startedAt: timestamp,
        completedAt: timestamp,
        userEntry,
        assistantEntry,
        terminal: { kind: "FinalAnswer", content: "Inspection complete." },
        conversationEntries: [userEntry, assistantEntry],
        executedTools: [executedToolResult()],
      });

      expect(recorded.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "artifact",
            artifactUri: "senera://artifact/source-file",
            toolName: "WorkspaceReadFile",
          }),
          expect.objectContaining({
            sourceKind: "tool_evidence",
            evidenceUri: "senera://evidence/source-file",
            artifactUri: "senera://artifact/source-file",
            toolName: "WorkspaceReadFile",
          }),
        ]),
      );
    } finally {
      repository.close();
    }
  });
});

function executedToolResult(): ExecutedToolCallResult {
  return {
    callId: "call-source-file",
    name: "WorkspaceReadFile",
    arguments: { path: "Source/example.ts" },
    process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    result: { content: "example" },
    outcome: AgentToolSuccessOutcome,
    artifact: {
      artifactId: "source-file",
      artifactUri: "senera://artifact/source-file",
      artifactPath: ".senera/artifacts/source-file",
      relativePath: "source-file",
      manifestPath: ".senera/artifacts/source-file/manifest.json",
      files: {},
      summary: "Source file contents.",
      evidence: [
        {
          key: "source-file",
          evidenceUri: "senera://evidence/source-file",
          kind: "file",
          locator: "Source/example.ts",
          display: "Source/example.ts",
          label: "Source/example.ts",
          source: "WorkspaceReadFile",
          confidence: 1,
          modelSlots: [],
          plannerMemory: {
            facts: [{ name: "path", value: "Source/example.ts" }],
            artifactRefs: ["raw"],
            artifactUri: "senera://artifact/source-file",
          },
        },
      ],
      delta: [],
    },
  };
}
