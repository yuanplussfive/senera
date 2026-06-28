import fs from "node:fs";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import type { AgentMemoryRecordedTurn } from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import {
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentMemoryLearningRuntime } from "../Source/AgentSystem/Memory/AgentMemoryLearningRuntime.js";
import { TurnContextMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

interface DailyMemoryExample {
  user: string;
  assistant: string;
}

const Examples: DailyMemoryExample[] = [
  {
    user: "你好",
    assistant: "你好，我在。",
  },
  {
    user: "我平时喜欢喝冰美式，不太喜欢甜饮料。",
    assistant: "记住了，饮料偏好上你更喜欢冰美式和低糖选择。",
  },
  {
    user: "以后推荐饮料时，优先无糖咖啡，奶茶这种少推荐。",
    assistant: "明白，后续推荐饮料会优先考虑无糖咖啡，少推荐奶茶。",
  },
  {
    user: "今天晚上提醒我买牛奶。",
    assistant: "这更像一次性提醒事项，我不会把它当长期偏好处理。",
  },
] as const;

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = AgentConfigLoader.load(path.resolve(process.argv[2] ?? "senera.config.json"));
  const databasePath = resolveAgentMemoryDatabasePath(
    workspaceRoot,
    ".senera/test-memory-real/Memory.sqlite",
  );
  cleanDatabase(databasePath);

  const repository = new SqliteAgentMemorySourceRepository(databasePath);
  const runtime = new AgentMemoryLearningRuntime({
    repository,
    configSnapshot: () => config,
  });
  const projector = new AgentConversationProjector();
  const sessionId = "session_daily_memory_real_api";

  try {
    for (const [index, example] of Examples.entries()) {
      const requestId = `req_daily_memory_${index + 1}`;
      const startedAt = new Date(Date.UTC(2026, 5, 24, 2, index * 2, 0)).toISOString();
      const completedAt = new Date(Date.UTC(2026, 5, 24, 2, index * 2, 8)).toISOString();
      const userEntry = projector.projectUserInput(requestId, example.user, startedAt);
      const assistantEntry = projector.projectAssistantDecision(
        requestId,
        `<final>${example.assistant}</final>`,
        completedAt,
      );
      const recordedTurn = repository.recordCompletedTurn({
        sessionId,
        requestId,
        startedAt,
        completedAt,
        userEntry,
        assistantEntry,
        terminal: {
          kind: "FinalAnswer",
          content: example.assistant,
        },
        turnUnderstanding: {
          rawUserTurn: example.user,
          standaloneRequest: example.user,
          contextMode: TurnContextMode.None,
          contextBasis: "",
          missingContext: "",
        },
        conversationEntries: [assistantEntry],
      });

      await runMemoryLearning(runtime, recordedTurn);
    }

    const episodes = repository.listEpisodes(sessionId);
    const candidates = repository.listPendingMemoryCandidates(sessionId);
    const memories = repository.listActiveMemoryItems()
      .filter((memory) => memory.sessionId === sessionId);

    console.log(JSON.stringify({
      databasePath,
      episodes: episodes.map((episode) => ({
        requestId: episode.requestId,
        standaloneRequest: episode.standaloneRequest,
        localHour: episode.localHour,
      })),
      pendingCandidates: candidates.map((candidate) => ({
        uri: candidate.uri,
        type: candidate.type,
        subject: candidate.subject,
        claim: candidate.claim,
        confidence: Number(candidate.confidence.toFixed(3)),
        sourceRefs: candidate.sourceRefs,
      })),
      activeMemories: memories.map((memory) => ({
        uri: memory.uri,
        type: memory.type,
        subject: memory.subject,
        claim: memory.claim,
        howToApply: memory.howToApply,
        tags: memory.tags,
        triggers: memory.triggers,
        confidence: Number(memory.confidence.toFixed(3)),
        sourceRefs: memory.sourceRefs,
      })),
    }, null, 2));
  } finally {
    repository.close();
  }
}

async function runMemoryLearning(
  runtime: AgentMemoryLearningRuntime,
  recordedTurn: AgentMemoryRecordedTurn,
): Promise<void> {
  await (runtime as unknown as {
    learn(recordedTurn: AgentMemoryRecordedTurn): Promise<void>;
  }).learn(recordedTurn);
}

function cleanDatabase(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}
