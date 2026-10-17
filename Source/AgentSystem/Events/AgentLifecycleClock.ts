export interface AgentLifecycleClock {
  /** Wall-clock epoch used to render the beginning of an operation. */
  now(): number;
  /** Monotonic clock used only for elapsed duration measurement. */
  monotonicNow(): number;
  timestamp(epochMilliseconds: number): string;
}

export const SystemAgentLifecycleClock: AgentLifecycleClock = {
  now: () => Date.now(),
  monotonicNow: () => performance.now(),
  timestamp: (epochMilliseconds) => new Date(epochMilliseconds).toISOString(),
};
