import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySemanticRecall } from "../../../Source/AgentSystem/Continuity/AgentContinuitySemanticRecall.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { agentContinuityObservationUri } from "../../../Source/AgentSystem/Continuity/AgentContinuityObservationProjection.js";
import type {
  AgentEmbeddingRequest,
  AgentEmbeddingResult,
} from "../../../Source/AgentSystem/Vector/AgentVectorModelClient.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of [...workspaces]) {
    workspaces.delete(workspace);
    removeDirectory(workspace);
  }
});

describe("continuity semantic recall", () => {
  test("embeds observations once and re-embeds only changed text", async () => {
    const store = createStore();
    try {
      const client = recordingClient();
      const recall = createRecall(store, client, "test-embed");
      const observations = [
        { uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" },
        { uri: "senera://continuity-learning/latte", summary: "用户偶尔喝拿铁。" },
      ];

      await expect(recall.embedObservations(observations)).resolves.toBe(2);
      await expect(recall.embedObservations(observations)).resolves.toBe(0);

      const changed = [{ ...observations[0]!, summary: "用户只喝无糖美式咖啡。" }];
      await expect(recall.embedObservations(changed)).resolves.toBe(1);
      expect(store.listObservationEmbeddings(observations.map(({ uri }) => uri)).size).toBe(2);
    } finally {
      store.close();
    }
  });

  test("skips embedding entirely without a client", async () => {
    const store = createStore();
    try {
      const recall = createRecall(store, undefined, "test-embed");
      await expect(
        recall.embedObservations([{ uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" }]),
      ).resolves.toBe(0);
    } finally {
      store.close();
    }
  });

  test("scores persisted vectors by cosine similarity above the floor", async () => {
    const store = createStore();
    try {
      const client = recordingClient();
      const recall = createRecall(store, client, "test-embed");
      const coffee = { uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" };
      const latte = { uri: "senera://continuity-learning/latte", summary: "用户偶尔喝拿铁。" };
      await recall.embedObservations([coffee, latte]);

      const scores = await recall.queryScores("我想喝咖啡", [coffee, latte]);
      expect(scores.get(coffee.uri)).toBeCloseTo(1, 5);
      expect(scores.has(latte.uri)).toBe(false);
    } finally {
      store.close();
    }
  });

  test("ignores vectors persisted for another embedding model", async () => {
    const store = createStore();
    try {
      const client = recordingClient();
      const write = createRecall(store, client, "model-a");
      const observation = { uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" };
      await write.embedObservations([observation]);

      const read = createRecall(store, client, "model-b");
      await expect(read.queryScores("我想喝咖啡", [observation])).resolves.toEqual(new Map());
    } finally {
      store.close();
    }
  });

  test("preserves physical-history vectors during orphan pruning", async () => {
    const store = createStore();
    try {
      const sourceUri = "senera://memory-source/physical-turn";
      const observationUri = agentContinuityObservationUri(sourceUri);
      const recall = createRecall(store, recordingClient(), "test-embed");
      await recall.embedObservations([{ uri: observationUri, summary: "历史用户消息" }]);

      expect(store.pruneObservationEmbeddings([observationUri])).toBe(0);
      expect(store.listObservationEmbeddings([observationUri])).toHaveProperty("size", 1);
      expect(store.pruneObservationEmbeddings()).toBe(1);
      expect(store.listObservationEmbeddings([observationUri])).toHaveProperty("size", 0);
    } finally {
      store.close();
    }
  });

  test("skips the embedding call for short queries", async () => {
    const store = createStore();
    try {
      const client = recordingClient();
      const recall = createRecall(store, client, "test-embed");
      const observation = { uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" };
      await recall.embedObservations([observation]);

      const callsBefore = client.embeds.length;
      await expect(recall.queryScores("咖", [observation], { minQueryCharacters: 2 })).resolves.toEqual(new Map());
      expect(client.embeds.length).toBe(callsBefore);
    } finally {
      store.close();
    }
  });

  test("degrades to an empty score map when the client fails", async () => {
    const store = createStore();
    try {
      const recall = createRecall(store, failingClient(), "test-embed");
      const observation = { uri: "senera://continuity-learning/coffee", summary: "用户喜欢无糖咖啡。" };

      await expect(recall.embedObservations([observation])).resolves.toBe(0);
      await expect(recall.queryScores("我想喝咖啡", [observation])).resolves.toEqual(new Map());
    } finally {
      store.close();
    }
  });
});

function createStore(): AgentContinuitySqliteStore {
  const workspace = createTemporaryDirectory("senera-semantic-recall");
  workspaces.add(workspace);
  return new AgentContinuitySqliteStore(path.join(workspace, ".senera", "data", "memory.sqlite"));
}

function createRecall(
  store: AgentContinuitySqliteStore,
  client: { embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> } | undefined,
  model: string,
): AgentContinuitySemanticRecall {
  return new AgentContinuitySemanticRecall({
    store,
    client,
    model: () => model,
    scoreFloor: () => 0.3,
  });
}

/** Deterministic vectors: coffee summaries map to [1, 0], everything else to [0, 1]. */
function recordingClient(): {
  embed: (request: AgentEmbeddingRequest) => Promise<AgentEmbeddingResult>;
  embeds: string[][];
} {
  const embeds: string[][] = [];
  return {
    embeds,
    embed: async (request) => {
      embeds.push([...request.input]);
      return {
        model: "test-embed",
        vectors: request.input.map((text) => (text.includes("咖啡") ? [1, 0] : [0, 1])),
      };
    },
  };
}

function failingClient(): { embed: (request: AgentEmbeddingRequest) => Promise<AgentEmbeddingResult> } {
  return {
    embed: async () => {
      throw new Error("embedding endpoint unavailable");
    },
  };
}
