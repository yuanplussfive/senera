import { describe, expect, test } from "vitest";
import {
  AgentLocalEmbeddingClient,
  AgentLocalEmbeddingModelName,
} from "../../../Source/AgentSystem/ToolSearch/AgentLocalEmbeddingClient.js";
import { cosineSimilarity } from "../../../Source/AgentSystem/Vector/AgentVectorSimilarity.js";

describe("AgentLocalEmbeddingClient", () => {
  test("prepares the local engine outside a retrieval request", async () => {
    await withClient(async (client) => {
      await expect(client.prewarm()).resolves.toBeUndefined();
      await expect(client.embed({ input: ["generate an image"], role: "query" })).resolves.toEqual(
        expect.objectContaining({
          model: AgentLocalEmbeddingModelName,
          vectors: [expect.any(Array)],
        }),
      );
    });
  });

  test("embeds each input into a unit-length 384-dim vector", async () => {
    await withClient(async (client) => {
      const result = await client.embed({ input: ["generate an image", "read a file"], role: "document" });
      expect(result.model).toBe(AgentLocalEmbeddingModelName);
      expect(result.vectors).toHaveLength(2);
      for (const vector of result.vectors) {
        expect(vector).toHaveLength(384);
        const norm = Math.hypot(...vector);
        expect(norm).toBeGreaterThan(0.99);
        expect(norm).toBeLessThan(1.01);
      }
    });
  });

  test("returns empty vectors for empty input", async () => {
    await withClient(async (client) => {
      const result = await client.embed({ input: [], role: "document" });
      expect(result.model).toBe(AgentLocalEmbeddingModelName);
      expect(result.vectors).toEqual([]);
    });
  });

  test("semantically ranks an English capability over unrelated ones", async () => {
    await withClient(async (client) => {
      const query = "generate an image from a prompt";
      const documents = [
        "Query current weather conditions and up to 30 forecast days for a location.",
        "Generate one or more images from a text prompt.",
        "Activate an application window and return diagnostics.",
      ];
      const { vectors: queryVectors } = await client.embed({ input: [query], role: "query" });
      const { vectors: documentVectors } = await client.embed({ input: documents, role: "document" });
      const scores = documentVectors.map((vector) => cosineSimilarity(queryVectors[0]!, vector));
      expect(scores[1]).toBeGreaterThan(scores[0]);
      expect(scores[1]).toBeGreaterThan(scores[2]);
    });
  });

  test("keeps Chinese and English capability descriptions in one retrieval space", async () => {
    await withClient(async (client) => {
      const documents = [
        "Query current weather conditions and up to 30 forecast days for a city or coordinates.",
        "Generate one or more images from a text prompt and return image files.",
        "Run shell commands, builds, tests, and scripts in the workspace.",
      ];
      const [weather, image, shell] = (await client.embed({ input: documents, role: "document" })).vectors;
      const { vectors } = await client.embed({ input: ["查询北京天气", "帮我画一张图"], role: "query" });
      const [weatherQuery, imageQuery] = vectors;

      expect(cosineSimilarity(weatherQuery!, weather!)).toBeGreaterThan(cosineSimilarity(weatherQuery!, image!));
      expect(cosineSimilarity(weatherQuery!, weather!)).toBeGreaterThan(cosineSimilarity(weatherQuery!, shell!));
      expect(cosineSimilarity(imageQuery!, image!)).toBeGreaterThan(cosineSimilarity(imageQuery!, weather!));
      expect(cosineSimilarity(imageQuery!, image!)).toBeGreaterThan(cosineSimilarity(imageQuery!, shell!));
    });
  });

  test("aligns a single-item document batch with the document role", async () => {
    await withClient(async (client) => {
      const text = "list files in the current directory";
      const asDocument = (await client.embed({ input: [text], role: "document" })).vectors[0]!;
      const asQuery = (await client.embed({ input: [text], role: "query" })).vectors[0]!;
      expect(asDocument).not.toEqual(asQuery);
    });
  });

  test("does not block the caller event loop while the WASM engine initializes", async () => {
    await withClient(async (client) => {
      let prewarmCompleted = false;
      const prewarm = client.prewarm().then(() => {
        prewarmCompleted = true;
      });

      await nextTimerTurn();

      expect(prewarmCompleted).toBe(false);
      await prewarm;
    });
  });

  test("observes cancellation without waiting for an owned worker operation", async () => {
    await withClient(async (client) => {
      const controller = new AbortController();
      const embedding = client.embed({
        input: ["query the current weather for the city"],
        role: "query",
        signal: controller.signal,
      });
      controller.abort("Embedding no longer needed.");

      await expect(embedding).rejects.toThrow("Embedding no longer needed.");
    });
  });
});

async function withClient(action: (client: AgentLocalEmbeddingClient) => Promise<void>): Promise<void> {
  const client = new AgentLocalEmbeddingClient();
  try {
    await action(client);
  } finally {
    await client.close();
  }
}

function nextTimerTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
