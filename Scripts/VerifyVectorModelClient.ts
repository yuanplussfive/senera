import assert from "node:assert/strict";
import http from "node:http";
import { resolveVectorModelsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentVectorModelClient } from "../Source/AgentSystem/Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "../Source/AgentSystem/Vector/AgentVectorSimilarity.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const requests: Array<{
  path: string;
  body: unknown;
  authorization: string;
}> = [];

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await readBody(request);
    requests.push({
      path: request.url ?? "",
      body,
      authorization: request.headers.authorization ?? "",
    });

    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/embeddings") {
      response.end(
        JSON.stringify({
          data: [
            { index: 0, embedding: [1, 0, 0] },
            { index: 1, embedding: [0, 1, 0] },
          ],
        }),
      );
      return;
    }

    if (request.url === "/v1/rerank") {
      response.end(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.91 },
            { index: 0, relevance_score: 0.42 },
          ],
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const config = resolveVectorModelsConfig({
      ModelProviderEndpoints: [
        {
          Id: "vector-test",
          BaseUrl: baseUrl,
          ApiKey: "test-key",
        },
      ],
      ModelProviders: [
        {
          Id: "main",
          ProviderId: "vector-test",
          Endpoint: "Responses",
          Model: "unused",
        },
      ],
      VectorModels: {
        Embedding: {
          ProviderId: "vector-test",
          Model: "qwen3-embedding-0.6b",
          BatchSize: 2,
        },
        Rerank: {
          ProviderId: "vector-test",
          Model: "qwen3-reranker-0.6b",
          EndpointPath: "/rerank",
        },
      },
    } satisfies AgentSystemConfig);
    const client = new AgentVectorModelClient(config);
    const untrimmedInput = "不".repeat(12_001);

    assert.equal(config.Embedding.InputMaxChars, -1);
    assert.equal(config.Rerank.CandidateLimit, -1);
    assert.equal(config.Rerank.TopK, -1);

    const embedding = await client.embed({
      input: [untrimmedInput, "从源头解决"],
    });
    assert.equal(embedding.model, "qwen3-embedding-0.6b");
    assert.deepEqual(embedding.vectors, [
      [1, 0, 0],
      [0, 1, 0],
    ]);

    const rerank = await client.rerank({
      query: "代码质量偏好",
      documents: [
        { id: "a", text: "用户喜欢快速回答" },
        { id: "b", text: "用户要求不要硬编码" },
        { id: "c", text: "用户要求从源头解决" },
      ],
    });
    assert.deepEqual(
      rerank.results.map((item) => item.id),
      ["b", "a"],
    );
    assert.equal(requests[0]?.path, "/v1/embeddings");
    assert.equal(requests[1]?.path, "/v1/rerank");
    assert.equal(requests[0]?.authorization, "Bearer test-key");
    assert.equal((requests[0]?.body as { model?: string }).model, "qwen3-embedding-0.6b");
    assert.equal((requests[1]?.body as { model?: string }).model, "qwen3-reranker-0.6b");
    assert.equal((requests[0]?.body as { input?: string[] }).input?.[0], untrimmedInput);
    const rerankBody = requests[1]?.body as { documents?: string[]; top_n?: number };
    assert.equal(rerankBody.documents?.length, 3);
    assert.equal("top_n" in rerankBody, false);

    const boundedClient = new AgentVectorModelClient({
      ...config,
      Rerank: {
        ...config.Rerank,
        CandidateLimit: 2,
        TopK: 2,
      },
    });
    await boundedClient.rerank({
      query: "代码质量偏好",
      documents: [
        { id: "a", text: "用户喜欢快速回答" },
        { id: "b", text: "用户要求不要硬编码" },
        { id: "c", text: "用户要求从源头解决" },
      ],
    });
    const boundedRerankBody = requests[2]?.body as { documents?: string[]; top_n?: number };
    assert.equal(boundedRerankBody.documents?.length, 2);
    assert.equal(boundedRerankBody.top_n, 2);

    assert.equal(Number(cosineSimilarity([1, 0], [1, 0]).toFixed(6)), 1);
    assert.equal(Number(cosineSimilarity([1, 0], [0, 1]).toFixed(6)), 0);

    console.log("Vector model client verification passed.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function readBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? (JSON.parse(text) as unknown) : undefined);
    });
  });
}
