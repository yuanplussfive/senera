import { createParser } from "eventsource-parser";
import type { AgentLanguageModelStreamChunk } from "./AgentLanguageModel.js";
import type { JsonObject } from "./ModelEndpointTypes.js";
import type { AgentModelUsageValue } from "./AgentModelUsage.js";
import { readAbortFailure } from "./ModelHttpAbort.js";
import { ModelRequestTimeoutError, ModelResponseLimitError } from "./ModelHttpErrors.js";
import { parseModelHttpJsonObject } from "./ModelHttpJson.js";

export async function* parseModelEventStreamText(
  body: ReadableStream<Uint8Array>,
  projectEvent: (event: JsonObject) => ModelSseEventProjection,
  options: {
    requestSignal: AbortSignal;
    firstTokenTimeoutMs: number;
    dispose: () => void;
    normalizeError: (error: unknown) => Error;
    onUsage?: (usage: AgentModelUsageValue) => void;
    maxResponseBytes: number;
    maxEventBytes: number;
    maxEvents: number;
  },
): AsyncGenerator<AgentLanguageModelStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: JsonObject[] = [];
  let responseBytes = 0;
  let eventCount = 0;
  const parser = createParser({
    onEvent: (event) => {
      if (event.data === "[DONE]") return;
      eventCount += 1;
      if (eventCount > options.maxEvents) throw new ModelResponseLimitError("SSE events", options.maxEvents);
      if (Buffer.byteLength(event.data, "utf8") > options.maxEventBytes) {
        throw new ModelResponseLimitError("SSE event", options.maxEventBytes);
      }
      events.push(parseModelHttpJsonObject(JSON.parse(event.data) as unknown));
    },
    onError: (error) => {
      throw error;
    },
  });
  const textChunks: string[] = [];
  let firstTokenSeen = false;
  const firstTokenController = new AbortController();
  const firstTokenTimer =
    options.firstTokenTimeoutMs === -1
      ? undefined
      : setTimeout(
          () => firstTokenController.abort(new ModelRequestTimeoutError("first_token")),
          options.firstTokenTimeoutMs,
        );

  try {
    while (true) {
      const { value, done } = await readStreamChunk(
        reader,
        options.requestSignal,
        firstTokenSeen || options.firstTokenTimeoutMs === -1 ? undefined : firstTokenController.signal,
      );
      if (value) {
        responseBytes += value.byteLength;
        if (responseBytes > options.maxResponseBytes) {
          throw new ModelResponseLimitError("SSE response", options.maxResponseBytes);
        }
        parser.feed(decoder.decode(value, { stream: !done }));
      }
      if (done) {
        parser.reset({ consume: true });
      }

      while (events.length > 0) {
        const event = events.shift();
        if (!event) continue;
        const projection = projectEvent(event);
        if (projection.usage) options.onUsage?.(projection.usage);
        const textDelta = projection.textDelta ?? "";
        if (!textDelta) continue;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
        }
        textChunks.push(textDelta);
        yield {
          textDelta,
          accumulatedText: textChunks.join(""),
        };
      }

      if (done) break;
    }
  } catch (error) {
    throw options.normalizeError(error);
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    options.dispose();
    reader.releaseLock();
  }
}

export interface ModelSseEventProjection {
  textDelta?: string;
  usage?: AgentModelUsageValue;
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSignal: AbortSignal,
  firstTokenSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const abortFailure = readAbortFailure(firstTokenSignal, requestSignal);
  if (abortFailure) {
    return Promise.reject(abortFailure.reason);
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(readAbortFailure(firstTokenSignal, requestSignal)?.reason);
    requestSignal.addEventListener("abort", onAbort, { once: true });
    firstTokenSignal?.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        requestSignal.removeEventListener("abort", onAbort);
        firstTokenSignal?.removeEventListener("abort", onAbort);
      });
  });
}
