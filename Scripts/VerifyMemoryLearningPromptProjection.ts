import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import { AgentConversationProjector } from "../Source/AgentSystem/AgentConversationProjector.js";
import { projectActionPlannerBamlRequestBody } from "../Source/AgentSystem/AgentActionPlannerPromptProjector.js";
import { buildMemoryLearningPromptJson } from "../Source/AgentSystem/AgentActionPlannerModelClient.js";
import { TurnContextMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  buildMemoryLearningPromptInput,
} from "../Source/AgentSystem/Memory/AgentMemoryLearningRuntime.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

const workspaceRoot = process.cwd();
const databasePath = resolveAgentMemoryDatabasePath(
  workspaceRoot,
  ".senera/test-memory-learning-prompt/Memory.sqlite",
);
const databaseDir = path.dirname(databasePath);

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

const repository = new SqliteAgentMemorySourceRepository(databasePath);
const projector = new AgentConversationProjector();

void main().catch((error) => {
  repository.close();
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const requestId = "req_memory_learning_prompt";
  const startedAt = "2026-06-24T02:00:00.000Z";
  const completedAt = "2026-06-24T02:00:05.000Z";
  const userEntry = projector.projectUserInput(
    requestId,
    "以后不要硬编码，要从源头解决。",
    startedAt,
  );
  const assistantEntry = projector.projectAssistantDecision(
    requestId,
    "<final>后续实现时会优先使用 schema 和统一模块。</final>",
    completedAt,
  );

  const recordedTurn = repository.recordCompletedTurn({
    sessionId: "session_memory_learning_prompt",
    requestId,
    startedAt,
    completedAt,
    userEntry,
    assistantEntry,
    terminal: {
      kind: "FinalAnswer",
      content: "后续实现时会优先使用 schema 和统一模块。",
    },
    turnUnderstanding: {
      rawUserTurn: userEntry.content,
      standaloneRequest: "用户要求后续实现避免硬编码，并从源头解决问题。",
      contextMode: TurnContextMode.None,
      contextBasis: "",
      missingContext: "",
    },
    conversationEntries: [assistantEntry],
  });

  const userSource = recordedTurn.sources.find((source) => source.sourceKind === "user_message");
  const assistantSource = recordedTurn.sources.find((source) => source.sourceKind === "assistant_final");
  assert.ok(userSource);
  assert.ok(assistantSource);

  const input = buildMemoryLearningPromptInput(recordedTurn);
  assert.deepEqual(input.supportingSourceRefs, [userSource.uri]);
  assert.deepEqual(input.contextSourceRefs, [assistantSource.uri]);
  assert.deepEqual(input.timeline.map((turn) => turn.role), ["user", "assistant"]);

  const request = await baml.request.LearnMemory(buildMemoryLearningPromptJson(input, {
    stage: "learnMemory",
  }), {});
  const projected = projectActionPlannerBamlRequestBody(request.body.json() as Record<string, unknown>);

  assert.deepEqual(projected.messages.map((message) => message.role), ["user", "assistant", "user"]);

  const projectedUserTurn = JSON.parse(projected.messages[0]?.content ?? "{}") as {
    turn?: {
      payload?: {
        sourceRef?: string;
        memoryRole?: string;
        content?: string;
      };
    };
  };
  const projectedAssistantTurn = JSON.parse(projected.messages[1]?.content ?? "{}") as {
    turn?: {
      payload?: {
        sourceRef?: string;
        memoryRole?: string;
        content?: string;
      };
    };
  };
  const projectedPlannerInput = JSON.parse(projected.messages[2]?.content ?? "{}") as {
    plannerInput?: {
      supportingSourceRefs?: string[];
      contextSourceRefs?: string[];
      sourceCatalog?: unknown[];
    };
  };

  assert.equal(projectedUserTurn.turn?.payload?.sourceRef, userSource.uri);
  assert.equal(projectedUserTurn.turn?.payload?.memoryRole, "support");
  assert.equal(projectedUserTurn.turn?.payload?.content, userEntry.content);
  assert.equal(projectedAssistantTurn.turn?.payload?.sourceRef, assistantSource.uri);
  assert.equal(projectedAssistantTurn.turn?.payload?.memoryRole, "context");
  assert.equal(projectedAssistantTurn.turn?.payload?.content, "后续实现时会优先使用 schema 和统一模块。");
  assert.deepEqual(projectedPlannerInput.plannerInput?.supportingSourceRefs, [userSource.uri]);
  assert.deepEqual(projectedPlannerInput.plannerInput?.contextSourceRefs, [assistantSource.uri]);
  assert.equal(JSON.stringify(projectedPlannerInput).includes(userEntry.content), false);
  assert.equal(JSON.stringify(projectedPlannerInput).includes("schema 和统一模块"), false);

  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.rmSync(databaseDir, { recursive: true, force: true });

  console.log("Memory learning prompt projection verification passed.");
}
