/** Shared reconnect pacing for console and channel transports. */
export function readAgentTransportRetryDelayMs(attempt: number, random = Math.random): number {
  const ceiling = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
  const boundedRandom = Math.min(1, Math.max(0, random()));
  return Math.round(ceiling / 2 + (ceiling / 2) * boundedRandom);
}
