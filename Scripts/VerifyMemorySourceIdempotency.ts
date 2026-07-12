import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
} from "../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { SqliteAgentMemorySourceRepository } from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentMemoryService } from "../Source/AgentSystem/Memory/AgentMemoryService.js";
import type { AgentMemoryCompletedTurnInput } from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentCompletedRunResult } from "../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import { AgentSessionRunCoordinator } from "../Source/AgentSystem/Session/AgentSessionRunCoordinator.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import type { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";

const fixedTimestamp = "2026-07-08T10:00:00.000Z";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-memory-source-"));

async function main(): Promise<void> {
  try {
    verifySqliteSourceIdempotency();
    await verifyCoordinatorRecordsOnlyFreshEntries();
    await verifyCoordinatorLogsMemoryFailures();
    console.log("Memory source idempotency verification passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifySqliteSourceIdempotency(): void {
  const repository = new SqliteAgentMemorySourceRepository(path.join(tempRoot, "Memory.sqlite"));
  try {
    const input = completedTurnInput("verify-memory-session", "verify-memory-request");

    const first = repository.recordCompletedTurn(input);
    const second = repository.recordCompletedTurn(input);
    const persisted = repository.listSources(second.episode.uri);

    assert.equal(first.sources.length, 4);
    assert.equal(second.sources.length, 4);
    assert.equal(persisted.length, 4);
    assert.equal(persisted.filter((source) => source.evidenceUri === "evidence://duplicate").length, 1);
    assert.equal(
      persisted.filter((source) => source.sourceKind === "artifact" && source.artifactUri === "artifact://duplicate")
        .length,
      1,
    );
  } finally {
    repository.close();
  }
}

async function verifyCoordinatorRecordsOnlyFreshEntries(): Promise<void> {
  const store = new AgentSessionStore();
  const opened = store.open("verify-memory-fresh-session");
  const historicalEntry = evidenceEntry("historical-request", "historical-evidence", "artifact://historical");
  opened.session.conversation = [historicalEntry];
  store.persistEntries(opened.session.id, [historicalEntry]);

  const repository = new RecordingMemorySourceRepository();
  const memory = new AgentMemoryService({ sourceRepository: repository });
  const coordinator = new AgentSessionRunCoordinator({
    store,
    conversationPolicy: new AgentConversationPolicy(),
    conversationProjector: new AgentConversationProjector(),
    memory,
    loopFactory: () =>
      ({
        run: async (): Promise<AgentCompletedRunResult> => ({
          terminal: {
            kind: "FinalAnswer",
            content: "Done.",
          },
          decisionXml: "<final_answer>Done.</final_answer>",
          conversationEntries: [historicalEntry, evidenceEntry("fresh-request", "fresh-evidence", "artifact://fresh")],
          stepTraces: [],
        }),
      }) as unknown as AgentLoop,
  });

  try {
    await coordinator.runTurn(opened.session, {
      requestId: "fresh-request",
      input: "Record fresh memory only.",
    });

    assert.equal(repository.inputs.length, 1);
    assert.deepEqual(
      repository.inputs[0]?.conversationEntries.map((entry) => entry.id),
      [
        createConversationEntryId("fresh-request", "evidence_memory", 1),
        createConversationEntryId("fresh-request", "assistant"),
      ],
    );
  } finally {
    memory.close();
  }
}

async function verifyCoordinatorLogsMemoryFailures(): Promise<void> {
  const store = new AgentSessionStore();
  const opened = store.open("verify-memory-logger-session");
  const output = new MemoryOutputStream();
  const memory = new AgentMemoryService({
    sourceRepository: new FailingMemorySourceRepository(),
  });
  const coordinator = new AgentSessionRunCoordinator({
    store,
    conversationPolicy: new AgentConversationPolicy(),
    conversationProjector: new AgentConversationProjector(),
    memory,
    logger: new AgentLogger({ output: output as unknown as NodeJS.WriteStream }),
    loopFactory: () =>
      ({
        run: async (): Promise<AgentCompletedRunResult> => ({
          terminal: {
            kind: "FinalAnswer",
            content: "Done.",
          },
          decisionXml: "<final_answer>Done.</final_answer>",
          conversationEntries: [],
          stepTraces: [],
        }),
      }) as unknown as AgentLoop,
  });

  try {
    await coordinator.runTurn(opened.session, {
      requestId: "logger-request",
      input: "Do not fail the run when memory persistence fails.",
    });

    assert.match(output.text, /memory\.record_completed_turn\.failed/);
    assert.equal(opened.session.status, "idle");
  } finally {
    memory.close();
  }
}

function completedTurnInput(sessionId: string, requestId: string): AgentMemoryCompletedTurnInput {
  const userEntry = {
    id: createConversationEntryId(requestId, "user"),
    requestId,
    timestamp: fixedTimestamp,
    kind: AgentConversationEntryKinds.UserMessage,
    content: "Remember this duplicate evidence once.",
  } as const;
  const assistantEntry = {
    id: createConversationEntryId(requestId, "assistant"),
    requestId,
    timestamp: fixedTimestamp,
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: "<final_answer>Done.</final_answer>",
  } as const;
  return {
    sessionId,
    requestId,
    startedAt: fixedTimestamp,
    completedAt: fixedTimestamp,
    userEntry,
    assistantEntry,
    terminal: {
      kind: "FinalAnswer",
      content: "Done.",
    },
    conversationEntries: [
      evidenceEntry(requestId, "duplicate-a", "artifact://duplicate"),
      evidenceEntry(requestId, "duplicate-b", "artifact://duplicate"),
    ],
  };
}

function evidenceEntry(
  requestId: string,
  evidenceLabel: string,
  artifactUri: string,
): Extract<AgentMemoryCompletedTurnInput["conversationEntries"][number], { kind: "tool.evidence_memory" }> {
  return {
    id: createConversationEntryId(requestId, "evidence_memory", 1),
    requestId,
    timestamp: fixedTimestamp,
    kind: AgentConversationEntryKinds.ToolEvidenceMemory,
    record: {
      requestId,
      step: 1,
      toolName: "WorkspaceReadFile",
      artifactId: "artifact-duplicate",
      artifactUri,
      artifactPath: "Source/example.ts",
      evidence: [
        {
          evidenceUri: "evidence://duplicate",
          kind: "file",
          locator: `Source/example.ts#${evidenceLabel}`,
          display: evidenceLabel,
          label: evidenceLabel,
          toolName: "WorkspaceReadFile",
          artifactUri,
          facts: [],
          artifactRefs: [],
        },
      ],
      createdAt: fixedTimestamp,
    },
  };
}

class RecordingMemorySourceRepository extends SqliteAgentMemorySourceRepository {
  readonly inputs: AgentMemoryCompletedTurnInput[] = [];

  constructor() {
    super(path.join(tempRoot, "RecordingMemory.sqlite"));
  }

  override recordCompletedTurn(input: AgentMemoryCompletedTurnInput) {
    this.inputs.push(input);
    return super.recordCompletedTurn(input);
  }
}

class FailingMemorySourceRepository extends SqliteAgentMemorySourceRepository {
  constructor() {
    super(path.join(tempRoot, "FailingMemory.sqlite"));
  }

  override recordCompletedTurn(_input: AgentMemoryCompletedTurnInput): never {
    throw new Error("synthetic memory failure");
  }
}

class MemoryOutputStream {
  text = "";
  readonly isTTY = false;
  readonly columns = 120;

  write(chunk: string | Uint8Array): boolean {
    this.text += chunk.toString();
    return true;
  }
}

await main();
