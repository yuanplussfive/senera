import type {
  ResolvedAgentVectorEmbeddingConfig,
  ResolvedAgentVectorModelsConfig,
  ResolvedAgentVectorRerankConfig,
} from "../Types/AgentConfigTypes.js";

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

    const limited = request.documents.slice(0, config.CandidateLimit);
    const response = await postJson(
      urlFor(config.BaseUrl, config.EndpointPath),
      {
        model: config.Model,
        query: request.query,
        documents: limited.map((document) => document.text),
        top_n: request.topK ?? config.TopK,
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
  const response = await fetchWithRetries(
    url,
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(payload),
      signal,
    },
    config,
  );
  return response.json() as Promise<unknown>;
}

async function fetchWithRetries(
  url: URL,
  init: RequestInit,
  config: Pick<ResolvedAgentVectorEmbeddingConfig, "TimeoutMs" | "MaxNetworkRetries" | "Model" | "BaseUrl">,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.MaxNetworkRetries; attempt += 1) {
    const timeout = new AbortController();
    const signal = combineAbortSignals(init.signal, timeout.signal);
    const timer = setTimeout(() => timeout.abort(new Error("vector_request_timeout")), config.TimeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        return response;
      }

      const detail = await safeReadText(response);
      const error = new Error(
        `向量模型请求失败。 status=${response.status} model=${config.Model} baseUrl=${config.BaseUrl} detail=${detail}`,
      );
      if (!isRetryableStatus(response.status) || attempt >= config.MaxNetworkRetries) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      clearTimeout(timer);
      if (init.signal?.aborted || attempt >= config.MaxNetworkRetries) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
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
  const record = readRecord(value, "embedding response");
  const data = readArray(record.data, "embedding response.data");
  return data.map((item, index) =>
    readNumberArray(
      readRecord(item, `embedding response.data[${index}]`).embedding,
      `embedding response.data[${index}].embedding`,
    ),
  );
}

function readRerankResults(value: unknown, documents: readonly AgentRerankDocument[]): AgentRerankResultItem[] {
  const record = readRecord(value, "rerank response");
  const rows = readArray(record.results ?? record.data, "rerank response.results");
  return rows
    .map((item, fallbackIndex) => {
      const row = readRecord(item, `rerank response.results[${fallbackIndex}]`);
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

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function combineAbortSignals(first: AbortSignal | null | undefined, second: AbortSignal): AbortSignal {
  if (!first) {
    return second;
  }
  if (first.aborted) {
    return first;
  }

  const controller = new AbortController();
  const abort = (event?: Event): void => {
    const source = event?.target as AbortSignal | undefined;
    controller.abort(source?.reason);
  };
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
