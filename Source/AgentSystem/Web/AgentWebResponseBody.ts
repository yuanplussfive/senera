import type { AgentWebFetchTransfer } from "./AgentWebTypes.js";

export async function readBoundedWebBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ readonly body: Uint8Array; readonly transfer: AgentWebFetchTransfer }> {
  const declaredContentLength = parseContentLength(response.headers.get("content-length"));
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    const retained = body.subarray(0, maxBytes);
    return {
      body: retained,
      transfer: {
        maxBytes,
        receivedBytes: retained.byteLength,
        ...(declaredContentLength === undefined ? {} : { declaredContentLength }),
        truncated: body.byteLength > maxBytes,
      },
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (next.value.byteLength <= remaining) {
        chunks.push(next.value);
        total += next.value.byteLength;
        continue;
      }
      chunks.push(next.value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return {
    body: concatBytes(chunks, total),
    transfer: {
      maxBytes,
      receivedBytes: total,
      ...(declaredContentLength === undefined ? {} : { declaredContentLength }),
      truncated,
    },
  };
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
