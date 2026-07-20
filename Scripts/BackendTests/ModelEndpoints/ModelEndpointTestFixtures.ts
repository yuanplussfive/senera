import type {
  AgentLanguageModelRequest,
  AgentLanguageModelStream,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import { createModelProviderMetadata } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelMetadata.js";
import type { ModelHttpClient } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpClient.js";
import type {
  EndpointRuntime,
  JsonObject,
  ModelHttpPathSegment,
} from "../../../Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { ModelSseEventProjection } from "../../../Source/AgentSystem/ModelEndpoints/ModelSseStreamParser.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

export function createModelEndpointRuntime(
  http: RecordingModelHttp,
  configOverrides: Partial<ResolvedAgentModelProviderConfig> = {},
): EndpointRuntime {
  const config = createModelProvider(configOverrides);
  return {
    config,
    http: http as unknown as ModelHttpClient,
  };
}

export function createModelRequest(overrides: Partial<AgentLanguageModelRequest> = {}): AgentLanguageModelRequest {
  return {
    requestId: "request-model-endpoint",
    step: 1,
    systemPrompt: "Follow the system instruction.",
    messages: [
      { role: "developer", content: "Use concise answers." },
      { role: "user", content: "Explain the current status." },
    ],
    ...overrides,
  };
}

export class RecordingModelHttp {
  readonly jsonRequests: RecordedJsonRequest[] = [];
  readonly sseRequests: RecordedSseRequest[] = [];

  constructor(
    private readonly responses: {
      json?: JsonObject;
      stream?: AgentLanguageModelStream;
    } = {},
  ) {}

  async postJson(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    options: { signal?: AbortSignal } = {},
  ): Promise<JsonObject> {
    this.jsonRequests.push({ headers, options, path, payload });
    return this.responses.json ?? {};
  }

  async postSseStream(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    projectEvent: (event: JsonObject) => ModelSseEventProjection,
    query?: Record<string, string>,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentLanguageModelStream> {
    this.sseRequests.push({ projectEvent, headers, options, path, payload, query });
    return this.responses.stream ?? createStaticModelStream([]);
  }
}

export interface RecordedJsonRequest {
  readonly headers: HeadersInit;
  readonly options: { signal?: AbortSignal };
  readonly path: ModelHttpPathSegment[];
  readonly payload: unknown;
}

export interface RecordedSseRequest extends RecordedJsonRequest {
  readonly projectEvent: (event: JsonObject) => ModelSseEventProjection;
  readonly query?: Record<string, string>;
}

export function createStaticModelStream(deltas: readonly string[]): AgentLanguageModelStream {
  const metadata = createModelProviderMetadata(createModelProvider());
  let aborted = false;
  return {
    metadata,
    abort: () => {
      aborted = true;
    },
    async *[Symbol.asyncIterator]() {
      let accumulatedText = "";
      for (const textDelta of deltas) {
        if (aborted) return;
        accumulatedText += textDelta;
        yield { textDelta, accumulatedText };
      }
    },
  };
}

export function readHeaders(headers: HeadersInit): Headers {
  return new Headers(headers);
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object test payload.");
  }
  return value as Record<string, unknown>;
}

export function createSseResponse(events: readonly string[], splitAt: number[] = []): Response {
  const bytes = new TextEncoder().encode(events.join(""));
  const chunks = splitBytes(bytes, splitAt);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

export async function collectModelStream(stream: AsyncIterable<{ textDelta: string; accumulatedText: string }>) {
  const chunks: Array<{ textDelta: string; accumulatedText: string }> = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function splitBytes(value: Uint8Array, indexes: readonly number[]): Uint8Array[] {
  const boundaries = [...indexes]
    .filter((index) => index > 0 && index < value.length)
    .sort((left, right) => left - right);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const end of boundaries) {
    chunks.push(value.subarray(start, end));
    start = end;
  }
  chunks.push(value.subarray(start));
  return chunks;
}
