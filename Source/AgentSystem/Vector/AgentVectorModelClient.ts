import type {
  ResolvedAgentVectorEmbeddingConfig,
  ResolvedAgentVectorModelsConfig,
  ResolvedAgentVectorRerankConfig,
} from "../Types/AgentConfigTypes.js";
import { fetchModelHttpWithRetries } from "../ModelEndpoints/ModelHttpRetry.js";
import { readAgentRecordOrThrow } from "../Core/AgentUnknownValue.js";

export interface AgentEmbeddingRequest {
  input: readonly string[];
  signal?: AbortSignal;
}

export interface AgentEmbeddingResult {
  model: string;
  vectors: number[][];
}

export interface AgentRerankDocument {
  id: string;
  text: string;
}

export interface AgentRerankRequest {
  query: string;
  documents: readonly AgentRerankDocument[];
  topK?: number;
  signal?: AbortSignal;
}

export interface AgentRerankResult {
  model: string;
  results: AgentRerankResultItem[];
}

export interface AgentRerankResultItem {
  id: string;
  index: number;
  score: number;
}

export class AgentVectorModelClient {
  constructor(private readonly config: ResolvedAgentVectorModelsConfig) {}

  async embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> {
    const config = this.config.Embedding;
    if (!config.Enabled) {
      return {
        model: config.Model,
        vectors: [],
      };
    }

    const inputs = request.input.map((value) => trimEmbeddingInput(value, config.InputMaxChars));
    const batches = chunk(inputs, config.BatchSize);
    const vectors: number[][] = [];
    for (const batch of batches) {
      const response = await postJson(
        urlFor(config.BaseUrl, "/embeddings"),
        {
          model: config.Model,
          input: batch,
          ...optionalNumberField("dimensions", config.Dimensions),
        },
        config,
        request.signal,
      );
      vectors.push(...readEmbeddingVectors(response));
    }

    return {
      model: config.Model,
      vectors,
    };
  }

  async rerank(request: AgentRerankRequest): Promise<AgentRerankResult> {
    const config = this.config.Rerank;
    if (!config.Enabled || request.documents.length === 0) {
      return {
        model: config.Model,
        results: [],
      };
    }

    const limited = takeUpTo(request.documents, config.CandidateLimit);
    const topK = request.topK ?? config.TopK;
    const response = await postJson(
      urlFor(config.BaseUrl, config.EndpointPath),
      {
        model: config.Model,
        query: request.query,
        documents: limited.map((document) => document.text),
        ...optionalNumberField("top_n", topK),
      },
      config,
      request.signal,
    );

    return {
      model: config.Model,
      results: readRerankResults(response, limited),
    };
  }
}

async function postJson(
  url: URL,
  payload: unknown,
  config: ResolvedAgentVectorEmbeddingConfig | ResolvedAgentVectorRerankConfig,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchModelHttpWithRetries(config, url, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(payload),
    signal,
  });
  return response.json() as Promise<unknown>;
}

function headers(config: Pick<ResolvedAgentVectorEmbeddingConfig, "ApiKey" | "Headers">): HeadersInit {
  return {
    "content-type": "application/json",
    ...authorizationHeader(config.ApiKey),
    ...config.Headers,
  };
}

function authorizationHeader(apiKey: string): HeadersInit {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {};
}

function readEmbeddingVectors(value: unknown): number[][] {
  const record = readAgentRecordOrThrow(value, "embedding response");
  const data = readArray(record.data, "embedding response.data");
  return data.map((item, index) =>
    readNumberArray(
      readAgentRecordOrThrow(item, `embedding response.data[${index}]`).embedding,
      `embedding response.data[${index}].embedding`,
    ),
  );
}

function readRerankResults(value: unknown, documents: readonly AgentRerankDocument[]): AgentRerankResultItem[] {
  const record = readAgentRecordOrThrow(value, "rerank response");
  const rows = readArray(record.results ?? record.data, "rerank response.results");
  return rows
    .map((item, fallbackIndex) => {
      const row = readAgentRecordOrThrow(item, `rerank response.results[${fallbackIndex}]`);
      const index = readIndex(row, fallbackIndex);
      return {
        id: documents[index]?.id ?? String(index),
        index,
        score: readScore(row),
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function readIndex(record: Record<string, unknown>, fallback: number): number {
  const value = record.index ?? record.document_index ?? record.documentIndex;
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function readScore(record: Record<string, unknown>): number {
  const value = record.relevance_score ?? record.score;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("rerank response score must be a finite number.");
  }
  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function readNumberArray(value: unknown, label: string): number[] {
  const array = readArray(value, label);
  return array.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`${label}[${index}] must be a finite number.`);
    }
    return item;
  });
}

function trimEmbeddingInput(value: string, maxChars: number): string {
  return maxChars === -1 ? value : value.slice(0, maxChars);
}

function optionalNumberField(key: string, value: number): Record<string, number> {
  return value === -1 ? {} : { [key]: value };
}

function takeUpTo<T>(values: readonly T[], limit: number): T[] {
  return limit === -1 ? [...values] : values.slice(0, limit);
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function urlFor(baseUrl: string, endpointPath: string): URL {
  const url = new URL(withTrailingSlash(baseUrl));
  const baseSegments = url.pathname.split("/").filter(Boolean);
  const endpointSegments = endpointPath.split("/").filter(Boolean);
  url.pathname = [...baseSegments, ...endpointSegments].join("/");
  return url;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
