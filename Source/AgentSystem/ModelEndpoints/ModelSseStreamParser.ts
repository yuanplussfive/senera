import { createParser } from "eventsource-parser";
import type {
  AgentLanguageModelStreamChunk,
} from "./AgentLanguageModel.js";
import type { JsonObject } from "./ModelEndpointTypes.js";
import { readAbortFailure } from "./ModelHttpAbort.js";
import { ModelRequestTimeoutError } from "./ModelHttpErrors.js";
import { parseModelHttpJsonObject } from "./ModelHttpJson.js";

export async function* parseModelEventStreamText(
  body: ReadableStream<Uint8Array>,
  extractText: (event: JsonObject) => string,
  options: {
    requestSignal: AbortSignal;
    firstTokenTimeoutMs: number;
    dispose: () => void;
    normalizeError: (error: unknown) => Error;
  },
): AsyncGenerator<AgentLanguageModelStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: JsonObject[] = [];
  const parser = createParser({
    onEvent: (event) => {
      if (event.data === "[DONE]") return;
      events.push(parseModelHttpJsonObject(JSON.parse(event.data) as unknown));
    },
    onError: (error) => {
      throw error;
    },
  });
  let accumulatedText = "";
  let firstTokenSeen = false;
  const firstTokenController = new AbortController();
  const firstTokenTimer = options.firstTokenTimeoutMs === -1
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
        parser.feed(decoder.decode(value, { stream: !done }));
      }
      if (done) {
        parser.reset({ consume: true });
      }

      while (events.length > 0) {
        const event = events.shift();
        if (!event) continue;
        const textDelta = extractText(event);
        if (!textDelta) continue;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
        }
        accumulatedText += textDelta;
        yield {
          textDelta,
          accumulatedText,
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
    reader.read().then(resolve, reject).finally(() => {
      requestSignal.removeEventListener("abort", onAbort);
      firstTokenSignal?.removeEventListener("abort", onAbort);
    });
  });
}
