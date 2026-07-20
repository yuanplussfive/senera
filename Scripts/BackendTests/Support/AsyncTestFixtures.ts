export function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

export async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
}
