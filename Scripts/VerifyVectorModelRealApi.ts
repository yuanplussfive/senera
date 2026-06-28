import assert from "node:assert/strict";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/Config/AgentConfigLoader.js";
import { resolveVectorModelsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentVectorModelClient } from "../Source/AgentSystem/Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "../Source/AgentSystem/Vector/AgentVectorSimilarity.js";

const Samples = [
  {
    id: "same_preference",
    text: "用户要求实现时不要硬编码，优先从根因和结构化协议解决。",
  },
  {
    id: "weather",
    text: "用户想查询上海今天和未来几天的天气预报。",
  },
  {
    id: "schema_quality",
    text: "实现功能时应该使用成熟库、统一 schema 和可维护模块边界。",
  },
  {
    id: "story_scene",
    text: "角色扮演剧情里存在一个魔法学院和长期世界观设定。",
  },
] as const;

const Query = "用户偏好从源头解决问题，避免硬编码、兜底堆规则和低级字符串匹配。";

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const configPath = path.resolve(process.argv[2] ?? "senera.config.json");
  const config = resolveVectorModelsConfig(AgentConfigLoader.load(configPath));
  const client = new AgentVectorModelClient(config);

  assert.equal(config.Embedding.Enabled, true, "VectorModels.Embedding.Enabled must be true.");
  assert.equal(config.Rerank.Enabled, true, "VectorModels.Rerank.Enabled must be true.");

  const embedding = await client.embed({
    input: [
      Query,
      ...Samples.map((sample) => sample.text),
    ],
  });
  const [queryVector, ...sampleVectors] = embedding.vectors;
  assert.ok(queryVector);

  const similarityRows = Samples.map((sample, index) => ({
    id: sample.id,
    similarity: Number(cosineSimilarity(queryVector, sampleVectors[index] ?? []).toFixed(6)),
    text: sample.text,
  })).sort((left, right) => right.similarity - left.similarity);

  const rerank = await client.rerank({
    query: Query,
    documents: Samples.map((sample) => ({
      id: sample.id,
      text: sample.text,
    })),
    topK: Samples.length,
  });

  console.log(JSON.stringify({
    embedding: {
      model: embedding.model,
      vectorCount: embedding.vectors.length,
      dimensions: queryVector.length,
      similarityRows,
    },
    rerank: {
      model: rerank.model,
      results: rerank.results.map((item) => ({
        id: item.id,
        score: Number(item.score.toFixed(6)),
        text: Samples.find((sample) => sample.id === item.id)?.text,
      })),
    },
  }, null, 2));
}
