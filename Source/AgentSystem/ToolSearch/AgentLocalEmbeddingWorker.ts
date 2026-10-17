import { parentPort } from "node:worker_threads";
import { embedDocument, embedQuery } from "ternlight-mini-cn";
import { AgentEmbeddingPriorities } from "../Vector/AgentEmbeddingContract.js";
import {
  AgentLocalEmbeddingWorkerRequestTypes,
  AgentLocalEmbeddingWorkerResponseTypes,
  type AgentLocalEmbeddingWorkerEmbedRequest,
  type AgentLocalEmbeddingWorkerRequest,
  type AgentLocalEmbeddingWorkerResponse,
  type AgentLocalEmbeddingWorkerWarmupRequest,
} from "./AgentLocalEmbeddingWorkerProtocol.js";

const port = parentPort ?? missingParentPort();

const queue: Array<AgentLocalEmbeddingWorkerEmbedRequest | AgentLocalEmbeddingWorkerWarmupRequest> = [];
let scheduled = false;

port.on("message", (message: AgentLocalEmbeddingWorkerRequest) => {
  if (message.type === AgentLocalEmbeddingWorkerRequestTypes.Cancel) {
    // Messages from one parent port are ordered. A cancellation can therefore
    // remove an operation that has not started; a synchronous WASM operation
    // already running cannot observe a message until it finishes, and its
    // response is ignored by the parent after cancellation.
    const queued = queue.findIndex((entry) => entry.requestId === message.requestId);
    if (queued >= 0) queue.splice(queued, 1);
    return;
  }

  if (message.type === AgentLocalEmbeddingWorkerRequestTypes.Warmup) {
    queue.push(message);
  } else {
    queue.push(message);
  }
  schedule();
});

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(processNext);
}

function processNext(): void {
  const next = takeNext();
  if (!next) {
    scheduled = false;
    return;
  }

  try {
    if (next.type === AgentLocalEmbeddingWorkerRequestTypes.Warmup) {
      embedQuery("");
      post({ type: AgentLocalEmbeddingWorkerResponseTypes.Completed, requestId: next.requestId });
    } else {
      const vectors = next.input.map((text) =>
        Array.from(next.role === "query" ? embedQuery(text) : embedDocument(text)),
      );
      post({
        type: AgentLocalEmbeddingWorkerResponseTypes.Completed,
        requestId: next.requestId,
        vectors,
      });
    }
  } catch (error) {
    post({
      type: AgentLocalEmbeddingWorkerResponseTypes.Failed,
      requestId: next.requestId,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  // One operation per event-loop turn lets a foreground request or a
  // cancellation overtake the next derived catalog vector.
  setImmediate(processNext);
}

function takeNext(): AgentLocalEmbeddingWorkerEmbedRequest | AgentLocalEmbeddingWorkerWarmupRequest | undefined {
  const foreground = queue.findIndex((entry) => entry.priority === AgentEmbeddingPriorities.Foreground);
  const index = foreground >= 0 ? foreground : 0;
  return queue.splice(index, 1)[0];
}

function post(message: AgentLocalEmbeddingWorkerResponse): void {
  port.postMessage(message);
}

function missingParentPort(): never {
  throw new Error("Local embedding worker requires parentPort.");
}
